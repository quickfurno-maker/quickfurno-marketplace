# PHASE 4 — QuickFurno Simple Credit-Wallet Vendor System

> **Status: implemented (TS keystone) + migrations generated for review. NOT
> applied, NOT committed, NOT deployed.** SQL is review-only; DB integration &
> production E2E are pending (see §15).

**One-sentence rule achieved:** *An approved and active vendor who is accepting
leads, has at least one credit, and matches the client's city and category can
receive an enquiry. No credit = no enquiry. One successful assignment = one credit.
Maximum three successful vendors per lead. Packages only add credits; package
status does not control matching.*

---

## 1. Previous complexity discovered
- The live auto-assignment RPC (`assign_lead_to_paid_vendors_phase26a`) gated on
  `v_has_active_package` — an **OR** of `vendor_packages` active rows **or**
  `package_status in (active,trial)` **or** `paid_status in (paid,trial,active,…)`.
  So `package_status=active` alone classified a vendor as commercially eligible
  even with `paid_status=Unpaid`.
- The TS matcher used `evaluateVendorContactAccessEligibility` → `classifyVendorCommercialType` which treats `package_status=active` **or** `paid_status=paid` as "paid".
- Credit balance is written **directly** (`.update({remaining_credits})`) from
  `services/vendorAdminService.ts` (admin grant + package top-up) with **no
  idempotency reference**; `vendor_credit_logs` had no `lead_id`/`reference`.
- Three assignment RPCs exist: `assign_lead_to_paid_vendors_phase26a` (auto),
  `assign_lead_to_preferred_vendor` (client-selected), `assign_lead_to_vendors`
  (admin/manual). The preferred path already ignores package/paid (credits-only).
- The auto RPC **preselected 3** candidates (`limit v_max`) — a candidate losing
  its last credit concurrently left the lead under-filled.
- `accepting_leads` did not exist anywhere.

## 2. Final canonical business rules
`APPROVED + ACTIVE + ACCEPTING_LEADS + credits ≥ 1 + CITY match + CATEGORY match`.
Package purchase only adds credits. `paid_status`/`package_status`/`package_expires_at`/`vendor_packages` **do not** control automatic assignment.

## 3. Authoritative fields
| Meaning | Field |
|---|---|
| Account approval | `vendors.status` (normalized: pending/approved/suspended/rejected) |
| Temporary availability | `vendors.accepting_leads` (new, default true) |
| Wallet balance | `vendors.remaining_credits` (canonical; no second column) |
| Credit audit | `vendor_credit_logs` (+ new `reference_type`/`reference_id`) |
| Package purchase | `vendor_packages` / package columns — **history only** |

## 4. Deprecated matching dependencies (kept, not deleted)
`paid_status`, `package_status`, `package_expires_at`, `vendor_packages` active rows, `public_visibility` — **removed from automatic eligibility in both layers**; retained for legacy preview/badge/history. `evaluateVendorContactAccessEligibility` is now `@deprecated for automatic assignment` and no longer called by the matcher.

## 5. Eligibility flow
`evaluateVendorAutomaticLeadEligibility(vendor)` (new, in the zero-dependency
`lib/vendors/vendorAutomaticEligibility.ts`, re-exported from `vendorEligibility.ts`)
→ `{ eligible, reasons, accountStatus, isActive, acceptingLeads, credits, creditCost }`
with reasons `vendor_not_approved | vendor_suspended | vendor_inactive | not_accepting_leads | no_credits`. The matcher applies city + category **separately** (unchanged Phase 2 semantics). The RPC gate (migration 142) is byte-for-byte the same contract.

## 6. Credit grant flow
Canonical primitive `qf_apply_vendor_credit_delta(vendor, delta, change_type, reason, reference_type, reference_id, updated_by)` (migration 141): locks vendor, **idempotent** on `(reference_type, reference_id)`, updates `remaining_credits` + writes one ledger row. Admin grants / package purchases / refunds should route through it (wiring is a follow-on — see §13).

## 7. Assignment debit flow
The debit stays **atomic inside** the assignment RPC (migration 142): conditional
`remaining_credits - 1 WHERE remaining_credits >= 1`, one `lead_assignments` row,
one ledger row `change_type=lead_assignment_debit, delta=-1, reference_type=lead_assignment, reference_id=<assignment id>` (closes the Phase 3A accounting-correlation gap). No `vendor_packages` decrement anymore.

## 8. Refund flow
Append-only: a refund is a **new** `+1` ledger row (`invalid_lead_refund`) via
`qf_apply_vendor_credit_delta`; the original `-1` debit is **never** deleted
(harness CASE 14).

## 9. Atomic transaction behavior
Unchanged safety: lead `FOR UPDATE` lock, duplicate/idempotency short-circuits,
vendor `FOR UPDATE` lock, **conditional** credit decrement (two concurrent leads
cannot both spend the same last credit), `unique(lead_id, vendor_id)` with credit
rollback on race, search_path hardened, least-privilege grants. **RPC signature
unchanged.**

## 10. Maximum-3 successful fill behavior
The RPC now iterates the **whole** deduped ranked pool and `exit when assigned ≥ least(configured, 3)` — stop after **3 SUCCESSFUL**, not preselect-3. The JS matcher passes a bounded ranked pool (`MAX_CANDIDATE_POOL = 6`, ordering unchanged) so a candidate that lost its last credit is skipped and the next fills the slot (harness CASE 12). Ranking (tier → distance → area affinity → fairness → rating → id) is untouched; distance stays ranking-only; area stays soft.

## 11. Migration details (all additive, reversible, **generated for review — not applied**)
- `20260706000140_vendor_accepting_leads.sql` — `add column if not exists accepting_leads boolean not null default true` + index. Reverse: drop column.
- `20260706000141_vendor_credit_wallet_rpc.sql` — ledger `reference_type`/`reference_id` + **partial unique index** (`where reference_id is not null`, safe on all-NULL history — no duplicate audit needed) + `qf_apply_vendor_credit_delta` primitive.
- `20260706000142_credit_wallet_assignment_rpc.sql` — create-or-replace the auto RPC with the credit-wallet gate + fill-until-3 + assignment-correlated ledger. Requires 140 & 141 first. Reverse: re-apply `20260705000130`.

## 12. Test results
- **Phase 4 harness** (`npm run test:phase4`): **26 passed, 0 failed** — CASES 1–8, 12, 14, 16, 17 `[pure]`; CASES 9, 10, 11, 13, 15, 18 `[static]`. Verification levels labeled honestly; DB/E2E cases not claimed as proven.
- **Regression**: Phase 3A **52/52**, Phase 3B **58/58** (matcher + diagnostics changes caused no regression).
- **typecheck**: pass. **build**: pass. **git diff --check**: clean.

## 13. Compatibility risks & follow-on wiring (deferred, documented)
- **Forward-compatible & safe pre-apply:** the TS matcher swap does not newly block any currently-assignable vendor (all had credits+active+approved); end-to-end behavior only changes once migration 142 is applied. Passing a 6-pool to the *current* RPC degrades to top-3 (it reads only the first 3). `accepting_leads` defaults true.
- **Not yet wired (needs DB integration, intentionally out of this turn):** routing `vendorAdminService.updateVendorCredits` / `updateVendorPackage` and package-purchase confirmation / invalid-lead refunds through `qf_apply_vendor_credit_delta` for idempotency; the preferred-vendor RPC + `assign_lead_to_vendors` (manual) do not yet check `accepting_leads` (they already enforce credits). These are enumerated for Phase 4-cont.
- **Vendor/Admin dashboards:** intentionally untouched (no clean minimal change without UI edits, which are out of scope). Admin can already read status/credits/ledger; `accepting_leads` surfacing is a follow-on.
- **Phase 3A diagnostics:** one necessary refinement (`selected_vendor_not_reflected_in_assignment` skips at max-3, since selected is now the pool). New anomaly codes (`assignment_while_not_accepting_leads`, etc.) require per-vendor state loading — deferred; diagnostics stays read-only.

## 14. Exact n8n synchronization requirements for next phase
See `docs/N8N_VENDOR_CREDIT_SYNC_CONTRACT.md`. Events: `vendor.approved`,
`vendor.accepting_leads_changed`, `credits.granted`, `credits.debited`,
`credits.refunded`, `credits.exhausted`, `package.purchase_confirmed`, each with
`vendor_id`, `credit_balance`, `delta`, `reference_type/id`, `reason`, `timestamp`,
`idempotency_key`. **No events emitted, no workflow/webhook changed in Phase 4.**

## 15. Production E2E plan (pending; not run)
On an **isolated staging Supabase** (never prod): (1) apply migrations 140→141→142
in order; (2) seed vendors covering CASES 1–7,16,17 and assert live RPC eligibility
matches the TS helper; (3) two concurrent leads on a 1-credit vendor → exactly one
assignment, one `-1` ledger, no negative balance; (4) 4-candidate pool with a
concurrent credit exhaustion → exactly 3 assignments (CASE 12); (5) repeat the same
assignment + same purchase reference → no double assignment/debit (CASES 11, 13);
(6) invalid-lead refund → original `-1` retained + new `+1` (CASE 14); (7) Phase 3B
retry on a waiting lead → matched, idempotent, no duplicate delivery. Only after
this passes should production migration be scheduled.

---

## Git safety answers
- **UI files changed?** No — no `components/*`, `app/*` pages, CSS, or Tailwind.
- **Existing API contract changed?** No — no route handler was modified.
- **Database RPC signature changed?** No — `assign_lead_to_paid_vendors_phase26a(uuid, uuid[])` keeps its signature (body only, in a review-only migration). `qf_apply_vendor_credit_delta` is **new/additive**.
- **Webhook contract changed?** No — n8n untouched; contract is documentation only.

### Files
**Modified (5):** `lib/vendors/vendorEligibility.ts`, `services/leadMatchingEngine.ts`, `services/leadDeliveryService.ts`, `services/leadProcessingDiagnosticsCore.ts`, `package.json`.
**New (6):** `lib/vendors/vendorAutomaticEligibility.ts`, `scripts/phase4-credit-wallet-harness.ts`, `docs/N8N_VENDOR_CREDIT_SYNC_CONTRACT.md`, and migrations `20260706000140`, `20260706000141`, `20260706000142`.
**Migrations created (3):** all additive/reversible, **generated for review — not applied.**
