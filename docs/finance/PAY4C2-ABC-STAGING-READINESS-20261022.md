# PAY-4C2 A+B+C parallel readiness — financial release HOLD

**22 October 2026 | Source-only review work | No managed Staging/Production writes**

Stacked on Finance PAY-4C1 draft PR #392 at head `d00c101e246cf3f692b5b961e0328336f85bef50`.

## A. Database & security
- Added `scripts/mvp/payments/financePay4c2MigrationReview.mjs`, verifying the pinned quarantined VOX 20261014010000 SQL SHA against recorded history and read-only recorded 86/86 Staging/Production migrations; detects unauthorized copy to `supabase/migrations`, fails closed and explicitly reports **old validator BLOCKED**.
- This does NOT resolve the historical migration validator. Source hash match is not authorization to apply it. No migration lists altered, no candidate SQL installed.
- The earlier generated independent DBA read-only catalog queries remain in `ops/finance/PAY4C1-DBA-READONLY-CATALOG-REVIEW.sql`. Execution against managed Staging and object-level attribution of Supabase security advisor warnings remain pending until independently authorized.
- Prior first-party Supabase security advisors identified, in **each** environment: `security_definer_view` ERROR; `authenticated_security_definer_function_executable` WARN; `rls_enabled_no_policy` INFO. No verified mapping to a Finance V2 object; not certified resolved.
- A human DBA must review exact live role/grant/RLS/view catalog results and produce authorized rollback/forward-fix plan.

## B. Real identity and Finance reviewer separation
- `financePay4c2IdentityPreflight.mjs` inspects existing Core `verifiedStaffBearer`, `verifiedScopedStaff`, Finance-scoped grants and Core case/reviewer routes for real Supabase Auth validation plus AAL2, neutral Staff role, department enforcement, revocation, independent owner approval, and fresh Finance-grant check before writes.
- These are **source checks only**. Neither a genuine Owner Superadmin AAL2 sign-in nor an employee Staff AAL2 login was performed or certified in this batch; no one was onboarded, granted permissions or approved.
- Do not bootstrap a first Team Leader by temporarily removing independent review. Staff roles and Finance grants must come through approved existing Core identity and independent reviewer process. Genuine cross-tenant and revoked-grant tests require named approved test accounts and authorized Staging.

## C. Signed Staging release, provider TEST readiness
- `financePay4c2StageRelease.mjs` computes deterministic SHA-256 fingerprints of nine Core/VOX source files together with the 12 source candidate SQL hashes and prior migration/advisor snapshots. This is a **source fingerprint only**, not a signed build, artifact attestation, backup or certification.
- Every sensitive Finance flag is expected OFF. The preflight fails when a sensitive flag is enabled without approved activation, and always reports `releaseStatus=HOLD`, `installMigrations=false`, `runWorker=false`, `realProviderWritesAllowed=false`, `realSigningComplete=false`.
- No genuine Razorpay TEST checkout/capture/failure/refund/webhook canary was initiated. No TEST credentials, production secrets or webhooks were copied, and no provider/bank/credit transaction occurred.
- Controlled Staging requires independent DBA/AppSec approval, actual Owner/Staff MFA, verified signed Core+VOX digests, backup/restore validation, provider TEST-only account, webhook HMAC, monitoring, kill switch and Owner permission.

## Continuous QA
- New five focused C2 tests include source hash/quarantine, forbidden runnable copy, MFA/Finance security source guards, deterministic fingerprint and an enabled-flag negative test. Run combined PAY1–PAY4C2 finance tests and original Razorpay 51 checks, Core/VOX TypeScript + full production builds, native Docker --network none PostgreSQL17 candidate tests with 2 real client refund reservation race; exact-head GitHub workflows.
- The PAY4C1 isolated PostgreSQL contention prior passed with exactly one of two 7000-paise reservations against a synthetic 10000-paise capture; Staging and real gateway concurrency still not certified.

## Mandatory external sign-offs — still outstanding
1. Independent DBA reconciles quarantined VOX validator, actual current remote object grants, the security advisor findings and approved staged migration order, with tested backup and forward recovery.
2. Independent AppSec validates existing Owner+Staff genuine AAL2, neutral Staff principals, independent Team Leader and Finance grants, reviewer separation and service-role boundaries.
3. Owner explicitly authorizes signing and deployment of an approved TEST-only Staging release. Complete signed source/build image digest and rollback plan.
4. Only then perform genuine Razorpay TEST scenario execution and reconciled bank evidence; refund/consumed-credit decision remains human.
5. Final Owner GO/NO-GO for production after independent certification.

**PR remains draft and unmerged; financial release HOLD.**
