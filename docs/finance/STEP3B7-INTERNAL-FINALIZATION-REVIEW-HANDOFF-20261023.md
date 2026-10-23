# Phase 3B-7 — Internal Finalization / pre-approval review handoff
**Source-only:** no managed Staging/Production DDL or DML, no privileged Auth, no Razorpay TEST/LIVE provider requests, no WhatsApp sends.
**Base:** 3B6 RC2 commit `034305988bff6409e8c6d4aedd83624002f3cd4b` / DRAFT PR #401. Exact RC3 commit and CI to be filled only after independent GitHub verification.
## A — RLS / security
Fresh first-party *read-only* Staging catalog inventory on 23 Oct: 69 unique affected policies, 59 referencing `is_admin()`, 22 referencing `owns_vendor()`, 12 referencing both. Evidence `ops/vox/certification/STEP3B7-STAGING-RLS-READONLY-20261023.json`, policy-level classification `STEP3B7-POLICY-DECISION-MATRIX-20261023.json`, 69/69 **UNREVIEWED**. `step3b7PolicyReview.mjs` is a scenario categorizer, *not* SQL permission logic. Tests demonstrate fail-closed candidates; DO NOT certify actual effective PostgreSQL RLS or replace the ownership helper wholesale. Special pending decisions: suspended vendor historic payments/refunds, disputes, support, notifications, leads, WhatsApp logs; inactive Admin and revoked JWT sessions; SECURITY DEFINER public vendor discovery. AppSec/domain decision P0.
## B — VOX Staff / Vendor / Agent integrations
Direct tests call existing Core-verified `resolveScopedStaff`, `normalizeAgentSubjectAccess`, `hasHumanCoreConversation`, `projectStaffServiceDesk`, `filterHumanConversations` and `projectProspectVendor` with synthetic verified/revoked scopes. Assert Anisha vendor and Aarohi prospect isolation, human takeover and revision, current grants, Staff role/city boundaries, metadata-only/support read, zero permission to send/reply, no automatic prospect-to-vendor link. These are in-memory contract tests, not actual Riya/Anisha/Aarohi WhatsApp or managed Auth/E2E certification.
## C — Owner identity transition
Existing script `scripts/grant-superadmin.mjs` remains intentionally hard-disabled. Added fault/replay/reviewer separation, stale epoch, exact Phase22 and compensation negative scenarios against `owner-superadmin-transition-plan.mjs`. Even synthetically complete approvals yield `authorizedToExecute:false` and `crossSystemTransactionCertified:false`. No genuine MFA/AAL2 or first Team Leader role operation claimed.
## D — VOX Finance history
`step3b7FinanceHistoryPreview.mjs` exercises existing Core Staff `evaluateFinanceReadGrant` and PAY3 `financeTimeline` with strict merchant/mode/order/vendor/event isolation, duplicate event denial and sorted immutable sanitized metadata. Every preview explicitly denies capture, refund and wallet authority. Manual UTR is not verified settlement. No provider calls and no money movement.
## E — Continuous source QA
Run Step3B1 through 3B7 HOLD validators, isolated VOX 507 base cases plus additions, Finance 79 base cases plus additions, Owner 27 plus 3B7 faults, Core/VOX TypeScript, CI exact-head. Record initial failures and corrections transparently; no audit statement based solely on green source tests.
## Outstanding managed and approval dependencies
- Independent DBA: resolve 52/52 migration semantic drift and full global-role/ACL/PITR/storage rollback proof. Staging Phase22 not approved.
- Independent AppSec: effective 69-policy review (59 admin/22 vendor, 12 overlap), OR/AND composition, other grants, JWT revocation, public view behavior.
- Owner: explicit exact-source Staging-only written authorization AFTER genuine distinct reviews; real MFA and first TL onboarding.
- Razorpay real TEST provider certification only after correct managed permissions; Production independent release approval.
**HOLD:** Staging, Production, privileged Auth, Razorpay money operations.
