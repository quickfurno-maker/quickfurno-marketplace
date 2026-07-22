# QF-MVP-10.5 — Authority Audit

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · Evidence = repository code **+ ✅ production SELECT-only reconciliation (22 July 2026)**.

Audits the 16 locked authorities. Severity: **BLOCKER** (active authority bypass / security exposure) · **HIGH** (correctness/consolidation must precede the owning phase) · **MEDIUM** (drift risk) · **LOW** · **INFORMATIONAL**. Per the task rule, architectural *preference* is **not** labelled a blocker without evidence.

> **Headline update (production-reconciled):** the repository-only audit below concluded "No BLOCKER" because no TS/route writes the authoritative tables directly. **Reading the live database changed that verdict.** Four SECURITY DEFINER assignment RPCs are **executable by PUBLIC / anon / authenticated** with **no in-body caller authorization** — an **active authority bypass** exploitable directly against the database. Plus a **HIGH** public monetization exposure (anon `SELECT` on vendor credit/package columns). These are the confirmed BLOCKERS; the money-path consolidation items remain as originally assessed. See the production-verified section immediately below, then the original repository audit.

---

## ✅ Production-verified findings (22 July 2026, SELECT-only)

Access mode: the connection was **not** technically read-only (role `postgres`, `transaction_read_only = off`); read-only behaviour was **process-enforced through an explicit SELECT-only allowlist** under founder approval. No database change, migration, or provider access occurred. Full evidence: [`QF-MVP-10-RECONCILIATION-RESULTS.md`](QF-MVP-10-RECONCILIATION-RESULTS.md).

### PV-1. Assignment authority — **BLOCKER (active bypass)**

Four assignment RPCs are SECURITY DEFINER **and executable by PUBLIC, anon, authenticated, service_role**, with **no in-body caller-authorization / lead-ownership check**:

| RPC | Signature | Definition MD5 | Key defects |
|---|---|---|---|
| `admin_smart_assign_lead_to_vendors` | `(uuid,uuid[],boolean,integer)` | `8b64ca6203b9faa1189ddac3521b2a42` | no admin check; limit clamp 1–9; uses `deduct_vendor_credit`/`restore_vendor_credit`; **no assignment-linked ledger row** |
| `assign_client_selected_vendor_to_group` | `(uuid,uuid,uuid,integer)` | `3bbe5417b13293ca72a4b8526740be21` | no lead-ownership/caller proof; clamp 1–9; legacy debit/restore; **no ledger row** |
| `assign_vendor_to_requirement_group` | `(uuid,uuid,uuid,text,integer,text)` | `b63b7656ef95832e2fed8fc37a796d6a` | no caller check; clamp 1–9; legacy debit/restore; **no ledger row** |
| `assign_lead_to_preferred_vendor` | `(uuid,uuid)` | `0138b0ff9dd89a320b73af57e60fe524` | no caller/lead-ownership check; **does not check existing total assignment count**; **does not enforce lifetime-six**; live body does not enforce complete city/category compatibility; **does** write ledger evidence after success |

### PV-2. Canonical assignment base (service_role-only) — consolidation targets

| RPC | Signature | Definition MD5 | Classification |
|---|---|---|---|
| `assign_lead_to_paid_vendors_phase26a` | `(uuid,uuid[])` | `3ab9c1a04b44ec130f032188d2a7f51f` | **STRONG_CANONICAL_BASE_REQUIRES_CONSOLIDATION** — service_role only; max 3; dup-lead + existing-assignment idempotency; normalized eligibility; **mandatory ledger row**; **lifetime-six absent** |
| `assign_lead_to_vendors` | `(uuid,uuid[],boolean,text)` | `9a9eff43766542aa68d71e0d6860be9b` | **REQUIRES_CONSOLIDATION** — service_role only; max 3; **mandatory ledger row**; **lifetime-six absent**; **directly inserts into `whatsapp_logs`** (comms side effect must move behind the communication authority) |

### PV-3. Assignment limits & live data

- `app_settings.max_vendors_per_lead = 4` — **configuration drift** (canonical RPCs clamp to 3); correct later via approved change.
- Live counts: 46 total (34 auto / 7 client-selected / 5 admin); all 46 `credit_deducted`; **0** leads above 3 assignments; **0** leads above 6 unique vendors; max-3 assignments and max-3 unique vendors on any one lead.
- `UNIQUE (lead_id, vendor_id)` exists; `lead_assignment_approvals.selected_vendor_count ≤ 3`. **No** canonical authority enforces 6 lifetime unique vendors; **no** trigger enforces 3-active or 6-lifetime.
- Current rows do not violate the intended limit, but several live paths are **capable** of violating it.

### PV-4. Credit & ledger authority

- `qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)` — MD5 `45ad58beb9cb1dd8ea4f77466909cc0e`: SECURITY DEFINER, service_role only, locks vendor row, post-lock duplicate-reference check, writes `vendor_credit_logs`, returns `already_applied` on duplicate. `uq_vendor_credit_logs_reference` exists: `UNIQUE (reference_type, reference_id) WHERE reference_id IS NOT NULL`.
- Live credit evidence: 47 credit-log rows; **0** arithmetic-inconsistent; 28 without `reference_id`; 19 assignment-debit rows; **0** invalid-lead refunds; **0** vendors with negative credits; **0** duplicate reference groups.
- **Assignment-ledger gap (A6/A7 confirmed live):** of 46 credit-deducted assignments, **27** lack a matching `lead_assignment` / assignment-UUID / `lead_assignment_debit` ledger row — **5 admin, 16 automatic, 6 client-selected**. **No blind backfill:** QF-MVP-20 must design a reviewed procedure that proves a debit actually occurred before inserting historical/compensating evidence.
- Legacy `deduct_vendor_credit`, `restore_vendor_credit`, `increment_vendor_credits` all mutate balances **without ledger evidence**; `restore_vendor_credit` has **no approval input** — both violate the locked money-path rules.

### PV-5. Public monetization exposure — **HIGH**

The `vendors` table exposes `total_credits`, `remaining_credits`, `public_visibility`, `paid_status`, `package_name`, `package_status`, `package_expires_at`, and the **anon** role has `SELECT` on these columns. The public-listing RLS policy limits **rows** but not **columns**, so the DB currently permits **anonymous reads of monetization fields** on publicly visible vendor rows. Violates the locked "no monetization on public vendor pages/payloads" rule. QF-MVP-20 must add a public-safe projection/DTO, prevent anon exposure of monetization columns, add no-leak regression coverage, and preserve full data only for authorized vendor/admin/CRM paths.

### PV-6. Consent & communication authority

- Consent writer `apply_communication_consent_command` — MD5 `195e3437ddf2b56f60cd3bb446bc70a4`: SECURITY DEFINER, service_role only, fixed policy version, input validation, deterministic lock ordering, receipt-based replay/conflict handling, marketing+transactional suppression, immutable evidence. **Clean.**
- Consent-ack functions present: `qf_claim_consent_ack_intents`, `qf_reserve_consent_ack_provider_attempt`, `qf_terminalize_consent_ack_intent`, `qf_expire_consent_ack_intents`, `qf_recover_stale_dispatching_consent_ack_intents`.
- Meta correctly inactive: 0 provider accounts; 1 runtime policy (`meta_whatsapp_cloud`/`whatsapp`/`disabled`); 16 internal templates (16 active); 0 provider mappings; 0 messages/receipts/inbound/delivery/consent-ack/consent-events/suppressions.
- Provider-account hardening **present**: provider-account tables + FKs; account-scoped webhook/inbound/delivery indexes; `communication_delivery_events_provider_account_required_check`. **Missing**: `communication_consent_ack_intents.provider_account_id` still **nullable**; expected ack provider-account-required check **absent** → **`QF-MVP-40_BLOCKER`**.

### PV-7. RLS, grants & triggers

Communication authority tables: RLS enabled, no anon/authenticated policies, service-role access, fail-closed. Core tables carry older broad grants with RLS as the row boundary. The **primary authority defect** is public/anon execution of the SECURITY DEFINER assignment functions (PV-1). **No reviewed trigger** enforces max-3, lifetime-6, or mandatory ledger evidence.

**Production severity roll-up:** **BLOCKER** — PV-1 (4 PUBLIC/anon-executable assignment RPCs, active bypass). **HIGH** — PV-5 (public monetization exposure); PV-4 assignment-ledger gap (27/46). **QF-MVP-40_BLOCKER** — PV-6 nullable ack `provider_account_id`. **Consolidation** — PV-2. **Config drift** — PV-3 (`max_vendors_per_lead = 4`).

---

## Original repository audit (pre-reconciliation; retained)

> The section below was written from **repository code only**, before the database was read. Where it says "no active bypass / DB state UNKNOWN_UNVERIFIED," the production-verified findings above are now authoritative — most importantly, the live assignment RPCs are PUBLIC/anon-executable (a BLOCKER the code-only view could not see).

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
- **⚠ Spec gap (V5) — founder DECISION now LOCKED:** lifetime unique vendors per lead = **6**. The current code lifetime cap of **9** (`ADMIN_MANUAL_TOTAL_VENDOR_LIMIT`, `lib/config.ts:113`) is **REJECTED** and must be corrected. There is **no DB-level lifetime constraint today** (the 9 lives only in TS).
- **Bypass risk:** none active; this is unbuilt scope + a now-resolved numeric discrepancy.
- **Rec:** in QF-MVP-20 replace `9`→`6`, enforce the **6-vendor lifetime cap in the assignment RPC** (not only TS), and build a concurrency-controlled replacement that never reassigns an exhausted vendor. **Phase:** QF-MVP-20.4/20.6.

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
