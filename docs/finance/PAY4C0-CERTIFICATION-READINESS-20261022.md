# QuickFurno Finance V2 — PAY-4C0 parallel certification-readiness evidence

**22 October 2026 · SOURCE ONLY · RELEASE HOLD · No signed Staging deployment created**

This report records completed internal source/evidence work for PAY-4C0 A–E, with PAY-4C0 F automated QA. It does not represent independent DBA or AppSec sign-off, a legally verified bank statement, a production migration, or Razorpay TEST certification.

## C0-A — live read-only database history
Connected first-party Supabase migration listing was queried **read-only** for the explicitly named QuickFurno Staging and Production projects on 22 October 2026. Both returned **86 versions**. Staging most recent version: `20261013144901`; Production: `20261012181000`. Neither inventory contained historical VOX `20261014010000_vox_v1_scoped_staff_authority` nor any Finance V2 candidate. This is recorded without Supabase project credentials in `ops/finance/PAY4C0-READONLY-MANAGED-MIGRATION-EVIDENCE-20261022.json`. `financePay4c0ManagedHistory.mjs` verifies that observation schema and known absence conditions against the 12-file candidate manifest; it **cannot** verify live SQL bytes, ACLs, RLS policies, remote DB objects, migrations that share different canonical names, or reviewer approval. An optional read-only catalogue query was blocked by tooling security checks and **no such SQL query was executed**.

The old legacy migration-tree validator still references the nonexistent `supabase/migrations/20261014010000_vox_v1_scoped_staff_authority.sql` despite the pinned matching source being intentionally quarantined at `ops/vox/quarantined-migrations/legacy-20261014/` with SHA-256 `a5d0da20590b178b5e0aaff5045fe9957e367f9396baea4e86222bcc7d076c4c`. **Do not copy the SQL, alter the manifest or repair migrations merely to produce green tests.** Independent DBA must reconcile the exact managed schema, DB migration lists, grants, roles, financial source bytes and documented forward-recovery plan before ANY managed apply.

## C0-B — AppSec and identity assurance packet
`contracts/vox/financePay4c0SecurityReview.mjs` records the required existing Core Owner Superadmin AAL2, Core Staff AAL2, department+vendor object assignment, separate active Finance read grant, independent approval and grant revocation, no browser service-role credentials, reviewed SQL SECURITY DEFINER ACL/search_path and FORCE RLS/invoker views. It is an evidence classifier, not an authorization mechanism. Independent human AppSec must review real authenticated sessions, token/session revocation and current DB permissions. Cursor can prepare independent review findings but is not itself independent human signoff. No Staff finance grant or approval was issued.

## C0-C — Razorpay TEST execution plan, NOT transactions
`lib/payments/financePay4c0RazorpayFixtures.mjs` names nine expected TEST scenarios: provider captured; authorized-but-uncaptured; failed; late capture after failure notice; order mismatch; amount mismatch; merchant mismatch; LIVE event in TEST mode; provider outage. Dedicated deterministic tests assert no separate wallet authority. True TEST-mode checkout, provider GET, signed webhook deliveries, duplicate/reordered real messages and provider refund canaries are **NOT run**, pending authorized TEST credentials, account/mode binding and independently approved Staging. No provider account was contacted.

## C0-D — bank/refund and consumed-credit evidence controls
`lib/payments/financePay4c0Evidence.mjs` requires consistent synthetic three-way paise amounts, independent reviewer identifiers, reviewer MFA and statement fingerprints, but **always** returns `bankVerified=false`, `refundReleaseAllowed=false`, `markPaidAllowed=false`. A SHA-256 is not external bank document authenticity. Consumed-credit refund policy always forbids automatic clawback and refund execution. Source-only refund reservation and cancellation rules from PAY3/PAY4A remain quarantined; no Razorpay refund actions or bank receipt mutations are wired.

## C0-E — release packet
`scripts/mvp/payments/financePay4c0StageGate.mjs` checks the recorded migration observations, exact source candidates, forbidden feature flags and missing external approvals. It **always** returns `releaseStatus=HOLD`, `deployApproved=false`, `signedDeploymentCreated=false`, `workerSchedulingApproved=false`, and `providerTestAuthorized=false`, even if alleged sign-off booleans are supplied. This is NOT a cryptographically signed release artifact. Actual deployment digest, DBA/AppSec approvals, recovery and verified MFA belong in future controlled PAY-4C1.

## C0-F — continuous source and isolated database QA
`node --test scripts/mvp/payments/validate-finance-v2-pay*.test.mjs` includes PAY4C0 source scenarios. The pre-existing 51 Razorpay regression checks and Core/VOX typechecks and Next builds are preserved. Existing PAY3 isolated `--network none` PostgreSQL17 candidate test includes FORCE RLS, lease replay and clean restore. A proposed **two independent PG client sessions** concurrency test was attempted but caused a PowerShell parser failure in initial PR CI, and the script was reverted to the previously passing version; **real two-session refund contention remains NOT IMPLEMENTED or certified in PAY-4C0**. The supported source QA and existing isolated DB rehearsal remain release-HOLD. No managed Supabase changes.

## Mandatory review before subsequent activation
1. Independent DBA signs exact 12-file source candidate and staged SQL plan, compares live schema and grants, backs up and runs rollback/forward-recovery test, resolves legacy validator truth.
2. Independent AppSec reviews source and Staging identity, service-role RPCs, owner/staff MFA and separate Finance grants and reviewer independence.
3. Owner explicitly authorizes a controlled TEST-only Staging change. Exact Core/VOX signed artifacts, staged configuration and rollback GO required.
4. PAY-4C1 may then install authorized migration(s) and release TEST-only worker with verified monitoring. PAY-4C2 may run actual Razorpay TEST checkout/capture/failure/refund/replay and independently matched bank documents, with explicit money-flow policy. PAY-4D separate Owner final GO/NO-GO.
5. Production stays HOLD. No automatic wallet credit beyond existing canonical Core authority; no double reviewer, privilege bypass, fake bank proof or unsupported status claims.

**Source green is not launch certification. All mutation/deployment flags remain OFF.**
