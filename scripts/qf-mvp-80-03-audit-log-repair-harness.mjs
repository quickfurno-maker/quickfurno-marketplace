// ============================================================================
// QuickFurno — scripts/qf-mvp-80-03-audit-log-repair-harness.mjs
//
// QF-MVP-80.03 — DURABLE SUPERADMIN AUDIT LOGGING.
//
// WHAT IS BEING PROVED
//   The QF-MVP-80.03 audit found that `public.audit_logs` is absent from
//   production because 20260621000006_superadmin_foundation.sql was never
//   applied, and that services/vendorAdminService.bestEffortAudit wrapped its
//   insert in a bare try/catch. PostgREST RETURNS its errors rather than
//   throwing, so the catch never fired: every superadmin vendor action was
//   discarded silently, and nothing said so. That is why the QF-MVP-80.02
//   investigation could not determine which admin action an operator invoked.
//
//   This harness locks the forward-only repair migration, the now-visible
//   failure reporting, and — most importantly — the rule that an audit failure
//   must still never break the admin action, and that nothing credential-shaped
//   may enter audit metadata or the log line.
//
// VERIFICATION LEVELS — never conflated:
//   [exec]   runs the REAL compiled service against a mock database and a
//            captured console, so fail-open and log sanitation are observed.
//   [static] reads production source / migration text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it, so a
//            green run can never be an artefact of a check that never bites.
//
// Run: npm run test:mvp:80-03-audit
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path, { resolve } from "node:path";
import crypto from "node:crypto";

const outDir = resolve(".qf-80-03-audit-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/vendors/vendorEligibility.ts",
  "services/vendorCreditWalletService.ts",
  "services/vendorAdminService.ts",
];

const tsconfigPath = resolve(".qf-80-03-audit-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node",
    skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
    outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files,
}, null, 2));

try {
  execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
} finally {
  rmSync(tsconfigPath, { force: true });
}

// ----------------------------------------------------------------------------
function readCode(p) {
  return readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const MIGRATION_FILE = "supabase/migrations/20260817000000_qf_mvp_80_03_audit_logs_forward_repair.sql";
const MIGRATION_RAW = readFileSync(MIGRATION_FILE, "utf8");
/** SQL judged as CODE: `--` comments stripped, so prose never satisfies a rule. */
const MIGRATION_SQL = MIGRATION_RAW.replace(/--[^\n]*/g, " ");
const VENDOR_ADMIN_SRC = readCode("services/vendorAdminService.ts");
const ADMIN_SERVICE_SRC = readCode("services/adminService.ts");
const ADMIN_SECTION_SRC = readCode("services/adminSectionService.ts");
const OLD_FOUNDATION = "supabase/migrations/20260621000006_superadmin_foundation.sql";

const MIGRATION_FILES = readdirSync(path.join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql"));

/** Credential-shaped keys that must never reach audit metadata or a log line. */
const ACTOR = "11111111-2222-4333-8444-555555555555";

const BANNED_KEYS = ["password", "passwd", "token", "access_token", "refresh_token", "jwt",
  "secret", "service_role", "serviceRole", "recoveryLink", "recovery_link",
  "authorization", "cookie", "apiKey", "api_key"];

// ----------------------------------------------------------------------------
// Mock database — models PostgREST's RETURNED-error contract, which is the
// whole point: a thrown error and a returned error are different failures and
// the old code only handled the one that never happens.
// ----------------------------------------------------------------------------
const db = {};
let auditInserts = [];
let vendorUpdates = [];
/** "ok" | "returns-error" | "throws" */
let auditMode = "ok";

function resetDb() {
  auditInserts = [];
  vendorUpdates = [];
  auditMode = "ok";
  db.vendors = [{
    id: "vendor-1", business_name: "QA Vendor", status: "Approved", is_active: true,
    accepting_leads: true, remaining_credits: 10, total_credits: 10,
    package_status: "trial", package_name: null, verification_status: "Pending",
    paid_status: "Unpaid", public_visibility: false, city: "Pune",
  }];
  db.audit_logs = [];
}

class MockQuery {
  constructor(table) { this.table = table; this.filters = []; this.action = "select"; this.payload = null; }
  select() { return this; }
  order() { return this; }
  limit() { return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  is(col, val) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  insert(row) { this.action = "insert"; this.payload = row; return this; }
  update(patch) { this.action = "update"; this.payload = patch; return this; }
  async maybeSingle() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [data];
    return { data: rows[0] ?? null, error: null };
  }
  async single() { return this.maybeSingle(); }
  async execute() {
    if (this.table === "audit_logs" && this.action === "insert") {
      auditInserts.push(this.payload);
      if (auditMode === "throws") throw new Error("simulated audit transport failure");
      if (auditMode === "returns-error") {
        // Exactly the shape PostgREST hands back for a missing relation.
        return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.audit_logs' in the schema cache" } };
      }
      db.audit_logs.push({ id: crypto.randomUUID(), ...this.payload });
      return { data: [this.payload], error: null };
    }
    let list = db[this.table] ?? [];
    if (this.action === "update") {
      for (const f of this.filters) list = list.filter(f);
      vendorUpdates.push({ table: this.table, patch: this.payload, rows: list.length });
      for (const row of list) Object.assign(row, this.payload);
      return { data: list, error: null };
    }
    for (const f of this.filters) list = list.filter(f);
    return { data: list, error: null };
  }
  /**
   * Both handlers, deliberately. A one-argument `then` swallows a synchronous
   * throw from `execute()` into an unobserved rejection, so an `await` on this
   * builder would hang instead of failing — and the "transport throws" case is
   * precisely what this harness must be able to model.
   */
  then(res, rej) { return this.execute().then((r) => res({ data: r.data, error: r.error }), rej); }
}

function fakeAdminClient() {
  return {
    from: (t) => new MockQuery(t),
    // recomputeVisibility calls this; it is irrelevant to the audit contract.
    rpc: async () => ({ data: null, error: null }),
  };
}

resetDb();

// tsc does not rewrite the "@/" path alias at emit time, so the compiled output
// still carries it. Resolve it against the build tree — a harness-side loader
// concern only; no production module is altered to make this work.
const { default: NodeModule } = await import("node:module");
const originalResolve = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const candidate = resolve(outDir, `${request.slice(2)}.js`);
    if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const requireFromBuild = createRequire(`${outDir}/`);
const supabaseMod = requireFromBuild("./lib/supabase.js");
supabaseMod.adminClient = () => fakeAdminClient();
const VendorAdmin = requireFromBuild("./services/vendorAdminService.js");

// ----------------------------------------------------------------------------
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }

/** Capture every console channel while fn runs. */
async function captureConsole(fn) {
  const lines = [];
  const originals = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  }
  try { return { value: await fn(), output: lines.join("\n") }; }
  finally { for (const l of Object.keys(originals)) console[l] = originals[l]; }
}

// ============================================================================
// A — migration static checks
// ============================================================================
check("01 [static] the migration exists with a forward-only timestamped name", () => {
  assert(existsSync(MIGRATION_FILE), "migration file missing");
  const base = path.basename(MIGRATION_FILE);
  assert(/^\d{14}_/.test(base), "must carry a 14-digit timestamp prefix");

  // QF-MVP-80.14A. This used to assert "is the NEWEST migration in the tree",
  // which is a moving-HEAD claim: it went red the moment any later slice added a
  // migration, even though 80.03's migration was still perfectly forward-only.
  // Forward-only is a property of THIS migration's position, not of it being last
  // forever, so it is now stated as such and stays true for good:
  //   * it appears exactly once,
  //   * every migration ordered before it has a strictly smaller version, and
  //   * the whole tree is strictly ascending with no duplicate timestamps.
  const sorted = MIGRATION_FILES.slice().sort();
  assert(sorted.filter((f) => f === base).length === 1, "must appear exactly once");

  const versions = sorted.map((f) => f.slice(0, 14));
  assert(new Set(versions).size === versions.length, "duplicate migration timestamps");
  for (let i = 1; i < versions.length; i += 1) {
    assert(versions[i] > versions[i - 1], `migration order is not strictly ascending at ${sorted[i]}`);
  }

  const index = sorted.indexOf(base);
  assert(index > 0, "must not be the first migration in the tree");
  assert(
    sorted.slice(0, index).every((f) => f.slice(0, 14) < base.slice(0, 14)),
    "must be strictly newer than every migration ordered before it"
  );
});

check("02 [static] it creates audit_logs with the canonical columns", () => {
  assert(/create table if not exists public\.audit_logs/.test(MIGRATION_SQL), "table create missing");
  for (const col of [
    "id\\s+uuid primary key default gen_random_uuid\\(\\)",
    "created_at\\s+timestamptz not null default now\\(\\)",
    "admin_user_id\\s+uuid references public\\.profiles\\(id\\) on delete set null",
    "action\\s+text not null",
    "entity_type\\s+text",
    "entity_id\\s+uuid",
    "metadata\\s+jsonb default '\\{\\}'::jsonb",
    "ip_address\\s+text",
    "user_agent\\s+text",
  ]) {
    assert(new RegExp(col).test(MIGRATION_SQL), `missing/!= canonical column: ${col}`);
  }
});

check("03 [static] index, RLS and the two admin policies are present", () => {
  assert(/create index if not exists idx_audit_logs_created on public\.audit_logs\(created_at desc\)/.test(MIGRATION_SQL));
  assert(/alter table public\.audit_logs enable row level security/.test(MIGRATION_SQL));
  assert(/create policy "audit admin read" on public\.audit_logs for select to authenticated\s+using \(public\.is_admin\(\)\)/.test(MIGRATION_SQL));
  assert(/create policy "audit admin insert" on public\.audit_logs for insert to authenticated\s+with check \(public\.is_admin\(\)\)/.test(MIGRATION_SQL));
});

check("04 [static] an audit trail participants could edit or erase is refused", () => {
  assert(!/for update/i.test(MIGRATION_SQL), "no UPDATE policy may exist on audit_logs");
  assert(!/for delete/i.test(MIGRATION_SQL), "no DELETE policy may exist on audit_logs");
  assert(!/for all/i.test(MIGRATION_SQL), "no blanket ALL policy may exist on audit_logs");
});

check("05 [static] nothing destructive and no fabricated history", () => {
  for (const banned of ["drop table", "drop column", "truncate", "delete from"]) {
    assert(!new RegExp(banned, "i").test(MIGRATION_SQL), `migration must not contain ${banned}`);
  }
  // The only INSERT-shaped statement permitted is none at all: no backfill.
  assert(!/insert\s+into/i.test(MIGRATION_SQL), "no historical audit rows may be fabricated");
});

check("06 [static] ONLY audit_logs objects are created — no legacy replay", () => {
  const created = [...MIGRATION_SQL.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);
  assert(JSON.stringify(created) === JSON.stringify(["audit_logs"]), `created tables: ${JSON.stringify(created)}`);
  for (const legacy of ["lead_timeline_events", "aos_audit_logs", "localities", "admin_notifications",
    "reviews", "ai_agents", "ai_agent_runs", "ai_suggestions", "automations", "automation_logs",
    "lead_internal_notes", "vendor_internal_notes"]) {
    assert(!new RegExp(legacy).test(MIGRATION_SQL), `must not create ${legacy}`);
  }
  const policyTables = [...MIGRATION_SQL.matchAll(/create policy [^\n]*? on public\.(\w+)/gi)].map((m) => m[1]);
  assert(policyTables.every((t) => t === "audit_logs"), `policies touch: ${JSON.stringify([...new Set(policyTables)])}`);
  const altered = [...MIGRATION_SQL.matchAll(/alter table (?:if exists )?public\.(\w+)/gi)].map((m) => m[1]);
  assert(altered.every((t) => t === "audit_logs"), `alters touch: ${JSON.stringify([...new Set(altered)])}`);
});

check("07 [static] the old foundation migration is NOT replayed and is untouched", () => {
  assert(existsSync(OLD_FOUNDATION), "the historical migration must remain in place, unedited");
  const old = readFileSync(OLD_FOUNDATION, "utf8");
  assert(/create table if not exists public\.ai_agents/.test(old), "historical file must not be rewritten");
  assert(!MIGRATION_SQL.includes("superadmin_foundation"), "no include/replay of the old file");
});

check("08 [static] it fails closed on an incompatible pre-existing table", () => {
  assert(/to_regclass\('public\.audit_logs'\)/.test(MIGRATION_SQL), "must probe for an existing object");
  assert(/raise exception/i.test(MIGRATION_SQL), "must RAISE rather than adopt a foreign object");
  assert(/information_schema\.columns/.test(MIGRATION_SQL), "must compare the actual column set");
});

// ============================================================================
// B — vendorAdminService fail-open + visible failure   [exec]
// ============================================================================
check("09 [exec] a successful action writes EXACTLY one audit row, silently", async () => {
  resetDb();
  const { value, output } = await captureConsole(() =>
    VendorAdmin.setVendorStatusAction("vendor-1", "deactivate", "Superadmin", ACTOR));
  assert(value.ok, `action failed: ${JSON.stringify(value)}`);
  assert(auditInserts.length === 1, `expected 1 audit insert, got ${auditInserts.length}`);
  assert(db.audit_logs.length === 1, "the row must land");
  assert(db.audit_logs[0].action === "vendor.deactivate", db.audit_logs[0].action);
  assert(db.audit_logs[0].entity_type === "vendor" && db.audit_logs[0].entity_id === "vendor-1");
  assert(!/NOT recorded/.test(output), "a successful audit must not warn");
});

check("10 [exec] a RETURNED PostgREST error is detected and reported", async () => {
  resetDb();
  auditMode = "returns-error";
  const { value, output } = await captureConsole(() =>
    VendorAdmin.setVendorStatusAction("vendor-1", "deactivate", "Superadmin", ACTOR));
  assert(value.ok, "the business action must still succeed");
  assert(/\[audit log\] vendor admin action was NOT recorded/.test(output),
    `the failure must be visible, saw: ${output.slice(0, 200)}`);
  assert(/PGRST205/.test(output), "the database's own code must be reported");
});

check("11 [exec] a THROWN transport failure is caught and reported, not rethrown", async () => {
  resetDb();
  auditMode = "throws";
  let threw = false;
  const { value, output } = await captureConsole(async () => {
    try { return await VendorAdmin.setVendorStatusAction("vendor-1", "activate", "Superadmin", ACTOR); }
    catch (e) { threw = true; throw e; }
  });
  assert(!threw, "bestEffortAudit must never rethrow");
  assert(value.ok, "the business action must still succeed");
  assert(/NOT recorded/.test(output), "the throw must be reported");
});

check("12 [exec] the business write happens EVEN WHEN the audit fails", async () => {
  for (const mode of ["ok", "returns-error", "throws"]) {
    resetDb();
    auditMode = mode;
    await captureConsole(() => VendorAdmin.setVendorStatusAction("vendor-1", "deactivate", "Superadmin", ACTOR));
    const vendor = db.vendors.find((v) => v.id === "vendor-1");
    assert(vendor.is_active === false, `${mode}: is_active must still have been written`);
    assert(vendorUpdates.some((u) => u.table === "vendors"), `${mode}: the vendor update must have run`);
  }
});

check("13 [exec] audit failure never corrupts unrelated business state", async () => {
  resetDb();
  auditMode = "returns-error";
  const before = JSON.stringify(db.vendors[0]);
  await captureConsole(() => VendorAdmin.setVendorStatusAction("vendor-1", "deactivate", "Superadmin", ACTOR));
  const after = db.vendors[0];
  assert(after.remaining_credits === 10 && after.total_credits === 10, "credits untouched");
  assert(after.status === "Approved", "account status untouched by an is_active action");
  assert(after.package_status === "trial", "package untouched");
  assert(before !== JSON.stringify(after), "the intended is_active change did happen");
});

// ============================================================================
// C — metadata + log sanitation
// ============================================================================
check("14 [exec] the log line carries no metadata and no credential", async () => {
  resetDb();
  auditMode = "returns-error";
  const { output } = await captureConsole(() =>
    VendorAdmin.setVendorStatusAction("vendor-1", "deactivate", "Superadmin", ACTOR));
  for (const banned of BANNED_KEYS) {
    assert(!new RegExp(banned, "i").test(output), `the log must not contain ${banned}`);
  }
  assert(!/"metadata"/.test(output) && !/updatedBy/.test(output),
    "the caller's metadata object must never be logged");
  assert(/entity_id_prefix/.test(output), "only an id PREFIX may be logged");
  assert(!/vendor-1"/.test(output.replace(/entity_id_prefix[^,}]*/g, "")), "no full entity id outside the prefix field");
});

check("15 [exec] no credential-shaped key reaches audit metadata", async () => {
  resetDb();
  await captureConsole(() => VendorAdmin.setVendorStatusAction("vendor-1", "activate", "Superadmin", ACTOR));
  await captureConsole(() => VendorAdmin.updateVendorCredits("vendor-1", { mode: "add", amount: 1, updatedBy: "Superadmin", actorUserId: ACTOR }));
  assert(auditInserts.length >= 1, "at least one audit payload to inspect");
  for (const payload of auditInserts) {
    const keys = Object.keys(payload.metadata ?? {});
    for (const k of keys) {
      assert(!BANNED_KEYS.some((b) => k.toLowerCase().includes(b.toLowerCase())),
        `metadata key "${k}" is credential-shaped`);
    }
    const serialized = JSON.stringify(payload.metadata ?? {});
    for (const banned of ["eyJ", "Bearer ", "/auth/v1/verify"]) {
      assert(!serialized.includes(banned), `metadata carries ${banned}`);
    }
  }
});

check("16 [static] no audit writer names a credential-shaped field", () => {
  for (const src of [VENDOR_ADMIN_SRC, ADMIN_SERVICE_SRC]) {
    const writes = src.match(/from\("audit_logs"\)[\s\S]{0,400}?\}\)/g) ?? [];
    assert(writes.length >= 1, "an audit writer must exist");
    for (const w of writes) {
      for (const banned of BANNED_KEYS) {
        assert(!new RegExp(banned, "i").test(w), `audit insert mentions ${banned}`);
      }
    }
  }
});

check("17 [static] the recovery link never travels near an audit writer", () => {
  for (const src of [VENDOR_ADMIN_SRC, ADMIN_SERVICE_SRC, ADMIN_SECTION_SRC]) {
    assert(!/recoveryLink|recovery_link|action_link/.test(src),
      "no audit-writing service may even reference a recovery link");
  }
});

check("18 [static] bestEffortAudit inspects the returned error and never rethrows", () => {
  const fn = VENDOR_ADMIN_SRC.slice(VENDOR_ADMIN_SRC.indexOf("async function bestEffortAudit"));
  const body = fn.slice(0, fn.indexOf("\nasync function", 1) === -1 ? fn.indexOf("\nfunction ") : fn.indexOf("\nasync function", 1));
  assert(/const \{ error \} = await adminClient\(\)/.test(body), "must destructure the returned error");
  assert(/if \(error\)/.test(body), "must branch on the returned error");
  assert(/console\.warn/.test(body), "must surface the failure");
  assert(!/throw/.test(body), "must never rethrow — the admin action has already succeeded");
  assert(/entity_id_prefix/.test(body), "must log only an id prefix");
  assert(!/metadata,?\s*$/m.test(body.split("console.warn")[1] ?? ""), "must not log metadata");
});

check("19 [static] audit writing stays FAIL-OPEN", () => {
  assert(/catch/.test(VENDOR_ADMIN_SRC.slice(VENDOR_ADMIN_SRC.indexOf("bestEffortAudit"))),
    "a transport throw must still be caught");
  // The callers must not gate the business result on the audit.
  assert(!/if \(!?await bestEffortAudit/.test(VENDOR_ADMIN_SRC), "no caller may branch on the audit outcome");
  assert(!/return .*bestEffortAudit/.test(VENDOR_ADMIN_SRC), "the audit result is never the action result");
});

// ============================================================================
// D — mutants
// ============================================================================
function mutant(name, source, mutate, stillPasses) {
  check(name, () => {
    const mutated = mutate(source);
    assert(mutated !== source, "the mutation must actually change the source");
    assert(!stillPasses(mutated), "the rule accepted a mutation it must reject");
  });
}

mutant("20 [mutant] dropping the returned-error branch is rejected",
  VENDOR_ADMIN_SRC,
  (s) => s.replace("const { error } = await adminClient().from(\"audit_logs\").insert({",
    "await adminClient().from(\"audit_logs\").insert({"),
  (s) => /const \{ error \} = await adminClient\(\)\.from\("audit_logs"\)/.test(s));

mutant("21 [mutant] logging the caller metadata is rejected",
  VENDOR_ADMIN_SRC,
  (s) => s.replace("entity_id_prefix: vendorId.slice(0, 8),", "entity_id_prefix: vendorId.slice(0, 8),\n        metadata,"),
  (s) => {
    const after = s.split("console.warn")[1] ?? "";
    return !/\bmetadata,/.test(after);
  });

mutant("22 [mutant] making the audit failure fatal is rejected",
  VENDOR_ADMIN_SRC,
  (s) => s.replace("if (error) {", "if (error) { throw error;"),
  (s) => {
    const fn = s.slice(s.indexOf("async function bestEffortAudit"));
    return !/throw/.test(fn.slice(0, 1200));
  });

mutant("23 [mutant] a DROP TABLE in the migration is rejected",
  MIGRATION_SQL,
  (s) => s + "\ndrop table public.audit_logs;\n",
  (s) => !/drop table/i.test(s));

mutant("24 [mutant] backfilling fake history is rejected",
  MIGRATION_SQL,
  (s) => s + "\ninsert into public.audit_logs (action) values ('backfilled');\n",
  (s) => !/insert\s+into/i.test(s));

mutant("25 [mutant] resurrecting a legacy table is rejected",
  MIGRATION_SQL,
  (s) => s + "\ncreate table if not exists public.ai_agents (id uuid primary key);\n",
  (s) => {
    const created = [...s.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);
    return JSON.stringify(created) === JSON.stringify(["audit_logs"]);
  });

mutant("26 [mutant] adding an UPDATE policy to the audit trail is rejected",
  MIGRATION_SQL,
  (s) => s + '\ncreate policy "audit admin edit" on public.audit_logs for update to authenticated using (public.is_admin());\n',
  (s) => !/for update/i.test(s));

mutant("27 [mutant] dropping the incompatible-object guard is rejected",
  MIGRATION_SQL,
  (s) => s.replace(/raise exception/i, "return"),
  (s) => /raise exception/i.test(s));


// ============================================================================
// QF-MVP-80.03 PR C — trusted actor attribution
// ============================================================================
const ACTIONS_SRC_C = readCode("app/actions.ts");
const ADMIN_SVC_C = readCode("services/adminService.ts");
const VENDOR_SVC_C = readCode("services/vendorAdminService.ts");
const ROUTE_STATUS = readCode("app/api/admin/vendors/[id]/status/route.ts");
const ROUTE_CREDITS = readCode("app/api/admin/vendors/[id]/credits/route.ts");
const ROUTE_PACKAGE = readCode("app/api/admin/vendors/[id]/package/route.ts");

check("28 [exec] a vendor status action binds the authenticated actor", async () => {
  resetDb();
  await captureConsole(() => VendorAdmin.setVendorStatusAction("vendor-1", "deactivate", "Superadmin", ACTOR));
  assert(db.audit_logs.length === 1, `expected 1 audit row, got ${db.audit_logs.length}`);
  assert(db.audit_logs[0].admin_user_id === ACTOR,
    `admin_user_id must be the authenticated actor, saw ${JSON.stringify(db.audit_logs[0].admin_user_id)}`);
  assert(auditInserts.length === 1, "exactly one audit attempt");
});

check("29 [exec] a credit adjustment binds the authenticated actor", async () => {
  resetDb();
  await captureConsole(() => VendorAdmin.updateVendorCredits("vendor-1",
    { mode: "add", amount: 1, updatedBy: "Superadmin", actorUserId: ACTOR }));
  const rows = db.audit_logs.filter((r) => r.action === "vendor.credits_updated");
  assert(rows.length === 1, `expected 1 credit audit row, got ${rows.length}`);
  assert(rows[0].admin_user_id === ACTOR, String(rows[0].admin_user_id));
});

check("30 [exec] a package update binds the authenticated actor", async () => {
  resetDb();
  await captureConsole(() => VendorAdmin.updateVendorPackage("vendor-1",
    { packageStatus: "expired", packageName: null, updatedBy: "Superadmin", actorUserId: ACTOR }));
  const rows = db.audit_logs.filter((r) => r.action === "vendor.package_updated");
  assert(rows.length === 1, `expected 1 package audit row, got ${rows.length}`);
  assert(rows[0].admin_user_id === ACTOR, String(rows[0].admin_user_id));
});

check("31 [exec] a MISSING actor fails closed BEFORE the business mutation", async () => {
  for (const bad of ["", "   ", null, undefined]) {
    resetDb();
    const before = JSON.stringify(db.vendors[0]);
    const res = await captureConsole(() =>
      VendorAdmin.setVendorStatusAction("vendor-1", "deactivate", "Superadmin", bad));
    assert(res.value.ok === false, `actor ${JSON.stringify(bad)} must be refused`);
    assert(res.value.code === "UNAUTHORIZED", String(res.value.code));
    assert(JSON.stringify(db.vendors[0]) === before, "the vendor must NOT have been mutated");
    assert(db.audit_logs.length === 0, "no audit row for a refused action");
    assert(vendorUpdates.length === 0, "no vendor write attempted at all");
  }
});

check("32 [exec] a missing actor also fails closed for credits and package", async () => {
  resetDb();
  const c = await VendorAdmin.updateVendorCredits("vendor-1", { mode: "add", amount: 5, updatedBy: "x", actorUserId: "" });
  assert(c.ok === false && c.code === "UNAUTHORIZED", JSON.stringify(c));
  assert(db.vendors[0].remaining_credits === 10, "credits must be untouched");
  const p = await VendorAdmin.updateVendorPackage("vendor-1", { packageStatus: "expired", packageName: null, updatedBy: "x", actorUserId: "" });
  assert(p.ok === false && p.code === "UNAUTHORIZED", JSON.stringify(p));
  assert(db.audit_logs.length === 0, "no audit rows from refused actions");
});

check("33 [exec] the actor is NOT taken from updatedBy or any label", async () => {
  resetDb();
  await captureConsole(() => VendorAdmin.setVendorStatusAction("vendor-1", "activate", "Superadmin", ACTOR));
  const row = db.audit_logs[0];
  assert(row.admin_user_id === ACTOR, "actor is the session id");
  assert(row.admin_user_id !== "Superadmin", "the display label must never become the identity");
  assert(row.metadata.updatedBy === "Superadmin", "the label still travels as display context");
  assert(row.admin_user_id !== db.vendors[0].id, "the vendor id is not the actor");
});

check("34 [static] getAdminSession exposes a trusted userId from the session", () => {
  assert(/userId: string \| null;/.test(ACTIONS_SRC_C), "the session type must carry userId");
  assert(/userId: u\?\.id \?\? null,/.test(ACTIONS_SRC_C), "userId must come from currentUser()");
  assert(/const \{ data: \{ user \} \} = await sb\.auth\.getUser\(\)/.test(ACTIONS_SRC_C),
    "currentUser must still resolve from the Supabase-validated session");
  // roles unchanged
  for (const f of ["isLoggedIn: Boolean(u)", 'isAdmin: u?.role === "admin"',
    'isSuperadmin: u?.role === "admin" && u.adminRole === "Superadmin"', "adminRole: u?.adminRole ?? null"]) {
    assert(ACTIONS_SRC_C.includes(f), `existing session field changed: ${f}`);
  }
});

check("35 [static] asAdmin hands the authenticated principal to the work", () => {
  assert(/async function asAdmin<T>\(fn: \(actorUserId: string\) => Promise<Result<T>>\)/.test(ACTIONS_SRC_C),
    "asAdmin must pass the actor");
  assert(/actor = \(await requireSuperadmin\(\)\)\.id/.test(ACTIONS_SRC_C), "actor comes from requireSuperadmin()");
  assert(/if \(!actor\) return fail\(appError\("UNAUTHORIZED"\)\);/.test(ACTIONS_SRC_C), "fail closed on a missing actor");
});

check("36 [static] both audit writers set admin_user_id", () => {
  assert(/admin_user_id: actorUserId,/.test(VENDOR_SVC_C), "vendorAdminService must bind the actor");
  assert(/admin_user_id: actorUserId,/.test(ADMIN_SVC_C), "adminService must bind the actor");
  for (const src of [VENDOR_SVC_C, ADMIN_SVC_C]) {
    const inserts = src.match(/from\("audit_logs"\)\.insert\(\{[\s\S]*?\}\)/g) ?? [];
    assert(inserts.length >= 1, "an audit insert must exist");
    for (const i of inserts) assert(/admin_user_id/.test(i), "every audit insert must carry admin_user_id");
  }
});

check("37 [static] the actor is never sourced from untrusted input", () => {
  for (const src of [VENDOR_SVC_C, ADMIN_SVC_C, ROUTE_STATUS, ROUTE_CREDITS, ROUTE_PACKAGE]) {
    assert(!/admin_user_id:\s*(body|input\.updatedBy|updatedBy|req|request|params|headers)/.test(src),
      "admin_user_id must never come from request input or a display label");
    assert(!/actorUserId\s*=\s*(body|req|request|headers)/.test(src), "actor must not be read from the request");
  }
  // the routes take it from the SESSION only
  for (const r of [ROUTE_STATUS, ROUTE_CREDITS, ROUTE_PACKAGE]) {
    assert(/session\.userId/.test(r), "the route must pass session.userId");
    assert(/if \(!session\.userId\)/.test(r), "the route must fail closed on a missing session actor");
  }
});

check("38 [static] every human-admin audit writer threads an actor", () => {
  const calls = ADMIN_SVC_C.match(/await recordAuditLog\([^;]*?\);/gs) ?? [];
  assert(calls.length === 8, `expected 8 recordAuditLog call sites, found ${calls.length}`);
  for (const c of calls) assert(/actorUserId\)/.test(c), `call site lacks the actor: ${c.slice(0, 80)}`);
  const vcalls = VENDOR_SVC_C.match(/await bestEffortAudit\([^;]*?\);/gs) ?? [];
  assert(vcalls.length === 3, `expected 3 bestEffortAudit call sites, found ${vcalls.length}`);
  for (const c of vcalls) assert(/, actor\)/.test(c), `call site lacks the actor: ${c.slice(0, 80)}`);
});

check("39 [static] no historical backfill and no new migration", () => {
  for (const src of [VENDOR_SVC_C, ADMIN_SVC_C]) {
    assert(!/update\([^)]*admin_user_id/.test(src), "existing audit rows must never be updated");
    assert(!/from\("audit_logs"\)[\s\S]{0,120}\.(update|delete)\(/.test(src), "no update/delete on audit_logs");
  }
  // QF-MVP-80.14A. "PR C adds no migration" was expressed as a hard-coded global
  // count, so a later slice adding a legitimate, explicitly pinned migration made
  // it fail — a false failure about someone else's work. The count is now
  // delegated to the ONE authority for it, G1's MIGRATION_COUNT, rather than
  // duplicated as a literal here. An UNPINNED migration still fails this check,
  // and fails G1's 153 mutants first.
  const migrations = readdirSync(path.join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
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
});

mutant("40 [mutant] dropping admin_user_id from the vendor audit insert is rejected",
  VENDOR_SVC_C, (s) => s.replace("      admin_user_id: actorUserId,\n", ""),
  (s) => /admin_user_id: actorUserId,/.test(s));

mutant("41 [mutant] dropping admin_user_id from the adminService insert is rejected",
  ADMIN_SVC_C, (s) => s.replace("      admin_user_id: actorUserId,\n", ""),
  (s) => /admin_user_id: actorUserId,/.test(s));

mutant("42 [mutant] sourcing the actor from updatedBy is rejected",
  VENDOR_SVC_C, (s) => s.replace("admin_user_id: actorUserId,", "admin_user_id: updatedBy,"),
  (s) => /admin_user_id: actorUserId,/.test(s)
    && !/admin_user_id:\s*(body|input\.updatedBy|updatedBy|req|request|params|headers)/.test(s));

mutant("43 [mutant] sourcing the actor from the request body is rejected",
  ROUTE_STATUS,
  (s) => s.replace('"Superadmin", session.userId)', '"Superadmin", (body as any).adminUserId)'),
  (s) => /"Superadmin", session\.userId\)/.test(s)
    && !/adminUserId/.test(s));

mutant("44 [mutant] removing the route's fail-closed actor guard is rejected",
  ROUTE_STATUS, (s) => s.replace("if (!session.userId) {", "if (false) {"),
  (s) => /if \(!session\.userId\)/.test(s));

mutant("45 [mutant] removing asAdmin's actor plumbing is rejected",
  ACTIONS_SRC_C, (s) => s.replace("async function asAdmin<T>(fn: (actorUserId: string) => Promise<Result<T>>)",
    "async function asAdmin<T>(fn: () => Promise<Result<T>>)"),
  (s) => /async function asAdmin<T>\(fn: \(actorUserId: string\) => Promise<Result<T>>\)/.test(s));

mutant("46 [mutant] backfilling historical NULL attribution is rejected",
  VENDOR_SVC_C, (s) => s + '\nasync function backfill() { await adminClient().from("audit_logs").update({ admin_user_id: "x" }); }\n',
  (s) => !/from\("audit_logs"\)[\s\S]{0,120}\.(update|delete)\(/.test(s));

// ============================================================================
(async () => {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of checks) {
    try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
    catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
  }
  rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-80.03 audit log repair — passed ${passed}, failed ${failures.length}`);
  if (failures.length > 0) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length > 0 ? 1 : 0);
})();
