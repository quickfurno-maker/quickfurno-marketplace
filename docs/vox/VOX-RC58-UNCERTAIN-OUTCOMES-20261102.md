# VOX RC58 — Repository-only uncertain-outcome corrections

**Date:** 2 November 2026. **Base:** protected Draft PR #450 SHA `c0bdb31c83df3e68ede2593fb5609fe137936715`. **Scope:** GitHub source code only, without JARVIS/PC. **Decision: RELEASE HOLD.**

## Engineering changes

**Core:** The reviewed but uninstalled atomic conversation operator now reports `committed:null`, `commitState:"unknown"`, and `retrySameNonceOnly:true` on all failure paths **after** an atomic SQL RPC is attempted (timeout, transport error, malformed receipt, expired or revoked Staff after receipt). Before-RPC denials still truthfully report `committed:false`. This removes a false rollback claim when a transaction may already have committed. Does not retry the RPC or issue provider messages; database nonce/revision remains authoritative.

**Finance:** The reviewed but uninstalled bad-lead credit-restoration adapter now reports `CREDIT_OUTCOME_UNKNOWN` on transport failure or an unverifiable result after attempting an atomic LEAD credit RPC. It does not disclose raw backend errors, claim failed transaction rollback, retry automatically or authorize a second credit. Continue the locked rule: **one LEAD credit to the vendor per approved original consumed assignment, never cash refund, monetary wallet credit or replacement assignment.** Genuine canonical, cross-evidence unique index and human Owner AAL2 remain required before installation.

**EOD:** The reviewed read-only dedicated PostgREST reviewer now checks both initial and post-read credential freshness (issue and not-before age <= 3600 seconds). Data returned after the credential ages out is discarded. Official signed EOD remains uninstalled.

**Web BFF / Staff UX:** The authenticated VOX Web adapter now preserves Core HTTP 504 uncertain results, and marks other Core 5xx or lost HTTP responses as unknown with the exact same-nonce recovery contract. It does not create a fresh command, auto-send provider messages or claim a rollback. An explicit Core HTTP 403 response bearing a strictly validated post-RPC `committed:null` receipt is also propagated as uncertain rather than ordinary pre-RPC denial. This is covered by an actual BFF regression test. Its existing Web integration suite has added 503, 504 and transport-loss regression tests.

**QA:** Focused regression tests, the protected GitHub workflow and the existing VOX Web integration workflow cover these changes, full code paths and existing disposable PostgreSQL 17 functional proofs. No protected launch flag changed.

## Remaining independent and operational prerequisites

This source batch is not a genuine managed Staging acceptance test. JARVIS is offline; the private 31 original managed-only SQL capture remains on JARVIS and has not been exported. Database version differences (7), duplicate managed SQL pairs (2) and unmatched source-only files (85) still need qualified adjudication and isolated full Auth/Vault/Storage/PostGIS/ACL/PITR restoration. True Owner + separate Team Leader MFA, approved staging migration and rollback, Staff UAT and independent qualified DBA/AppSec approval are outstanding. Managed Staging, Production, live lead-credit/payment writers, provider WhatsApp/RCS and official EOD remain HOLD.

**Validation:** this GitHub-only commit is NOT described as source-certified until exact-head GitHub CI completes successfully. Source-only regression tests and actual disposable PostgreSQL workflow must run on GitHub Actions.
