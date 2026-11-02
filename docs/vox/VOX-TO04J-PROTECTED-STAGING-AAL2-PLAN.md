# VOX TO-04J — Protected Staging Real Supabase AAL2 and IDOR Smoke

**Source-ready, NOT run on staging, never production authorization.**

A true VOX security certification needs actual Supabase Auth **AAL1** and **AAL2** session tokens belonging to distinct synthetic Staff users, plus a genuine Core Staging environment with approved VOX migrations, one independently attested first Team Leader, current department and exact Core subject grants, and configured protected staging source.

The read-only runner `scripts/mvp/vox/run-to04j-protected-aal2.mjs` deliberately pins its only network destination to **https://staging-core.quickfurno.in/api/vox/v1/work-queue** (the hostname in the existing VOX Web BFF allowlist). It makes exactly four HTTPS **GET** requests and disallows redirects. It cannot invite Staff, change permissions, create approval, mutate task, pause Jarvis, or send WhatsApp. It never prints session tokens or raw Core response bodies.

## Protected human execution prerequisites (currently unavailable)
- Independent approved security reviewer, DBA-reviewed 86-migration ledger/restore, signed protected release, active verified first Team Leader and a canonical signed grant implementation.
- All ten missing VOX Staff/work SQL objects installed **on approved protected staging only**, RLS/grant/security-view compatibility tested against real synthetic identities.
- The actual protected staging operator provides environment variables privately (never in PR, logs or chat):
  `VOX_QA_HUMAN_APPROVED_STAGE` = `ACKNOWLEDGED_BY_EXTERNAL_HUMAN`,
  `VOX_QA_EXPECTED_CORE_ORIGIN` = `https://staging-core.quickfurno.in`,
  `VOX_QA_AAL1_TOKEN`, `VOX_QA_WRONG_CITY_AAL2_TOKEN`, `VOX_QA_SCOPED_AAL2_TOKEN`.
  These string values are a runner safety check, **not cryptographically verified independent human signoff**. Protected reviewer and artifact proofs must be separately verified.
- Explicit operator command, inside an approved private staging environment only: `node scripts/mvp/vox/run-to04j-protected-aal2.mjs --protected-read-only`.

## Strict expectations
1. No token → 401/403.
2. Real verified AAL1 Staff token → 403.
3. Real verified AAL2 Staff with foreign city/no Core exact-object grant → 403.
4. Real verified AAL2, current department/TL reviewer and exact object/city-scoped Staff → 200 with **READ_ONLY**, `actionsEnabled:false`, max 25 masked items, `BOUNDED_NOT_TOTAL`. Any additional PII fields or executable buttons fail closed.

503 for any case means feature/schema is not active: NOT READY. Real stage errors, timeouts, redirects or untrusted schema mean NOT READY. The runner returns sanitized statuses only and reports **releaseAuthorized:false even if all GET assertions pass**. It does not certify live concurrency, Postgres restore, Riya signed pause, Anisha consent/provider outbox, vendor fair matching or AGNI.

PR CI runs only offline mocks and a no-token dry run. It intentionally **never** connects to protected staging, loads secrets, changes Supabase Auth or deploys a service.
