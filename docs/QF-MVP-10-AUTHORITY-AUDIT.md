# QF-MVP-10.5 — Authority Audit

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **HEAD:** `cda20fd` · Evidence = repository code (no DB access; DB state `UNKNOWN_UNVERIFIED`).

Audits the 16 locked authorities. Severity: **BLOCKER** (active authority bypass / security exposure) · **HIGH** (correctness/consolidation must precede the owning phase) · **MEDIUM** (drift risk) · **LOW** · **INFORMATIONAL**. Per the task rule, architectural *preference* is **not** labelled a blocker without evidence.

**Headline:** **No BLOCKER found.** There is **no active authority bypass** — every authoritative write (assignments, credits, consent) goes through a SECURITY DEFINER RPC or a single owning service; no TS/route writes those tables directly; no AI in the decision path; no Jarvis in-repo; Meta/n8n gated off. The material risks are **HIGH consolidation/verification items** concentrated in the marketplace/credits domain.

---

### A1. Lead qualification — INFORMATIONAL
- **Owner:** `leadQualityService` (rule-based V2). **DB:** `lead_scores`, `leads`.
- **Impl:** deterministic points (contact/location/requirement/intent − fraud) → `score_class` + `recommended_action`; auto-distribute gate score≥70 & A/A+ & no hard-block (`leadQualityService.ts:297`). Header **"No AI"** (`:3`); migration 37 header "Rule-based lead scoring".
- **Competing:** `leadQualityRecoveryCore` (rescore) — same rules, no conflict.
- **Bypass risk:** none. **Note:** roadmap 20.2 says "no scoring" — reconcile wording: a *deterministic rule-based* score exists and is allowed (the prohibition is on **AI/predictive** scoring, which is absent). **Rec:** confirm the score is used only as a gate/classification, not a ranking sold as AI. **Phase:** QF-MVP-20.2.

### A2. Vendor eligibility — HIGH
- **Owner (intended):** one Core eligibility decision; the assignment RPC is the final gate.
- **Impl:** LIVE = `vendorAutomaticEligibility` (credits-only) mirrored by RPC `assign_lead_to_paid_vendors_phase26a` gate (`…142:98-108`).
- **Competing implementations (5):** `evaluateVendorAutomaticLeadEligibility` (credits) · `evaluateVendorLeadAssignmentEligibility` (package; `autoAssignmentEngine`, `manualLeadAssignmentService:398`, `delayedLeadFillService:375`) · `evaluateVendorEligibility` (package; `leadAssignmentApprovalService:242` + admin Vendors page) · `evaluateClientSelectedVendorEligibility` (credits) · inline `evaluatePreferredVendorDirectEligibility` (`preferredVendorLeadService:98`) — plus each RPC re-encodes its own gate.
- **Bypass risk:** preview/approval set can differ from what the live RPC actually assigns (package vs credits divergence).
- **Rec:** designate `vendorAutomaticEligibility` (+ RPC) as the single source; make preview/manual paths consume it; keep legacy `vendorEligibility` for public-listing/package badges only. **Phase:** QF-MVP-20.3.

### A3. Assignment limits — HIGH
- **Owner:** SECURITY DEFINER assignment RPCs (authoritative); TS mirrors are advisory.
- **Impl:** "max 3" in `assign_lead_to_paid_vendors_phase26a` (`…142:50,81`), legacy `assign_lead_to_vendors` (`…0003:207`), per-group RPC (`…032:210`, clamp 1..9), DB CHECK on preview table (`…017:75`). Mirrored in TS **8×** (`lib/config.ts:106`, `leadMatchingEngine:88`, `assignmentRules:2`, `leadService:371`, `leadAssignmentApprovalService:32,311`, `leadDistributionTypes:23`, `autoAssignmentEngine:61`, `leadProcessingDiagnosticsCore:33`).
- **Bypass risk:** MEDIUM — a single stale mirror silently breaks the "max 3" invariant; only the RPC + one DB CHECK are load-bearing.
- **Rec:** treat the RPC as sole authority; derive TS mirrors from one shared constant; add a test asserting RPC-vs-constant agreement. **Phase:** QF-MVP-20.4.

### A4. Replacement limits — HIGH (gap)
- **Owner (intended):** a one-at-a-time, concurrency-safe replacement that respects the lifetime cap and never reassigns an exhausted vendor.
- **Impl (actual):** **no swap/replacement flow exists.** "Replacement" = additive admin recovery (`manualLeadAssignmentService`, primary≤3 / total≤9) + bad-lead credit-back (`adminService.approveBadLeadReport` → `restore_vendor_credit`).
- **⚠ Spec gap (V5):** the locked "**max 6 unique vendors lifetime**" (roadmap 20.4, boundaries §10) is **not implemented** — coded lifetime cap is **9** (`ADMIN_MANUAL_TOTAL_VENDOR_LIMIT`, `lib/config.ts:113`).
- **Bypass risk:** none active; this is unbuilt scope + a numeric discrepancy requiring a **founder decision (6 vs 9)**.
- **Rec:** decide the lifetime number; build a concurrency-controlled replacement in QF-MVP-20.6 that enforces it in the RPC. **Phase:** QF-MVP-20.4/20.6.

### A5. Package validity — MEDIUM
- **Owner:** `packageService` / `vendorPackageOrderService` / `vendorAdminService`; RPC `assign_package_to_vendor`.
- **Impl:** packages **decoupled** from automatic-lead eligibility (Phase 4). Residual coupling: `public_visibility` requires an active `vendor_packages` row (`update_vendor_visibility` `…0003:44-54`). Live paid flow is inert (no payment webhook; `vendorPackageOrderService` writes intents only).
- **Bypass risk:** LOW; but **non-idempotent** legacy `assign_package_to_vendor` double-grants on replay if migration 48 (idempotent grant) is not applied (DO-NOT-AUTO-APPLY).
- **Rec:** confirm 48 applied before any payment integration; confirm the public-visibility↔package coupling is intended for MVP. **Phase:** QF-MVP-20.7 / POST_MVP.

### A6. Credit deduction — HIGH
- **Owner:** the assignment RPCs (lead-debit) + `vendorCreditWalletService` (`qf_apply_vendor_credit_delta`).
- **Impl:** idempotent + atomic — lead `FOR UPDATE`, conditional `remaining_credits ≥ cost` decrement, per-(lead,vendor) unique rollback, **mandatory** `vendor_credit_logs` row under `uq_vendor_credit_logs_reference` (`…142:114-148`, `…141:30-32`).
- **Competing implementations:** `assign_lead_to_paid_vendors_phase26a` defined in migr 27/34/42/**45**; `assign_lead_to_vendors` (3/**47**); `assign_lead_to_preferred_vendor` (35/36/**46**). The ledger-backed versions (45/46/47) are **DO-NOT-AUTO-APPLY** → **which body is live is UNKNOWN**.
- **Bypass risk:** HIGH — if the legacy (pre-ledger) bodies are live, debits occur via `deduct_vendor_credit` **without** a ledger row.
- **Rec:** verify live RPC bodies in reconciliation (10.7) **before** QF-MVP-20; apply 44–47 if absent. **Phase:** QF-MVP-10.7 → 20.7.

### A7. Credit restoration — HIGH
- **Owner:** founder/admin approval, audited.
- **Impl:** **manual only, by design.** `approveBadLeadReport` sets `credit_restored:false` (`adminService.ts:596`); idempotent `refundCreditForInvalidLead` **exists but is unwired** (no route). **⚠ Un-ledgered debit (V4):** `admin_smart_assign_lead_to_vendors` (used by `manualLeadAssignmentService:471` + `delayedLeadFillService:444`) debits credits and writes **no** `vendor_credit_logs` row.
- **Bypass risk:** HIGH (accounting/audit hole — credits leave the wallet un-ledgered; also burns `vendor_packages` FIFO).
- **Rec:** rewrite `admin_smart_assign` to the ledger contract; wire an approval-gated restore endpoint if founder-approved refunds are MVP. **Phase:** QF-MVP-20.7.

### A8. Consent decision — INFORMATIONAL (clean)
- **Owner:** `communicationConsentDecisionService` (D2-C) — **sole** read-only decider; suppression-first precedence (`:465-501`).
- **Competing:** none. `communicationService` "NEVER interprets consent" (`:383-384`).
- **Bypass risk:** none. **Phase:** QF-MVP-40 (verify wiring).

### A9. STOP/START consent writes — INFORMATIONAL (clean)
- **Owner:** `communicationConsentWriterService` (D2-D) → single SECURITY DEFINER RPC `apply_communication_consent_command` (`…0300`, `service_role` only, all-or-nothing, fixed-order advisory locks). HELP/unsupported never write.
- **Bypass risk:** none. Consent-truth tables writable only inside the RPC. **Note:** RPC migration (64/…0300) is **DO-NOT-AUTO-APPLY** → verify applied before QF-MVP-40. **Phase:** QF-MVP-40.

### A10. Outbound send eligibility — INFORMATIONAL (clean, fail-closed)
- **Owner:** `outboundConsentEnforcementService` (D3-B) — **sole** interpreter; 10-step gate chain in `communicationService` (channel → template/lane → destination → early Meta-gate+mapping+fingerprint → consent gate → atomic claim → provider-account bind → **final** runtime re-gate → HTTP).
- **Bypass risk:** none active; a raw `new CommunicationService()` in prod would bypass consent — a static harness asserts none exists (`runtimeCommunicationService.ts:159-163`). **D9** (uncertain outcome never auto-resent) enforced in 3 places. **Phase:** QF-MVP-40.

### A11. Provider-account ownership — INFORMATIONAL (clean)
- **Owner:** `providerAccountOwnership.classifyOwnership` (0→not_found, >1→ambiguous, mismatch→waba_mismatch). Foreign WABA/phone callback → generic 200 `acknowledged_unowned_provider_account`, **zero effects** (`metaWhatsAppWebhookService:220-221`); outbound binds exact account before any Meta call.
- **Bypass risk:** none. **Phase:** QF-MVP-40.

### A12. Campaign recipient approval — INFORMATIONAL (not built)
- **Owner (intended):** CRM proposes → Core recalculates eligibility → consent/suppression/frequency → frozen audience → **admin approval** → n8n → Meta.
- **Impl:** **not implemented** (`lib/crm` foundation only; no campaign approval/audience-snapshot code). **Bypass risk:** none (absent). **Rec:** build in QF-MVP-30 on top of Core consent authority. **Phase:** QF-MVP-30.

### A13. Automation execution (n8n) — INFORMATIONAL (inactive, clean)
- **Owner:** Core authorizes; n8n executes only. **Seam:** `lib/aos/tools/n8nTool.ts` (single gated webhook, masks PII/secrets, forces side-effects=false; inbound requires `x-qf-n8n-secret`).
- **Impl:** **two-lock OFF by default**; n8n holds **no** authority/service-role; credit-sync is contract-only (no emitter). **Bypass risk:** none. **Phase:** QF-MVP-50.

### A14. Jarvis recommendation boundary — INFORMATIONAL (absent, clean)
- **Owner:** Jarvis is a **separate repo** (recommendation-only, no service-role, no direct Core writes).
- **Impl:** **no Jarvis code/runtime/credential/DB-role in this repo.** `"jarvis"` tokens are future-compat tags on comms/consent services. `domain_events`/`outbox_events` envelope is a committed-but-**unapplied, unwired** contract. **Bypass risk:** none. **Phase:** QF-MVP-60.
- **⚠ Watch (LOW, V8):** `lib/aos/agents/engines.ts` carries its own ranking/eligibility heuristics not reusing Core — harmless while suggestion-only/unwired; must rewire to Core before any activation.

### A15. Admin approvals — MEDIUM
- **Owner:** Superadmin, audited. **Impl:** all `/api/admin/**` routes gated `session.isSuperadmin`; status/credit/package/category admin via owning services; `audit_logs` written.
- **Gap:** credit-restoration approval is manual/unwired (A7); campaign approval not built (A12). **Bypass risk:** LOW. **Rec:** formalize approval gates for credit restore + campaigns. **Phase:** QF-MVP-70.

### A16. Audit records — MEDIUM
- **Owner:** `adminAuditService` (`audit_logs`), `authSecurityEventService` (`auth_security_events`), comms delivery/consent events.
- **Gap:** the `admin_smart_assign` credit debit lacks a `vendor_credit_logs` entry (A7) — an important action without a complete audit record.
- **Bypass risk:** LOW (audit completeness). **Rec:** close A7; assert every credit movement produces a ledger row. **Phase:** QF-MVP-20.7.

---

## Severity roll-up

| Severity | Findings |
|---|---|
| **BLOCKER** | *(none)* |
| **HIGH** | A2 (5 eligibility interpretations) · A4 (no 6-lifetime cap / founder decision) · A6 (live credit RPC body unverified) · A7 (un-ledgered `admin_smart_assign` debit) |
| **MEDIUM** | A3 (cap constant 8× drift) · A5 (non-idempotent legacy package grant if 48 absent) · A15 (approval gates partial) · A16 (audit completeness) |
| **LOW** | V7 (direct receipt insert) · V8 (AOS engines heuristics) |
| **INFORMATIONAL / clean** | A1, A8, A9, A10, A11, A12, A13, A14 |

**Gate for QF-MVP-20:** resolve A6 (verify live RPC bodies via 10.7) and decide A4 (6 vs 9) **before** building the marketplace engine; consolidate A2/A3 and close A7 **within** QF-MVP-20.
