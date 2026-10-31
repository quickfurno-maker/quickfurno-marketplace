# VOX RC24 — A/B-first integration with C/D/E continuous QA

Date: 31 October 2026. Target: existing Draft PR #450 (not `main`).
Disposition: **SOURCE IMPLEMENTED / MANAGED RELEASE HOLD**.

## Isolation and traceability

Five new JARVIS isolated worktrees cut from identical PR #450 head `849284a4f7897d56a4cfc4a018bf9bbf9364ca41`: `qf-vox-rc24-a-migrations`, `qf-vox-rc24-b-core`, `qf-vox-rc24-c-finance`, `qf-vox-rc24-d-eod` and `qf-vox-rc24-e-qa`. Separate focused tests were run before cherry-picking the first three validated changes. Tracks D/E ran additional full integration and regression tests on the consolidated branch.

### Priority A — migration and recoverability

`scripts/mvp/vox/rc23-migration-adjudication.mjs` now explicitly pins the exact SHA256 of the **managed Staging read-only evidence snapshot** and checks the complete filename set (162 versioned SQL files) against the SHA-pinned current local migration inventory. A changed source file, added/removed file, duplicate version, altered captured snapshot or equal-count filename swap refuses the release packet with a deterministic error. `rc24-source-snapshot-parity.test.mjs` passes. No database connection or DDL.

The history discrepancy remains unchanged and is substantive: managed Staging has **86 recorded migrations**, with **55 matching source versions, 31 Staging-only versions and 107 source-only versions**. Every source-only version is historical (earlier than the latest managed Staging version `20261013144901`), and **zero** is a straightforward append-only candidate. This is NOT a safe replay plan. Qualified independent DBA/AppSec must adjudicate lineage, historical V1 Razorpay defects, exact role/RLS/function parity and a full Auth/Storage/Vault/physical objects/PITR restore before approved Staging DDL.

### Priority B — operational Core and consent integration

New `rc24-core-consent-serialization.test.mjs` binds the *actual canonical D2-D STOP/START transactional RPC SQL* `20260712000300_communication_consent_command_writer_rpc.sql` to the *actual native Core PostgreSQL conversation writer*: both take the same `hashtextextended('dst|' + destination_hash + '|whatsapp',0)` advisory xact lock, before reading/writing the relevant suppression state. The tests ensure suppression-only STOP/START cannot manufacture marketing consent. It protects this specific serialization relationship from unnoticed code drift. Native Core real disposable PostgreSQL 17 transaction/consent/AB7B/rollback suite PASS, zero provider sends. Genuine Staff-to-Core writer production path remains **HARD OFF**, actual managed AAL2/Staff schema absent and canonical cross-writer D2-D mutations still require approved live acceptance.

### Track C — Finance hardening

Actual Next.js Razorpay vendor-package webhook route now limits raw HTTP body to **64 KiB before signature verification**, rejects declared oversize, invalid declared length, deceptive length, malformed UTF-8, empty body and oversized streamed input, while preserving the exact UTF-8 text passed to the existing HMAC verifier. The new `readBoundedRazorpayWebhookBody.mjs` and TypeScript declaration are free of provider/DB side effects. `rc24-webhook-body-limits.test.mjs` **4/4 PASS**. This does not change provider refund execution, consumed-credit accounting or the review-only V2 SQL authority. No live provider calls.

### Track D — signer

Retained the RC23 signer-key window, AAL2 recency, actual database Staff membership TTL, signed-envelope expiry and signed-nonce atomicity interlocks. Real disposable PG17 signed EOD suite PASS with synthetic keys, no official publication. Human key registry remains empty and real signer writer hard OFF.

### Track E — continuous QA and CI

On consolidated candidate, **RC17–RC24 contract tests 86/86 PASS**, root `npm run typecheck` PASS, real disposable PostgreSQL 17 Core, Finance V2 five-function, signed-EOD suites PASS; VOX Web full `npm test` PASS and Next.js 16.3.8 `npm run build` PASS. The existing GitHub release-HOLD workflow now includes RC24 tests and triggers on the bounded webhook code/route. Exact-head CI must be verified after pushing; older CI results do not certify a new commit.

## Unresolved — never mark these internally complete

1. Approved migration reconciliation of 31 Staging-only/107 historical source-only versions, malformed Razorpay V1 replay, and qualified independent DBA/AppSec review.
2. Full recoverable managed Supabase Staging backup/restore with Auth, Storage objects, Vault, roles, ACLs, ownership, recovery and rollback evidence.
3. Actual reviewed Staff AAL2 identity and canonical production Core/AB7B/consent writer integration, Staff team setup and end-to-end protected Staging tests.
4. Real provider-authoritative Finance settlement, webhook recovery, audited refunds and consumed-credit policy/atomic revocation with human approval.
5. Owner and separate Team Leader MFA, human Ed25519 key ceremony, signed EOD publication authority, protected feature-level Staging acceptance.
6. Final Owner Production authorization and qualified independent review.

**HOLD:** no managed Staging or Production migrations/deployments, real money/refunds/credits, messages, official EOD or PR merge. Production readiness cannot be truthfully claimed from the above local tests.
