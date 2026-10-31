# VOX — Next P0 parallel start: real HTTP and grant-expiry QA — 31 October 2026

**Source:** consolidated VOX Draft PR #450; JARVIS desktop, Node 24, Docker Desktop Linux engine. This checkpoint supersedes none of the previous managed release HOLD requirements.

## What was actually completed in this follow-up

1. **Current GitHub CI evidence:** Before new work, 100/100 of the first 100 returned Actions runs on `3c04d26fff6969dbbe2869a28b815a35f14c0a3e` were completed success. The new head, once committed, needs fresh independent CI.
2. **E / Real local Next.js HTTP:** Launched the compiled VOX Web Next.js standalone-configured build on **127.0.0.1:3107** only. New executable `apps/vox-web/scripts/validate-locked-http-runtime.mjs` checks actual HTTP, not source contracts. **8/8 PASS:** root locked 200, Operations restricted 200, Vendor 360 restricted 200, Finance unavailable 200; four protected APIs return 503. No bearer/service role leaked in response bodies; no managed URLs or credentials were contacted. This does **not** mean authenticated staging features function yet.
3. **C / Time-of-check authorization hardening:** `services/vox/rc8PgVendorConversationOperator.ts` now repeats current PostgreSQL `clock_timestamp()` expiry checks *inside the same serializable transaction immediately before commit*: Staff membership, conversation object scope, independently reviewed capability and request, reviewer Team Leader membership and (when applicable) client-project binding. Earlier locks prevent ordinary concurrent revocation updates, but they did not prevent the clock from expiring a formerly valid grant. All resulting errors roll back rather than perform a takeover.
4. **C / Genuine PG17 negative test:** `validate-vox-rc8-real-pg-vendor-core.mjs` inserts a controlled expired scope after staging the receipt but before commit. A fresh authorization check rejects the write, proving **no additional event, receipt, revision or takeover**. Entire native Core PG17 suite PASS; no provider messages and writer remains hard-OFF.
5. **A/B/D parallel checks retained:** RC17–RC21 JavaScript/source regression **58/58 PASS**; root TypeScript PASS; real disposable Finance V2 PG17 five-function PASS (provider calls 0); real disposable signed EOD PG17 PASS (synthetic signers, production disabled). Prior isolated seven-migration recovery evidence remains valid, but no new managed recovery authority was obtained.

## Persistent blockers / next action

- **A:** Independent adjudication of malformed historical V1 Razorpay migration, exact managed schema and full Auth/Storage/Vault/role/physical object restore; isolated local replay does not count as managed acceptance.
- **B:** Provider-verified webhook reconciliation, human refund approval and consumed-credit reconciliation with immutable accounting and no automatic reversal of consumed credits.
- **C:** Actual Staff AAL2 enrollment, canonical AB7B and consent writer approvals and protected staging end-to-end workflow verification.
- **D:** Actual human Owner/TL independent keys, signoff, and reviewed publication authority.
- **E:** Full authenticated staging browser E2E across all VOX screens and feature flags; local unauthenticated HTTP checks are a preliminary fail-closed smoke only.

**All release gates remain HOLD:** PR #450 Draft/unmerged; no managed Staging/Production deployments, provider payment/refunds, real credits, external messages, real Staff onboarding or official EOD signing.
