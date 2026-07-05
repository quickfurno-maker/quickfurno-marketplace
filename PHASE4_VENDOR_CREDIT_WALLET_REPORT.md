# PHASE 4 — QuickFurno Simple Credit-Wallet Vendor System

> **Status: NOT production-ready until live DB integration passes.** TS logic is
> implemented + verified; all SQL is **migration-generated for review (not
> applied)**; concurrency/atomicity/rollback are **integration-required**. Nothing
> committed, pushed, deployed, or migrated.

**Rule:** *An approved and active vendor who is accepting leads, has ≥1 credit, and
matches the client's city and category can receive an enquiry. No credit = no
enquiry. One successful assignment = one credit. Max three successful vendors per
lead. Packages only add credits; package status does not control matching.*

## Status legend
`[implemented]` = code merged & verified (typecheck/build/pure/static harness).
`[migration-generated]` = SQL written for review, **not applied**.
`[integration-required]` = correctness needs a staging DB E2E (see §E2E).
`[deferred]` = explicitly out of this pass, documented.

---

## 1. Preflight blockers fixed
| Finding | Fix | Status |
|---|---|---|
| Ledger CHECK rejected `lead_assignment_debit` (swallowed) | 00141 aligns `change_type` CHECK to Phase 4 + legacy types; 00142 ledger insert made **mandatory** (no catch) | `[migration-generated]` |
| Wallet writers not wired | admin grant/adjust + package top-up routed through canonical primitive; refund + package-purchase boundaries added | `[implemented]` (TS) + `[migration-generated]` (00145) |
| Preferred/manual RPCs missing `accepting_leads` | 00143 (preferred) + 00144 (manual) add `accepting_leads` | `[migration-generated]` |
| Preferred/manual debits NOT ledger-correlated | 00143 + 00144 drop `deduct_vendor_credit`, do atomic debit + **mandatory** `lead_assignment_debit` ledger row; 00145 no longer duplicates `vendor_packages` on replay | `[migration-generated]` |
| Manual RPC honored a DB setting of 4 | 00144 `v_max := least(get_setting_int(...,3), 3)` — hard cap 3 for selected-count guard + auto-fill | `[migration-generated]` |
| Preferred RPC double trust gate | 00143 removes `verification_status` as eligibility (approved Approved+Pending vendors no longer blocked); trust = `status` only, verification is audit/display | `[migration-generated]` |
| Legacy package route was a 2nd credit path | `updateVendorPackage` + package route grant **no** credits (metadata only); `creditsToAdd` dropped/ignored | `[implemented]` |
| Package RPC didn't verify payment ownership | 00145 raises `PAYMENT_VENDOR_MISMATCH` / `PAYMENT_PACKAGE_MISMATCH` after locking the payment | `[migration-generated]` |
| Pool = 6 | `MAX_ASSIGNMENT_CANDIDATE_POOL = 20` in matcher + delivery (agree) | `[implemented]` |
| `qf_apply_vendor_credit_delta` hardening | lock-first, idempotency-after-lock, no-clamp, cumulative `total_credits` | `[migration-generated]` |

## 2. Canonical business rule
`APPROVED + ACTIVE + ACCEPTING_LEADS + remaining_credits ≥ 1 + CITY + CATEGORY`.
`paid_status`/`package_status`/`package_expires_at`/`vendor_packages` are **history-only**.

## 3. Authoritative fields
Approval = `vendors.status`; availability = `vendors.accepting_leads` (default true);
wallet = `vendors.remaining_credits`; ledger = `vendor_credit_logs` (+`reference_type`/`reference_id`).

## 4. Deprecated matching dependencies (kept, not deleted)
`paid_status`, `package_status`, `package_expires_at`, `vendor_packages` active rows, `public_visibility` — removed from **automatic** eligibility in both layers. `evaluateVendorContactAccessEligibility` is `@deprecated for assignment` and unused by the matcher.

## 5. Eligibility flow `[implemented]`
`evaluateVendorAutomaticLeadEligibility` (zero-dep `lib/vendors/vendorAutomaticEligibility.ts`) → reasons `vendor_not_approved|vendor_suspended|vendor_inactive|not_accepting_leads|no_credits`. The RPC gate (00142) is the same contract in SQL.

## 6. Credit grant flow `[implemented]` + `[migration-generated]`
Canonical primitive `qf_apply_vendor_credit_delta(vendor, delta, change_type, reason, reference_type, reference_id, updated_by, allow_negative)` (00141). TS boundary `services/vendorCreditWalletService.ts` (`applyVendorCreditDelta` / `grantVendorCredits` / `refundCreditForInvalidLead` / `grantCreditsForConfirmedPackagePurchase`). **Wired:** `vendorAdminService.updateVendorCredits` ("add" → `admin_credit_grant`, "set"/remove → `manual_adjustment`, optional idempotency `reference` from the credits API) and `updateVendorPackage` top-up → `admin_credit_grant`. No direct `remaining_credits`/`total_credits`/`vendor_credit_logs` writes remain in `vendorAdminService`.

## 7. Assignment debit flow `[migration-generated]` — ALL THREE paths ledger-correlated
Every chargeable path now debits the credit wallet atomically and writes a
**MANDATORY** assignment-correlated ledger row (`change_type=lead_assignment_debit`,
`reference_type=lead_assignment`, `reference_id=<assignment id>`, `credits_delta=-1`).
A ledger failure rolls back that debit + assignment. **No successful assignment
debit without a successful ledger row** — for automatic (`00142`), preferred/client-
selected (`00143`), and manual/admin (`00144`). `deduct_vendor_credit` /
`restore_vendor_credit` are **no longer used** by any of the three RPCs (each does
an atomic conditional `remaining_credits - 1 WHERE remaining_credits >= 1`, and a
direct `+1` restore only for a pre-ledger `unique_violation` race).

## 8. Refund flow `[implemented]` (call site) + `[migration-generated]` (primitive)
Append-only: `refundCreditForInvalidLead` grants `+1` via the primitive, `reference=(invalid_lead_refund, assignment id)`; the original `-1` is never deleted (idempotent — same reference refunds once).

## 9. Atomic transaction behavior `[migration-generated]` / `[integration-required]`
Auto RPC: lead lock, duplicate/idempotency short-circuits, vendor lock, conditional debit, `unique(lead,vendor)` rollback, mandatory ledger, max-3. Wallet primitive: **vendor lock FIRST, idempotency after lock** (concurrent duplicates serialize → exactly one mutation), **no silent clamp** (raises `INSUFFICIENT_CREDITS` unless `allow_negative`). Real atomicity/race behavior is `[integration-required]`.

## 10. Max-3 successful fill `[implemented]` (pool) + `[migration-generated]` (loop)
Matcher passes a bounded ranked pool of **20** (ranking unchanged); 00142 iterates the whole deduped pool in JS order, skips failed transactional rechecks, and `exit when assigned ≥ 3`. Pure model verified (H13b/H14/H15).

## 11. Migration order (all additive, reversible, **not applied**)
`00140` accepting_leads → `00141` ledger ref + change_type constraint + wallet primitive → `00142` auto RPC (mandatory ledger, fill-until-3) → `00143` preferred RPC + accepting_leads → `00144` manual RPC + accepting_leads → `00145` package-purchase idempotent grant. 00141 is a hard prerequisite of 00142 (constraint + reference columns).

## 12. total_credits semantics (decision)
**A — cumulative credits ever granted.** The primitive increments `total_credits` on **positive** deltas only (`+ greatest(p_delta,0)`); debits/negative adjustments never reduce it. It is **not** an eligibility field (only `remaining_credits` is spendable).

## 13. Ledger reference design (decision)
`reference_type` + `reference_id`, **GLOBAL** partial unique index `(reference_type, reference_id) where reference_id is not null` (vendor_id intentionally excluded — every canonical reference id is a globally-unique entity id). References: `lead_assignment`+assignment id · `package_purchase`+payment/order id · `admin_credit_grant`+grant key · `invalid_lead_refund`+assignment/approval id · `manual_adjustment`+adjustment key.

## 14. Historical data `[implemented]` (read-only)
`docs/PHASE4_HISTORICAL_CREDIT_AUDIT.sql` — SELECT-only audit (27 charged assignments / 16 negative rows). **No backfill** (old ledger has no assignment reference → non-deterministic). Phase 4 guarantee is forward-only.

## 15. Test results (`npm run test:phase4`)
**46 passed, 0 failed** (adds R1–R10: preferred/manual RPCs drop `deduct_vendor_credit`, insert `vendor_credit_logs` with `reference_type=lead_assignment`; all three RPCs use `lead_assignment_debit` with mandatory (non-swallowed) ledger; 00145 checks the package_purchase reference before inserting `vendor_packages`). Eligibility CASES 1–8/16/17 `[pure]`; H1–H2 change-type constraint `[static]`; H3/H4 mandatory ledger / no-swallow `[static]`; H5/H6/H7 accepting_leads in auto/preferred/manual `[static]`; H8 preferred no package/paid `[static]`; H9/H10/H11 idempotent purchase/grant/refund `[static]`; H12 no-clamp `[static]`; H13/H13b/H14/H15 pool-20 + fill-until-3 + continue-to-later `[static]`+`[pure]`; H16/H17/H18 replay/delivery/whatsapp no-debit `[static]`; refund append-only `[pure]`. Regression: 3A **52/52**, 3B **58/58**. typecheck ✓, build ✓, `git diff --check` clean.

## 16. Deferred / integration-required (honest)
- **Ledger correlation is COMPLETE** across all three assignment RPCs in the
  generated migrations (auto/preferred/manual) — this is no longer deferred. The
  package-purchase RPC (`00145`) is idempotent on `(package_purchase, payment id)`
  and no longer risks a duplicate `vendor_packages` row on replay.
- `[integration-required]` (NOT proven by a pure/static harness, NOT claimed): real
  DB transaction atomicity, concurrent race testing, RPC-level uniqueness, true
  rollback-on-ledger-failure, and production E2E. n8n sync remains documentation-only.
- `[deferred]`: app-level package-purchase confirmation handler does not exist
  (order-intent only) — the TS boundary `grantCreditsForConfirmedPackagePurchase`
  + DB `assign_package_to_vendor` (`00145`) are the go-forward; the future webhook
  call site is documented in `vendorCreditWalletService.ts`. Vendor/Admin dashboard
  UI intentionally untouched.

---

## Change surface
**Modified:** `services/leadMatchingEngine.ts`, `services/leadDeliveryService.ts`, `services/vendorAdminService.ts`, `app/api/admin/vendors/[id]/credits/route.ts`, `scripts/phase4-credit-wallet-harness.ts`, migrations `20260706000141`, `20260706000142`.
**New:** `services/vendorCreditWalletService.ts`, `docs/PHASE4_HISTORICAL_CREDIT_AUDIT.sql`, migrations `20260706000143`, `20260706000144`, `20260706000145`.
**New corrective migrations:** 00143 (preferred RPC), 00144 (manual RPC), 00145 (package purchase); 00141/00142 revised.
**RPC signatures:** `assign_lead_to_paid_vendors_phase26a(uuid,uuid[])` unchanged; `assign_lead_to_preferred_vendor(uuid,uuid)` unchanged; `assign_lead_to_vendors(uuid,uuid[],boolean,text)` unchanged; `assign_package_to_vendor(uuid,uuid,uuid)` unchanged. **New:** `qf_apply_vendor_credit_delta(uuid,int,text,text,text,text,text,boolean)`.
**API changes:** admin credits route accepts an **optional** `reference` (backward-compatible; no breaking change).
**UI changes:** none.
**Webhook changes:** none (n8n untouched; contract remains documentation-only).

## E2E plan (integration-required, not run)
On an isolated staging Supabase, apply 00140→00145 in order, then: (a) assert live RPC eligibility == TS helper across CASES 1–7/16/17; (b) force a ledger failure and confirm the debit + assignment roll back; (c) 20-candidate pool with concurrent credit exhaustion → exactly 3 assignments; (d) replay assignment + same purchase/grant/refund reference → one mutation each; (e) manual over-remove → `INSUFFICIENT_CREDITS` (no clamp); (f) Phase 3B retry idempotent. Only then schedule production migration.
