// ============================================================================
// QuickFurno — scripts/qf-mvp-80-04-fail-closed-runtime-default-harness.mjs
//
// QF-MVP-80.04 — FAIL-CLOSED AUTO-ASSIGNMENT RUNTIME DEFAULT.
//
// WHAT IS BEING PROVED
//   `marketplace_runtime_settings` is EMPTY on staging. Until this slice the
//   canonical default was `auto_assignment_mode: "preview"`, so an environment
//   with no persisted row silently entered `preview` — and the QF-MVP-80.03
//   staging canary proved `preview` is NOT read-only: one canary lead produced
//   3 real lead_assignments, 3 credit debits, 3 assignment events and 6 delivery
//   rows, with outbound merely mocked.
//
//   Silence is not consent to spend vendor credits. The absence, unreadability,
//   invalidity or partial absence of the setting must resolve to `off`.
//
//   This slice changes ONLY what UNSET resolves to. `preview` is not redefined
//   as read-only, no mode is renamed, and an explicitly persisted `preview` or
//   `auto_suggest` still resolves to itself.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the REAL normalizer with no I/O.
//   [exec]   executes the REAL loader against a mock database.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it.
//
// Run: npm run test:mvp:80-04
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path, { resolve } from "node:path";

const outDir = resolve(".qf-80-04-build");
rmSync(outDir, { recursive: true, force: true });
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = ["lib/errors.ts", "lib/supabase.ts", "lib/lead-assignment/runtimeSettings.ts"];
const tsconfigPath = resolve(".qf-80-04-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
    esModuleInterop: true, strict: true, outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files,
}, null, 2));
try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
finally { rmSync(tsconfigPath, { force: true }); }

function readCode(p) {
  return readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const SETTINGS_SRC = readCode("lib/lead-assignment/runtimeSettings.ts");
const MATCHER_SRC = readCode("services/leadMatchingEngine.ts");
const PREVIEW_SRC = readCode("lib/lead-assignment/autoAssignmentEngine.ts");
const ADMIN_VIEW_SRC = readCode("components/admin/sections/SettingsSection.tsx");

// ----------------------------------------------------------------------------
// Mock database — models every way the settings read can fail.
// ----------------------------------------------------------------------------
let rowsMode = "empty";   // empty | missing-key | explicit | invalid | null-value | error | throw
let storedRows = [];

class MockQuery {
  select() { return this; }
  order() { return this.execute(); }
  async execute() {
    if (rowsMode === "throw") throw new Error("simulated settings transport failure");
    if (rowsMode === "error") return { data: null, error: { code: "PGRST205", message: "relation missing" } };
    return { data: storedRows, error: null };
  }
  then(res, rej) { return this.execute().then(res, rej); }
}

const { default: Module } = await import("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const c = resolve(outDir, `${request.slice(2)}.js`);
    if (existsSync(c)) return originalResolve.call(this, c, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};
const requireFromBuild = createRequire(`${outDir}/`);
const supabaseMod = requireFromBuild("./lib/supabase.js");
supabaseMod.adminClient = () => ({ from: () => new MockQuery() });
const RT = requireFromBuild("./lib/lead-assignment/runtimeSettings.js");

// ----------------------------------------------------------------------------
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m); }

/** Capture console output so the loader's warnings can be inspected. */
async function quiet(fn) {
  const orig = { warn: console.warn, info: console.info, log: console.log };
  console.warn = console.info = console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, orig); }
}
async function resolveMode(mode, rows = []) {
  rowsMode = mode; storedRows = rows;
  const s = await quiet(() => RT.loadMarketplaceRuntimeSettings());
  return s.auto_assignment_mode;
}

// ============================================================================
// The resolution matrix — every required behaviour, executed
// ============================================================================
check("01 [exec] rows = []  =>  off", async () => {
  assert(await resolveMode("empty", []) === "off", "empty rows must fail closed");
});

check("02 [exec] no auto_assignment_mode row  =>  off", async () => {
  const m = await resolveMode("explicit", [{ key: "max_vendors_per_lead", value: 3 }]);
  assert(m === "off", `other keys present but mode absent must fail closed, saw ${m}`);
});

check("03 [exec] query error  =>  off", async () => {
  assert(await resolveMode("error") === "off", "a returned error must fail closed");
});

check("04 [exec] thrown exception  =>  off", async () => {
  assert(await resolveMode("throw") === "off", "a thrown transport failure must fail closed");
});

check("05 [exec] invalid mode value  =>  off", async () => {
  for (const bad of ["PREVIEW", "on", "auto", "", "  ", "offf", "0", "true"]) {
    const m = await resolveMode("explicit", [{ key: "auto_assignment_mode", value: bad }]);
    assert(m === "off", `invalid value ${JSON.stringify(bad)} resolved ${m}`);
  }
});

check("06 [exec] null / undefined / malformed value  =>  off", async () => {
  for (const bad of [null, undefined, 0, 1, true, false, {}, []]) {
    const m = await resolveMode("explicit", [{ key: "auto_assignment_mode", value: bad }]);
    assert(m === "off", `malformed value ${JSON.stringify(bad)} resolved ${m}`);
  }
});

check("07 [exec] a malformed ROW shape  =>  off", async () => {
  for (const row of [null, undefined, "auto_assignment_mode", 42, { value: "preview" }, { key: 7, value: "preview" }]) {
    const m = await resolveMode("explicit", [row]);
    assert(m === "off", `malformed row ${JSON.stringify(row)} resolved ${m}`);
  }
});

check("08 [exec] a non-array payload  =>  off", async () => {
  for (const payload of [null, undefined, {}, "rows", 5]) {
    rowsMode = "explicit"; storedRows = payload;
    const s = await quiet(() => RT.loadMarketplaceRuntimeSettings());
    assert(s.auto_assignment_mode === "off", `payload ${JSON.stringify(payload)} resolved ${s.auto_assignment_mode}`);
  }
});

// ---- explicit modes are PRESERVED, unchanged -------------------------------
check("09 [exec] explicit \"off\"  =>  off", async () => {
  assert(await resolveMode("explicit", [{ key: "auto_assignment_mode", value: "off" }]) === "off");
});

check("10 [exec] explicit \"preview\"  =>  preview (deliberate modes still work)", async () => {
  const m = await resolveMode("explicit", [{ key: "auto_assignment_mode", value: "preview" }]);
  assert(m === "preview", `an explicitly persisted preview must survive, saw ${m}`);
});

check("11 [exec] explicit \"auto_suggest\"  =>  auto_suggest", async () => {
  const m = await resolveMode("explicit", [{ key: "auto_assignment_mode", value: "auto_suggest" }]);
  assert(m === "auto_suggest", `an explicitly persisted auto_suggest must survive, saw ${m}`);
});

check("12 [exec] surrounding whitespace on an explicit mode is tolerated", async () => {
  assert(await resolveMode("explicit", [{ key: "auto_assignment_mode", value: "  preview  " }]) === "preview");
  assert(await resolveMode("explicit", [{ key: "auto_assignment_mode", value: " off " }]) === "off");
});

check("13 [exec] the other defaults are untouched by this slice", async () => {
  rowsMode = "empty"; storedRows = [];
  const s = await quiet(() => RT.loadMarketplaceRuntimeSettings());
  assert(s.max_vendors_per_lead === 3, String(s.max_vendors_per_lead));
  assert(s.minimum_paid_vendors_required_for_auto_assignment === 1, String(s.minimum_paid_vendors_required_for_auto_assignment));
  assert(s.show_free_vendors_publicly === true);
  assert(s.allow_free_vendor_interest_capture === true);
  assert(s.notify_free_vendor_recharge_interest === true);
  assert(s.allow_trial_vendors_for_assignment === true);
});

check("14 [pure] normalizeMarketplaceSettings fails closed on every bad input", () => {
  for (const bad of [undefined, null, {}, "rows", 5, [], [null], [{}], [{ key: "auto_assignment_mode" }]]) {
    const s = RT.normalizeMarketplaceSettings(bad);
    assert(s.auto_assignment_mode === "off", `${JSON.stringify(bad)} -> ${s.auto_assignment_mode}`);
  }
  assert(RT.normalizeMarketplaceSettings([{ key: "auto_assignment_mode", value: "preview" }]).auto_assignment_mode === "preview");
});

check("15 [pure] the exported default itself is off", () => {
  assert(RT.DEFAULT_MARKETPLACE_RUNTIME_SETTINGS.auto_assignment_mode === "off",
    String(RT.DEFAULT_MARKETPLACE_RUNTIME_SETTINGS.auto_assignment_mode));
  assert(RT.AUTO_ASSIGNMENT_OFF_REASON === "auto_assignment_off", RT.AUTO_ASSIGNMENT_OFF_REASON);
});

// ============================================================================
// Kill-switch invariant — the matcher halts before anything can act
// ============================================================================
check("16 [static] the matcher reads the mode through the CANONICAL loader only", () => {
  assert(/const runtimeSettings = await loadMarketplaceRuntimeSettings\(\);/.test(MATCHER_SRC),
    "the live matcher must use the canonical loader");
  assert(!/from\("marketplace_runtime_settings"\)/.test(MATCHER_SRC),
    "the matcher must not read the settings table directly and re-implement the fallback");
  assert(!/auto_assignment_mode\s*(\?\?|\|\|)/.test(MATCHER_SRC),
    "the matcher must not carry its own second fallback for the mode");
});

check("17 [static] the off halt precedes vendor evaluation, routes and assignment", () => {
  const t = MATCHER_SRC.replace(/\s+/g, " ");
  const gate = t.indexOf('if (runtimeSettings.auto_assignment_mode === "off")');
  const evaluate = t.indexOf("evaluateVendorsForLead");
  assert(gate > 0, "the kill switch must exist");
  assert(evaluate > gate, "vendor evaluation must come AFTER the halt");
  const halted = t.slice(gate, evaluate);
  for (const forbidden of ["qf_assign_lead_vendors_v2", "applyVendorCreditDelta", "lead_delivery_logs",
    "communication_messages", "routeTime", "sendMessage"]) {
    assert(!halted.includes(forbidden), `${forbidden} must not be reachable inside the halt path`);
  }
});

check("18 [static] the halt records the stable shared reason and the standing negatives", () => {
  assert(/failure_reason: AUTO_ASSIGNMENT_OFF_REASON,/.test(MATCHER_SRC), "the matcher uses the shared reason code");
  for (const neg of ['halted_before: "vendor_evaluation"', "vendors_evaluated: false", "route_provider_called: false",
    "assignment_authority_called: false", "credits_debited: false", "deliveries_created: false"]) {
    assert(MATCHER_SRC.includes(neg), `missing standing negative: ${neg}`);
  }
  assert(/eligible_vendor_count: 0,/.test(MATCHER_SRC));
});

check("19 [static] the preview engine also routes through the canonical loader", () => {
  assert(/loadMarketplaceRuntimeSettings/.test(PREVIEW_SRC), "the preview engine uses the canonical loader");
  assert(/return DEFAULT_MARKETPLACE_RUNTIME_SETTINGS\.auto_assignment_mode;/.test(PREVIEW_SRC),
    "its normalizeMode falls back to the SAME canonical default, so it inherits fail-closed");
  assert(!/return "preview"/.test(PREVIEW_SRC), "no hardcoded preview fallback");
});

check("20 [static] normalization keeps the exact three-literal vocabulary", () => {
  assert(/mode === "off" \|\| mode === "preview" \|\| mode === "auto_suggest" \? mode : fallback/.test(
    SETTINGS_SRC.replace(/\s+/g, " ")), "the accepted literals and the fallback route are unchanged");
  assert(/export type AutoAssignmentMode = "off" \| "preview" \| "auto_suggest";/.test(SETTINGS_SRC),
    "no mode was renamed or removed");
});

check("21 [static] the admin settings view mirrors the canonical default", () => {
  assert(/auto_assignment_mode: "off",/.test(ADMIN_VIEW_SRC),
    "the admin view default must not display a mutating mode the server is not in");
  assert(!/auto_assignment_mode: "preview",/.test(ADMIN_VIEW_SRC));
});

check("22 [static] this slice adds no migration and no seed", () => {
  const migrations = readdirSync(path.join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql"));

  // QF-MVP-80.14A. This guard used to hard-code the GLOBAL migration count (102),
  // which made it a moving-HEAD assertion: it went red the moment ANY later slice
  // legitimately added a migration, even though 80.04 still added none. That is a
  // false failure about someone else's work, and re-bumping the literal every time
  // just defers it.
  //
  // Re-pinned to what this slice can actually claim, without losing coverage:
  //   (1) NO migration belongs to the 80.04 slice — the real scope statement, and
  //       true forever;
  //   (2) the tree size still equals the ONE pinned authority for it, G1's
  //       MIGRATION_COUNT, read from G1's source rather than duplicated here. An
  //       unpinned migration therefore still fails this check, and it fails G1's
  //       153 mutants first.
  assert(
    migrations.filter((f) => /80_04/.test(f)).length === 0,
    `QF-MVP-80.04 must add no migration; found ${migrations.filter((f) => /80_04/.test(f)).join(", ")}`
  );
  const g1 = readFileSync(
    path.join(process.cwd(), "scripts", "mvp", "staging", "validate-qf-mvp-50-2c-s2-g1.mjs"),
    "utf8"
  );
  const pinned = /const MIGRATION_COUNT = (\d+);/.exec(g1);
  assert(pinned !== null, "G1 no longer pins a migration count");
  assert(
    migrations.length === Number(pinned[1]),
    `tree has ${migrations.length} migrations but G1 pins ${pinned[1]}`
  );

  assert(!/upsert\(|insert\(/.test(SETTINGS_SRC.split("updateMarketplaceRuntimeSetting")[0]),
    "the loader must not write a row to make the default real");
});

check("23 [static] unrelated marketplace semantics are untouched", () => {
  assert(/max_vendors_per_lead: 3,/.test(SETTINGS_SRC), "cap unchanged");
  assert(/minimum_paid_vendors_required_for_auto_assignment: 1,/.test(SETTINGS_SRC));
  for (const b of ["credit_cost", "LEAD_CREDIT_COST", "qf_assign_lead_vendors_v2", "whatsapp", "n8n"]) {
    assert(!new RegExp(b, "i").test(SETTINGS_SRC), `runtimeSettings must not reference ${b}`);
  }
});

// ============================================================================
// Mutants
// ============================================================================
function mutant(name, source, mutate, stillPasses) {
  check(name, () => {
    const mutated = mutate(source);
    assert(mutated !== source, "the mutation must actually change the source");
    assert(!stillPasses(mutated), "the rule accepted a mutation it must reject");
  });
}
const SETTINGS_RAW = readFileSync("lib/lead-assignment/runtimeSettings.ts", "utf8");
const MATCHER_RAW = readFileSync("services/leadMatchingEngine.ts", "utf8");
const defaultIsOff = (s) => /auto_assignment_mode: "off",\n};/.test(s);

mutant("24 [mutant] changing the default back to preview is rejected",
  SETTINGS_RAW, (s) => s.replace('auto_assignment_mode: "off",\n};', 'auto_assignment_mode: "preview",\n};'), defaultIsOff);

mutant("25 [mutant] changing the default to auto_suggest is rejected",
  SETTINGS_RAW, (s) => s.replace('auto_assignment_mode: "off",\n};', 'auto_assignment_mode: "auto_suggest",\n};'), defaultIsOff);

mutant("26 [mutant] making empty rows resolve preview is rejected",
  SETTINGS_RAW,
  (s) => s.replace("  const settings = { ...DEFAULT_MARKETPLACE_RUNTIME_SETTINGS };\n  if (!Array.isArray(rows)) return settings;",
    '  const settings = { ...DEFAULT_MARKETPLACE_RUNTIME_SETTINGS, auto_assignment_mode: "preview" as const };\n  if (!Array.isArray(rows)) return settings;'),
  (s) => !/auto_assignment_mode: "preview"/.test(s));

mutant("27 [mutant] making a query failure resolve preview is rejected",
  SETTINGS_RAW,
  (s) => s.replace('      return { ...DEFAULT_MARKETPLACE_RUNTIME_SETTINGS };\n    }\n    return normalizeMarketplaceSettings',
    '      return { ...DEFAULT_MARKETPLACE_RUNTIME_SETTINGS, auto_assignment_mode: "preview" as const };\n    }\n    return normalizeMarketplaceSettings'),
  (s) => !/auto_assignment_mode: "preview"/.test(s));

mutant("28 [mutant] making an invalid value resolve preview is rejected",
  SETTINGS_RAW,
  (s) => s.replace('? mode : fallback) as MarketplaceRuntimeSettings[K];', '? mode : "preview") as MarketplaceRuntimeSettings[K];'),
  (s) => /\? mode : fallback\) as MarketplaceRuntimeSettings\[K\];/.test(s) && !/\? mode : "preview"/.test(s));

mutant("29 [mutant] bypassing the canonical loader in the live matcher is rejected",
  MATCHER_RAW,
  (s) => s.replace("const runtimeSettings = await loadMarketplaceRuntimeSettings();",
    'const runtimeSettings = { auto_assignment_mode: "preview" as const };'),
  (s) => /const runtimeSettings = await loadMarketplaceRuntimeSettings\(\);/.test(s));

mutant("30 [mutant] removing the off halt before vendor evaluation is rejected",
  MATCHER_RAW,
  (s) => s.replace('if (runtimeSettings.auto_assignment_mode === "off") {', "if (false) {"),
  (s) => /if \(runtimeSettings\.auto_assignment_mode === "off"\) \{/.test(s));

mutant("31 [mutant] aliasing preview to off is rejected",
  SETTINGS_RAW,
  (s) => s.replace('mode === "off" || mode === "preview" || mode === "auto_suggest" ? mode : fallback',
    'mode === "off" || mode === "preview" ? "off" : mode === "auto_suggest" ? mode : fallback'),
  (s) => /mode === "off" \|\| mode === "preview" \|\| mode === "auto_suggest" \? mode : fallback/.test(s));

mutant("32 [mutant] aliasing off to preview is rejected",
  SETTINGS_RAW,
  (s) => s.replace('mode === "off" || mode === "preview" || mode === "auto_suggest" ? mode : fallback',
    'mode === "off" ? "preview" : mode === "preview" || mode === "auto_suggest" ? mode : fallback'),
  (s) => /mode === "off" \|\| mode === "preview" \|\| mode === "auto_suggest" \? mode : fallback/.test(s));

mutant("33 [mutant] a second hidden fallback in the matcher is rejected",
  MATCHER_RAW,
  (s) => s.replace("if (runtimeSettings.auto_assignment_mode === \"off\") {",
    'const effective = runtimeSettings.auto_assignment_mode ?? "preview";\n    if (effective === "off") {'),
  (s) => !/auto_assignment_mode\s*(\?\?|\|\|)/.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));

// ============================================================================
(async () => {
  let passed = 0; const failures = [];
  for (const { name, fn } of checks) {
    try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
    catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
  }
  rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-80.04 fail-closed runtime default — passed ${passed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length ? 1 : 0);
})();
