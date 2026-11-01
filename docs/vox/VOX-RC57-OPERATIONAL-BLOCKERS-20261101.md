# VOX RC57 — operational blocker fixes and remaining completion gates

**Date:** 2026-11-01. **Base:** exact protected PR #450 commit `473c2b6de1d19a6b6044b46652b699f0b12d6933`. **Status: source-only, NOT a production or managed Staging deployment approval.**

## Integrated implementation

**A. Database reconciliation:** New `scripts/mvp/vox/rc57-private-lexical-reconciliation.mjs` analyzes ONLY verified private original Staging migration SQL after 31/31 independently checked second-read manifests, comparing bounded SQL token sequences against SHA-256-verified source SQL. Comments and unquoted-identifier case are normalized; quoted literal and dollar-quoted bodies retain their exact contents. Private JARVIS execution confirmed **821 baseline statements, 117 eligible long token sequences and 107 source files**, with **zero strict token-substring matches**. No original SQL, credentials or secrets printed or committed. **This is not semantic equivalence or proof of incompatibility, and must not be used to approve aliases.** Seven managed-version discrepancies, two duplicate-SQL pairs and 85 unmatched source-only files persist. Full Auth/Vault/Storage/PostGIS/ACL/PITR isolated recovery and independent qualified DBA/AppSec review still pending.

**B. Core:** Uninstalled atomic conversation operator now bounds an unanswered RPC to a maximum 3.5-second default (test-injectable 25–5000 ms). A timed-out SQL call returns `504 ATOMIC_RPC_OUTCOME_UNKNOWN` with `committed:null`, `retrySameNonceOnly:true`, and `providerMessagesSent:0`, never a false rollback assertion, a fresh-nonce retry or a provider send. Actual SQL may have committed; the database remains authoritative. Existing route, pre-RPC and post-RPC live AAL2/Staff/city/team verification are retained, and no protected writer was enabled.

**C. Finance:** Uninstalled candidate SQL now independently verifies the expected per-assignment cross-evidence index is genuinely unique, valid, ready, a single original-assignment btree key with an active-restoration predicate, rather than trusting `CREATE INDEX IF NOT EXISTS` when a same-name index exists. The disposable PostgreSQL 17 harness was strengthened to handle benign psql NOTICE stderr correctly without ignoring nonzero SQL exit codes. Both simulated-wallet and real canonical credit-authority/ledger PostgreSQL 17 variants passed including a spoofed nonunique same-name index rejection. **Locked bad-lead policy: exactly one LEAD credit for an approved original consumed assignment, never a monetary refund or money wallet credit, and no automatic replacement.** This reviewed SQL is NOT applied to managed Staging or Production.

**D. EOD:** The dedicated reviewed, read-only PostgREST token adapter now denies ancient issue/not-before JWTs over one hour old. The actual PostgREST role/signature grant and dual distinct real-human Owner/Team Leader AAL2 gates remain mandatory. Official EOD remains uninstalled.

**E. QA:** Five independent isolated worktrees; each track's targeted tests passed before cherry-pick. Protected PR CI now includes RC57 diagnostic, actual Finance index identity tests, Core timeout outcome and EOD reader tests. Existing protected flags remain hard OFF.

## Verification and limitations

- Five isolated commits cherry-picked into a clean RC57 integrated branch. Focused targeted tests all PASS.
- Both genuine disposable PostgreSQL 17 credit proofs PASS, including overlapping transactions, a direct second competing restoration, counterfeit-index rejection and real canonical credit ledger conservation. These are NOT production activation.
- Full repository-wide VOX source suite **1,457/1,457 PASS**, after clearing the existing live WhatsApp token from this isolated test subprocess only; the gate was not relaxed. Root TypeScript **PASS**, protected-feature OFF gate **PASS**, native Next.js 16.4.1 production build **PASS** with clean `npm ci`. Fresh-head GitHub CI must still complete before source certification.
- **Release HOLD:** no managed Staging DDL/deployment, Production activation, payment/credit mutations, provider messaging, or official EOD. Outstanding independent full managed isolated recovery/qualified review, Owner+Team Leader MFA, genuine Staff/VOX UAT, controlled Staging rehearsal and rollback, and separate Production GO.
