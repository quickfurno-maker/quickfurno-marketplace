// ============================================================================
// QuickFurno — scripts/qf-mvp-80-15c-assigned-contact-entitlement-harness.mjs
//
// QF-MVP-80.15C — ASSIGNED-LEAD CONTACT ENTITLEMENT.
//
// WHAT IS BEING PROVED
//   The canonical authority charges ONE wallet credit at assignment time and
//   commits the assignment only if the ledger debit applied. That row is a
//   receipt. But the vendor dashboard decided contact visibility from MUTABLE
//   CURRENT state — package expiry, package/paid class, current balance — so an
//   already-paid lead could be hidden later. Two ways in particular:
//
//     • the package lapsed after the lead was charged, and
//     • the assignment itself spent the last credit (1 -> 0), so the very debit
//       that paid for the lead made the lead unreadable.
//
//   After this slice a canonical receipt (operation_id + credit_deducted) grants
//   contact for THAT assignment. Nothing else moves: account safety gates still
//   deny, legacy rows still fall back to the previous helper, and no lead the
//   vendor was never assigned becomes reachable.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the REAL decision module with no I/O.
//   [view]   executes the REAL client view-model builder.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it.
//
// A rule that cannot fail proves nothing, so every static rule is re-evaluated
// against a deliberately broken copy.
//
// Run: npm run test:mvp:80-15c
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const outDir = resolve(".qf-80-15c-build");
rmSync(outDir, { recursive: true, force: true });
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/vendors/assignedLeadContactAccess.ts",
  "components/vendor-dashboard-v2/leads/leadsModel.ts",
];
const tsconfigPath = resolve(".qf-80-15c-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
    esModuleInterop: true, strict: true, outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
    jsx: "react-jsx",
  },
  files,
}, null, 2));
try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
finally { rmSync(tsconfigPath, { force: true }); }

const require_ = createRequire(import.meta.url);

// tsc rewrites types, not the "@/..." path alias, so the emitted CommonJS still
// asks for "@/lib/...". Resolve those against the build output exactly as the
// bundler would, so the harness executes the REAL modules rather than copies.
const Module = require_("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolve.call(this, resolve(outDir, request.slice(2)), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const ACCESS = require_(resolve(outDir, "lib/vendors/assignedLeadContactAccess.js"));
const MODEL = require_(resolve(outDir, "components/vendor-dashboard-v2/leads/leadsModel.js"));

const { evaluateAssignedLeadContactAccess, hasCanonicalAssignmentDebitEvidence,
        isVendorAccountContactEligible } = ACCESS;
const { buildVendorLeadViews } = MODEL;

/** Comment text is intent, not behaviour. Negative claims run on CODE only. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const readRaw = (p) => readFileSync(p, "utf8");
const readCode = (p) => stripComments(readRaw(p));

const VENDOR_SERVICE_RAW = readRaw("services/vendorService.ts");
const VENDOR_SERVICE = stripComments(VENDOR_SERVICE_RAW);
const MODEL_RAW = readRaw("components/vendor-dashboard-v2/leads/leadsModel.ts");
const MODEL_SRC = stripComments(MODEL_RAW);
const PAGE_SRC = readCode("app/vendor/dashboard/leads/page.tsx");
const ACCESS_RAW = readRaw("lib/vendors/assignedLeadContactAccess.ts");
const ACCESS_SRC = stripComments(ACCESS_RAW);
const AUTO_ELIG_SRC = readCode("lib/vendors/vendorAutomaticEligibility.ts");
const ADMIN_SETTINGS_RAW = readRaw("components/admin/sections/SettingsSection.tsx");

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function mutant(name, source, mutate, stillPasses) {
  check(name, () => {
    assert(stillPasses(source), "precondition: the rule must PASS on real source");
    const broken = mutate(source);
    assert(broken !== source, "mutation was a no-op — the rule proves nothing");
    assert(!stillPasses(broken), "the rule ACCEPTED a broken source");
  });
}

// ---------------------------------------------------------------------------
// Fixtures. The vendor that matters most: approved, active, package expired
// months ago, wallet drained to 0 by the very assignment being read.
// ---------------------------------------------------------------------------
const PAST = "2026-07-02T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

const vendorExpiredBroke = {
  status: "Approved", is_active: true, paid_status: "Unpaid",
  package_status: "active", package_expires_at: PAST, remaining_credits: 0,
};
const vendorHealthy = {
  status: "Approved", is_active: true, paid_status: "Paid",
  package_status: "active", package_expires_at: FUTURE, remaining_credits: 5,
};
const CANONICAL = { operation_id: "7b1c9f2e-0000-4a00-8000-000000000001", credit_deducted: true };
const SETTINGS = { allow_trial_vendors_for_assignment: true };

// ---------------------------------------------------------------------------
// A. PURE — the decision module
// ---------------------------------------------------------------------------
check("01 [pure] canonical receipt + expired package + zero balance => CONTACT ALLOWED", () => {
  const r = evaluateAssignedLeadContactAccess(vendorExpiredBroke, CANONICAL, SETTINGS);
  assert(r.contactAllowed === true, "contact was denied on a charged assignment");
  assert(r.basis === "canonical_assignment", `basis was ${r.basis}`);
});

check("02 [pure] operation_id null => NOT canonical, legacy helper decides", () => {
  const r = evaluateAssignedLeadContactAccess(vendorExpiredBroke,
    { operation_id: null, credit_deducted: true }, SETTINGS);
  assert(r.canonicalEvidence === false, "null operation_id was treated as a receipt");
  assert(r.basis === "legacy_helper", `basis was ${r.basis}`);
  // Same vendor, no receipt: the pre-existing gate still hides it.
  assert(r.contactAllowed === false, "legacy fallback silently widened access");
});

check("03 [pure] credit_deducted false => NOT canonical", () => {
  const r = evaluateAssignedLeadContactAccess(vendorExpiredBroke,
    { operation_id: CANONICAL.operation_id, credit_deducted: false }, SETTINGS);
  assert(r.canonicalEvidence === false, "an uncharged assignment was treated as a receipt");
  assert(r.basis === "legacy_helper", `basis was ${r.basis}`);
});

for (const [label, vendor] of [
  ["04 pending", { ...vendorHealthy, status: "Pending" }],
  ["05 suspended", { ...vendorHealthy, status: "Suspended" }],
  ["06 rejected", { ...vendorHealthy, status: "Rejected" }],
  ["07 inactive", { ...vendorHealthy, is_active: false }],
]) {
  check(`${label} [pure] blocked account + canonical receipt => DENIED`, () => {
    const r = evaluateAssignedLeadContactAccess(vendor, CANONICAL, SETTINGS);
    assert(r.contactAllowed === false, "a blocked account was granted contact by a receipt");
    assert(r.basis === "account_blocked", `basis was ${r.basis}`);
  });
}

check("08 [pure] the 1 -> 0 debit that paid for the lead cannot hide the lead", () => {
  const before = evaluateAssignedLeadContactAccess(
    { ...vendorExpiredBroke, remaining_credits: 1 }, CANONICAL, SETTINGS);
  const after = evaluateAssignedLeadContactAccess(
    { ...vendorExpiredBroke, remaining_credits: 0 }, CANONICAL, SETTINGS);
  assert(before.contactAllowed === true && after.contactAllowed === true,
    "spending the last credit revoked the lead it bought");
});

check("09 [pure] the helper cannot grant contact without an assignment", () => {
  for (const absent of [null, undefined, {}]) {
    const r = evaluateAssignedLeadContactAccess(vendorExpiredBroke, absent, SETTINGS);
    assert(r.canonicalEvidence === false, "an absent assignment produced a receipt");
    assert(r.basis === "legacy_helper" && r.contactAllowed === false,
      "an unassigned/unevidenced lead gained contact");
  }
});

check("10 [pure] current package expiry / zero balance never revoke a receipt", () => {
  const variants = [
    { ...vendorHealthy, package_expires_at: PAST },
    { ...vendorHealthy, package_status: "expired" },
    { ...vendorHealthy, remaining_credits: 0 },
    { ...vendorHealthy, paid_status: "Unpaid", package_status: "none" },
  ];
  for (const v of variants) {
    assert(evaluateAssignedLeadContactAccess(v, CANONICAL, SETTINGS).contactAllowed === true,
      `mutable current state revoked a receipt: ${JSON.stringify(v)}`);
  }
});

check("10b [pure] evidence is strict — only a real uuid-ish string + literal true", () => {
  const bad = [
    { operation_id: "", credit_deducted: true },
    { operation_id: "   ", credit_deducted: true },
    { operation_id: 12345, credit_deducted: true },
    { operation_id: CANONICAL.operation_id, credit_deducted: "true" },
    { operation_id: CANONICAL.operation_id, credit_deducted: 1 },
    { operation_id: CANONICAL.operation_id, credit_deducted: null },
  ];
  for (const row of bad) {
    assert(hasCanonicalAssignmentDebitEvidence(row) === false,
      `loose value accepted as a receipt: ${JSON.stringify(row)}`);
  }
  assert(hasCanonicalAssignmentDebitEvidence(CANONICAL) === true, "the real shape was rejected");
});

check("10c [pure] account gate helper agrees with the full decision", () => {
  assert(isVendorAccountContactEligible(vendorHealthy) === true, "healthy account rejected");
  assert(isVendorAccountContactEligible({ ...vendorHealthy, status: "Pending" }) === false, "pending accepted");
  assert(isVendorAccountContactEligible({ ...vendorHealthy, is_active: false }) === false, "inactive accepted");
});

// ---------------------------------------------------------------------------
// B. VIEW MODEL — what actually crosses into the browser
// ---------------------------------------------------------------------------
const rawLead = {
  id: "lead-1", name: "Client", phone: "9990001111", email: "leak@example.com",
  city: "Pune", area: "Baner", service_required: "Interior Designers",
  budget: null, property_type: null, timeline: null, message: null, created_at: null,
};
const rawRow = (id, contactAllowed) => ({
  id, assigned_at: null, assignment_type: "auto_assigned", assignment_source: null,
  vendor_status: "New", is_bad_lead_reported: false,
  contact_allowed: contactAllowed, lead: { ...rawLead, id: `lead-${id}` },
});

check("11 [view] contact_allowed=false + a phone still on the row => phone is dropped", () => {
  const [v] = buildVendorLeadViews([rawRow("a", false)]);
  assert(v.phone === null, "an unentitled row leaked a phone into the view");
  assert(v.contactAllowed === false, "the view claimed entitlement it did not have");
});

check("12 [view] contact_allowed=true => phone is copied", () => {
  const [v] = buildVendorLeadViews([rawRow("b", true)]);
  assert(v.phone === "9990001111", "an entitled row lost its phone");
  assert(v.contactAllowed === true, "the view dropped a real entitlement");
});

check("13 [view] email never appears in any view, under any flag", () => {
  const views = buildVendorLeadViews([rawRow("c", true), rawRow("d", false)]);
  const blob = JSON.stringify(views);
  assert(!blob.includes("leak@example.com"), "the client email crossed the boundary");
  assert(!/\bemail\b/.test(Object.keys(views[0]).join(" ")), "an email field exists on the view");
});

check("14 [view] a MIXED list stays mixed — no global all-or-nothing gate", () => {
  const views = buildVendorLeadViews([rawRow("e", true), rawRow("f", false)]);
  assert(views.length === 2, "rows were dropped");
  assert(views[0].phone === "9990001111", "the entitled row lost its phone");
  assert(views[1].phone === null, "the unentitled row kept its phone");
});

check("14b [view] a missing/loose contact_allowed fails closed", () => {
  for (const flag of [undefined, null, "true", 1]) {
    const row = rawRow("g", flag);
    const [v] = buildVendorLeadViews([row]);
    assert(v.phone === null, `loose flag ${JSON.stringify(flag)} leaked a phone`);
  }
});

// ---------------------------------------------------------------------------
// C. STATIC / STRUCTURAL — the service boundary
// ---------------------------------------------------------------------------
const assignedLeadsQuery = (s) => {
  const start = s.indexOf("const runQuery = (columns: string) =>");
  return start < 0 ? "" : s.slice(start, start + 400);
};
const scopedByVendor = (s) => /\.eq\("vendor_id",\s*vendorId\)/.test(assignedLeadsQuery(s));
check("15 [static] getVendorAssignedLeads is still scoped to the caller's vendor", () => {
  assert(scopedByVendor(VENDOR_SERVICE), "the vendor_id scope was lost");
});

const sanitizesBeforeReturn = (s) =>
  /rows\.map\(\(row\)\s*=>\s*sanitizeAssignedLeadRow\(/.test(s) &&
  /function sanitizeAssignedLeadRow\(/.test(s);
check("16 [static] every row is sanitized before the service returns", () => {
  assert(sanitizesBeforeReturn(VENDOR_SERVICE), "rows are returned without per-row sanitization");
});

const noEmailSelected = (s) => {
  const selects = s.match(/"[^"]*\bid,[^"]*"/g) ?? [];
  return !selects.some((sel) => /\bemail\b/.test(sel));
};
check("17 [static] no lead email is ever selected", () => {
  assert(noEmailSelected(VENDOR_SERVICE), "an email column appears in a select list");
});

const evidenceStaysServerSide = (s) => {
  const body = s.slice(s.indexOf("function sanitizeAssignedLeadRow"));
  const returned = body.slice(body.indexOf("return {"));
  return !/operation_id/.test(returned) && !/credit_deducted/.test(returned);
};
check("18 [static] operation_id / credit_deducted never enter the returned shape", () => {
  assert(evidenceStaysServerSide(VENDOR_SERVICE), "entitlement evidence is shipped to the browser");
});

check("19 [static] no browser-side module imports the service-role client", () => {
  for (const p of [
    "components/vendor-dashboard-v2/leads/leadsModel.ts",
    "components/vendor-dashboard-v2/leads/VendorLeadCard.tsx",
    "components/vendor-dashboard-v2/leads/VendorLeadsBoard.tsx",
    "lib/vendors/assignedLeadContactAccess.ts",
  ]) {
    const src = readCode(p);
    assert(!/adminClient|SUPABASE_SERVICE_ROLE_KEY|service_role/.test(src),
      `${p} reaches for service-role credentials`);
  }
});

const noPostPurchaseWalletGate = (s) => {
  const body = s.slice(s.indexOf("export function evaluateAssignedLeadContactAccess"));
  return !/remaining_credits|package_expires_at|package_status|paid_status/.test(body);
};
check("20 [static] the decision never re-reads package/balance to override a receipt", () => {
  assert(noPostPurchaseWalletGate(ACCESS_SRC), "a current-state gate leaked into the decision");
});

// The whole point of the slice: the page must not re-derive a second verdict.
const noGlobalPageGate = (s) =>
  !/evaluateVendorContactAccessEligibility/.test(s) && !/contactAllowed:\s*eligible/.test(s);
check("21 [static] the leads page holds no second vendor-wide contact verdict", () => {
  assert(noGlobalPageGate(PAGE_SRC), "the page still computes a global contact gate");
});

const modelHasNoGlobalOption = (s) => !/options\.contactAllowed/.test(s);
check("22 [static] buildVendorLeadViews takes no global contactAllowed option", () => {
  assert(modelHasNoGlobalOption(MODEL_SRC), "the global option survived");
});

// NEW-assignment eligibility must be untouched by this slice.
const autoEligibilityUnchanged = (s) =>
  /reasons\.push\("no_credits"\)/.test(s) && !/operation_id/.test(s);
check("23 [static] automatic NEW-assignment eligibility is not touched", () => {
  assert(autoEligibilityUnchanged(AUTO_ELIG_SRC),
    "the assignment-time eligibility rule was altered by a contact-side change");
});

// Operator truthfulness — the admin card must not claim a paid-only gate.
check("24 [static] admin settings no longer claim 'Paid-Only Auto Matching'", () => {
  assert(!/Paid-Only Auto Matching/.test(ADMIN_SETTINGS_RAW),
    "the false 'Paid-Only' title is still shown to the operator");
  assert(/wallet/i.test(ADMIN_SETTINGS_RAW),
    "the card never tells the operator matching is wallet-credit based");
  assert(/Legacy/i.test(ADMIN_SETTINGS_RAW),
    "legacy preview-only controls are not labelled as such");
});

// Locked copy must not tell a vendor to recharge for a lead already paid for.
check("25 [static] no 'recharge/activate a package' copy on the assigned-lead path", () => {
  for (const p of [
    "components/vendor-dashboard-v2/leads/VendorLeadCard.tsx",
    "components/vendor-dashboard-v2/leads/VendorLeadAccessNotice.tsx",
    "app/vendor/dashboard/leads/page.tsx",
  ]) {
    const src = readRaw(p);
    assert(!/Recharge your lead credits/i.test(src), `${p} still asks for a recharge`);
    assert(!/Activate a package to view/i.test(src), `${p} still demands a package`);
    assert(!/hidden until your lead access is active/i.test(src), `${p} keeps the false locked copy`);
  }
});

// ---------------------------------------------------------------------------
// D. MUTANTS — every static rule above must be able to fail
// ---------------------------------------------------------------------------
mutant("M15 [mutant] reject: the assigned-leads query loses its vendor scope",
  VENDOR_SERVICE,
  (s) => {
    const q = assignedLeadsQuery(s);
    return s.replace(q, q.replace('.eq("vendor_id", vendorId)', ".limit(50)"));
  },
  scopedByVendor);

mutant("M16 [mutant] reject: rows are returned unsanitized",
  VENDOR_SERVICE,
  (s) => s.replace(/return ok\(rows\.map\(\(row\)[\s\S]*?\);\n/, "return ok(rows);\n"),
  sanitizesBeforeReturn);

mutant("M17 [mutant] reject: email is added to the lead select",
  VENDOR_SERVICE,
  (s) => s.replace('"id, name, phone, city,', '"id, name, phone, email, city,'),
  noEmailSelected);

mutant("M18 [mutant] reject: the receipt columns are shipped to the browser",
  VENDOR_SERVICE,
  (s) => s.replace("    contact_allowed: access.contactAllowed,",
    "    contact_allowed: access.contactAllowed,\n    operation_id: row.operation_id,"),
  evidenceStaysServerSide);

mutant("M20 [mutant] reject: a current-balance gate is re-added to the decision",
  ACCESS_SRC,
  (s) => s.replace("  if (canonicalEvidence) {",
    "  if (canonicalEvidence && Number(vendor?.remaining_credits ?? 0) > 0) {"),
  noPostPurchaseWalletGate);

mutant("M21 [mutant] reject: the page re-introduces a global contact verdict",
  PAGE_SRC,
  (s) => s.replace("  const leads = buildVendorLeadViews(rows);",
    "  const eligible = evaluateVendorContactAccessEligibility(vendor, {}).eligible;\n" +
    "  const leads = buildVendorLeadViews(rows, { contactAllowed: eligible });"),
  noGlobalPageGate);

mutant("M22 [mutant] reject: a global option returns to the view model",
  MODEL_SRC,
  (s) => s.replace("const contactAllowed = row.contact_allowed === true;",
    "const contactAllowed = options.contactAllowed === true;"),
  modelHasNoGlobalOption);

mutant("M23 [mutant] reject: the receipt leaks into NEW-assignment eligibility",
  AUTO_ELIG_SRC,
  (s) => s.replace('reasons.push("no_credits")',
    'reasons.push(row.operation_id ? "no_credits" : "no_credits")'),
  autoEligibilityUnchanged);

// ============================================================================
(async () => {
  let passed = 0; const failures = [];
  for (const { name, fn } of checks) {
    try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
    catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
  }
  rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-80.15C assigned-lead contact entitlement — passed ${passed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length ? 1 : 0);
})();
