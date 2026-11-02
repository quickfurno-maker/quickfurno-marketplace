# VOX RC59 — Staff/Finance operator outcome correctness

**2026-11-02 — Repository-only source candidate for protected Draft PR #450.** JARVIS private managed SQL backup unavailable. RELEASE HOLD.

### Web/Staff real route
The VOX BFF waits up to 6500 ms for Core to enforce its own 3500 ms atomic RPC timeout, allowing the Core 504 outcome to reach Staff rather than the BFF pre-empting it. No automatic command retry or provider message. The actual Staff UI retains its current command and nonce, blocks action/ID/revision edits when Core reports an uncertain result, and presents an explicit unknown-commit warning; a future same-nonce receipt may resolve the lock. Normal accepted receipts clear it. Client-side locks are UX safeguards, **not transactional authority**.

### Finance reviewed bad-lead recovery operator
The human-admin panel now retains a review-required latch per report in the current UI session when a canonical credit response is uncertain, absent/malformed, or a credit server action throws. It refuses another credit/reject decision for that report until review, rather than showing ordinary retry UX. The database-enforced original-assignment once-only unique authority remains primary; a page reload does not create an approved second credit. **Locked remedy: one LEAD credit on approved original consumed assignment, never cash refund, monetary wallet credit, or automatic replacement.** No canonical SQL installed or financial feature turned ON.

### QA and release gates
Real compiled VOX Web integration suite expanded, source-level UI/Finance regression tests and RC59 CI proof added to protected workflow. No managed Staging, Production, EOD, lead-credit/payment, outbound provider traffic or database DDL authorized. Source-only CI must pass on the exact new head before source certification.

### Genuine launch requirements remaining
Original managed SQL captured 31/31 privately on JARVIS; 7 managed-to-source differences, 2 duplicate managed SQL pairs, 85 unmatched source-only files and full independently authorized isolated Auth/Vault/Storage/PostGIS/ACL/PITR recovery remain unresolved. Real Owner/Team Leader AAL2, qualified independent DBA/AppSec, actual Staff Staging E2E/UAT, signed EOD authorizer and staged rollback must pass before Production GO.
