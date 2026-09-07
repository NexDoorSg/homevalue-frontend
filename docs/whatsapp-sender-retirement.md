# HomeValue consent and Office-only WhatsApp cutover

HomeValue's report-unlock and consultation forms offer the optional, unchecked notice `homevalue-whatsapp-v1`. Checking it captures an evidence UUID and ISO timestamp; editing the recipient phone clears it. The later intent selection forwards the same original evidence, without inferring consent from intent or refreshing the time. Missing consent still permits the existing HomeValue Lead save, Office sync and email.

The server accepts only affirmative evidence with the recognized version, valid UUID and nonfuture timestamp. It forwards the validated object over the existing authenticated Office sync. Consent is not added to the browser-written HomeValue `leads` row: Office's existing private WhatsAppConsent ledger is the durable evidence store. Office must be deployed with the matching contract first. No HomeValue database migration or new notification system is needed.

The route no longer calls Meta, regardless of legacy WhatsApp environment variables. Office assignment and the existing admin email are preserved. A failed Office sync now returns a failure status instead of success. No Ads credentials, registration/coexistence or Meta configuration changes are part of this PR.

## Approval and deployment order

1. Review/deploy the coordinated Office consent PR first, with OFFICE_WHATSAPP_ACK_ENABLED=false. It accepts the optional contract, records evidence transactionally, preserves original Lead receipt identity, and prevents existing/re-engaged Leads from acquiring a new introductory acknowledgement. Old HomeValue clients remain compatible.
2. With explicit cutover approval, deploy this HomeValue PR while Office acknowledgements stay false. Verify the production source and opt-in form, then verify consent, Lead assignment and consultant email with an approved consenting owner submission. An unchecked submission must still save/sync without a new consent grant. No automatic WhatsApp message is expected yet. Leads created while acknowledgements are off do not form a send backlog.
3. Neutralize old HomeValue production/preview/branch deployment URLs containing sender code, and drain in-flight requests. Removing current environment variables alone does not revoke secrets embedded in old deployments. Prefer disabling access to old sender deployments and verify it. Revoke a legacy WhatsApp token only if its exact identity and every consumer are established and the owner explicitly approves; never guess or revoke shared Ads credentials. If old-send capability cannot be proven off, do not set the retirement gate or activate Office.
4. Keep the generic Business App greeting disabled, and leave manual Quick Replies unchanged. Owner confirms there is no Away Message. Verify dedicated Office credential send permission without broadening access implicitly.
5. After HomeValue retirement and consent are deployed and verified, stop and propose the normal PR9 controlled production test: one approved new consenting Company Lead through actual HomeValue intake, universal routing, assigned-consultant email, one exact approved Office template, status/reply checks and duplicate replay. Obtain the owner-approved window, recipient and rendered message. Set HOMEVALUE_SENDER_DISABLED=true only when step 3 is proven. Receiving/sending activation require the approved test window; no temporary bypass exists.
6. Close the test window and restore Office flags OFF unless continuing live operation is separately approved. Preserve claims/evidence. No blind retry after timeout or uncertain provider outcome.

A temporary acknowledgement gap is intentional: leads and email keep working while Office sending is off. Never enable both old HomeValue and Office automatic senders. A cutover rollback must disable/drain Office sends before any restoration of old sender code. Do not erase acknowledgement claims or consent records.

## Meta Ads readiness

Future Meta Lead Forms and Website/Landing Page adapters must use Office's existing trusted intake and affirmative consent contract. The actual form/campaign, consent version and evidence mapping must be defined and verified before activating an adapter. No new campaign adapter or Ads permission is created by this work.
