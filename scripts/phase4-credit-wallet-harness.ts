// ============================================================================
// QuickFurno — scripts/phase4-credit-wallet-harness.ts
// Phase 4 (credit-wallet) deterministic harness (no DB, no network).
//
// VERIFICATION LEVELS (honest):
//   [pure]   runs the canonical eligibility helper / pure algorithm models.
//   [static] scans source/migration files for the required contract.
//   [db]     NOT covered here — real transaction atomicity, concurrent matcher
//            execution, RPC race behavior, and DB-level uniqueness require a
//            controlled staging DB E2E (see PHASE4 report). NOT claimed as proven.
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

console.log("QuickFurno Phase 4 — credit-wallet harness\n");
check("LEAD_CREDIT_COST is 1", LEAD_CREDIT_COST === 1);

// ---- CASE 1–7, 16, 17 : canonical eligibility [pure] -----------------------
check("CASE 1 approved+active+accepting+credits1 → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 1 })).eligible === true);
{
  const r = evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 0, package_status: "active" }));
  check("CASE 2 credits0 + package active → no_credits (not eligible)", !r.eligible && hasReason(r, "no_credits"));
}
check("CASE 3 credits5 + package expired → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 5, package_status: "expired" })).eligible === true);
check("CASE 4 credits5 + paid_status Unpaid → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 5, paid_status: "Unpaid" })).eligible === true);
{
  const r = evaluateVendorAutomaticLeadEligibility(vendor({ status: "Pending", remaining_credits: 50 }));
  check("CASE 5 pending + credits50 → not eligible (vendor_not_approved)", !r.eligible && hasReason(r, "vendor_not_approved"));
}
{
  const r = evaluateVendorAutomaticLeadEligibility(vendor({ status: "Suspended", remaining_credits: 50 }));
  check("CASE 6 suspended + credits50 → not eligible (vendor_suspended)", !r.eligible && hasReason(r, "vendor_suspended"));
}
{
  const r = evaluateVendorAutomaticLeadEligibility(vendor({ accepting_leads: false, remaining_credits: 50 }));
  check("CASE 7 accepting_leads false + credits50 → not eligible (not_accepting_leads)", !r.eligible && hasReason(r, "not_accepting_leads"));
}
{
  const r = evaluateVendorAutomaticLeadEligibility(vendor({ package_status: "active", remaining_credits: 0 }));
  check("CASE 16 approved + package active + credits0 → no enquiry", !r.eligible && hasReason(r, "no_credits"));
}
check("CASE 17 approved + package expired + positive credits → eligible", evaluateVendorAutomaticLeadEligibility(vendor({ package_status: "expired", remaining_credits: 3 })).eligible === true);

// accepting_leads defaults TRUE when the column is absent (no silent stop).
check("accepting_leads defaults true when absent", normalizeAcceptingLeads({ status: "Approved" }) === true);
check("package/paid never appear in eligibility reasons", evaluateVendorAutomaticLeadEligibility(vendor({ package_status: "expired", paid_status: "Unpaid" })).reasons.length === 0);

// ---- CASE 8 : one assignment consumes the last credit [pure] ---------------
{
  const before = evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 1 }));
  const afterDebit = evaluateVendorAutomaticLeadEligibility(vendor({ remaining_credits: 0 })); // post one -1 debit
  check("CASE 8 credits1 eligible, then credits0 → next lead not eligible", before.eligible === true && !afterDebit.eligible && hasReason(afterDebit, "no_credits"));
}

// ---- CASE 12 : fill-until-3-successful [pure model of RPC loop] -------------
{
  // Pure model of the RPC's bounded loop. Real atomicity is a [db] concern.
  function simulateFillUntilSuccessful(ranked: string[], maxSuccessful: number, canAssign: (id: string) => boolean): string[] {
    const assigned: string[] = [];
    for (const id of ranked) {
      if (assigned.length >= maxSuccessful) break;
      if (canAssign(id)) assigned.push(id);
    }
    return assigned;
  }
  const ranked = ["c1", "c2", "c3", "c4"];
  const lostCredit = new Set(["c3"]); // c3 exhausted its last credit concurrently
  const result = simulateFillUntilSuccessful(ranked, 3, (id) => !lostCredit.has(id));
  check("CASE 12 four ranked, c3 ineligible → c4 fills → exactly 3 assigned", result.length === 3 && JSON.stringify(result) === JSON.stringify(["c1", "c2", "c4"]));
  const allOk = simulateFillUntilSuccessful(["c1", "c2", "c3", "c4"], 3, () => true);
  check("CASE 12b never exceeds max-3 even when all eligible", allOk.length === 3);
}

// ---- CASE 14 : refund retains original debit [pure ledger model] -----------
{
  // Append-only ledger: a refund is a NEW +1 row; the original -1 is never removed.
  const ledger: Array<{ delta: number; reason: string }> = [{ delta: -1, reason: "lead_assignment_debit" }];
  ledger.push({ delta: 1, reason: "invalid_lead_refund" });
  const net = ledger.reduce((s, e) => s + e.delta, 0);
  check("CASE 14 original -1 debit retained", ledger[0].delta === -1 && ledger[0].reason === "lead_assignment_debit");
  check("CASE 14 refund is a new +1 row (both retained, net 0)", ledger.length === 2 && ledger[1].delta === 1 && net === 0);
}

// ============================================================================
// [static] contract/alignment scans over the actual sources + migrations.
// ============================================================================
const matcherSrc = stripJs(readSource("../services/leadMatchingEngine.ts"));
const deliverySrc = stripJs(readSource("../services/leadDeliveryService.ts"));
const preferredSrc = stripJs(readSource("../services/preferredVendorLeadService.ts"));
const rpcSrc = stripSql(readSource("../supabase/migrations/20260706000142_credit_wallet_assignment_rpc.sql"));
const creditRpcSrc = stripSql(readSource("../supabase/migrations/20260706000141_vendor_credit_wallet_rpc.sql"));

// CASE 9 — one successful assignment writes exactly one -1 debit ledger row.
check("CASE 9 [static] RPC writes a lead_assignment_debit ledger row (delta -v_credit_cost)", /'lead_assignment_debit'/.test(rpcSrc) && /-v_credit_cost/.test(rpcSrc));

// CASE 10 — delivery side effects deduct zero additional credit.
check("CASE 10 [static] delivery service never mutates credits", !/remaining_credits/.test(deliverySrc));

// CASE 11 — repeat assignment request → RPC already_assigned short-circuit.
check("CASE 11 [static] RPC has already_assigned idempotency short-circuit", /already_assigned/.test(rpcSrc) && /lead_assignments where lead_id = p_lead_id/.test(rpcSrc));

// CASE 13 — repeated purchase/grant with same reference grants once.
check("CASE 13 [static] credit RPC is idempotent on (reference_type, reference_id)", /already_applied/.test(creditRpcSrc) && /reference_type = p_reference_type and reference_id = p_reference_id/.test(creditRpcSrc));

// CASE 15 — client-selected path blocks when no credits (no contact shared).
check("CASE 15 [static] preferred/client-selected path enforces a no_credits block", /no_credits/.test(preferredSrc) && /normalizeCredits\(vendor\) <= 0/.test(preferredSrc));

// CASE 18 — matcher (TS) and RPC (SQL) share the SAME canonical gate; package/paid removed from BOTH.
check("CASE 18 [static] matcher uses the canonical helper", /evaluateVendorAutomaticLeadEligibility/.test(matcherSrc));
check("CASE 18 [static] matcher no longer uses the package/paid contact-access helper for the gate", !/evaluateVendorContactAccessEligibility/.test(matcherSrc));
check("CASE 18 [static] RPC gate: approved/active + is_active + accepting_leads + remaining_credits", /not in \('approved', 'active'\)/.test(rpcSrc) && /accepting_leads/.test(rpcSrc) && /remaining_credits, 0\) < v_credit_cost/.test(rpcSrc));
check("CASE 18 [static] RPC gate removed package/paid_status", !/v_has_active_package/.test(rpcSrc) && !/paid_status/.test(rpcSrc) && !/package_status/.test(rpcSrc));

// ---- summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const line of failures) console.log(line);
  process.exit(1);
}
console.log("All Phase 4 credit-wallet harness cases passed.");
