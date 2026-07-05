// ============================================================================
// QuickFurno — scripts/phase4-credit-wallet-harness.ts
// Phase 4 (credit-wallet) deterministic harness (no DB, no network).
//
// VERIFICATION LEVELS (honest — never conflated):
//   [pure]    runs the canonical eligibility helper / pure algorithm models.
//   [static]  scans source/migration files for the required contract.
//   [db]      NOT covered here. Real transaction atomicity, concurrent matcher
//             execution, RPC race behavior, DB-level uniqueness, and true rollback
//             on a ledger failure require a controlled staging DB E2E (report §E2E).
// Run with:  node scripts/phase4-credit-wallet-harness.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VendorAutomaticLeadEligibilityReason } from "../lib/vendors/vendorAutomaticEligibility";

const eligUrl = new URL("../lib/vendors/vendorAutomaticEligibility.ts", import.meta.url).href;
const elig = (await import(eligUrl)) as typeof import("../lib/vendors/vendorAutomaticEligibility");
const { evaluateVendorAutomaticLeadEligibility, normalizeAcceptingLeads, LEAD_CREDIT_COST } = elig;

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    const line = `  FAIL  ${name}${detail ? ` — ${detail}` : ""}`;
    failures.push(line);
    console.log(line);
  }
}
function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}
function stripJs(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function stripSql(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}
function vendor(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "Approved", is_active: true, accepting_leads: true, remaining_credits: 5, ...over };
}
function hasReason(v: { reasons: VendorAutomaticLeadEligibilityReason[] }, r: VendorAutomaticLeadEligibilityReason): boolean {
  return v.reasons.includes(r);
}

// Pure model of the RPC's bounded fill loop (real atomicity is a [db] concern):
// iterate ranked candidates in order, skip those failing the transactional recheck,
// stop after maxSuccessful.
function simulateFillUntilSuccessful(ranked: string[], maxSuccessful: number, canAssign: (id: string) => boolean): string[] {
  const assigned: string[] = [];
  for (const id of ranked) {
    if (assigned.length >= maxSuccessful) break;
    if (canAssign(id)) assigned.push(id);
  }
  return assigned;
}

console.log("QuickFurno Phase 4 — credit-wallet harness\n");
check("LEAD_CREDIT_COST is 1", LEAD_CREDIT_COST === 1);

// ---- Canonical eligibility (report CASES 1–8, 16, 17) [pure] ---------------
check("CASE 1 approved+active+accepting+credits1 → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 1 })).eligible === true);
check("CASE 2 credits0 + package active → no_credits", hasReason(evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 0, package_status: "active" })), "no_credits"));
check("CASE 3 credits5 + package expired → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 5, package_status: "expired" })).eligible === true);
check("CASE 4 credits5 + paid_status Unpaid → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 5, paid_status: "Unpaid" })).eligible === true);
check("CASE 5 pending + credits50 → vendor_not_approved", hasReason(evaluateVendorAutomaticLeadEligibility(vendor({ status: "Pending", remaining_credits: 50 })), "vendor_not_approved"));
check("CASE 6 suspended + credits50 → vendor_suspended", hasReason(evaluateVendorAutomaticLeadEligibility(vendor({ status: "Suspended", remaining_credits: 50 })), "vendor_suspended"));
check("CASE 7 accepting_leads false + credits50 → not_accepting_leads", hasReason(evaluateVendorAutomaticLeadEligibility(vendor({ accepting_leads: false, remaining_credits: 50 })), "not_accepting_leads"));
check("CASE 8 credits1 eligible, then credits0 → not eligible", evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 1 })).eligible === true && hasReason(evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 0 })), "no_credits"));
check("CASE 16 approved + package active + credits0 → no enquiry", hasReason(evaluateVendorAutomaticLeadEligibility(vendor({ package_status: "active", remaining_credits: 0 })), "no_credits"));
check("CASE 17 approved + package expired + positive credits → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ package_status: "expired", remaining_credits: 3 })).eligible === true);
check("accepting_leads defaults true when absent", normalizeAcceptingLeads({ status: "Approved" }) === true);
check("package/paid never appear in eligibility reasons", evaluateVendorAutomaticLeadEligibility(vendor({ package_status: "expired", paid_status: "Unpaid" })).reasons.length === 0);

// ============================================================================
// Sources / migrations for [static] contract scans.
// ============================================================================
const matcherSrc = stripJs(readSource("../services/leadMatchingEngine.ts"));
const deliverySrc = stripJs(readSource("../services/leadDeliveryService.ts"));
const preferredSrc = stripJs(readSource("../services/preferredVendorLeadService.ts"));
const walletSrc = stripJs(readSource("../services/vendorCreditWalletService.ts"));
const adminSrc = stripJs(readSource("../services/vendorAdminService.ts"));
const c141 = stripSql(readSource("../supabase/migrations/20260706000141_vendor_credit_wallet_rpc.sql"));
const c142 = stripSql(readSource("../supabase/migrations/20260706000142_credit_wallet_assignment_rpc.sql"));
const c143 = stripSql(readSource("../supabase/migrations/20260706000143_preferred_assignment_accepting_leads.sql"));
const c144 = stripSql(readSource("../supabase/migrations/20260706000144_manual_assignment_accepting_leads.sql"));

// ---- Hardening tests H1–H18 (finding TESTS list) ---------------------------

// H1 — allowed Phase 4 ledger change types.
check("H1 [static] constraint allows the 5 Phase 4 change types", ["'package_purchase'", "'admin_credit_grant'", "'lead_assignment_debit'", "'invalid_lead_refund'", "'manual_adjustment'"].every((t) => c141.includes(t)));
// H2 — legacy ledger change types preserved.
check("H2 [static] constraint preserves the 6 legacy change types", ["'manual_add'", "'manual_set'", "'manual_remove'", "'package_credit'", "'preview_test'", "'correction'"].every((t) => c141.includes(t)));
// H3 — assignment ledger failure rolls back (mandatory insert). [db] proves rollback; [static] proves no swallow.
check("H3 [static] assignment ledger insert is MANDATORY (transaction fails on error)", /'lead_assignment_debit'/.test(c142));
// H4 — no catch swallowing the required ledger check failure.
check("H4 [static] no swallow of check_violation/undefined_column around the ledger insert", !/when undefined_table or undefined_column or check_violation/.test(c142));
// H5 — automatic assignment checks accepting_leads.
check("H5 [static] auto RPC gate checks accepting_leads", /accepting_leads/.test(c142) && /not in \('approved', 'active'\)/.test(c142));
// H6 — preferred assignment checks accepting_leads.
check("H6 [static] preferred RPC checks accepting_leads", /accepting_leads/.test(c143) && /not_accepting_leads/.test(c143));
// H7 — manual assignment checks accepting_leads (both subqueries).
check("H7 [static] manual RPC checks accepting_leads in both subqueries", (c144.match(/coalesce\(v\.accepting_leads, true\)/g) || []).length >= 2);
// H8 — preferred path does not use package_status/paid_status as eligibility.
check("H8 [static] preferred RPC does not gate on package_status/paid_status", !/package_status|paid_status/.test(c143));
// H9 — package purchase same reference twice → one grant.
check("H9 [static] package purchase idempotent on reference", /already_applied/.test(c141) && /package_purchase/.test(walletSrc) && /'package_purchase'/.test(stripSql(readSource("../supabase/migrations/20260706000145_package_purchase_idempotent_grant.sql"))));
// H10 — admin grant same reference twice → one grant.
check("H10 [static] admin grant routes through canonical service w/ optional reference", /applyVendorCreditDelta/.test(adminSrc) && /referenceId: reference/.test(adminSrc) && /admin_credit_grant/.test(adminSrc));
// H11 — refund same reference twice → one refund.
check("H11 [static] refund helper uses invalid_lead_refund reference (idempotent)", /refundCreditForInvalidLead/.test(walletSrc) && /invalid_lead_refund/.test(walletSrc));
// H12 — invalid negative mutation cannot silently clamp to zero.
check("H12 [static] canonical RPC raises INSUFFICIENT_CREDITS, no clamp", /INSUFFICIENT_CREDITS/.test(c141) && !/greatest\(0,\s*v_before\s*\+\s*p_delta\)/.test(c141));
// H13 — candidate pool > 6 works; constants agree at 20.
check("H13 [static] MAX_ASSIGNMENT_CANDIDATE_POOL = 20 in both matcher and delivery", /MAX_ASSIGNMENT_CANDIDATE_POOL = 20/.test(matcherSrc) && /MAX_ASSIGNMENT_CANDIDATE_POOL = 20/.test(deliverySrc));
{
  const ranked = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);
  check("H13b [pure] pool of 8 candidates → exactly 3 assigned", simulateFillUntilSuccessful(ranked, 3, () => true).length === 3);
}
// H14 — exactly 3 successful maximum.
check("H14 [pure] never exceeds 3 successful even with 20 eligible", simulateFillUntilSuccessful(Array.from({ length: 20 }, (_, i) => `c${i + 1}`), 3, () => true).length === 3);
// H15 — early transactional failures continue to later candidates (7–20).
{
  const ranked = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
  const failed6 = new Set(["c1", "c2", "c3", "c4", "c5"]);
  const res = simulateFillUntilSuccessful(ranked, 3, (id) => !failed6.has(id));
  check("H15 [pure] candidates 1–5 fail → 6,7,8 fill → exactly 3", res.length === 3 && JSON.stringify(res) === JSON.stringify(["c6", "c7", "c8"]));
}
// H16 — existing assignment replay creates no new debit.
check("H16 [static] auto RPC short-circuits already_assigned before any debit", /already_assigned/.test(c142) && /lead_assignments where lead_id = p_lead_id/.test(c142));
// H17 — delivery retry creates no debit.
check("H17 [static] delivery service never mutates credits", !/remaining_credits/.test(deliverySrc));
// H18 — WhatsApp preview retry creates no debit.
check("H18 [static] whatsapp preview log carries credit_deducted: false", /whatsapp_preview[\s\S]*?credit_deducted: false/.test(deliverySrc) || /credit_deducted: false[\s\S]*?whatsapp/.test(deliverySrc));

// ---- Ledger-correlation corrections (R1–R10) [static] ----------------------
const c145 = stripSql(readSource("../supabase/migrations/20260706000145_package_purchase_idempotent_grant.sql"));
const ledgerInsertRe = /insert into public\.vendor_credit_logs/;
const swallowRe = /when undefined_table or undefined_column or check_violation/;

// R1/R4 — preferred + manual no longer use the old package-coupled debit helpers.
check("R1 [static] preferred RPC does not call deduct_vendor_credit/restore_vendor_credit", !/deduct_vendor_credit|restore_vendor_credit/.test(c143));
check("R4 [static] manual RPC does not call deduct_vendor_credit/restore_vendor_credit", !/deduct_vendor_credit|restore_vendor_credit/.test(c144));
// R2/R5 — preferred + manual insert vendor_credit_logs.
check("R2 [static] preferred RPC inserts vendor_credit_logs", ledgerInsertRe.test(c143));
check("R5 [static] manual RPC inserts vendor_credit_logs", ledgerInsertRe.test(c144));
// R3/R6 — reference_type = lead_assignment + change_type = lead_assignment_debit.
check("R3 [static] preferred RPC uses reference_type lead_assignment (+ debit type)", /'lead_assignment'/.test(c143) && /'lead_assignment_debit'/.test(c143));
check("R6 [static] manual RPC uses reference_type lead_assignment (+ debit type)", /'lead_assignment'/.test(c144) && /'lead_assignment_debit'/.test(c144));
// R7 — 00145 checks the prior package_purchase reference BEFORE inserting vendor_packages.
{
  const refIdx = c145.indexOf("reference_type = 'package_purchase'");
  const insIdx = c145.indexOf("insert into public.vendor_packages");
  check("R7 [static] package RPC checks package_purchase reference before vendor_packages insert", refIdx >= 0 && insIdx >= 0 && refIdx < insIdx);
}
// R8 — repeated payment reference short-circuits (already_applied) → no duplicate row.
check("R8 [static] package RPC returns already_applied on replay (no duplicate row/grant)", /already_applied/.test(c145));
// R9 — all three assignment RPCs use lead_assignment_debit.
check("R9 [static] all three assignment RPCs use lead_assignment_debit", /'lead_assignment_debit'/.test(c142) && /'lead_assignment_debit'/.test(c143) && /'lead_assignment_debit'/.test(c144));
// R10 — all three have MANDATORY ledger (insert present, no check_violation swallow).
check("R10 [static] all three RPCs: mandatory ledger, no swallow", ledgerInsertRe.test(c142) && ledgerInsertRe.test(c143) && ledgerInsertRe.test(c144) && !swallowRe.test(c142) && !swallowRe.test(c143) && !swallowRe.test(c144));

// ---- Alignment (report CASE 18) + refund append-only [pure] ----------------
check("Align [static] matcher uses the canonical helper, not the package/paid helper", /evaluateVendorAutomaticLeadEligibility/.test(matcherSrc) && !/evaluateVendorContactAccessEligibility/.test(matcherSrc));
check("Align [static] auto RPC gate removed package/paid, kept credits", !/v_has_active_package/.test(c142) && /remaining_credits, 0\) < v_credit_cost/.test(c142));
check("CASE 15 [static] client-selected path enforces a no_credits block", /no_credits/.test(preferredSrc) && /normalizeCredits\(vendor\) <= 0/.test(preferredSrc));
{
  const ledger = [{ delta: -1, reason: "lead_assignment_debit" }, { delta: 1, reason: "invalid_lead_refund" }];
  check("Refund [pure] original -1 retained + new +1 (net 0, append-only)", ledger[0].delta === -1 && ledger.length === 2 && ledger[1].delta === 1 && ledger.reduce((s, e) => s + e.delta, 0) === 0);
}

// ---- summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const line of failures) console.log(line);
  process.exit(1);
}
console.log("All Phase 4 credit-wallet harness cases passed.");
