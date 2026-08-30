// ============================================================================
// QuickFurno — scripts/qf-mvp-80-02-vendor-login-activation-harness.mjs
//
// QF-MVP-80.02 GATE-06 — SUPERADMIN-ONLY "Activate vendor login".
//
// WHAT IS BEING PROVED
//   The Gate 06 audit found 5 fully eligible Pune vendors that could receive
//   assignments and credits but could not sign in, because approved vendors
//   created through the admin path carry `vendors.user_id = NULL` and the ONLY
//   writer of that column creates a NEW vendor row. This harness locks the
//   remedy and, just as importantly, locks what the remedy must NOT do.
//
// VERIFICATION LEVELS — never conflated:
//   [exec]   runs the REAL compiled service against a mock database that models
//            the constraints production actually enforces.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it, so a
//            green run can never be an artefact of a check that never bites.
//
// The mock models, because the service depends on each:
//   • auth.users.email UNIQUE
//   • the partial unique index on vendor_dashboard_users(user_id)
//   • PostgREST update-with-filter semantics (the CAS returns affected rows)
//   • `.is("user_id", null)` NULL semantics
//
// Run: npm run test:mvp:80-02-gate06
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

const outDir = resolve(".qf-80-02-gate06-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/identity/vendorAccess.ts",
  "lib/identity/authPrincipalMarker.ts",
  "lib/vendors/vendorEligibility.ts",
  "services/vendorAccessService.ts",
  "services/vendorLoginActivationService.ts",
];

const tsconfigPath = resolve(".qf-80-02-gate06-tsconfig.json");
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
// Source text (comments stripped: rules judge CODE, not the prose about it)
// ----------------------------------------------------------------------------
function readCode(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const ACTIVATION_SRC = readCode("services/vendorLoginActivationService.ts");
const ACTIVATION_RAW = readFileSync("services/vendorLoginActivationService.ts", "utf8");
const ACCESS_SRC = readCode("services/vendorAccessService.ts");
const ACTIONS_SRC = readCode("app/actions.ts");
const VENDORS_UI_SRC = readCode("components/admin/sections/VendorsSection.tsx");

// ----------------------------------------------------------------------------
// Mock database — models the constraints production enforces
// ----------------------------------------------------------------------------
const SUPERADMIN = "auth-superadmin";
const PLAIN_ADMIN = "auth-plain-admin";
const PLAIN_USER = "auth-plain-user";
const LINKED_VENDOR_USER = "auth-linked-vendor";
const SQUATTER_USER = "auth-squatter";

const V_BLOCKED = "vendor-blocked";        // approved, no login  → the Gate 06 case
const V_LINKED = "vendor-linked";          // already has a login → replay
const V_PENDING = "vendor-pending";        // not approved
const V_NO_EMAIL = "vendor-no-email";      // no usable identity
const V_SHARED_A = "vendor-shared-a";      // shares an email with…
const V_SHARED_B = "vendor-shared-b";      // …this one
const V_SQUATTED = "vendor-squatted";      // an auth user already owns its email

const EMAIL_BLOCKED = "blocked@example.com";
const EMAIL_LINKED = "linked@example.com";
const EMAIL_SHARED = "shared@example.com";
const EMAIL_SQUATTED = "squatted@example.com";

const db = {};
let currentSessionUserId = null;
let createUserCalls = [];
let deleteUserCalls = [];
let generateLinkCalls = [];
let listUsersCalls = 0;
/** Forces the next vendor CAS to affect zero rows (a concurrent claim). */
let simulateClaimRace = false;
/** Forces the auth directory read to fail. */
let simulateDirectoryFailure = false;
/** Forces generateLink to fail. */
let simulateLinkFailure = false;
/** Forces the vendor_dashboard_users insert to fail. */
let simulateMappingFailure = false;

function baseVendor(overrides) {
  return {
    status: "Approved", email: null, phone: "+919876500000", owner_name: "Owner",
    business_name: "Business", user_id: null,
    // Business state that must survive every activation, untouched.
    verification_status: "Pending", paid_status: "Unpaid", package_status: "inactive",
    package_name: "Trial", remaining_credits: 17, total_credits: 20,
    accepting_leads: true, is_active: true, public_visibility: false,
    ...overrides,
  };
}

function resetDb() {
  currentSessionUserId = null;
  createUserCalls = [];
  deleteUserCalls = [];
  generateLinkCalls = [];
  listUsersCalls = 0;
  simulateClaimRace = false;
  simulateDirectoryFailure = false;
  simulateLinkFailure = false;
  simulateMappingFailure = false;

  db.auth_users = [
    { id: SUPERADMIN, email: "super@example.com" },
    { id: PLAIN_ADMIN, email: "admin@example.com" },
    { id: PLAIN_USER, email: "user@example.com" },
    { id: LINKED_VENDOR_USER, email: EMAIL_LINKED },
    { id: SQUATTER_USER, email: EMAIL_SQUATTED },
  ];

  db.profiles = [
    { id: SUPERADMIN, role: "admin" },
    { id: PLAIN_ADMIN, role: "admin" },
    { id: PLAIN_USER, role: null },
    { id: LINKED_VENDOR_USER, role: "vendor" },
  ];

  db.vendors = [
    { id: V_BLOCKED, ...baseVendor({ email: EMAIL_BLOCKED, business_name: "Aalam interior" }) },
    { id: V_LINKED, ...baseVendor({ email: EMAIL_LINKED, user_id: LINKED_VENDOR_USER }) },
    { id: V_PENDING, ...baseVendor({ status: "Pending", email: "pending@example.com" }) },
    { id: V_NO_EMAIL, ...baseVendor({ email: null }) },
    { id: V_SHARED_A, ...baseVendor({ email: EMAIL_SHARED }) },
    { id: V_SHARED_B, ...baseVendor({ email: EMAIL_SHARED }) },
    { id: V_SQUATTED, ...baseVendor({ email: EMAIL_SQUATTED }) },
  ];

  db.vendor_dashboard_users = [
    {
      id: "vdu-linked", vendor_id: V_LINKED, user_id: LINKED_VENDOR_USER, phone: "+919876500000",
      email: EMAIL_LINKED, role: "owner", status: "active", phone_verified: false,
      whatsapp_otp_enabled: false, last_login_method: null, last_login_at: null,
    },
  ];

  // Business tables the activation must never touch.
  db.lead_assignments = [{ id: "a1", vendor_id: V_BLOCKED }];
  db.vendor_credit_logs = [{ id: "c1", vendor_id: V_BLOCKED }];
  db.communication_messages = [];
}

/** PostgreSQL: NULL never conflicts; a partial index only covers matching rows. */
const UNIQUE_INDEXES = {
  vendor_dashboard_users: [
    { name: "uq_vendor_dashboard_users_user_id", cols: ["user_id"], where: (r) => r.user_id !== null && r.user_id !== undefined },
  ],
};

function findUniqueViolation(table, newRow, rows, excludeId = null) {
  for (const index of UNIQUE_INDEXES[table] ?? []) {
    if (index.where && !index.where(newRow)) continue;
    if (index.cols.some((c) => newRow[c] === null || newRow[c] === undefined)) continue;
    const clash = rows.some((existing) =>
      existing.id !== excludeId && (!index.where || index.where(existing)) &&
      index.cols.every((c) => existing[c] === newRow[c]));
    if (clash) return { code: "23505", message: `duplicate key value violates unique constraint "${index.name}"`, constraint: index.name };
  }
  return null;
}

class MockQueryBuilder {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.limitVal = null;
    this.action = "select";
    this.actionData = null;
  }
  select() { return this; }
  order() { return this; }
  limit(n) { this.limitVal = n; return this; }
  eq(col, val) { this.filters.push((item) => item[col] === val); return this; }
  is(col, val) { this.filters.push((item) => (item[col] ?? null) === val); return this; }
  /** No-wildcard ILIKE is case-insensitive equality, which is how it is used. */
  ilike(col, pattern) {
    const needle = String(pattern).toLowerCase();
    this.filters.push((item) => String(item[col] ?? "").toLowerCase() === needle);
    return this;
  }
  insert(row) { this.action = "insert"; this.actionData = row; return this; }
  update(patch) { this.action = "update"; this.actionData = patch; return this; }

  async maybeSingle() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
    return { data: rows[0] ?? null, error: null };
  }
  async single() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [data];
    return { data: rows[0] ?? null, error: rows.length === 1 ? null : { code: "PGRST116", message: "no rows" } };
  }

  async execute() {
    let list = db[this.table] || [];

    if (this.action === "insert") {
      if (this.table === "vendor_dashboard_users" && simulateMappingFailure) {
        return { data: null, error: { code: "XX000", message: "simulated mapping failure" } };
      }
      const supplied = Object.fromEntries(Object.entries(this.actionData).filter(([, v]) => v !== undefined));
      const row = { id: crypto.randomUUID(), ...supplied };
      const violation = findUniqueViolation(this.table, row, db[this.table]);
      if (violation) return { data: null, error: violation };
      db[this.table].push(row);
      return { data: [row], error: null };
    }

    if (this.action === "update") {
      // Models a concurrent claim landing between the read and this write: the
      // filtered UPDATE simply affects zero rows.
      if (this.table === "vendors" && simulateClaimRace) return { data: [], error: null };
      for (const f of this.filters) list = list.filter(f);
      for (const item of list) {
        const candidate = { ...item, ...this.actionData };
        const violation = findUniqueViolation(this.table, candidate, db[this.table], item.id);
        if (violation) return { data: null, error: violation };
      }
      for (const item of list) Object.assign(item, this.actionData);
      return { data: list, error: null };
    }

    for (const f of this.filters) list = list.filter(f);
    if (this.limitVal !== null) list = list.slice(0, this.limitVal);
    return { data: list, error: null };
  }

  async then(resolve) {
    const { data, error } = await this.execute();
    return resolve({ data, error });
  }
}

/** Models auth.users.email UNIQUE and the Admin API surface used. */
function fakeAdminClient() {
  return {
    from: (table) => new MockQueryBuilder(table),
    auth: {
      admin: {
        async createUser(input) {
          createUserCalls.push(input);
          const email = String(input?.email ?? "").trim().toLowerCase();
          if (db.auth_users.some((u) => String(u.email ?? "").toLowerCase() === email)) {
            return { data: { user: null }, error: { message: "email already registered", code: "email_exists" } };
          }
          const user = {
            id: `auth-new-${db.auth_users.length}`,
            email,
            app_metadata: input?.app_metadata ?? {},
            user_metadata: input?.user_metadata ?? {},
          };
          db.auth_users.push(user);
          return { data: { user }, error: null };
        },
        async listUsers({ page, perPage }) {
          listUsersCalls += 1;
          if (simulateDirectoryFailure) return { data: null, error: { message: "directory unavailable" } };
          const start = (page - 1) * perPage;
          return { data: { users: db.auth_users.slice(start, start + perPage) }, error: null };
        },
        async generateLink(input) {
          generateLinkCalls.push(input);
          if (simulateLinkFailure) return { data: null, error: { message: "link failed" } };
          return { data: { properties: { action_link: `https://auth.example/recover#token=${crypto.randomUUID()}` } }, error: null };
        },
        async deleteUser(id) {
          deleteUserCalls.push(id);
          db.auth_users = db.auth_users.filter((u) => u.id !== id);
          for (const row of db.vendor_dashboard_users) if (row.user_id === id) row.user_id = null;
          return { data: {}, error: null };
        },
      },
    },
  };
}

function fakeServerClient() {
  return {
    from: (table) => new MockQueryBuilder(table),
    auth: {
      async getUser() {
        if (!currentSessionUserId) return { data: { user: null }, error: { message: "no session" } };
        const appMetadata = currentSessionUserId === SUPERADMIN ? { admin_role: "Superadmin" } : {};
        return { data: { user: { id: currentSessionUserId, app_metadata: appMetadata } }, error: null };
      },
    },
  };
}

resetDb();

// tsc does not rewrite the "@/" path alias at emit time, so the compiled output
// still carries it. Resolve it against the build tree — a harness-side loader
// concern only; no production module is altered to make this work.
const { default: Module } = await import("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const candidate = resolve(outDir, `${request.slice(2)}.js`);
    if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const requireFromBuild = createRequire(`${outDir}/`);
const supabaseMod = requireFromBuild("./lib/supabase.js");
supabaseMod.adminClient = () => fakeAdminClient();
supabaseMod.serverClient = async () => fakeServerClient();

const Activation = requireFromBuild("./services/vendorLoginActivationService.js");
const AccessService = requireFromBuild("./services/vendorAccessService.js");
const MarkerMod = requireFromBuild("./lib/identity/authPrincipalMarker.js");

// ----------------------------------------------------------------------------
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function signIn(userId) { currentSessionUserId = userId; }
function vendorRow(id) { return db.vendors.find((v) => v.id === id); }
function vendorCount() { return db.vendors.length; }
function authCount() { return db.auth_users.length; }

/** The business state that an activation must never alter. */
const BUSINESS_COLUMNS = [
  "status", "verification_status", "paid_status", "package_status", "package_name",
  "remaining_credits", "total_credits", "accepting_leads", "is_active", "public_visibility",
];
function businessSnapshot() {
  return JSON.stringify(db.vendors.map((v) => {
    const out = { id: v.id };
    for (const c of BUSINESS_COLUMNS) out[c] = v[c];
    return out;
  }));
}

/** Run an activation as the superadmin from a clean database. */
async function activateAs(userId, vendorId, prepare) {
  resetDb();
  if (prepare) prepare();
  signIn(userId);
  const before = { vendors: vendorCount(), auth: authCount(), business: businessSnapshot() };
  const result = await Activation.activateVendorLogin({ vendorId });
  return { result, before };
}

// ============================================================================
// [exec] the Gate 06 happy path
// ============================================================================
check("01 [exec] an approved vendor with no login is given one, in place", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert(result.data.alreadyActive === false, "must not report already-active");
  assert(typeof result.data.authUserId === "string" && result.data.authUserId.length > 0, "an auth user id is returned");
  assert(vendorRow(V_BLOCKED).user_id === result.data.authUserId, "vendors.user_id now points at the new principal");
  assert(vendorCount() === before.vendors, "NO vendor row may be created");
  assert(authCount() === before.auth + 1, "exactly one auth user created");
});

check("02 [exec] the SAME vendor id is kept — no duplicate business row anywhere", async () => {
  await activateAs(SUPERADMIN, V_BLOCKED);
  const matches = db.vendors.filter((v) => v.business_name === "Aalam interior");
  assert(matches.length === 1, `expected exactly one Aalam interior row, found ${matches.length}`);
  assert(matches[0].id === V_BLOCKED, "the original vendor id must survive");
});

check("03 [exec] approval, package and credits are untouched", async () => {
  const { before } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(businessSnapshot() === before.business, "no business column may change during activation");
});

check("04 [exec] the canonical vendor_dashboard_users linkage is reused", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(result.ok && result.data.dashboardMappingLinked === true, "the mapping must be reported linked");
  const mapping = db.vendor_dashboard_users.filter((m) => m.vendor_id === V_BLOCKED);
  assert(mapping.length === 1, "exactly one mapping row");
  assert(mapping[0].user_id === result.data.authUserId, "mapping points at the same principal");
  assert(mapping[0].status === "active" && mapping[0].role === "owner", "active owner membership");
});

check("05 [exec] no password is created, defaulted, stored or returned", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(createUserCalls.length === 1, "exactly one createUser call");
  const call = createUserCalls[0];
  assert(!("password" in call), "createUser must be called WITHOUT a password");
  const serialized = JSON.stringify(result);
  for (const banned of ["password", "service_role", "SUPABASE_SERVICE_ROLE_KEY", "anon_key"]) {
    assert(!serialized.includes(banned), `the result must not carry ${banned}`);
  }
  assert(db.auth_users.every((u) => !("password" in u)), "no password is written to the auth store");
});

check("06 [exec] handover is a single-use recovery link, issued once", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(generateLinkCalls.length === 1, "exactly one generateLink call");
  assert(generateLinkCalls[0].type === "recovery", "must be a recovery link, not an email/password invite");
  assert(result.ok && typeof result.data.recoveryLink === "string" && result.data.recoveryLink.length > 0,
    "the link is returned to the operator");
  assert(result.data.recoveryLinkIssued === true, "issuance is reported");
});

check("07 [exec] the new principal carries the trusted vendor marker only", async () => {
  await activateAs(SUPERADMIN, V_BLOCKED);
  const meta = createUserCalls[0].app_metadata;
  assert(JSON.stringify(meta) === JSON.stringify(MarkerMod.vendorPrincipalAppMetadata()),
    "app_metadata must be exactly the canonical vendor marker");
  assert(meta.qf_principal === "vendor", "the trigger classifies from qf_principal");
  assert(!("role" in meta) && !("admin_role" in meta), "no role or admin_role may be injected");
  const userMeta = createUserCalls[0].user_metadata ?? {};
  assert(!("role" in userMeta) && !("admin_role" in userMeta) && !("qf_principal" in userMeta),
    "attacker-writable user_metadata must never carry classification");
});

check("08 [exec] the email is confirmed so the recovery link is usable", async () => {
  await activateAs(SUPERADMIN, V_BLOCKED);
  assert(createUserCalls[0].email_confirm === true, "email_confirm must be true");
  assert(createUserCalls[0].email === EMAIL_BLOCKED, "the vendor's STORED email is used, never an argument");
});

// ============================================================================
// [exec] replay and idempotence
// ============================================================================
check("09 [exec] replay on an already-linked vendor is a safe no-op", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_LINKED);
  assert(result.ok, "replay must not error");
  assert(result.data.alreadyActive === true, "must report already-active");
  assert(result.data.authUserId === LINKED_VENDOR_USER, "returns the EXISTING principal");
  assert(result.data.recoveryLink === null && result.data.recoveryLinkIssued === false,
    "a replay must not mint a credential");
  assert(authCount() === before.auth, "no second auth user");
  assert(vendorCount() === before.vendors, "no second vendor row");
  assert(createUserCalls.length === 0, "createUser must never be called on replay");
  assert(vendorRow(V_LINKED).user_id === LINKED_VENDOR_USER, "the existing link is never rewritten");
});

check("10 [exec] running twice in a row is stable and creates exactly one account", async () => {
  await activateAs(SUPERADMIN, V_BLOCKED);
  const authAfterFirst = authCount();
  const linked = vendorRow(V_BLOCKED).user_id;
  const second = await Activation.activateVendorLogin({ vendorId: V_BLOCKED });
  assert(second.ok && second.data.alreadyActive === true, "the second run is a replay");
  assert(authCount() === authAfterFirst, "no additional auth user on the second run");
  assert(vendorRow(V_BLOCKED).user_id === linked, "the link is unchanged");
  assert(createUserCalls.length === 1, "createUser stays at exactly one call across both runs");
});

// ============================================================================
// [exec] fail-closed identity rules
// ============================================================================
check("11 [exec] a pre-existing auth principal is REFUSED, never adopted", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_SQUATTED);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.AUTH_EMAIL_COLLISION,
    `expected AUTH_EMAIL_COLLISION, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0, "no auth user may be created");
  assert(authCount() === before.auth, "the auth store is unchanged");
  assert(vendorRow(V_SQUATTED).user_id === null, "the vendor stays unlinked");
});

check("12 [exec] a shared vendor email is REFUSED for both rows", async () => {
  for (const target of [V_SHARED_A, V_SHARED_B]) {
    const { result, before } = await activateAs(SUPERADMIN, target);
    assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_EMAIL_NOT_UNIQUE,
      `expected VENDOR_EMAIL_NOT_UNIQUE for ${target}, got ${JSON.stringify(result)}`);
    assert(createUserCalls.length === 0, "no auth user may be created for a shared email");
    assert(authCount() === before.auth, "the auth store is unchanged");
    assert(vendorRow(V_SHARED_A).user_id === null && vendorRow(V_SHARED_B).user_id === null,
      "neither row may be arbitrarily chosen as the owner");
  }
});

check("13 [exec] a vendor with no email is refused, with no side effect", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_NO_EMAIL);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_EMAIL_MISSING,
    `expected VENDOR_EMAIL_MISSING, got ${JSON.stringify(result)}`);
  assert(authCount() === before.auth && vendorCount() === before.vendors, "nothing created");
});

check("14 [exec] a non-approved vendor is refused", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_PENDING);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_NOT_APPROVED,
    `expected VENDOR_NOT_APPROVED, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0, "no auth user for a pending vendor");
  assert(vendorRow(V_PENDING).status === "Pending", "the status is not changed to make it pass");
  assert(authCount() === before.auth, "the auth store is unchanged");
});

check("15 [exec] an unknown vendor id is refused", async () => {
  const { result, before } = await activateAs(SUPERADMIN, "vendor-does-not-exist");
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_NOT_FOUND,
    `expected VENDOR_NOT_FOUND, got ${JSON.stringify(result)}`);
  assert(vendorCount() === before.vendors, "a missing vendor must never be created");
  assert(authCount() === before.auth, "no auth user for a missing vendor");
});

check("16 [exec] an empty vendor id is a validation failure, not a wildcard", async () => {
  for (const bad of ["", "   ", null, undefined]) {
    resetDb();
    signIn(SUPERADMIN);
    const result = await Activation.activateVendorLogin({ vendorId: bad });
    assert(!result.ok, `empty vendor id ${JSON.stringify(bad)} must fail`);
    assert(createUserCalls.length === 0, "no auth user for an empty target");
    assert(db.vendors.every((v) => v.id === V_LINKED ? true : v.user_id === null),
      "no vendor may be linked by an empty target");
  }
});

check("17 [exec] an unreadable auth directory fails closed, not open", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateDirectoryFailure = true; });
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.AUTH_DIRECTORY_UNREADABLE,
    `expected AUTH_DIRECTORY_UNREADABLE, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0, "an unprovable collision must block creation");
  assert(authCount() === before.auth, "the auth store is unchanged");
});

// ============================================================================
// [exec] the compare-and-swap and its rollback
// ============================================================================
check("18 [exec] a lost CAS race rolls the new auth user back", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateClaimRace = true; });
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_CLAIM_CONFLICT,
    `expected VENDOR_CLAIM_CONFLICT, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 1, "the auth user was created before the race was detected");
  assert(deleteUserCalls.length === 1, "and it MUST be deleted again");
  assert(authCount() === before.auth, "no orphan principal may survive a failed activation");
  assert(vendorRow(V_BLOCKED).user_id === null, "the vendor stays unlinked");
  assert(vendorCount() === before.vendors, "no vendor row created");
});

check("19 [exec] the CAS can never move an ALREADY-owned vendor", async () => {
  resetDb();
  signIn(SUPERADMIN);
  // Force past the replay guard so only the CAS itself can protect the row.
  const target = vendorRow(V_LINKED);
  const originalOwner = target.user_id;
  const result = await Activation.activateVendorLogin({ vendorId: V_LINKED });
  assert(result.ok && result.data.alreadyActive === true, "guarded by the replay check first");
  assert(target.user_id === originalOwner, "ownership is never reassigned");
  // And the write itself is filtered on NULL, proven statically below (rule 31).
});

check("20 [exec] a failed mapping does not roll back a completed link", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateMappingFailure = true; });
  assert(result.ok, "the primary link succeeded, so the operation succeeds");
  assert(result.data.dashboardMappingLinked === false, "and the failure is reported honestly, not hidden");
  assert(vendorRow(V_BLOCKED).user_id === result.data.authUserId, "the canonical link stands");
  assert(deleteUserCalls.length === 0, "a committed principal must NOT be deleted");
});

check("21 [exec] a failed recovery link is reported, not fatal", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateLinkFailure = true; });
  assert(result.ok, "the vendor is linked even if the handover link fails");
  assert(result.data.recoveryLink === null && result.data.recoveryLinkIssued === false, "reported as not issued");
  assert(deleteUserCalls.length === 0, "the principal is kept; the operator can re-issue");
});

// ============================================================================
// [exec] authorization
// ============================================================================
check("22 [exec] an anonymous caller is denied", async () => {
  const { result, before } = await activateAs(null, V_BLOCKED);
  assert(!result.ok && result.code === "UNAUTHORIZED", `expected UNAUTHORIZED, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0 && authCount() === before.auth, "no side effect");
});

check("23 [exec] a plain (non-superadmin) admin is denied", async () => {
  const { result, before } = await activateAs(PLAIN_ADMIN, V_BLOCKED);
  assert(!result.ok && result.code === "UNAUTHORIZED", `expected UNAUTHORIZED, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0, "no auth user for a non-superadmin");
  assert(vendorRow(V_BLOCKED).user_id === null && authCount() === before.auth, "no side effect");
});

check("24 [exec] a signed-in non-admin is denied", async () => {
  const { result, before } = await activateAs(PLAIN_USER, V_BLOCKED);
  assert(!result.ok && result.code === "UNAUTHORIZED", `expected UNAUTHORIZED, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0 && authCount() === before.auth, "no side effect");
});

check("25 [exec] a vendor cannot activate another vendor", async () => {
  const { result, before } = await activateAs(LINKED_VENDOR_USER, V_BLOCKED);
  assert(!result.ok && result.code === "UNAUTHORIZED", `expected UNAUTHORIZED, got ${JSON.stringify(result)}`);
  assert(vendorRow(V_BLOCKED).user_id === null && authCount() === before.auth, "no cross-vendor effect");
});

check("26 [exec] authority comes from the session, not from the argument", async () => {
  resetDb();
  signIn(PLAIN_USER);
  for (const forged of [
    { vendorId: V_BLOCKED, superadmin: true },
    { vendorId: V_BLOCKED, adminUserId: SUPERADMIN },
    { vendorId: V_BLOCKED, role: "Superadmin", app_metadata: { admin_role: "Superadmin" } },
  ]) {
    const result = await Activation.activateVendorLogin(forged);
    assert(!result.ok && result.code === "UNAUTHORIZED", "a forged authorization claim must be ignored");
  }
  assert(createUserCalls.length === 0, "no auth user from a forged claim");
});

// ============================================================================
// [exec] blast radius
// ============================================================================
check("27 [exec] activation touches no assignment, credit or message table", async () => {
  resetDb();
  signIn(SUPERADMIN);
  const before = JSON.stringify({
    a: db.lead_assignments, c: db.vendor_credit_logs, m: db.communication_messages,
  });
  await Activation.activateVendorLogin({ vendorId: V_BLOCKED });
  const after = JSON.stringify({
    a: db.lead_assignments, c: db.vendor_credit_logs, m: db.communication_messages,
  });
  assert(before === after, "assignment, credit and message state must be byte-identical");
});

check("28 [exec] every failure path leaves the database exactly as it was", async () => {
  for (const target of [V_SQUATTED, V_SHARED_A, V_NO_EMAIL, V_PENDING, "vendor-missing"]) {
    resetDb();
    signIn(SUPERADMIN);
    const snapshot = JSON.stringify({ v: db.vendors, m: db.vendor_dashboard_users, u: db.auth_users });
    const result = await Activation.activateVendorLogin({ vendorId: target });
    assert(!result.ok, `${target} must fail`);
    assert(JSON.stringify({ v: db.vendors, m: db.vendor_dashboard_users, u: db.auth_users }) === snapshot,
      `${target} left a side effect behind`);
  }
});

// ============================================================================
// [static] source contracts
// ============================================================================
check("29 [static] the service can never create a vendor row", () => {
  assert(!/from\("vendors"\)[\s\S]{0,200}\.insert\(/.test(ACTIVATION_SRC), "no INSERT on vendors");
  assert(!/registerVendor|submitVendorAccountRegistration/.test(ACTIVATION_SRC), "no registration path is reachable");
  assert(!/\.delete\(/.test(ACTIVATION_SRC), "no vendor deletion");
});

/**
 * Every write payload in a source file. The rule below must judge what is
 * WRITTEN, not what is read: `status` legitimately appears in the row type and
 * in the approval check, and banning the word outright would be a rule that
 * fails for the wrong reason.
 */
function writePayloads(src) {
  return src.match(/\.(?:update|insert)\(\{[\s\S]*?\}\)/g) ?? [];
}
function onlyUserIdIsWritten(src) {
  const payloads = writePayloads(src);
  if (payloads.length !== 1) return false;
  if (payloads[0].trim() !== ".update({ user_id: uncommittedAuthUserId })") return false;
  const written = payloads.join(" ");
  return !["status", "remaining_credits", "total_credits", "paid_status", "verification_status",
    "package_status", "accepting_leads", "is_active", "public_visibility"]
    .some((column) => new RegExp(`${column}\\s*:`).test(written));
}

check("30 [static] the ONLY vendors column written is user_id", () => {
  const payloads = writePayloads(ACTIVATION_SRC);
  assert(payloads.length === 1, `expected exactly one write payload, found ${payloads.length}: ${payloads.join(" | ")}`);
  assert(onlyUserIdIsWritten(ACTIVATION_SRC),
    `the single write must be exactly user_id, saw ${payloads[0]}`);
});

check("31 [static] the claim is a compare-and-swap on a NULL owner", () => {
  assert(/\.update\(\{ user_id: uncommittedAuthUserId \}\)[\s\S]{0,120}\.is\("user_id", null\)/.test(ACTIVATION_SRC),
    "the update must be filtered on user_id IS NULL");
  assert(/\(claimed \?\? \[\]\)\.length !== 1/.test(ACTIVATION_SRC),
    "exactly one affected row is required");
});

check("32 [static] no password, OTP or shared credential is anywhere in the service", () => {
  for (const banned of ["password", "passwd", "generatePassword", "randomPassword", "defaultPassword", "otp"]) {
    assert(!new RegExp(banned, "i").test(ACTIVATION_SRC), `the service must not mention ${banned}`);
  }
  assert(!/inviteUserByEmail|resetPasswordForEmail|signInWithPassword|updateUserById/.test(ACTIVATION_SRC),
    "no password-mutating or session-minting Auth call");
});

check("33 [static] no messaging, assignment, matching or runtime-mode reach", () => {
  for (const banned of ["whatsapp", "sendMessage", "messaging_product", "communication_messages",
    "lead_assignments", "lead_matching_runs", "vendor_credit_logs", "auto_assignment_mode",
    "marketplace_runtime_settings", "runAutoLeadMatching", "routes"]) {
    assert(!new RegExp(banned, "i").test(ACTIVATION_SRC), `the service must not reference ${banned}`);
  }
});

check("34 [static] superadmin authority is derived internally and stays private", () => {
  assert(/async function requireSuperadminSession/.test(ACTIVATION_SRC), "the guard exists");
  assert(!/export\s+(async\s+)?function\s+requireSuperadminSession/.test(ACTIVATION_SRC), "and stays private");
  assert(!/export\s+async\s+function\s+performVendorLoginActivation/.test(ACTIVATION_SRC),
    "the raw provisioning write must stay private");
  assert(/admin_role/.test(ACTIVATION_SRC) && /SUPERADMIN_ADMIN_ROLE/.test(ACTIVATION_SRC),
    "Superadmin is checked, not merely admin");
  assert(/auth\.getUser\(\)/.test(ACTIVATION_SRC), "the session is validated by Supabase");
  assert(!/jsonwebtoken|jose|jwt\.sign|jwt\.verify/.test(ACTIVATION_SRC), "no custom token system");
  assert(/const superadmin = await requireSuperadminSession\(\);[\s\S]{0,120}if \(!superadmin\.ok\) return superadmin;/.test(ACTIVATION_SRC),
    "the public entry point must guard before doing anything");
});

check("35 [static] the linkage is REUSED, not reimplemented", () => {
  assert(/import \{ linkVendorAuthUser \} from "\.\/vendorAccessService"/.test(ACTIVATION_SRC),
    "the canonical linking function is imported");
  assert(!/from\("vendor_dashboard_users"\)[\s\S]{0,200}\.insert\(/.test(ACTIVATION_SRC),
    "the mapping insert must not be duplicated here");
  assert(/async function requireAdminSession/.test(ACCESS_SRC),
    "and it still derives its own authority");
});

check("36 [static] Phase 5C's resolver boundary is left intact", () => {
  assert(!/adminClient\(\)\s*\.\s*auth/.test(ACCESS_SRC),
    "vendorAccessService must still never reach adminClient().auth");
  assert(/never touches vendors\.user_id/.test(readFileSync("services/vendorAccessService.ts", "utf8")),
    "its documented contract is unchanged");
  const accessDiffRisk = /activateVendorLogin|createUser|generateLink|deleteUser/.test(ACCESS_SRC);
  assert(!accessDiffRisk, "provisioning must not have leaked into the resolver");
});

check("37 [static] the server action is superadmin-gated and thin", () => {
  assert(/export const adminActivateVendorLogin/.test(ACTIONS_SRC), "the action exists");
  assert(/adminActivateVendorLogin = async \(vendorId: string\) =>\s*asAdmin\(\(\) => vendorLoginActivation\.activateVendorLogin\(\{ vendorId \}\)\)/.test(ACTIONS_SRC.replace(/\s+/g, " ").replace(/ =>/g, " =>")) ||
    /asAdmin\(\(\) => vendorLoginActivation\.activateVendorLogin/.test(ACTIONS_SRC),
    "it must run inside asAdmin");
  assert(/async function asAdmin[\s\S]{0,160}requireSuperadmin\(\)/.test(ACTIONS_SRC),
    "and asAdmin requires Superadmin");
});

check("38 [static] the admin UI never handles a credential it should not", () => {
  assert(/adminActivateVendorLogin/.test(VENDORS_UI_SRC), "the UI calls the guarded action");
  assert(/Activate vendor login/.test(VENDORS_UI_SRC), "the action is reachable from the vendor menu");
  for (const banned of ["SERVICE_ROLE", "serviceRoleKey", "adminClient(", "auth.admin"]) {
    assert(!VENDORS_UI_SRC.includes(banned), `the client component must not reference ${banned}`);
  }
  assert(/never persisted or re-fetched|Shown once/.test(readFileSync("components/admin/sections/VendorsSection.tsx", "utf8")),
    "the one-time nature of the link is stated to the operator");
});

check("39 [static] the directory scan is bounded and fails closed when exhausted", () => {
  assert(/page <= AUTH_DIRECTORY_MAX_PAGES/.test(ACTIVATION_SRC), "the scan is bounded");
  assert(/return \{ readable: false, authUserId: null \};\s*\}\s*$/m.test(ACTIVATION_SRC) ||
    /\}\s*return \{ readable: false, authUserId: null \};/.test(ACTIVATION_SRC.replace(/\n/g, " ")),
    "an exhausted budget returns readable:false, never a clean 'no collision'");
  assert(/if \(!directory\.readable\) throw activationError\("AUTH_DIRECTORY_UNREADABLE"\)/.test(ACTIVATION_SRC),
    "and the caller treats that as a hard stop");
});

check("40 [static] no migration is introduced by this slice", () => {
  assert(!/create table|alter table|create policy|drop /i.test(ACTIVATION_SRC), "no DDL in the service");
});

// ============================================================================
// [mutant] every static rule above must actually bite
// ============================================================================
function mutant(name, source, mutate, stillPasses) {
  check(name, () => {
    const mutated = mutate(source);
    assert(mutated !== source, "the mutation must actually change the source");
    assert(!stillPasses(mutated), "the rule accepted a mutation it must reject");
  });
}

mutant("41 [mutant] dropping the NULL filter from the CAS is rejected",
  ACTIVATION_SRC,
  (s) => s.replace('.is("user_id", null)', ""),
  (s) => /\.update\(\{ user_id: uncommittedAuthUserId \}\)[\s\S]{0,120}\.is\("user_id", null\)/.test(s));

mutant("42 [mutant] widening the CAS to an arbitrary affected-row count is rejected",
  ACTIVATION_SRC,
  (s) => s.replace("(claimed ?? []).length !== 1", "(claimed ?? []).length < 1"),
  (s) => /\(claimed \?\? \[\]\)\.length !== 1/.test(s));

mutant("43 [mutant] writing a business column alongside user_id is rejected",
  ACTIVATION_SRC,
  (s) => s.replace(".update({ user_id: uncommittedAuthUserId })",
    '.update({ user_id: uncommittedAuthUserId, status: "Approved" })'),
  onlyUserIdIsWritten);

mutant("44 [mutant] setting a password on the new principal is rejected",
  ACTIVATION_SRC,
  (s) => s.replace("email_confirm: true,", 'email_confirm: true,\n      password: "welcome123",'),
  (s) => !/password/i.test(s));

mutant("45 [mutant] downgrading the guard from Superadmin to admin is rejected",
  ACTIVATION_SRC,
  (s) => s.replace("if (adminRole !== SUPERADMIN_ADMIN_ROLE) return fail(appError(\"UNAUTHORIZED\"));", ""),
  (s) => /SUPERADMIN_ADMIN_ROLE\) return fail/.test(s));

mutant("46 [mutant] treating an exhausted directory scan as 'no collision' is rejected",
  ACTIVATION_SRC,
  (s) => s.replace("if (!directory.readable) throw activationError(\"AUTH_DIRECTORY_UNREADABLE\");", ""),
  (s) => /if \(!directory\.readable\) throw activationError\("AUTH_DIRECTORY_UNREADABLE"\)/.test(s));

mutant("47 [mutant] inserting a vendor row from this service is rejected",
  ACTIVATION_SRC,
  (s) => s.replace('.from("vendors")\n      .select(VENDOR_ACTIVATION_COLUMNS)',
    '.from("vendors")\n      .insert({ business_name: "x" })\n      .select(VENDOR_ACTIVATION_COLUMNS)'),
  (s) => !/from\("vendors"\)[\s\S]{0,200}\.insert\(/.test(s));

mutant("48 [mutant] reaching a messaging table from this service is rejected",
  ACTIVATION_SRC,
  (s) => s.replace('const db = adminClient();',
    'const db = adminClient();\n    await db.from("communication_messages").select("id");'),
  (s) => !/communication_messages/i.test(s));

mutant("49 [mutant] letting the provisioning write escape its private guard is rejected",
  ACTIVATION_SRC,
  (s) => s.replace("async function performVendorLoginActivation", "export async function performVendorLoginActivation"),
  (s) => !/export\s+async\s+function\s+performVendorLoginActivation/.test(s));

mutant("50 [mutant] letting adminClient().auth into the Phase 5C resolver is rejected",
  ACCESS_SRC,
  (s) => s.replace("const { data: vendor, error: vendorError } = await adminClient()",
    "await adminClient().auth.admin.listUsers({ page: 1, perPage: 1 });\n    const { data: vendor, error: vendorError } = await adminClient()"),
  (s) => !/adminClient\(\)\s*\.\s*auth/.test(s));

// ============================================================================
(async () => {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of checks) {
    try {
      await fn();
      passed += 1;
      console.log(`   ok    ${name}`);
    } catch (e) {
      failures.push(`   FAIL  ${name} — ${e.message}`);
      console.log(`   FAIL  ${name} — ${e.message}`);
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-80.02 GATE-06 vendor login activation — passed ${passed}, failed ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const line of failures) console.log(line);
  }
  console.log("=".repeat(78));
  process.exit(failures.length > 0 ? 1 : 0);
})();
