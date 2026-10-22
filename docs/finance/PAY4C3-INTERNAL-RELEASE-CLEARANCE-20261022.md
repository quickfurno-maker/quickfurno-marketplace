# PAY-4C3 — Parallel internal technical clearance A–F and financial launch HOLD
**22 October 2026 — QuickFurno Finance V2 · internal test evidence, not independent external approval.**

Parent is PAY-4C2 [draft PR #393](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/393), head `ac553f5875e261018208042deca46966b6824e08`. This candidate is stacked above parent, not a merged or signed deploy. Core, VOX, AGNI and Jarvis unrelated deployments untouched.

## A — Database and migration reconciliation
- First-party **read-only** `pg_catalog` and Auth aggregate checks confirmed **Staging 1 Auth user / 0 MFA / 0 Finance / 0 VOX tables** and **Production 10 Auth users / 0 MFA / 0 Finance / 0 VOX tables**. There are **86 historical migrations per environment** in the prior migration lists. Prior to any finance deployment, reconcile `20261014010000_vox_v1_scoped_staff_authority.sql` with old migration-tree validator (currently **ENOENT exit 1**) while preserving quarantined files and their hashes.
- Twelve source candidate Finance SQL files remain **out of** `supabase/migrations`. Candidate index and SHA256 are in `financePay4bSqlReview.mjs`. Neither real DB has proposed Finance V2 tables, so source test PASS cannot be equated to staging certification.
- `ops/finance/PAY4C3-PREDEPLOY-READONLY-VERIFY.sql` contains reviewer queries for real RLS/EXECUTE/owners, policy definitions and existing public vendor view. It has NO DDL and was not run by an automated migration. Live read-only catalog inspection was conducted separately through connected Supabase.
- Disposable network-none PG17 rebuilt Finance candidate SQL and verified 18/18 FORCE RLS tables, no browser financial DML, immutable evidence, replay fencing, actual two-client refund cap and **NEW** two-client event inbox claim lease: exactly one of two concurrent PostgreSQL clients acquired a given synthetic event lease; attempt count 1. Pre-change pg_dump restored, finance tables count 0.
- **Remaining:** independent DBA signs precise reconciled migration versions, remote DDL/ACL diff, application order, backup/restore and owner-approved Staging migration. No schema was installed in managed Staging/Production.

## B — Identity and staff access
- Existing Core source gates verify genuine Supabase Auth user, AAL2 Owner Superadmin and neutral Staff, revocable expiring object- and department-scoped Finance grant, fresh recheck and independent case review.
- **Actual facts:** 0 verified MFA factors in BOTH projects and VOX staff tables absent. Thus genuine Owner MFA/Team Leader bootstrap/Staff AAL2, Finance role and negative cross-vendor/revocation end-to-end tests **CANNOT be certified** in existing managed environment. No account, password, TOTP factor, new authentication or staff grants were created.
- Next human tasks: existing Owner enroll AAL2 interactively in Core Auth; independent authorized staff reviewer enroll AAL2, then approved scoped grants after reviewed Staging migrations; test fresh invalidation and replay denial. No self-approval bypass.

## C — Security hardening
- Live Supabase security advisor findings in BOTH environments: `security_definer_view` ERROR, `authenticated_security_definer_function_executable` WARN, `rls_enabled_no_policy` INFO.
- Object attribution from live PG catalog: `public.vendor_public_v` has no security-invoker option and can be selected by both anon/authenticated; it intentionally filters public approved/active/visible vendors with positive credits. Blindly switching to SECURITY INVOKER without a verified public vendor RLS policy could break marketplace discovery.
- `public.is_admin()` and `public.owns_vendor(uuid)` are SECURITY DEFINER, executable by signed-in users (anonymous EXECUTE denied on Staging), and use `auth.uid()` to check owner/profile. Their functions use public search_path. Authenticated `profiles.role` or `profiles.is_active` UPDATE permissions **not granted** on checked projects; no demonstrated direct role edit exploit.
- Never blindly revoke function execution because these functions are used by Core RLS. Secure object owner/search_path and behavior must be assessed on isolated/staged DB, regression-tested for public listing, normal vendor login and owner/admin, and approved before mutating managed schema.
- **Remaining:** independent AppSec object-level review and remediations with regression evidence.

## D — Signed release engineering and observability
- `financePay4c3OperationalClearance.mjs` integrates the exact current read-only counts and unresolved advisors, source candidate hashes and previous Staging source preflight into a deterministic readiness fingerprint. It cannot be promoted by mocked attestation booleans or enabled feature flags and never claims actual cryptographic signing.
- All Finance flags/worker cron stay OFF. Release pinning must use exact signed Core+VOX digests and reviewed SQL fingerprints; rollback and kill-switch must be verified using approved Staging backup, not a source checklist.
- **Remaining:** approved backup and restore in managed Staging, independent DBA/AppSec/Owner TEST-only authorization, signed Core/VOX artifact digest, secrets and origin firewall validation, monitoring and rollback.

## E — Payment, refund and bank operations
- Existing offline source tests cover signed checkout/webhook HMAC, mode+merchant+order+payment+amount binding, webhook idempotency, exactly-one lease, refund over-reservation denial (two 7000-paise requests against a 10000-paise captured synthetic attempt yield one reservation and one rejection), reviewer independence and consumed-credit policy.
- Existing Razorpay TEST runbook still requires real merchant TEST account, genuine provider GET, payment captured/failed/timeout/duplicate, partial refund, settlement/UTR, bank evidence and staff-visible order/payment history. No real provider call, bank transfer, refund or wallet credit in this batch.
- **Remaining:** approved end-to-end Razorpay TEST Staging canary, actual bank/UTR evidence, refund-submitted ambiguity/compensation and financial case audit signoffs.

## F — Continuous adversarial QA
- `node --test scripts/mvp/payments/validate-finance-v2-pay*.test.mjs` includes new PAY4C3 source guard tests.
- Original `node scripts/mvp/payments/validate-vendor-package-razorpay.mjs` 51 assertions; Core+VOX production builds/TS; isolated Docker PG17 source schema, RLS, webhook and refund tests + new real two PG claimant test; exact-head GitHub Actions workflow on the draft PR.
- Always record exact SHA, failures and fixes, and GitHub CI before calling it source-green. Local source, simulated TEST, isolated PG, actual Staging, human signoff and production authorization are separate statuses.

## Source versus actual deployment
`ops/finance/PAY4C3-LIVE-INTERNAL-READONLY-AUDIT-20261022.json` is a time-stamped, non-secret read-only observation only. Its JSON data cannot authorize release or remain fresh after environment changes. `financePay4c3OperationalClearance.mjs` always reports `releaseStatus=HOLD`, no managed SQL, worker scheduling, real Razorpay TEST calls or production money writes.

### External/staging blockers — exact prerequisite sequence
1. Human Owner uses actual MFA enrollment in existing Core Supabase Auth; independent reviewer/Staff AAL2 and approved first Team Leader governance (0 verified MFA now).
2. Authorized DBA resolves historical VOX migration validator mismatch and reconciles managed SQL/RLS/functions/grants and backup/restore; AppSec reviews Core security-definer findings, public listings and staff authorization.
3. Signed TEST-only Staging migration/deploy after independent DBA/AppSec plus Owner approval; real protected Team Leader/Finance grants and negative access tests; worker stays OFF until explicitly authorized.
4. True Razorpay TEST payment/refund/webhook/settlement/bank trials, zero double credits and no over-refund verified in managed Staging, monitored canary, rollback drill.
5. Independent final reviewer evidence, Owner GO/NO-GO and **separate** production promotion; do not treat future review as retroactive authorization.

**Financial launch decision: NO-GO / RELEASE HOLD.** No managed schema, Auth, provider or payment changes performed.
