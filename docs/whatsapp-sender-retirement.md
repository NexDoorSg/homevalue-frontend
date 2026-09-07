# Retire the legacy WhatsApp sender

This change removes direct Meta acknowledgement sending from `/api/send-lead`. Office synchronization, its returned assignment, and the existing admin email remain unchanged. Legacy WhatsApp environment variables no longer affect this route. No new dependencies or notification system are introduced.

Do not merge or deploy until the replacement Office sender has been verified and the owner explicitly approves cutover. This branch alone does not change production.

## Cutover with no overlap

1. Keep Office automatic acknowledgements disabled. Verify the dedicated WhatsApp credential, exact phone registration/coexistence, approved template, callback, consent capture and status processing.
2. After explicit approval of the exact recipient and message, run an isolated Office-code send test to an internal consenting recipient that never passes through HomeValue. Do not enable global production sending or submit a real HomeValue form for this test. Confirm acceptance, delivery/read status and reply matching.
3. After a separate cutover approval, deploy this removal while Office sending is still off. Verify the production deployment and drain prior in-flight HomeValue requests. Leads continue syncing and email remains available during the temporary acknowledgement gap.
4. Account for old deployment URLs and Preview deployments that still contain sender code and credentials. Before enabling Office, block their send capability by revoking the identified legacy WhatsApp token (only after its scope and other consumers are verified), or by removing access to all old sender deployments and proving requests have drained. Removing an environment variable from a new deployment does not neutralize old deployments.
5. Verify actual source messaging-consent capture. HomeValue currently supplies no explicit PR9 consent proof; do not infer it from a phone number, intent or valuation request. Without recorded proof, Office correctly suppresses acknowledgement.
6. Only after old-send capability is proven off, set Office's legacy-sender-retired gate and enable acknowledgements. Existing historical leads are not backfilled. Verify one authorized new lead and duplicate replay.

Rollback: disable Office sending first. Never restore the HomeValue sender while Office sending or an Office send request remains active. Preserve all acknowledgement claims and consent evidence.

## Validation

Two executable route tests use synthetic credentials and mocked Office/email transports: successful/failed Office sync and repeated submissions retain sync/email behavior and never call Meta. Existing identity/email regression tests, TypeScript checks, and Python tests are also run. No real network message is sent by these tests.
