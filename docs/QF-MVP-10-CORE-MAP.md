# QF-MVP-10.4 — Core Domain Map

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **HEAD:** `cda20fd` · Evidence = repository code (no DB access). DB-applied state `UNKNOWN_UNVERIFIED`.

QuickFurno is a **modular monolith**, one authoritative business database. This map defines the existing/target domains, their authority, dependency direction, and evidence-backed boundary violations. **No refactor is performed in this phase.**

## Dependency direction (target)

```
UI / API route  →  application service (services/*)  →  domain rules (lib/*)  →  repository / SECURITY DEFINER RPC  →  authoritative DB
External:  Core-authorized job  →  n8n (execute only)  →  provider (Meta/Exotel)  →  result callback  →  Core audit
```
Observed adherence is **strong**: no TypeScript/route writes `lead_assignments`, `vendors.remaining_credits`, or consent-truth tables directly — all authoritative writes go through SECURITY DEFINER RPCs. Violations below are **duplication / ambiguity**, not active bypasses.

---

## Domains

Authority key: **AD** authoritative-decision · **AW** authoritative-write · **RO** read-only · **ORCH** orchestration · **PR** pure-rule.

### 1. Leads
- **Authoritative data:** `leads`, `lead_status_updates`, `lead_scores`, `lead_clarification_requests/responses`.
- **Writes/decisions:** capture + status (AW `leadService`); rule-based quality score + auto-distribute gate (AD `leadQualityService`, score≥70 & class A/A+ & no hard-block; **"No AI"** `leadQualityService.ts:3`); clarification (`leadClarificationService`).
- **Entry:** `/enquiry` page, `leadService.createLead`. **DB RPC:** `check_duplicate_lead`.
- **Allowed consumers:** matching engine, admin ops. **Prohibited:** UI writing distribution directly.
- **Gap / boundary:** `leadService.createLead` couples capture + quality gate + distribution orchestration (LOW). Target: keep quality classification deterministic; distribution stays a downstream authorized step.

### 2. Clients
- **Data:** `client_accounts` (+ OTP cols). **Services:** `clientOtpAuthService`, `clientAccessService`, `clientOtpAutomationService` (kill-switch).
- **Auth:** WhatsApp OTP login — **ships disabled** (`communication_automation_catalog.client_login_otp.is_operationally_enabled=false`). Classification KEEP_AS_BUILT / gated.
- **Boundary:** a lead is **not** an identity (`inboundIdentityResolutionService.ts:19-21`).

### 3. Vendors
- **Data:** `vendors`, `vendor_dashboard_users`, `vendor_profile_change_requests`, `vendor_notifications`, `vendor_support_threads/messages`.
- **Services:** `vendorService`, `vendorAccessService` (dashboard identity guard), `publicVendorService` (RO public listing), `vendorAdminService` (superadmin status/credits/package), `vendorProfileChangeService`, `vendorVerificationService`, `vendorSupportService`, `vendorNotificationService`.
- **Prohibited:** public listing exposing unverified/hidden vendors — enforced via `getVendorPublicVisibility` / `vendorVisibility`.

### 4. Eligibility
- **Authoritative decision:** the **SECURITY DEFINER assignment RPC is final** (`assign_lead_to_paid_vendors_phase26a` gate: approved+active+accepting_leads+credits≥cost+city+category; **no package/paid_status**).
- **Pure rules:** `lib/vendors/vendorAutomaticEligibility.ts` (credits-only, LIVE mirror), `vendorEligibility.ts` (legacy package-based, preview/admin), `categoryMatching.ts`, `vendorVisibility.ts`.
- **⚠ Violation (HIGH):** **five** eligibility interpretations for one question (credits-only vs package-based variants + each RPC's own gate) — see Authority Audit A2.

### 5. Assignments
- **Authoritative write:** RPC `assign_lead_to_paid_vendors_phase26a` (auto), `assign_lead_to_vendors` (manual), `assign_lead_to_preferred_vendor`, `assign_vendor_to_requirement_group`, `assign_client_selected_vendor_to_group` — all SECURITY DEFINER; lead+vendor `FOR UPDATE`, conditional credit debit, per-(lead,vendor) unique constraint, mandatory ledger row.
- **Services:** `leadMatchingEngine` (deterministic rank, fill-to-3) → `leadDeliveryService` (sole caller of live auto RPC); `manualLeadAssignmentService` (admin recovery ≤9); `preferredVendorLeadService`; `clientRequirementGroupService`.
- **Data:** `lead_assignments`, `lead_matching_runs`, `lead_delivery_logs`, `client_notification_logs`, `lead_assignment_queue`, `lead_assignment_approvals` (preview ledger).
- **Caps:** **3 active/primary** (per lead and per requirement-group-per-parent-category). **⚠ No "6 lifetime" rule exists** — total recovery cap is **9** (`ADMIN_MANUAL_TOTAL_VENDOR_LIMIT`).
- **⚠ Violations:** cap constant `3` duplicated **8×** (MEDIUM); two parallel auto-assignment engines with divergent semantics — LIVE `leadMatchingEngine` (credits) vs preview `lib/lead-assignment/autoAssignmentEngine` (package) (MEDIUM); live RPC body **UNKNOWN_UNVERIFIED** (HIGH). See Authority Audit A3/A6.

### 6. Replacements
- **Reality:** **no vendor-swap/replacement flow exists.** "Replacement" today = **additive** admin recovery (`manualLeadAssignmentService`, primary≤3 / total≤9) + bad-lead **credit-back** (`adminService.approveBadLeadReport` → `restore_vendor_credit`, `bad_lead_reports`; **credit_restored:false**, manual only).
- **Gap:** no one-at-a-time concurrency-controlled replacement; no "never reassign an exhausted vendor" swap. Classification **UNKNOWN_REQUIRES_AUDIT**; build in QF-MVP-20.6.

### 7. Packages
- **Data:** `packages`, `vendor_packages`, `vendor_package_orders`. **Services:** `packageService` (paid-payment credit trigger — **no calling route/webhook**), `vendorPackageOrderService` (intents only: `payment_status:'not_started'`), `vendorAdminService` (metadata).
- **Boundary:** **decoupled from automatic-lead eligibility** (Phase 4). Residual coupling: `public_visibility` still requires an active `vendor_packages` row (`update_vendor_visibility`).
- **Classification:** live paid-credit flow is **POST_MVP** (no payment integration); package metadata KEEP_AS_BUILT.

### 8. Credits
- **Authoritative writes (owning domain):** `vendorCreditWalletService` (canonical, RPC `qf_apply_vendor_credit_delta`) for grants/manual; the assignment RPCs for lead-debit; all write a `vendor_credit_logs` row under `uq_vendor_credit_logs_reference` (idempotent).
- **Restoration:** **manual only** (`refundCreditForInvalidLead` exists but **unwired**; `approveBadLeadReport` sets `credit_restored:false`).
- **⚠ Violations:** `admin_smart_assign_lead_to_vendors` (manual + delayed-fill) debits credits **without a ledger row** (HIGH); legacy `deduct_vendor_credit` still present; ledger-backed wallet migrations (141–145) are **DO-NOT-AUTO-APPLY** (unverified). See Authority Audit A6/A7.

### 9. Consent
- **Authoritative decision:** `communicationConsentDecisionService` (D2-C) — **sole** read-only consent+suppression decider (suppression-first precedence).
- **Authoritative write:** `communicationConsentWriterService` (D2-D) → single transactional SECURITY DEFINER RPC `apply_communication_consent_command` (STOP/START; marketing+transactional scopes only; HELP never writes).
- **Enforcement:** `outboundConsentEnforcementService` (D3-B) — **sole** interpreter of a decision into allow/deny; marketing default-deny.
- **Data:** `communication_consent_events`, `communication_suppressions`, `communication_preferences`, `communication_consent_command_receipts`. **Clean single-authority** (no duplication found).

### 10. Communication (Meta non-voice + SMS)
- **Ledger/dispatch:** `communicationService` (state machine + one consent gate per attempt). **Providers:** `metaCloudWhatsAppProvider` (template-send only — **no voice**), `exotelSmsProvider`, `mockWhatsAppProvider`/`mockSmsProvider` (defaults).
- **Meta path:** `metaWhatsAppOutboundService`, `communicationProviderRuntimeService`, `metaRuntimeGate` (fail-closed activation→account-readiness→canary); webhook `metaWhatsAppWebhookService` (HMAC-over-bytes → callback identity → runtime gate → effects; async ack).
- **Data:** `communication_messages/templates/delivery_events/webhook_receipts/inbound_messages`, `communication_provider_accounts/template_mappings/runtime_policies/canary_destinations`, `communication_suppressions/preferences/channel_capabilities`.
- **Activation:** **gated OFF by DB seed** (`activation_status='disabled'`, no account/mapping/canary rows). KEEP_AS_BUILT: SMS fallback, multi-provider, retry/fallback. **No Meta voice anywhere.**

### 11. Vendor CRM
- **Data:** `crm_leads`, `crm_activities`, `crm_followups`, `crm_lead_tasks`, `crm_calendar_events`, `crm_funnel_events`, `crm_sources`, `crm_lead_notes`, `campaign_performance`, `lead_attribution` (migrations 13/15 — re-declared pair).
- **Implementation:** `lib/crm` = **3 files (foundation only)**. Status **UNKNOWN_REQUIRES_AUDIT** — MVP_REQUIRED per scope but essentially unbuilt.
- **Boundary:** CRM must reference Core (verification/package/credits/consent/eligibility) by FK, never shadow it.

### 12. Automation contracts (n8n)
- **Seam:** `lib/aos/tools/n8nTool.ts` (single outbound webhook; masks PII/secrets; forces side-effects=false), `lib/aos/events/*`, `lib/aos/sync/n8nSyncService` (mock).
- **Authority:** **none** — n8n executes only, holds no service-role, writes no Core tables. **Two-lock OFF by default** (env `N8N_ENABLED`+`N8N_OUTBOUND_WEBHOOK_ENABLED`=false; runtime `aos_runtime_settings` default `enabled:false/mode:off`).
- **Classification:** documented-but-inactive; KEEP_AS_BUILT / KEEP_DISABLED.

### 13. Audit
- **Data:** `audit_logs` (business, `adminAuditService`), `auth_security_events` (`authSecurityEventService`), `communication_delivery_events` + `communication_consent_events` (comms), `aos_audit_logs` (AOS, inactive), `lead_timeline_events`.
- **Boundary:** every important action (assignment, credit change, approval, admin override) must produce an audit record. **Gap:** `admin_smart_assign` debit lacks a credit-ledger row (A7).

### 14. Admin operations
- **Services:** `adminService`, `adminAuditService`, `categoryAdminService`, `vendorAdminService`, `communicationAdminService` (RO observability). **Routes:** `/api/admin/**` (16), all Superadmin-gated (`session.isSuperadmin`).
- **Boundary:** sensitive corrections (credit restore, campaign approval) require founder/admin approval (partially implemented; credit restore is manual/unwired).

---

## AOS subsystem (cross-cutting, mostly dormant)
`lib/aos` (184 files) is a **safe-by-default preview/scaffolding** layer: recommendation-only, no business authority, **no AI active** (`AOS_AI_ENABLED=false`, rule-based engines), no direct authoritative writes (writes only its own `aos_*`/preview tables). The event-sourced lead-lifecycle state machine (`lib/aos/workflows/leadLifecycle/**`) and the workflow kernel (`lib/aos/workflow/**` + migrations 146–150) are **built/tested but wired to no route** (dormant). The only live AOS HTTP entry, `/api/aos/process-lead`, is a **side-effect-free preview**. Classifications: runtime/events/tools/rules KEEP_AS_BUILT; workflows/policy/kernel/agents/memory POST_MVP / KEEP_DISABLED.

## Evidence-backed boundary violations (do NOT fix in QF-MVP-10)

| # | Violation | Evidence | Severity | Target phase |
|---|---|---|---|---|
| V1 | Five eligibility interpretations for one decision | `vendorAutomaticEligibility` vs `vendorEligibility` (+3) + per-RPC gates | HIGH | QF-MVP-20.3 |
| V2 | "max 3" cap constant duplicated 8× (only RPC + 1 DB CHECK load-bearing) | `lib/config.ts:106`, `leadMatchingEngine:88`, `assignmentRules:2`, +5 | MEDIUM | QF-MVP-20.4 |
| V3 | Two parallel auto-assignment engines, divergent eligibility | `leadMatchingEngine` (live/credits) vs `lib/lead-assignment/autoAssignmentEngine` (preview/package) | MEDIUM | QF-MVP-20.4 |
| V4 | Un-ledgered credit debit path | `admin_smart_assign_lead_to_vendors` writes no `vendor_credit_logs` row | HIGH | QF-MVP-20.7 |
| V5 | "6 unique vendors lifetime" not implemented (code = 3 / 9) | no 6-cap anywhere; `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT=9` | HIGH (founder decision) | QF-MVP-20.4 |
| V6 | Live assignment/credit RPC body UNVERIFIED (3 committed versions) | `assign_lead_to_paid_vendors_phase26a` in migr 27/34/42/45; 45 DO-NOT-AUTO-APPLY | HIGH | QF-MVP-10.7 → 20 |
| V7 | `metaWhatsAppWebhookService.recordIgnoredReceipt` direct receipt insert | `:110-129` (receipts, not consent truth) | LOW | QF-MVP-40 |
| V8 | AOS `engines.ts` heuristics don't reuse Core (dormant) | `lib/aos/agents/engines.ts` scoring/ranking | LOW | QF-MVP-60 |

**Positives (evidence-confirmed):** no direct `lead_assignments`/credit/consent table writes from TS/UI/routes; consent has a single decision + single writer + single enforcer; **no AI** in scoring/ranking/assignment; **no Jarvis** code in-repo; **no Meta voice**; Meta/SMS/OTP all gated off by DB seed.
