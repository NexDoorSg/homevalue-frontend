# Durable HomeValue → Office capture

PR #74 replaces the separate admin email and browser-only handoff with atomic HomeValue capture plus one private, source-specific outbox. Office retains Contact/open-Lead resolution, global routing, consultant email, consent and acknowledgement ownership. No Office change is required.

## Capture and immutable identity

Both current public forms submit a frozen versioned envelope to `/api/send-lead`. The server validates bounded JSON, same-origin requests, contact/property fields, UUID/time and original optional consent. Canonical ISO submission and consent timestamps allow at most 60 seconds of positive browser clock skew; consent must still be granted no later than submission. It owns `source: HomeValue` and passes only validated fields to a service-role RPC. It does not accept a browser-supplied numeric Lead ID or routing/paid policy.

`homevalue_capture_handoff` atomically creates the existing HomeValue Lead and its handoff. Replaying an identical UUID returns the existing state; a changed payload/time/kind/parent conflicts. The unique submission lock covers concurrent captures, including uncertain database responses. No retry generates a replacement UUID. New IDs are not backfilled from historical rows.

An intent event has its own UUID and references the original capture UUID as a capability. The RPC resolves the local Lead server-side, checks the original contact/consent binding, updates the plan and inserts a separate immutable event in one transaction. Under the same parent lock, a first-time intent older than any accepted intent for that parent is rejected before updating the Lead or inserting a handoff. Exact replay of an accepted UUID still returns its existing state without reapplying its plan. A server-generated immutable capture order preserves per-Lead delivery ordering. Parent and older intent events must be delivered before later intent events; review blocks later events for that Lead until resolved. No standalone update can commit without its handoff.

The exact Office JSONB snapshot includes submission UUID, original ISO timestamp, enriched project/postal/property details and optional consent evidence ID, granted time, notice version and submitted phone. JSONB key order may change, but the semantic payload is immutable. Office's canonical-payload receipt hash is order-independent. Workers never rebuild this payload from mutable Lead rows.

## One private table and three server-only RPCs

The single additive migration creates `homevalue_private.office_handoffs` with:

- submission UUID, original timestamp, immutable server capture order, event kind, local Lead ID and optional parent submission UUID;
- immutable Office payload (maximum 32 KB);
- pending/delivered/review state, attempt count, next/last attempt times, delivered time;
- claim UUID and lease expiration;
- allowlisted failure code and HTTP status only, never provider text.

RLS is enabled with no browser policies. PUBLIC, anon, authenticated and service_role have no direct schema/table privileges. Only the three explicitly granted RPCs are callable by service_role. They use fixed, empty search paths and qualified tables. Browser roles cannot execute them. An immutable-column trigger prevents changing identity, payload, consent or Lead association through status updates.

RPCs: `homevalue_capture_handoff`, `homevalue_claim_handoffs`, `homevalue_finish_handoff`. Claim uses `FOR UPDATE SKIP LOCKED`, a fresh lease UUID and a two-minute lease. Claims are capped at ten even if a caller requests more. Settlement requires the current unexpired lease, so a stale worker cannot overwrite a newer result.

## Delivery and recovery

After capture commits, the request immediately attempts the existing authenticated Office `/api/leads` path with the stored payload. HTTP success marks delivered. Timeout, transport failure and retryable server errors remain pending with exponential backoff (two minutes initially, capped at 17 hours 4 minutes). Input/identity 400/409/422 becomes review and is not automatically retried. A failed settlement or crashed worker is recovered after lease expiry.

If Office committed but the response was lost, replaying the identical snapshot reaches its existing canonical receipt rather than another routing turn or acknowledgement. HomeValue never calls Meta or retries provider messages. Provider response bodies are neither read nor returned. The public capture response is only `{ success: true, captured: true }` after the transaction commits, not a claim that Office delivery has completed.

Session storage remains only a convenience for uncertain capture responses. Pending identities do not expire into new UUIDs. After confirmed durable capture, users can close the tab; the runner does not depend on their session. Completed browser conveniences expire after 24 hours. Prior #74 browser-only records are not converted into new captures.

## Scheduler and later configuration

`GET /api/cron/homevalue-office-recovery` requires timing-safe Bearer authentication using `CRON_SECRET` (at least 32 random characters). It returns only aggregate counts. Each invocation claims at most ten due rows and delivers them concurrently within a 60-second function limit; each Office request has a 30-second timeout. The two-minute leases outlive the function's execution window.

`vercel.json` schedules one invocation daily at `0 1 * * *` (01:00 UTC, approximately 09:00–09:59 Singapore time on Hobby). This is compatible with the current Hobby plan, which permits only daily cron execution. It recovers up to ten due events per daily invocation; outage backlogs can take multiple days. A reviewed faster schedule on a supporting plan, or an approved manual authenticated invocation of the same runner, requires no new intake architecture. Do not treat this daily cadence as near-real-time recovery.

Later Production configuration, **not performed by this PR**:

- Existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are reused server-side.
- Existing `NEXDOOR_OFFICE_URL` and `HOMEVALUE_OFFICE_SYNC_TOKEN` remain unchanged.
- New `HOMEVALUE_DURABLE_INTAKE_ENABLED=true` enables capture and recovery only after the migration and scheduler credentials are installed. Default is disabled.
- New `CRON_SECRET` authenticates Vercel's runner invocation. Set as a Production secret, never public.
- Applying the migration, enabling the flag/cron, merging/deploying and real acceptance testing require separate approval. No Vercel variables were configured during development.

## Migration and rollback safety

One migration only: `supabase/migrations/20260908081054_homevalue_office_handoff.sql`. It creates only new schema/table/index/functions/trigger and grants. It does not modify existing customer rows, Lead policies, schema columns or historical data. There is no backfill: historical consent and submission identities cannot be reconstructed safely.

For an operational rollback, disable the new flag and keep the table/records intact. This prevents new capture and automatic recovery without discarding pending work. Do not roll back to a browser-only sender while accepting new requests, and do not drop populated handoffs. A structural rollback may drop the three public RPCs and the new private schema only when the table is proven empty and that removal is separately approved. Existing Lead rows remain untouched.

Both current public forms use atomic capture. The unused legacy `/api/unlock-full-report` POST delegates to the same validated handler, so it cannot silently insert without an outbox record; old payloads lacking immutable identity fail before writing. Historical deployments and existing direct database grants are not retroactively converted or backfilled; rollout must continue preserving existing legacy-deployment firewall protections.

## Verification

Disposable PostgreSQL tests exercise atomic rollback, replay/concurrency, immutable evidence, intent binding/order, RLS/privileges, leases and terminal states. Mocked route/worker tests exercise safe auth/config/input handling, lost Office responses, unchanged replay payload and one canonical routing/email/acknowledgement. No tests use production databases or real providers. CI includes PostgreSQL 17, all JS/Python regressions, typecheck, focused lint and a production build with synthetic variables and provider fetch blocked.
