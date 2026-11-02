# VOX AB-7B — First genuine original-source Support Desk task integration (18 October 2026)

**Status:** uninstalled SQL candidate, local source-integrated Next route behind TWO staging feature flags. **RELEASE HOLD / DRAFT / UNMERGED**. Cursor and independent DBA/AppSec review deferred, not waived.

## Change
- Existing `POST /api/vox/v1/support-task` previously invoked `createVendorTask` as an independent CRM write. That did **not** atomically prove immutable Staff F1 attribution.
- New candidate route uses only `qf_vox_ab7b_support_task_atomic_candidate_v1`; *no legacy fallback*. It requires verified current Supabase AAL2 neutral `support_agent` identity and precise Support Desk object scope. It rejects other Staff roles until their own reviewed native grant paths exist.
- The uninstalled Core PostgreSQL function locks the existing genuine `vendor_support_threads` row, resolves its actual vendor service zone/city, creates the native `vendor_tasks` task and appends the AB7B immutable `SUPPORT_DESK` Staff original/F1/unique nonce in **one transaction**. The AB7B trigger checks current neutral Staff, team, city, source kind, department and object grants. A failure rolls back the original task too.
- Raw request cannot set actor, team, city, vendor, task title, source or arbitrary SQL. The route inherits verified Staff scope and uses a tightly normalized task with deterministic idempotency key.
- Explicit gates: `VOX_SUPPORT_INTERNAL_TASKS_ENABLED=staging` **and** `VOX_SUPPORT_ATOMIC_AUDIT_ENABLED=staging`; both OFF in active release environments. This does not authorize installing candidate SQL or activating either switch.

## Verified local QA
- Fresh isolated Docker `postgres:17-alpine --network none` passed synthetic pre-existing three native sources + genuine canonical `vendor_tasks` original insert → Staff F1 + nonce.
- Positive exact count: **1 actual Vendor CRM task / 4 native source actions / 4 F1 events / 4 unique nonces**.
- Negative SQL proof: duplicate idempotency/nonce DENIED, revoked Staff source object grant DENIED and rolls back the original Vendor CRM task; forced RLS, immutable events, cross-source actor forgery, ungranted object and revoked conversation consent retain their previous PASS proofs.
- Full Core source tests and Next app typecheck/build are required after every change; no live Auth accounts, managed Supabase DB or worker/providers touched.

## Remaining gaps
**A:** Real independent Staff Auth invitation/suspension/active grant/session revocation, first Team Leader approval.
**B:** Integrate genuine original Aarohi CRM and Core Conversation mutations, then certify all three native source families in protected staging; the Support Desk SQL itself still requires independent DBA source schema/RLS/concurrency review.
**C:** Signed real private Core↔Jarvis dual-evidence transport with durable consent/JTI and human-controlled handover.
**D:** True source key custody, four-source watermark writers and atomic official EOD/TL submission with correction handling.
**E:** Registered internal worker, alerts, SLA, DLQ requeue governance and AGNI/AOS read-only telemetry.
**AB8:** Combined exact-head CI, real protected staging AAL2 and cross-role boundaries; then **AB9** external DBA/AppSec/Team Leader approvals, migrations/rollback and Owner GO/NO-GO.

**No claim of external certification, approval, or production readiness.**
