# QF-MVP-20.3A — Consumer Migration Matrix

Every active caller identified in [`QF-MVP-20-CONSUMER-CALL-PATH-AUDIT.md`](QF-MVP-20-CONSUMER-CALL-PATH-AUDIT.md), with its exact migration target. **No code is changed in this task.**

Canonical targets: DB `qf_assign_lead_vendors_v2` · service `services/marketplaceAssignmentService.ts` · credit `qf_apply_credit_mutation_v2` (via `vendorCreditWalletService`) · eligibility `qf_vendor_assignment_eligible` / `lib/vendors/vendorMarketplaceEligibility.ts` · projection `vendor_public_v`.

**Revoke rule:** no legacy EXECUTE is revoked (Migration E) until every row below is `migrated` and proven by grep + staging assertion.

---

## 1. Assignment entry points

| # | Consumer (file:line) | Current call | Current authorization | Current defect | New call | Application change | Compatibility period | Staging test | Revoke prerequisite |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `app/actions.ts:167` **`assignLead`** | `leads.assignLeadToVendors` → `assign_lead_to_vendors` | **PUBLIC — no auth, no lead-ownership** | **Blocker H**: unauthenticated action can pass arbitrary `leadId`+`vendorIds` | **none — DELETE the action** | Remove the exported server action entirely (20.1 proved **no UI caller**) | **none** — remove immediately | T11 (anon/other-user cannot mutate) | **Must be removed before E** |
| 2 | `app/actions.ts:179` `sendClientSelectedVendorEnquiry` → `:250` `recordClientSelectedVendor` | `assign_client_selected_vendor_to_group` / `assign_vendor_to_requirement_group` | PUBLIC (creates the lead in-flow) | **Blocker A** (anon-executable RPCs in production), un-ledgered debit | `marketplaceAssignmentService.assign({mode:'client_selected'})` → `qf_assign_lead_vendors_v2` | Bind the created lead to the caller (session or signed intake token); add rate-limit/captcha; replace both group RPC calls | until consumers migrated | T11, T15 | migrated + ownership binding live |
| 3 | `app/actions.ts:685` `adminAssignLead` | `assign_lead_to_vendors` (`admin_assigned`) | `asAdmin` → `requireSuperadmin` | ledgered but legacy; writes `whatsapp_logs` in-txn (**Blocker J**) | `mode:'admin_manual'` | swap service call; comms become intents | short | T15, T16 | migrated |
| 4 | `app/actions.ts:703` `adminAssignLeadManually` → `manualLeadAssignmentService.assignLeadManually` → `:471` | `admin_smart_assign_lead_to_vendors` with `p_total_limit` | `asAdmin` + `requireSuperadmin` | **Blockers A, B, C** — anon-granted RPC, **un-ledgered debit**, `p_total_limit=9` in recovery mode (`manualLeadAssignmentService.ts:314`) | `mode:'admin_manual'`; **no limit parameter exists** | Delete `callSmartAssignRpc`; remove `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` usage | short | T1, T2, T15 | migrated + `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` removed |
| 5 | `services/leadDeliveryService.ts:54` (auto-match, via `leadMatchingEngine:198`) | `assign_lead_to_paid_vendors_phase26a` | service-role (system) | ledgered canonical base but **no lifetime-6** | `mode:'automatic'` | swap the boundary function; keep the ranked candidate pool | short | T1, T2 | migrated |
| 6 | `services/leadService.ts:373` `assignLeadToVendors` | `assign_lead_to_vendors` | caller-dependent (see #1/#3) | legacy; `MAX_VENDORS_PER_LEAD` advisory only | delete the wrapper once #1 is removed and #3 migrated | remove function | short | T15 | #1 removed, #3 migrated |
| 7 | `services/delayedLeadFillService.ts:444` | `admin_smart_assign_lead_to_vendors` (limit 3) | secret-gated cron (`x-qf-cron-secret`) | **Blockers A, B** — un-ledgered debit | `mode:'delayed_fill'` | swap call; worker identity as `actor_kind='worker'` | short | T1, T3, T4 | migrated |
| 8 | `services/delayedLeadFillService.ts:425` | `assign_lead_to_preferred_vendor` | secret-gated cron | **Blocker A**; RPC lacks total/lifetime checks | `mode:'delayed_fill'` (single candidate) | swap call | short | T2 | migrated |
| 9 | `services/preferredVendorLeadService.ts:256` (from `leadService.ts:278`, public funnel) | `assign_lead_to_preferred_vendor` | **public enquiry funnel** | **Blocker A**; no ownership/total/lifetime checks | `mode:'client_selected'` | swap call; ownership binding as in #2 | until #2 lands | T2, T11 | migrated |
| 10 | `services/clientRequirementGroupService.ts:371` | `assign_vendor_to_requirement_group` (`p_total_limit=3`) | superadmin processors + public path (#2) | **Blockers A, B, C** — un-ledgered | `mode:'client_selected'` / `'admin_manual'` | swap `callGroupAssignRpc` | short | T1, T15 | migrated |
| 11 | `services/clientRequirementGroupService.ts:619` | `assign_client_selected_vendor_to_group` (`p_total_limit=3`) | public path (#2) | **Blockers A, B, C** — un-ledgered | `mode:'client_selected'` | swap `callClientSelectedAssignRpc` | short | T1, T15 | migrated |

---

## 2. Credit / restoration consumers

| # | Consumer | Current | Defect | New | Change | Test | Revoke prerequisite |
|---|---|---|---|---|---|---|---|
| 12 | `services/vendorCreditWalletService.ts:53` | `qf_apply_vendor_credit_delta` | none (canonical base) | `qf_apply_credit_mutation_v2` | add trusted actor + idempotency key; restrict change types to the five canonical | T5, T6 | n/a (already safe) |
| 13 | `services/vendorAdminService.ts:144→167` (admin credits route) | canonical delta | actor is free-text | same, with `actor_kind='admin'`, server-derived `actor_id` | pass trusted actor | T5 | n/a |
| 14 | `services/adminService.ts:586` `approveBadLeadReport` | sets `bad_lead_reports.credit_restored=false`; **no refund** | no approval→ledger linkage | create `credit_restoration_approvals` row; apply via `qf_approve_credit_restoration_v2` | wire the approval workflow | T5, T6 | n/a |
| 15 | `services/vendorCreditWalletService.ts:93` `refundCreditForInvalidLead` | **UNWIRED** (TEST_ONLY) | no approval evidence | replaced by the approval workflow (#14) | delete or re-point at the approval path | T5 | n/a |
| 16 | `deduct_vendor_credit` / `restore_vendor_credit` / `increment_vendor_credits` | **no direct `.rpc()` caller**; invoked only inside legacy RPC bodies | un-ledgered (**Blocker B**) | none — retired with their callers | none | T19 | all of #4, #7, #10, #11 migrated |

---

## 3. Eligibility consumers (converge on the canonical evaluator)

| # | Consumer | Current evaluator | Defect | New |
|---|---|---|---|---|
| 17 | `lib/lead-assignment/autoAssignmentEngine.ts:68` | `evaluateVendorLeadAssignmentEligibility` | package/paid as **hard gate** | canonical (package → ranking) |
| 18 | `services/manualLeadAssignmentService.ts:218,398` | same | same | canonical |
| 19 | `services/delayedLeadFillService.ts:375` | same | same | canonical |
| 20 | `services/clientRequirementGroupService.ts:324,843` | same | same | canonical |
| 21 | `services/clientRequirementGroupService.ts:470`, `:676`; `services/delayedLeadFillService.ts:422` | `evaluateClientSelectedVendorEligibility` | **Blocker I** — `public_visibility` used as a hard assignment gate (`lib/vendors/vendorEligibility.ts:253-254,261`) | canonical; **drop the visibility gate** |
| 22 | `lib/aos/runtime/leadAssignmentApprovalService.ts:242` | `evaluateVendorEligibility` | package hard gate (preview ≠ reality) | canonical |
| 23 | `services/preferredVendorLeadService.ts:98-126` | inline `evaluatePreferredVendorDirectEligibility` | duplicate implementation | canonical |
| 24 | `services/leadMatchingEngine.ts:357` | `evaluateVendorAutomaticLeadEligibility` | **already canonical-shaped** | becomes the canonical implementation |
| — | `lib/vendors/vendorVisibility.ts` `getVendorPublicVisibility` | public listing only | correct scope | **unchanged** (never an assignment gate) |

---

## 4. Public vendor data consumers

| # | Consumer | Current | Defect | New | Test |
|---|---|---|---|---|---|
| 25 | `services/publicVendorService.ts:144` `getPublicVendorsForCategory` | `adminClient().from("vendors").select("*")` | service-role + `select("*")`; safe only by DTO convention | `vendor_public_v` with explicit columns | T12, T13 |
| 26 | `services/publicVendorService.ts:234` `fetchVendorRowByColumn` | same | same | same | T12, T13 |
| 27 | `app/actions.ts:142` `getMyVendor` | `serverClient()` RLS-scoped, full commercial | **correct** (owner) | unchanged | T14 |
| 28 | admin/CRM vendor views (`vendorAdminService`, `AdminSectionPage`) | full commercial, superadmin-gated | correct | unchanged | T14 |
| 29 | Production DB grant `GRANT ALL ON vendors TO anon` | — | **Blocker G** | revoked in Migration C | T12 |

---

## 5. Communication side-effect consumers

| # | Consumer | Current | Defect | New | Test |
|---|---|---|---|---|---|
| 30 | `assign_lead_to_vendors` SQL body (`whatsapp_logs` inserts) | writes `whatsapp_logs` **inside** the assignment txn | **Blocker J** | canonical engine writes a `communication_intents` row only | T16, T17 |
| 31 | `services/leadDeliveryService.ts:84,130,170` (`lead_delivery_logs`, `client_notification_logs`) | blind `.insert()` after commit | non-idempotent duplicates on replay | intents keyed by `idempotency_key`; preview logs become derived | T15 |
| 32 | `services/vendorNotificationService.ts:84` `createVendorNotification` | blind insert | non-idempotent | intent-driven | T15 |
| 33 | `supabase/functions/whatsapp-dispatch` edge function | drains `whatsapp_logs` → Meta | legacy delivery path | provider worker consumes **intents**; `whatsapp_logs` becomes read-only legacy | T17, T18 |

---

## 6. Workers, cron and test helpers

| # | Consumer | Current | New | Note |
|---|---|---|---|---|
| 34 | `app/api/admin/process-due-lead-assignment-queue/route.ts:77` | secret-gated → `processDueLeadAssignmentQueue` | unchanged route; the **service** switches to the canonical engine (`mode:'delayed_fill'`) | worker identity preserved |
| 35 | `app/actions.ts:663` `adminProcessDueLeadAssignmentQueue` | superadmin → same worker | same | — |
| 36 | `app/actions.ts:721-758` requirement-group / recharge processors | superadmin → group RPCs | canonical engine | — |
| 37 | `app/api/admin/lead-assignment-approval|preview` | superadmin, **preview-only** (writes `lead_assignment_approvals`) | unchanged in 20.3B | preview stays advisory; eligibility source becomes canonical (#22) |
| 38 | `scripts/mvp/**` MVP suites | offline assertions on caps/eligibility | extend to canonical constants + lifecycle vocabulary | must stay offline |
| 39 | `scripts/phase*` legacy harnesses | LEGACY_NON_BLOCKING | untouched | never gate the release |
| 40 | AOS `leadDistributionAssignmentAdapter` (wraps `assignLeadToMatchedVendors`) | **DORMANT**, no live dispatcher | leave dormant; re-point only if ever activated | `DORMANT_KEEP_DISABLED` |

---

## 7. Migration order (consumer release) — CORRECTED by QF-MVP-20.3A1

> **Ordering correction (binding).** Canonical authority must exist **before** consumers migrate to it. The release sequence is **A → A2 → B1 (canonical RPCs deployed, legacy retained, no triggers) → R1 (this consumer release) → B2 (enable enforcement triggers) → C → D → E**. Everything in this section is **R1**, and R1 **cannot start until B1 is deployed**. Enforcement triggers (B2) are deliberately deployed *after* R1 so legacy writers never meet a trigger they can violate — see the closure document §9.
>
> **Additional R1 scope from 20.3A1:** the public lead-intake path (#2 and the public forms) moves to a **server-owned service-role intake with an explicit field allow-list**; the always-true `leads` INSERT policy and anon table privileges are removed later in **Migration C**, strictly after R1 is live. Production evidence: anon can currently set 17 internal `leads` columns including `lead_quality_score`, `status`, `preferred_vendor_id` and `lead_priority` — enough to forge the auto-distribution quality gate and consume real vendor credits.

1. **Remove** `assignLead` (#1) — no replacement needed.
2. Land `marketplaceAssignmentService` + canonical eligibility behind a flag; migrate **automatic** (#5) and **delayed fill** (#7, #8) first (lowest external surface, worker identity).
3. Migrate **admin** paths (#3, #4, #36) — superadmin-gated, easy to verify.
4. Migrate **client-selected** paths (#2, #9, #10, #11) **together with** the ownership binding.
5. Migrate **credit/restoration** (#12–#15).
6. Migrate **public projection** (#25, #26), then apply Migration C.
7. Migrate **communication** to intents (#30–#33).
8. Prove zero legacy callers → apply **Migration E** (revokes).

**Hard gate:** step 8 cannot start until #1 is deleted and #2/#9 have ownership binding, because those are the only paths by which an unauthenticated caller can currently reach assignment authority.
