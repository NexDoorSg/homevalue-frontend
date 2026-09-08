# HomeValue Office handoff recovery

Office remains the sole Company Lead routing, assigned-consultant email and WhatsApp acknowledgement owner. `/api/send-lead` retains the existing HomeValue authentication and structured property payload. It sends no standalone admin email and never returns Office assignment or provider response bodies.

Both public valuation pages use the same browser recovery helper for report requests, consultations and intent changes. It freezes a UUID `submissionId`, original `submittedAt`, property/contact payload and optional consent evidence before any attempt. Office's existing HomeValue canonical-payload receipt includes that stable identity; retries send the identical payload. No Office architecture or schema change is needed.

The existing HomeValue `leads` save remains first. A confirmed save is checkpointed before Office handoff; recovery retries only Office and never inserts the local row again. Overlapping attempts are blocked. Failed handoffs retain form details and consent, do not unlock the report or show an intent-success confirmation, and expose a retry/download panel. Existing landing-page analytics still fires on a confirmed local insert, never on Office retry.

Recovery is confined to this browser tab's session storage: versioned records, one per form kind, 24-hour retention. Reload/navigation restores the original request; edits cannot replace a pending request. Details are not logged. Blocked browser storage prevents a new network attempt. An uncertain local insert/update is held for manual review with a download option, never automatically repeated. Closing the tab or expiration ends browser recovery; this is not a durable server queue. Users should download unresolved details before leaving.

Each user-triggered attempt performs at most one Office request, with bounded local-save, server handoff and browser timeouts. Office failures return safe 409 (review), 502 (handoff unavailable) or 503 (configuration unavailable); malformed JSON/consent returns 400. The browser accepts success only when both HTTP and `success: true` agree. Raw provider/customer errors are not logged or returned.

No migration, new dependency or new environment variable is required. Existing `NEXDOOR_OFFICE_URL` and `HOMEVALUE_OFFICE_SYNC_TOKEN` remain unchanged. Obsolete email variables/dependencies are deliberately not removed in this PR. HomeValue WhatsApp stays retired, and existing production firewall protections are unchanged. Do not merge until reviewed; no production submissions are part of validation.

Validation: mocked recovery/route tests, property and consent regressions, Python transaction-integrity unit tests, TypeScript, production build with synthetic build variables and provider fetch blocked, and CI. Full-repository lint has 93 errors on unchanged main; this PR does not broaden into unrelated lint repairs.
