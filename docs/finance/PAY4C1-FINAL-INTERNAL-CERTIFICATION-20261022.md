# QuickFurno Finance V2 — PAY-4C1 Internal Certification Readiness
**22 October 2026 · SOURCE + ISOLATED TESTS ONLY · FINANCIAL RELEASE HOLD**

Parent: PAY-4C0 PR #391 head `af7687807460a3d6914c9dc24324e5099ce013cb`.
This candidate must remain in DRAFT review, not merged/deployed without independent Owner, DBA and AppSec authorization.

## C1-A — Real database concurrency and recovery
The existing `scripts/mvp/payments/validate-finance-v2-pay3-pg17.ps1` uses a disposable PostgreSQL 17 Docker container with `--network none`. Added a synthetic finance attempt/capture of 10,000 paise and two **independent PostgreSQL client processes** in `finance-pay4c1-two-clients.sh`. Both race to reserve 7,000 paise on separate approval references via Core's actual `qf_finance_v2_reserve_refund` with advisory transaction lock. Acceptance: exactly **one** succeeds, **one** fails, active ledger exactly **1 row and 7000 paise**, no double-refund. The script restores the pre-change PG dump and proves zero finance tables in baseline. Earlier PAY3/PAY4B offline rehearsal also covers signed webhook idempotency, lease-token fencing, stale-token rejection, immutable evidence, dead-letter exhaustion, independent review, RLS and browser grant denial. No genuine Razorpay API calls or financial transactions. A larger 10-connection distributed database soak and actual simultaneous inbox claimant race remain recommended before operator certification; previous ten JS-worker test is only a simulation.

## C1-B — DBA permission and migration review
Connected Supabase `list_migrations` showed 86 versions each in QuickFurno Staging and Production; no `20261014010000` VOX migration or Finance V2 SQL candidate. The legacy VOX SQL is intentionally quarantined and its hash matches the pinned ledger. The older runnable migration-tree validator remains **unresolved/FAIL**. Do not import quarantined SQL or fake history to satisfy it. Prepared `ops/finance/PAY4C1-DBA-READONLY-CATALOG-REVIEW.sql`, a review-only catalog query plan for real DB table/view FORCE RLS, function owners, `SECURITY DEFINER`, public/authenticated/service-role privileges, with no DDL. **NOT EXECUTED** against managed environments; previous attempted remote catalog query was blocked by tool safety checks. Independent DBA must run authorized queries, reconcile exact versions and source hashes, verify grants, schema drift, backup restore and roll-forward before applying any finance candidate.

## C1-C — Independent AppSec / MFA evidence
First-party Supabase security advisors (read-only) show in **both environments** one `security_definer_view` **ERROR**, one `authenticated_security_definer_function_executable` **WARN**, and one `rls_enabled_no_policy` **INFO**. Snapshot is preserved in `ops/finance/PAY4C1-SUPABASE-SECURITY-ADVISORS-20261022.json`.
The first two warnings in each environment (four findings total) require object-level review and are **not yet attributed to Finance V2**. Remediation references:
- https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
The existing Core Superadmin Owner AAL2, neutral VOX Staff AAL2, department, vendor scope, distinct reviewer and revocable Finance grant must be positively tested in genuine Staging. Code policy cannot invent an independent human reviewer, fresh Auth session or RLS assurance.

## C1-D — Razorpay TEST and bank policy
`lib/payments/financePay4c1TestPlan.mjs` creates a deterministic **test-only**, nine-scenario Razorpay canary runbook with explicit additional duplicate event-ID, changed payload hash, checkout signature tamper, partial refund overcapture, possibly submitted refund release, statement mismatch, lease expiration and consumed-credit human review cases. All real provider actions are **disabled**, even if a caller sets every checklist boolean. Existing bank policy evidence SHA and three-way paise matching cannot certify bank authenticity. Existing refund-case approval cannot mint credit or submit provider refund. A genuine Razorpay TEST account, independently approved API/webhook credentials, actual bank statements, and Owner/DBA/AppSec signoffs are outstanding.

## C1-E — Release engineering HOLD bundle
`financePay4c1Certification.mjs` joins exact 12 quarantined source SQL candidate SHA hashes, managed migration observation, quarantined VOX source integrity, and the Supabase security-advisor snapshot to produce a deterministic SHA-256 fingerprint and explicit missing external gates. It is **not a cryptographically signed build, migration, provider authorization or Owner approval**. No Github secrets or credentials written. Signed Core/VOX build/digest, backup, identity grants, migration manifests, worker monitor/scheduler, emergency stop and rollback/forward-recovery require externally authorized preparation. The verifier always reports financial release HOLD and cannot turn approvals on.

## C1-F — Continuous QA
Run PAY1–PAY4C1 focused Node tests, original 51 Razorpay checks, isolated PostgreSQL17 SQL permission/transaction/restore suite, Core and VOX TypeScript and production builds and all exact-head GitHub workflows. On any CI failure, keep the draft unmerged and release HOLD. Document counts and exact PR SHA in Notion once verified.

## External dependencies still blocking launch
Human independent DBA signed review and legacy migration reconciliation; real managed database ACL/RLS SQL evidence and genuine Staging backup; AppSec signoff on actual function/view exposures and Owner/Staff MFA; Stage signed release with origin firewall and secure worker lease monitoring; Razorpay TEST checkout, captured/failed/refund/replay; settlement and bank account verification; consumed vendor-credit refund policy; Owner final GO/NO-GO. No managed Staging/Production writes, provider charge/refund, bank transfer or live worker scheduling may occur in this source batch.
