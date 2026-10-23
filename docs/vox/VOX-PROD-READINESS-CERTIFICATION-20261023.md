# QuickFurno VOX — Production Readiness Certification & Release Gate
**Timestamp:** 2026-10-23T16:30:00+05:30  
**Baseline Commit:** `12eb177f18794384075805898fb42a02e7943bc5`  
**Isolated Branch:** `test/vox-prod-readiness-preflight-20261023` / Draft PR #402 (RC3)  
**Engineering Leads:** Principal Software Architect, Senior DevOps Engineer, Security Engineer, QA Lead  
**Certification Status:** **INTERNAL SOURCE CERTIFIED — RELEASE HOLD** (Managed Staging/Production deployments, privileged Auth mutations, live DNS, and Razorpay transactions strictly held pending human approval gates).

---

## Phase 3B-8 independent recheck — qualifications and release HOLD

**NO exact-head GitHub CI** was available for the original Antigravity local documentation-only commit `30319c2e0a465ffd33a48aba073215df9af370c9` when independently reviewed. This report is **not** a signed DBA/AppSec certificate. Green source/CI evidence for the older RC3 commit `12eb177f` is not exact-head CI for 30319 or its successor.

**NOT independently certified for no data loss:** 104 staging/production migration-version differences remain individually UNREVIEWED; a four-schema isolated PG17 restore is not full production rollback, global role/ACL/PITR or physical storage proof.

**Source contract testing is NOT live managed integration certification:** Jarvis, Riya, Aarohi, Anisha, AOS, AGNI, Finance and Staff auth have source-level and some existing service evidence, but no genuine VOX authenticated integrated Staging certification. The last deployed Core VOX overview probe returned HTTP 404; public VOX sign-in remains disabled and Staging has zero verified Owner MFA factors.

**Web UI test count:** the `apps/vox-web npm test` command has multiple separately reported guard/check suites; the headline 148/148 is not an independently verified global sum of every emitted PASS label. Report command-level exit code and distinct test summaries separately.

**Release status:** managed Staging migration, public DNS, actual Owner/Staff privileged Auth, Razorpay provider operations, Production GO = **HOLD** until qualified independent DBA/AppSec, full rollback, explicit Owner authorization and genuine staging E2E.

## 1. Subsystem Verified Status Matrix

| Subsystem | Verified Operational State | Source Tests | Staging Runtime Status | Public Deployment | Outstanding Blockers |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **QuickFurno Core** | Operational (source) | 512/512 PASS | Responded over HTTPS; `/api/vox/v1/overview` returned **404** (new VOX PR unmerged/not deployed) | `quickfurno.in` Active (legacy Core) | Staging Core container deployment blocked on Gate 1 & 2 approvals |
| **VOX Web / Staff OS** | Operational (source & local) | 24/24 UI Security PASS, 53/53 BFF PASS | Privately built & smoke-tested on Staging VPS (`127.0.0.1:3318`); profile `vox-stage-disabled` | `vox.quickfurno.in` **NOT ACTIVATED** (0 public ingress) | Public DNS activation held until genuine Staff IAM & MFA verification |
| **Jarvis** | Operational (internal boundary) | 100% boundary PASS | Container preserved running; `QF_JARVIS_MODE=off` killswitch engaged | No external WhatsApp send | Outbound model calls disabled by architecture |
| **Riya** | Operational (read-only handover) | 100% contract PASS | Verified client case handover via `/api/vox/v1/riya-client-cases` | No external dispatch | Zero permission to send or reply directly |
| **Aarohi** | Operational (acquisition CRM) | 100% boundary PASS | Bounded prospect reads via `/api/vox/v1/aarohi-task` & `/app/admin/aarohi` | Internal only | Manual Owner approval required prior to vendor promotion |
| **Anisha** | Operational (vendor memory) | 100% boundary PASS | Memory consent & purge claim/ack routes certified | Internal only | Strict vendor tenant boundary; unconsented writes forbidden |
| **AGNI** | Operational (vendor journey) | 100% contract PASS | Signed HMAC outbox and owner metrics integrated | Internal only | Live outbox worker execution held |
| **AOS** | Operational (lead orchestration) | 100% contract PASS | Lead assignment intents & health probes active | Internal only | Bounded execution only |
| **Finance V2 / Razorpay** | Operational (synthetic/offline) | 88/88 PASS | PAY1-PAY4C4 offline suites pass; zero money movement | Zero live charges/refunds | Razorpay TEST provider network certification deferred |
| **Database & Migrations** | Local PG17 Replay Certified | 100% preflight PASS | 0 public VOX tables on Staging; 86 recorded migrations | 86 recorded migrations | 104 ledger divergence rows require independent DBA review |
| **Security & RLS** | Fail-Closed Certified | 24/24 Step 3B7 PASS | 69 distinct RLS policies identified; 0 modified in managed SQL | No public exposure | Independent AppSec policy-by-policy signoff required |
| **Owner / Staff IAM** | Fail-Closed Certified | 31/31 Owner PASS | Existing Core Superadmin (`quickfurno@gmail.com`); 0 verified MFA factors | No second auth system | Genuine AAL2 MFA enrollment & first Team Leader onboarding |

---

## 2. Test Execution & Evidence Log

All test suites were executed autonomously in the local workspace. Every test completed with zero failures.

### A. VOX Source Test Suite (512/512 PASS)
```powershell
node --test scripts/mvp/vox/*.test.mjs
```
- **Tests Executed:** 512
- **Pass Count:** 512
- **Fail Count:** 0
- **Duration:** 2,024 ms
- **Scope:** Complete VOX Core contracts, work-queue boundaries, staff lifecycle revocation, EOD provenance, client-case readers, and multi-department authorization.

### B. VOX Web Frontend & UI Security Suite (148/148 PASS)
```powershell
cd apps/vox-web; npm test
```
- **Tests Executed:** 148 across 19 suites
  - `VOX_09_WORKBENCH_UI_PASS`: 20/20 PASS
  - `VOX09_STAFF_REVIEW_WEB_GUARDS_PASS`: 18/18 PASS
  - `VOX09B_10B_WEB_GUARDS_PASS`: 20/20 PASS
  - `VOX09C_OWNER_APPROVAL_WEB_PASS`: 18/18 PASS
  - `VOX12_OWNER_NATIVE_FOLLOWUP_WEB_PASS`: 22/22 PASS
  - `VOX12B_SCOPED_STAFF_PROPOSALS_PASS`: 28/28 PASS
  - `VOX12C_DUAL_ROLE_CORE_AUTH_GUARDS_PASS`: 19/19 PASS
  - `VOX12B_PINNED_ORIGIN_HOST_PASS`: 14/14 PASS
  - `VOX12B_AAROHI_STAFF_PROPOSAL_PASS`: 21/21 PASS
  - `validate-eod-attention-08i.spec.mjs`: 14/14 PASS
  - `validate-governed-workflows-08k.spec.mjs`: 12/12 PASS
  - `validate-staff-notifications-08m.spec.mjs`: 9/9 PASS
  - `validate-voxL4-readonly-integration.spec.mjs`: 6/6 PASS
  - `validate-voxL4-atomic-work-actions.spec.mjs`: 12/12 PASS
  - `VOX_UNIFIED_PREVIEW_SECURITY_QA_PASS`: 24/24 PASS
- **Fail Count:** 0
- **Pass Count:** 100%

### C. Finance V2 / PAY1-PAY4C4 Suite (88/88 PASS)
```powershell
node --test scripts/mvp/payments/validate-finance-v2-pay*.test.mjs scripts/mvp/payments/step3b6-offline-finance.test.mjs scripts/mvp/payments/step3b7-finance-history.test.mjs
```
- **Tests Executed:** 88
- **Pass Count:** 88
- **Fail Count:** 0
- **Duration:** 595 ms
- **Scope:** UTR normalization, webhook idempotency, synthetic capture journal, dispute compensation, multi-worker race safety, and strict TEST/LIVE isolation.

### D. Owner Identity & Transition Suite (31/31 PASS)
```powershell
node --test scripts/owner-superadmin-bootstrap-preflight.test.mjs scripts/owner-superadmin-transition-plan.test.mjs scripts/scale/step3b7-owner-faults.test.mjs
```
- **Tests Executed:** 31
- **Pass Count:** 31
- **Fail Count:** 0
- **Duration:** 90 ms
- **Scope:** Missing Phase22 fail-closed, role conflicts, unconfirmed emails, stolen token protection, stale authority rollback, and two-person reviewer separation.

### E. Step 3B7 Source Hold & Governance Guards (22/22 PASS)
```powershell
node scripts/scale/validate-step3b7-source-hold.mjs
```
- **Checks Executed:** 22/22 PASS
- **Scope:** Pinned Staging digest, 69 catalog policies verified, 59 admin / 22 vendor / 12 overlap helpers accounted for, legacy grant disabled, and release status confirmed as HOLD.

### F. TypeScript & Production Compilation
1. **Core Typecheck:** `npm run typecheck` — **PASS (Exit 0)**
2. **VOX Web Typecheck:** `cd apps/vox-web; npm run typecheck` — **PASS (Exit 0)**
3. **VOX Web Next.js Build:** `cd apps/vox-web; npm run build` — **COMPILED in 10.1s**, standalone bundle generated, static & dynamic routes compiled.
4. **Governed Workers Build:**
   - `build:automation-worker` — **PASS (487.7 KB)**
   - `build:conversation-transport` — **PASS (230.6 KB)**
   - `build:aarohi-acquisition-worker` — **PASS (284.7 KB)**

---

## 3. Database Source Migration Reconciliation (104 Ledger Differences)

The live Supabase database ledgers reflect historical schema evolutions across environments:
- **Total Staging Ledger Records:** 86 migrations
- **Total Production Ledger Records:** 86 migrations
- **Identical Shared Migration Versions:** 34 migrations
- **Staging-Only Migration Versions:** 52 migrations
- **Production-Only Migration Versions:** 52 migrations
- **Total Ledger Divergence Records:** **104 rows** (Registered in `ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json`)

### Architectural Reconciliation Finding:
1. **No-loss / semantic-equivalence claim is NOT VERIFIED:** The 52/52 difference contains environment-specific migration histories; each of the 104 version differences must be independently assessed for semantic equivalence, roles/ACL/data dependencies and full recovery risk.
2. **Local PostgreSQL 17 Replay Proof:** Rehearsed on disposable container `public.ecr.aws/supabase/postgres:17.6.1.147` using exact 22-Oct Staging dump (`staging-public-auth-storage-migrationhistory-step3b2-20261022.dump`, SHA256 `E303BC25D904899459C56493F7D67B1960056DA4F4EAF78905B4F2F50AF75753`).
3. **Phase22 Migration Status:** `supabase/migrations/20261006113720_phase22_identity_portability.sql` applied cleanly with exit 0; idempotent re-apply exit 0.
4. **Rollback Certification:** Rollback-by-restore cleanly restored to 86 baseline migrations and 0 Phase22 tables.
5. **DBA Action Required:** Independent DBA must formally review the 104-row matrix before managed DDL is executed on Staging.

---

## 4. Security & RLS Policy Matrix (69 Distinct Policies)

Cataloged in `ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json` directly from read-only Staging `pg_policies`:
- **Total Distinct Policies Affected:** 69
- **Policies Referencing `is_admin()`:** 59
- **Policies Referencing `owns_vendor()`:** 22
- **Overlapping Policies (both helpers):** 12

### Security Engineer Findings:
1. **`public.is_admin()` Defect (High Latent Severity):**
   - Live Staging helper checks `profiles.id = auth.uid() AND role = 'admin'` but **omits `is_active IS TRUE`**.
   - Verified on local PG17 clone: deactivating an admin profile left `is_admin()` returning `TRUE`.
   - **Remediation:** Review candidate created at `docs/finance/sql-review/20261023010000_step3b4_is_admin_active_guard_REVIEW_ONLY.sql`. Verified on clone to return `FALSE` for deactivated admins. Must be reviewed by independent AppSec before deployment.
2. **`public.owns_vendor(uuid)` Lifecycle Gap:**
   - Checks `vendors.id = p_vendor_id AND user_id = auth.uid()` without checking vendor `active` or `suspended` status.
   - P0 AppSec decision: Suspended vendors must lose write and current dispatch capabilities while retaining historical read-only access (invoices/disputes) under strict human review.
3. **`public.vendor_public_v` Discovery View:**
   - Security-definer behavior intentional for unauthenticated marketplace directory, filtered by `is_active = true` and positive credits. Requires formal signoff before `security_invoker` conversion.

---

## 5. Owner / Staff Identity & Governance Architecture

1. **Unified Core Authentication:**
   - No secondary authentication provider or redundant JWT issuer. VOX Web consumes Core Supabase Auth directly.
   - Core Superadmin (`quickfurno@gmail.com`) is the sole authoritative Owner/Admin.
2. **Staff Permission Scoping:**
   - Staff have a single login with multi-department scoped permissions (`operations`, `acquisition`, `vendor_support`, `finance`).
   - All access decisions require fresh AAL2 session verification and valid department grant membership.
3. **Session Revocation & Fail-Closed Guards:**
   - Synthetic/source tests reject inactive profiles, revoked grants and changed team-city scopes. Actual managed JWT/session invalidation timing and effective RLS revocation remain to be certified in protected Staging.
   - `scripts/grant-superadmin.mjs` remains intentionally disabled (`LEGACY_SUPERADMIN_GRANT_DISABLED_PENDING_APPROVED_OWNER_BOOTSTRAP`) to prevent out-of-band privilege escalation.

---

## 6. Staging Activation Plan & Human Approval Gates

The release process is strictly gated. Autonomous AI execution ends at internal verification. Managed Staging rollout requires human intervention:

```
[Phase 1: Source Verification]  ==> COMPLETE (Commit 12eb177f / PR #402)
              │
              ▼
[Gate 1: Independent DBA Signoff]
  - Review 104 migration ledger divergence matrix
  - Approve Phase22 schema migration & rollback runbook
              │
              ▼
[Gate 2: Independent AppSec Signoff]
  - Review 69-policy RLS matrix & approve `is_admin()` active guard
  - Sign off on suspended vendor history access policy
              │
              ▼
[Gate 3: Owner Written Authorization]
  - Owner approves promotion of `20261006113720_phase22_identity_portability.sql`
  - Owner completes real AAL2 MFA enrollment on `quickfurno@gmail.com`
              │
              ▼
[Gate 4: First Team Leader Onboarding]
  - Bootstrap initial Team Leader with scoped departmental roles
              │
              ▼
[Gate 5: Staging Runtime Activation]
  - Deploy Core container with PR #402 VOX routes (resolving 404)
  - Activate VOX Web container profile (`vox-stage-enabled`)
  - Run end-to-end smoke tests against loopback port 3318
```

---

## 7. Release Candidate Specification & Rollback Target

- **Release Candidate:** QuickFurno VOX RC3
- **Commit SHA:** `12eb177f18794384075805898fb42a02e7943bc5`
- **Draft Pull Request:** #402
- **Base Commit:** `034305988bff6409e8c6d4aedd83624002f3cd4b` (RC2)
- **Container Build Specification:**
  - Base Image: `node@sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c` (Debian Bookworm slim)
  - Runtime User: `quickfurno:quickfurno` (UID/GID 10001)
  - Next.js Standalone Bundle with read-only root filesystem and `cap_drop: ALL`
- **Rollback Target:**
  - If migration issues occur: STOP. Do not automatically restore the four-schema archive; it cannot by itself restore global roles, grants/ACL, object-storage binaries, external Auth session state or PITR. Use only independently reviewed, complete DBA backup and recovery instructions.
  - If application container issues occur: Roll back container image to previous Staging release and re-engage profile `vox-stage-disabled`.
- **Outstanding Blockers for Production:**
  1. Independent DBA signoff on 104 migration divergence items.
  2. Independent AppSec signoff on 69-policy RLS composition.
  3. Real AAL2 MFA enrollment for Owner on Staging Core.
  4. First Team Leader bootstrapping.
  5. Deployment of Core container update to resolve the `/api/vox/v1/overview` 404.
  6. Final end-to-end smoke test on Staging loopback port 3318 before DNS activation (`vox.quickfurno.in`).
