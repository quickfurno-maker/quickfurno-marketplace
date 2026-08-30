// ============================================================================
// QuickFurno — scripts/qf-mvp-80-02-vendor-login-activation-harness.mjs
//
// QF-MVP-80.02 GATE-06 — SUPERADMIN-ONLY "Activate vendor login", and the
// GATE-06 REPAIR that the first real production activation forced.
//
// WHAT IS BEING PROVED
//   The Gate 06 audit found 5 fully eligible Pune vendors that could receive
//   assignments and credits but could not sign in, because approved vendors
//   created through the admin path carry `vendors.user_id = NULL` and the ONLY
//   writer of that column creates a NEW vendor row.
//
//   The first production activation then exposed three further defects, each of
//   which now has its own executable proof here:
//     1. the recovery link carried redirect_to=http://localhost:3000, because
//        generateLink was called without an explicit redirectTo;
//     2. vendor_dashboard_users was never written, because a legacy 10-digit
//        vendor phone was offered as an authentication identity and the
//        canonical linker correctly refused it;
//     3. profiles.role came out NULL, because handle_new_user classifies from
//        raw_app_meta_data at INSERT time and the Auth Admin API applies custom
//        app_metadata in a later step — so the vendor was bounced back to the
//        login page by the dashboard layout.
//   Plus: replay on an incomplete activation used to be a no-op, so the damaged
//   vendor could not be repaired by re-running the operation.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes a real production module with no I/O at all.
//   [exec]   runs the REAL compiled service against a mock database that models
//            the constraints production actually enforces.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it, so a
//            green run can never be an artefact of a check that never bites.
//
// ONE HONEST LIMIT, STATED RATHER THAN PAPERED OVER
//   app/actions.ts is a "use server" module that transitively imports most of
//   the application, so submitVendorAccountRegistration cannot be executed in
//   an offline harness. Its fix is therefore proved in two parts: the shared
//   rule it delegates to is proved [exec] against the mock database, and the
//   call site — including its rollback and its ordering before registerVendor —
//   is proved [static] with paired [mutant] checks. That is a weaker proof than
//   execution and is labelled as such.
//
// The mock models, because the services depend on each:
//   • auth.users.email UNIQUE
//   • the partial unique index on vendor_dashboard_users(user_id)
//   • PostgREST update-with-filter semantics (the CAS returns affected rows)
//   • `.is(col, null)` NULL semantics
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
  "lib/siteUrl.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/identity/vendorAccess.ts",
  "lib/identity/authPrincipalMarker.ts",
  "lib/vendors/vendorEligibility.ts",
  "services/vendorAccessService.ts",
  "services/vendorPrincipalProfileService.ts",
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
const PROFILE_SRC = readCode("services/vendorPrincipalProfileService.ts");
const SITEURL_SRC = readCode("lib/siteUrl.ts");
const ACCESS_SRC = readCode("services/vendorAccessService.ts");
const ACTIONS_SRC = readCode("app/actions.ts");
const VENDORS_UI_SRC = readCode("components/admin/sections/VendorsSection.tsx");
const SETPW_SRC = readCode("app/vendor/set-password/page.tsx");
const PHONE_SRC = readCode("lib/communication/phone.ts");

// ----------------------------------------------------------------------------
// Mock database — models the constraints production enforces
// ----------------------------------------------------------------------------
const SUPERADMIN = "auth-superadmin";
const PLAIN_ADMIN = "auth-plain-admin";
const PLAIN_USER = "auth-plain-user";
const LINKED_VENDOR_USER = "auth-linked-vendor";
const SQUATTER_USER = "auth-squatter";
const PARTIAL_USER = "auth-partial-vendor";
const ADMINROLE_USER = "auth-adminrole-vendor";

const V_BLOCKED = "vendor-blocked";        // approved, no login  → the Gate 06 case
const V_E164 = "vendor-e164";              // approved, no login, canonical phone
const V_LINKED = "vendor-linked";          // fully linked        → clean replay
const V_PARTIAL = "vendor-partial";        // linked but role NULL + no mapping
const V_ADMINROLE = "vendor-adminrole";    // linked to a principal holding role=admin
const V_PENDING = "vendor-pending";        // not approved
const V_NO_EMAIL = "vendor-no-email";      // no usable identity
const V_SHARED_A = "vendor-shared-a";      // shares an email with…
const V_SHARED_B = "vendor-shared-b";      // …this one
const V_SQUATTED = "vendor-squatted";      // an auth user already owns its email
const V_STALE = "vendor-stale";            // user_id points at a deleted principal
const V_MISMATCH = "vendor-mismatch";      // linked principal has a different email

const EMAIL_BLOCKED = "blocked@example.com";
const EMAIL_E164 = "e164@example.com";
const EMAIL_LINKED = "linked@example.com";
const EMAIL_PARTIAL = "partial@example.com";
const EMAIL_ADMINROLE = "adminrole@example.com";
const EMAIL_SHARED = "shared@example.com";
const EMAIL_SQUATTED = "squatted@example.com";
const EMAIL_MISMATCH = "mismatch@example.com";

const LEGACY_PHONE = "9876500000";          // 10 digits, no country code
const CANONICAL_PHONE = "+919876500001";

const SITE_URL = "https://quickfurno.in";
const EXPECTED_REDIRECT = "https://quickfurno.in/vendor/set-password";

const db = {};
let currentSessionUserId = null;
let createUserCalls = [];
let deleteUserCalls = [];
let generateLinkCalls = [];
let getUserByIdCalls = [];
let simulateClaimRace = false;
let simulateDirectoryFailure = false;
let simulateLinkFailure = false;
let simulateMappingFailure = false;

function baseVendor(overrides) {
  return {
    status: "Approved", email: null, phone: LEGACY_PHONE, owner_name: "Owner",
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
  getUserByIdCalls = [];
  simulateClaimRace = false;
  simulateDirectoryFailure = false;
  simulateLinkFailure = false;
  simulateMappingFailure = false;
  process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;

  db.auth_users = [
    { id: SUPERADMIN, email: "super@example.com" },
    { id: PLAIN_ADMIN, email: "admin@example.com" },
    { id: PLAIN_USER, email: "user@example.com" },
    { id: LINKED_VENDOR_USER, email: EMAIL_LINKED },
    { id: SQUATTER_USER, email: EMAIL_SQUATTED },
    { id: PARTIAL_USER, email: EMAIL_PARTIAL },
    { id: ADMINROLE_USER, email: EMAIL_ADMINROLE },
  ];

  db.profiles = [
    { id: SUPERADMIN, role: "admin" },
    { id: PLAIN_ADMIN, role: "admin" },
    { id: PLAIN_USER, role: null },
    { id: LINKED_VENDOR_USER, role: "vendor" },
    // The exact production shape after the first Gate-06 activation.
    { id: PARTIAL_USER, role: null },
    // A principal that must never be demoted or re-roled by this operation.
    { id: ADMINROLE_USER, role: "admin" },
  ];

  db.vendors = [
    { id: V_BLOCKED, ...baseVendor({ email: EMAIL_BLOCKED, business_name: "Aalam interior" }) },
    { id: V_E164, ...baseVendor({ email: EMAIL_E164, phone: CANONICAL_PHONE }) },
    { id: V_LINKED, ...baseVendor({ email: EMAIL_LINKED, user_id: LINKED_VENDOR_USER }) },
    { id: V_PARTIAL, ...baseVendor({ email: EMAIL_PARTIAL, user_id: PARTIAL_USER }) },
    { id: V_ADMINROLE, ...baseVendor({ email: EMAIL_ADMINROLE, user_id: ADMINROLE_USER }) },
    { id: V_PENDING, ...baseVendor({ status: "Pending", email: "pending@example.com" }) },
    { id: V_NO_EMAIL, ...baseVendor({ email: null }) },
    { id: V_SHARED_A, ...baseVendor({ email: EMAIL_SHARED }) },
    { id: V_SHARED_B, ...baseVendor({ email: EMAIL_SHARED }) },
    { id: V_SQUATTED, ...baseVendor({ email: EMAIL_SQUATTED }) },
    { id: V_STALE, ...baseVendor({ email: "stale@example.com", user_id: "auth-deleted" }) },
    { id: V_MISMATCH, ...baseVendor({ email: EMAIL_MISMATCH, user_id: LINKED_VENDOR_USER }) },
  ];

  db.vendor_dashboard_users = [
    {
      id: "vdu-linked", vendor_id: V_LINKED, user_id: LINKED_VENDOR_USER, phone: CANONICAL_PHONE,
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
          // The production trigger classifies from raw_app_meta_data AT INSERT
          // TIME and never sees the custom marker, so a new principal lands with
          // a NEUTRAL null role. Modelling that is the whole point of defect 3.
          db.profiles.push({ id: user.id, role: null });
          return { data: { user }, error: null };
        },
        async getUserById(id) {
          getUserByIdCalls.push(id);
          const user = db.auth_users.find((u) => u.id === id);
          if (!user) return { data: { user: null }, error: { message: "user not found" } };
          return { data: { user }, error: null };
        },
        async listUsers({ page, perPage }) {
          if (simulateDirectoryFailure) return { data: null, error: { message: "directory unavailable" } };
          const start = (page - 1) * perPage;
          return { data: { users: db.auth_users.slice(start, start + perPage) }, error: null };
        },
        async generateLink(input) {
          generateLinkCalls.push(input);
          if (simulateLinkFailure) return { data: null, error: { message: "link failed" } };
          const redirect = input?.options?.redirectTo ?? "SITE_URL_FALLBACK";
          return {
            data: {
              properties: {
                action_link:
                  `https://project.supabase.co/auth/v1/verify?token=${crypto.randomUUID()}` +
                  `&type=recovery&redirect_to=${encodeURIComponent(redirect)}`,
              },
            },
            error: null,
          };
        },
        async deleteUser(id) {
          deleteUserCalls.push(id);
          db.auth_users = db.auth_users.filter((u) => u.id !== id);
          db.profiles = db.profiles.filter((p) => p.id !== id);
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
const ProfileService = requireFromBuild("./services/vendorPrincipalProfileService.js");
const SiteUrl = requireFromBuild("./lib/siteUrl.js");
const MarkerMod = requireFromBuild("./lib/identity/authPrincipalMarker.js");

// ----------------------------------------------------------------------------
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function signIn(userId) { currentSessionUserId = userId; }
function vendorRow(id) { return db.vendors.find((v) => v.id === id); }
function profileRow(id) { return db.profiles.find((p) => p.id === id); }
function mappings(vendorId) { return db.vendor_dashboard_users.filter((m) => m.vendor_id === vendorId); }
function vendorCount() { return db.vendors.length; }
function authCount() { return db.auth_users.length; }

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

async function activateAs(userId, vendorId, prepare) {
  resetDb();
  if (prepare) prepare();
  signIn(userId);
  const before = { vendors: vendorCount(), auth: authCount(), business: businessSnapshot() };
  const result = await Activation.activateVendorLogin({ vendorId });
  return { result, before };
}

/** Capture everything written to the console while fn runs. */
async function captureConsole(fn) {
  const lines = [];
  const originals = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map((a) => String(a)).join(" "));
  }
  try {
    return { value: await fn(), output: lines.join("\n") };
  } finally {
    for (const level of Object.keys(originals)) console[level] = originals[level];
  }
}

// ============================================================================
// [pure] the canonical site URL rule
// ============================================================================
check("01 [pure] a valid production origin resolves", () => {
  const r = SiteUrl.resolveCanonicalSiteUrl(SITE_URL);
  assert(r.ok && r.origin === SITE_URL, JSON.stringify(r));
});

check("02 [pure] a missing or blank origin fails closed", () => {
  for (const bad of [undefined, null, "", "   "]) {
    const r = SiteUrl.resolveCanonicalSiteUrl(bad);
    assert(!r.ok && r.code === SiteUrl.SiteUrlFailure.SITE_URL_MISSING, `${JSON.stringify(bad)} -> ${JSON.stringify(r)}`);
  }
});

check("03 [pure] localhost and loopback are refused as an origin", () => {
  for (const bad of ["https://localhost", "https://localhost:3000", "https://127.0.0.1:3000",
    "https://0.0.0.0", "https://dev.local", "https://10.0.0.5", "https://192.168.1.9", "https://172.16.4.4"]) {
    const r = SiteUrl.resolveCanonicalSiteUrl(bad);
    assert(!r.ok && r.code === SiteUrl.SiteUrlFailure.SITE_URL_NOT_PUBLIC, `${bad} -> ${JSON.stringify(r)}`);
  }
});

check("04 [pure] a non-https origin is refused", () => {
  for (const bad of ["http://quickfurno.in", "ftp://quickfurno.in"]) {
    const r = SiteUrl.resolveCanonicalSiteUrl(bad);
    assert(!r.ok && r.code === SiteUrl.SiteUrlFailure.SITE_URL_NOT_HTTPS, `${bad} -> ${JSON.stringify(r)}`);
  }
});

check("05 [pure] a malformed value is refused", () => {
  for (const bad of ["quickfurno.in", "not a url", "//quickfurno.in"]) {
    const r = SiteUrl.resolveCanonicalSiteUrl(bad);
    assert(!r.ok && r.code === SiteUrl.SiteUrlFailure.SITE_URL_MALFORMED, `${bad} -> ${JSON.stringify(r)}`);
  }
});

check("06 [pure] anything that is not a bare origin is refused", () => {
  for (const bad of ["https://quickfurno.in/app", "https://quickfurno.in/?x=1",
    "https://quickfurno.in/#f", "https://u:p@quickfurno.in"]) {
    const r = SiteUrl.resolveCanonicalSiteUrl(bad);
    assert(!r.ok && r.code === SiteUrl.SiteUrlFailure.SITE_URL_NOT_AN_ORIGIN, `${bad} -> ${JSON.stringify(r)}`);
  }
});

check("07 [pure] the set-password URL is built from the canonical origin", () => {
  process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
  const r = SiteUrl.vendorSetPasswordUrl();
  assert(r.ok && r.origin === EXPECTED_REDIRECT, JSON.stringify(r));
  assert(SiteUrl.VENDOR_SET_PASSWORD_PATH === "/vendor/set-password", "canonical path");
});

// ============================================================================
// [exec] the Gate 06 happy path
// ============================================================================
check("08 [exec] an approved vendor with no login is given one, in place", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert(result.data.alreadyActive === false && result.data.repaired === false);
  assert(typeof result.data.authUserId === "string" && result.data.authUserId.length > 0);
  assert(vendorRow(V_BLOCKED).user_id === result.data.authUserId, "vendors.user_id now points at the new principal");
  assert(vendorCount() === before.vendors, "NO vendor row may be created");
  assert(authCount() === before.auth + 1, "exactly one auth user created");
});

check("09 [exec] the SAME vendor id is kept — no duplicate business row anywhere", async () => {
  await activateAs(SUPERADMIN, V_BLOCKED);
  const matches = db.vendors.filter((v) => v.business_name === "Aalam interior");
  assert(matches.length === 1, `expected exactly one Aalam interior row, found ${matches.length}`);
  assert(matches[0].id === V_BLOCKED, "the original vendor id must survive");
});

check("10 [exec] approval, package and credits are untouched", async () => {
  const { before } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(businessSnapshot() === before.business, "no business column may change during activation");
});

/**
 * Every key path in a value. The secrecy rule must judge FIELDS, not the
 * substring: the handover link legitimately points at /vendor/set-password, and
 * banning the word would fail for a reason that has nothing to do with secrecy.
 */
function keyPaths(value, prefix = "", out = []) {
  if (value === null || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value)) {
    out.push(prefix ? `${prefix}.${k}` : k);
    keyPaths(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

check("11 [exec] no login secret is created, defaulted, stored or returned", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(createUserCalls.length === 1, "exactly one createUser call");
  assert(!("password" in createUserCalls[0]), "createUser must be called WITHOUT a password");

  // No credential-shaped FIELD may exist on the result at all.
  for (const path of keyPaths(result)) {
    assert(!/password|passwd|secret|service_role|serviceRole|anon_key|apiKey/i.test(path),
      `the result must carry no credential-shaped field, saw "${path}"`);
  }
  // `recoveryLink` is the ONE field allowed to carry token material; nothing
  // else may, and no service credential may appear anywhere.
  const { recoveryLink, ...rest } = result.data;
  const serializedRest = JSON.stringify(rest);
  for (const banned of ["token", "service_role", "SUPABASE_SERVICE_ROLE_KEY", "anon_key"]) {
    assert(!serializedRest.includes(banned), `no field but recoveryLink may carry ${banned}`);
  }
  assert(!JSON.stringify(result).includes("SUPABASE_SERVICE_ROLE_KEY"), "no service credential anywhere");
  assert(db.auth_users.every((u) => !("password" in u)), "no password is written to the auth store");
});

check("12 [exec] the new principal carries the trusted vendor marker only", async () => {
  await activateAs(SUPERADMIN, V_BLOCKED);
  const meta = createUserCalls[0].app_metadata;
  assert(JSON.stringify(meta) === JSON.stringify(MarkerMod.vendorPrincipalAppMetadata()),
    "app_metadata must be exactly the canonical vendor marker");
  assert(meta.qf_principal === "vendor", "the trigger classifies from qf_principal");
  assert(!("role" in meta) && !("admin_role" in meta), "no role or admin_role may be injected");
  const userMeta = createUserCalls[0].user_metadata ?? {};
  assert(!("role" in userMeta) && !("admin_role" in userMeta) && !("qf_principal" in userMeta),
    "attacker-writable user_metadata must never carry classification");
  // And the marker survives the whole operation untouched.
  const stored = db.auth_users.find((u) => u.id === vendorRow(V_BLOCKED).user_id);
  assert(stored.app_metadata.qf_principal === "vendor", "qf_principal remains vendor after activation");
});

check("13 [exec] the email is confirmed so the recovery link is usable", async () => {
  await activateAs(SUPERADMIN, V_BLOCKED);
  assert(createUserCalls[0].email_confirm === true, "email_confirm must be true");
  assert(createUserCalls[0].email === EMAIL_BLOCKED, "the vendor's STORED email is used, never an argument");
});

// ============================================================================
// [exec] DEFECT 1 — the recovery redirect
// ============================================================================
check("14 [exec] the recovery link is issued with an EXPLICIT production redirect", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(generateLinkCalls.length === 1, "exactly one generateLink call");
  assert(generateLinkCalls[0].type === "recovery", "must be a recovery link");
  assert(generateLinkCalls[0].options?.redirectTo === EXPECTED_REDIRECT,
    `redirectTo must be the canonical set-password URL, saw ${JSON.stringify(generateLinkCalls[0].options)}`);
  assert(result.ok && result.data.recoveryLink.includes(encodeURIComponent(EXPECTED_REDIRECT)),
    "the issued link carries the production redirect");
  assert(!result.data.recoveryLink.includes("localhost"), "no localhost anywhere in the link");
  assert(result.data.recoveryLinkIssued === true, "issuance is reported");
});

check("15 [exec] a missing site URL fails closed BEFORE anything is created", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED, () => { delete process.env.NEXT_PUBLIC_SITE_URL; });
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.SITE_URL_UNAVAILABLE,
    `expected SITE_URL_UNAVAILABLE, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0, "no auth user may be created without a usable handover");
  assert(generateLinkCalls.length === 0, "no link attempted");
  assert(authCount() === before.auth && vendorCount() === before.vendors, "nothing created");
  assert(vendorRow(V_BLOCKED).user_id === null, "the vendor stays unlinked");
});

check("16 [exec] an invalid site URL fails closed the same way", async () => {
  for (const bad of ["http://quickfurno.in", "https://localhost:3000", "nonsense"]) {
    const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED, () => { process.env.NEXT_PUBLIC_SITE_URL = bad; });
    assert(!result.ok && result.code === Activation.VendorLoginActivationError.SITE_URL_UNAVAILABLE,
      `${bad} -> ${JSON.stringify(result)}`);
    assert(createUserCalls.length === 0 && authCount() === before.auth, `${bad} left a side effect`);
  }
});

// ============================================================================
// [exec] DEFECT 2 — the legacy vendor phone
// ============================================================================
check("17 [exec] a legacy non-E.164 phone STILL yields a membership, without a phone identity", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(result.ok && result.data.dashboardMappingLinked === true,
    `the mapping must be written, got ${JSON.stringify(result)}`);
  assert(result.data.mappingPhoneIdentity === false, "and must carry NO phone identity");
  const rows = mappings(V_BLOCKED);
  assert(rows.length === 1, `exactly one mapping row, found ${rows.length}`);
  assert(rows[0].phone === null, `mapping phone must be null, saw ${JSON.stringify(rows[0].phone)}`);
  assert(rows[0].user_id === result.data.authUserId && rows[0].role === "owner" && rows[0].status === "active");
  assert(rows[0].phone_verified === false, "WhatsApp verification is never inferred");
  // The vendor's own phone is untouched.
  assert(vendorRow(V_BLOCKED).phone === LEGACY_PHONE, "vendors.phone must be preserved verbatim");
});

check("18 [exec] a canonical E.164 phone is still carried into the mapping", async () => {
  const { result } = await activateAs(SUPERADMIN, V_E164);
  assert(result.ok && result.data.dashboardMappingLinked === true);
  assert(result.data.mappingPhoneIdentity === true, "a canonical phone IS a usable identity");
  const rows = mappings(V_E164);
  assert(rows.length === 1 && rows[0].phone === CANONICAL_PHONE,
    `mapping must carry the E.164 phone, saw ${JSON.stringify(rows[0]?.phone)}`);
  assert(vendorRow(V_E164).phone === CANONICAL_PHONE, "vendors.phone unchanged");
});

check("19 [pure] the phone rule is a filter, never a rewrite", () => {
  assert(Activation.canonicalMappingPhone(CANONICAL_PHONE) === CANONICAL_PHONE, "canonical passes through");
  for (const legacy of [LEGACY_PHONE, "98765 00000", "abc", "", "   ", null, undefined]) {
    assert(Activation.canonicalMappingPhone(legacy) === null,
      `non-canonical ${JSON.stringify(legacy)} must become null, never a guessed country code`);
  }
  assert(Activation.canonicalMappingPhone("00919876500000") === "+919876500000",
    "an explicit international prefix is already canonical");
});

// ============================================================================
// [exec] DEFECT 3 — profiles.role
// ============================================================================
check("20 [exec] a newly created vendor principal ends up with role=vendor", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED);
  assert(result.ok, JSON.stringify(result));
  const profile = profileRow(result.data.authUserId);
  assert(profile && profile.role === "vendor",
    `profiles.role must be vendor, saw ${JSON.stringify(profile)}`);
  assert(result.data.profileRoleOutcome === "ROLE_ASSIGNED", String(result.data.profileRoleOutcome));
});

check("21 [pure/exec] the role rule writes only 'vendor' and never escalates", async () => {
  resetDb();
  // A neutral profile is upgraded…
  const assigned = await ProfileService.ensureVendorPrincipalProfile(PARTIAL_USER);
  assert(assigned.ok && assigned.data.role === "vendor" && assigned.data.outcome === "ROLE_ASSIGNED");
  assert(profileRow(PARTIAL_USER).role === "vendor");
  // …and re-running is a no-op, not a rewrite.
  const again = await ProfileService.ensureVendorPrincipalProfile(PARTIAL_USER);
  assert(again.ok && again.data.outcome === "ALREADY_VENDOR");
  assert(ProfileService.VENDOR_PRINCIPAL_ROLE === "vendor", "the only writable role literal");
});

check("22 [exec] a conflicting non-null role is REFUSED and never overwritten", async () => {
  resetDb();
  const result = await ProfileService.ensureVendorPrincipalProfile(ADMINROLE_USER);
  assert(!result.ok && result.code === ProfileService.VendorPrincipalProfileError.PROFILE_ROLE_CONFLICT,
    `expected PROFILE_ROLE_CONFLICT, got ${JSON.stringify(result)}`);
  assert(profileRow(ADMINROLE_USER).role === "admin", "the admin role must survive untouched");
});

check("23 [exec] activation refuses rather than demote or adopt an admin principal", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_ADMINROLE);
  assert(!result.ok && result.code === ProfileService.VendorPrincipalProfileError.PROFILE_ROLE_CONFLICT,
    `expected PROFILE_ROLE_CONFLICT, got ${JSON.stringify(result)}`);
  assert(profileRow(ADMINROLE_USER).role === "admin", "no demotion");
  assert(authCount() === before.auth, "no principal created");
  assert(mappings(V_ADMINROLE).length === 0, "no membership granted off the back of a conflict");
});

check("24 [exec] no path can ever write an admin role", async () => {
  resetDb();
  signIn(SUPERADMIN);
  await Activation.activateVendorLogin({ vendorId: V_BLOCKED });
  await Activation.activateVendorLogin({ vendorId: V_PARTIAL });
  const admins = db.profiles.filter((p) => p.role === "admin").map((p) => p.id).sort();
  assert(JSON.stringify(admins) === JSON.stringify([ADMINROLE_USER, PLAIN_ADMIN, SUPERADMIN].sort()),
    `the admin set must be unchanged, saw ${JSON.stringify(admins)}`);
});

// ============================================================================
// [exec] DEFECT 4 — replay repairs instead of no-op
// ============================================================================
check("25 [exec] replay REPAIRS a partially activated vendor (role + mapping + link)", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_PARTIAL);
  assert(result.ok, `expected success, got ${JSON.stringify(result)}`);
  assert(result.data.alreadyActive === true, "the principal already existed");
  assert(result.data.repaired === true, "and the operation reports it repaired something");
  assert(result.data.authUserId === PARTIAL_USER, "the SAME principal is reused");
  assert(authCount() === before.auth, "NO second auth user");
  assert(createUserCalls.length === 0, "createUser is unreachable on the replay path");
  assert(vendorRow(V_PARTIAL).user_id === PARTIAL_USER, "vendors.user_id is unchanged");
  assert(profileRow(PARTIAL_USER).role === "vendor", "the missing role is now assigned");
  const rows = mappings(V_PARTIAL);
  assert(rows.length === 1 && rows[0].user_id === PARTIAL_USER, "the missing membership is now written");
  assert(result.data.recoveryLink && result.data.recoveryLink.includes(encodeURIComponent(EXPECTED_REDIRECT)),
    "a fresh production-domain link is issued");
  assert(vendorCount() === before.vendors, "no vendor row created");
  assert(businessSnapshot() === before.business, "no business state changed by a repair");
});

check("26 [exec] repeated replay is stable and still creates nothing", async () => {
  await activateAs(SUPERADMIN, V_PARTIAL);
  const authAfter = authCount();
  const second = await Activation.activateVendorLogin({ vendorId: V_PARTIAL });
  assert(second.ok && second.data.alreadyActive === true);
  assert(authCount() === authAfter, "no additional auth user");
  assert(mappings(V_PARTIAL).length === 1, "still exactly one membership");
  assert(createUserCalls.length === 0, "createUser never called on any replay");
  assert(second.data.profileRoleOutcome === "ALREADY_VENDOR", "the role is left alone once correct");
});

check("27 [exec] replay on an already-complete vendor changes nothing but the link", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_LINKED);
  assert(result.ok && result.data.alreadyActive === true);
  assert(result.data.authUserId === LINKED_VENDOR_USER);
  assert(authCount() === before.auth && vendorCount() === before.vendors);
  assert(mappings(V_LINKED).length === 1, "no duplicate membership");
  assert(profileRow(LINKED_VENDOR_USER).role === "vendor");
  assert(businessSnapshot() === before.business);
});

check("28 [exec] replay verifies the linked principal still exists", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_STALE);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.LINKED_PRINCIPAL_MISSING,
    `expected LINKED_PRINCIPAL_MISSING, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0, "a stale link must NOT be silently re-provisioned");
  assert(authCount() === before.auth, "nothing created");
  assert(vendorRow(V_STALE).user_id === "auth-deleted", "the link is not rewritten either");
});

check("29 [exec] replay refuses a linked principal whose email is not the vendor's", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_MISMATCH);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.LINKED_PRINCIPAL_MISMATCH,
    `expected LINKED_PRINCIPAL_MISMATCH, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0 && authCount() === before.auth, "no side effect");
  assert(mappings(V_MISMATCH).length === 0, "no membership granted across an identity mismatch");
  assert(profileRow(LINKED_VENDOR_USER).role === "vendor", "the other vendor's principal is untouched");
});

// ============================================================================
// [exec] fail-closed identity rules
// ============================================================================
check("30 [exec] a pre-existing auth principal is REFUSED, never adopted", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_SQUATTED);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.AUTH_EMAIL_COLLISION,
    `expected AUTH_EMAIL_COLLISION, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0 && authCount() === before.auth, "no auth user may be created");
  assert(vendorRow(V_SQUATTED).user_id === null, "the vendor stays unlinked");
});

check("31 [exec] a shared vendor email is REFUSED for both rows", async () => {
  for (const target of [V_SHARED_A, V_SHARED_B]) {
    const { result, before } = await activateAs(SUPERADMIN, target);
    assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_EMAIL_NOT_UNIQUE,
      `expected VENDOR_EMAIL_NOT_UNIQUE for ${target}, got ${JSON.stringify(result)}`);
    assert(createUserCalls.length === 0 && authCount() === before.auth, "no auth user for a shared email");
    assert(vendorRow(V_SHARED_A).user_id === null && vendorRow(V_SHARED_B).user_id === null,
      "neither row may be arbitrarily chosen as the owner");
  }
});

check("32 [exec] a vendor with no email is refused, with no side effect", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_NO_EMAIL);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_EMAIL_MISSING,
    `expected VENDOR_EMAIL_MISSING, got ${JSON.stringify(result)}`);
  assert(authCount() === before.auth && vendorCount() === before.vendors, "nothing created");
});

check("33 [exec] a non-approved vendor is refused", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_PENDING);
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_NOT_APPROVED,
    `expected VENDOR_NOT_APPROVED, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0, "no auth user for a pending vendor");
  assert(vendorRow(V_PENDING).status === "Pending", "the status is not changed to make it pass");
  assert(authCount() === before.auth, "the auth store is unchanged");
});

check("34 [exec] an unknown vendor id is refused", async () => {
  const { result, before } = await activateAs(SUPERADMIN, "vendor-does-not-exist");
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_NOT_FOUND,
    `expected VENDOR_NOT_FOUND, got ${JSON.stringify(result)}`);
  assert(vendorCount() === before.vendors && authCount() === before.auth, "nothing created");
});

check("35 [exec] an empty vendor id is a validation failure, not a wildcard", async () => {
  for (const bad of ["", "   ", null, undefined]) {
    resetDb();
    signIn(SUPERADMIN);
    const result = await Activation.activateVendorLogin({ vendorId: bad });
    assert(!result.ok, `empty vendor id ${JSON.stringify(bad)} must fail`);
    assert(createUserCalls.length === 0, "no auth user for an empty target");
  }
});

check("36 [exec] an unreadable auth directory fails closed, not open", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateDirectoryFailure = true; });
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.AUTH_DIRECTORY_UNREADABLE,
    `expected AUTH_DIRECTORY_UNREADABLE, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 0 && authCount() === before.auth, "an unprovable collision blocks creation");
});

// ============================================================================
// [exec] the compare-and-swap and its rollback
// ============================================================================
check("37 [exec] a lost CAS race rolls the new auth user back", async () => {
  const { result, before } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateClaimRace = true; });
  assert(!result.ok && result.code === Activation.VendorLoginActivationError.VENDOR_CLAIM_CONFLICT,
    `expected VENDOR_CLAIM_CONFLICT, got ${JSON.stringify(result)}`);
  assert(createUserCalls.length === 1, "the auth user was created before the race was detected");
  assert(deleteUserCalls.length === 1, "and it MUST be deleted again");
  assert(authCount() === before.auth, "no orphan principal may survive a failed activation");
  assert(vendorRow(V_BLOCKED).user_id === null && vendorCount() === before.vendors);
});

check("38 [exec] a failed mapping does not roll back a completed link", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateMappingFailure = true; });
  assert(result.ok, "the primary link succeeded, so the operation succeeds");
  assert(result.data.dashboardMappingLinked === false, "and the failure is reported honestly, not hidden");
  assert(vendorRow(V_BLOCKED).user_id === result.data.authUserId, "the canonical link stands");
  assert(profileRow(result.data.authUserId).role === "vendor", "the role is still established");
  assert(deleteUserCalls.length === 0, "a committed principal must NOT be deleted");
});

check("39 [exec] a failed recovery link is reported, not fatal", async () => {
  const { result } = await activateAs(SUPERADMIN, V_BLOCKED, () => { simulateLinkFailure = true; });
  assert(result.ok, "the vendor is linked even if the handover link fails");
  assert(result.data.recoveryLink === null && result.data.recoveryLinkIssued === false, "reported as not issued");
  assert(deleteUserCalls.length === 0, "the principal is kept; the operator can re-issue");
});

// ============================================================================
// [exec] authorization
// ============================================================================
check("40 [exec] anonymous, plain-admin, non-admin and vendor callers are all denied", async () => {
  for (const who of [null, PLAIN_ADMIN, PLAIN_USER, LINKED_VENDOR_USER]) {
    const { result, before } = await activateAs(who, V_BLOCKED);
    assert(!result.ok && result.code === "UNAUTHORIZED",
      `${who} expected UNAUTHORIZED, got ${JSON.stringify(result)}`);
    assert(createUserCalls.length === 0 && authCount() === before.auth, `${who} caused a side effect`);
    assert(vendorRow(V_BLOCKED).user_id === null, `${who} linked a vendor`);
  }
});

check("41 [exec] authority comes from the session, not from the argument", async () => {
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
// [exec] blast radius and secrecy
// ============================================================================
check("42 [exec] activation touches no assignment, credit or message table", async () => {
  resetDb();
  signIn(SUPERADMIN);
  const before = JSON.stringify({ a: db.lead_assignments, c: db.vendor_credit_logs, m: db.communication_messages });
  await Activation.activateVendorLogin({ vendorId: V_BLOCKED });
  const after = JSON.stringify({ a: db.lead_assignments, c: db.vendor_credit_logs, m: db.communication_messages });
  assert(before === after, "assignment, credit and message state must be byte-identical");
});

check("43 [exec] every failure path leaves the database exactly as it was", async () => {
  for (const target of [V_SQUATTED, V_SHARED_A, V_NO_EMAIL, V_PENDING, V_STALE, V_MISMATCH, V_ADMINROLE, "vendor-missing"]) {
    resetDb();
    signIn(SUPERADMIN);
    const snapshot = JSON.stringify({ v: db.vendors, m: db.vendor_dashboard_users, u: db.auth_users, p: db.profiles });
    const result = await Activation.activateVendorLogin({ vendorId: target });
    assert(!result.ok, `${target} must fail`);
    assert(JSON.stringify({ v: db.vendors, m: db.vendor_dashboard_users, u: db.auth_users, p: db.profiles }) === snapshot,
      `${target} left a side effect behind`);
  }
});

check("44 [exec] neither the recovery token nor any credential is written to the console", async () => {
  resetDb();
  signIn(SUPERADMIN);
  const { value, output } = await captureConsole(() => Activation.activateVendorLogin({ vendorId: V_BLOCKED }));
  assert(value.ok, "the activation itself succeeded");
  assert(output.trim() === "", `the service must log nothing at all, saw: ${output.slice(0, 200)}`);
  const link = value.data.recoveryLink;
  assert(typeof link === "string" && link.length > 0, "a link was in fact produced");
  assert(!output.includes(link), "the link must never reach the console");
});

// ============================================================================
// [static] source contracts
// ============================================================================
check("45 [static] the activation service can never create a vendor row", () => {
  assert(!/from\("vendors"\)[\s\S]{0,200}\.insert\(/.test(ACTIVATION_SRC), "no INSERT on vendors");
  assert(!/registerVendor|submitVendorAccountRegistration/.test(ACTIVATION_SRC), "no registration path is reachable");
  assert(!/\.delete\(/.test(ACTIVATION_SRC), "no vendor deletion");
});

function writePayloads(src) {
  return src.match(/\.(?:update|insert)\(\{[\s\S]*?\}\)/g) ?? [];
}
function onlyUserIdIsWritten(src) {
  const payloads = writePayloads(src);
  if (payloads.length !== 1) return false;
  if (payloads[0].trim() !== ".update({ user_id: uncommittedAuthUserId })") return false;
  return !["status", "remaining_credits", "total_credits", "paid_status", "verification_status",
    "package_status", "accepting_leads", "is_active", "public_visibility", "phone"]
    .some((column) => new RegExp(`${column}\\s*:`).test(payloads.join(" ")));
}

check("46 [static] the ONLY vendors column the activation writes is user_id", () => {
  const payloads = writePayloads(ACTIVATION_SRC);
  assert(payloads.length === 1, `expected exactly one write payload, found ${payloads.length}: ${payloads.join(" | ")}`);
  assert(onlyUserIdIsWritten(ACTIVATION_SRC), `the single write must be exactly user_id, saw ${payloads[0]}`);
});

check("47 [static] the claim is a compare-and-swap on a NULL owner", () => {
  assert(/\.update\(\{ user_id: uncommittedAuthUserId \}\)[\s\S]{0,120}\.is\("user_id", null\)/.test(ACTIVATION_SRC),
    "the update must be filtered on user_id IS NULL");
  assert(/\(claimed \?\? \[\]\)\.length !== 1/.test(ACTIVATION_SRC), "exactly one affected row is required");
});

check("48 [static] the role write is a CAS on NULL and only ever writes 'vendor'", () => {
  const payloads = writePayloads(PROFILE_SRC);
  assert(payloads.length === 1 && payloads[0].trim() === ".update({ role: VENDOR_PRINCIPAL_ROLE })",
    `exactly one role write, saw ${payloads.join(" | ")}`);
  assert(/\.is\("role", null\)/.test(PROFILE_SRC), "filtered on role IS NULL");
  assert(/VENDOR_PRINCIPAL_ROLE = "vendor"/.test(PROFILE_SRC), "the literal is fixed in source");
  assert(!/"admin"|'admin'|Superadmin/.test(PROFILE_SRC), "no admin literal may exist in this module at all");
  assert(!/role\s*[:=]\s*(input|arg|params|role)\b/.test(PROFILE_SRC), "no role value is taken from an argument");
});

check("49 [static] no login secret is created, stored or returned by the activation", () => {
  // Judge WRITES and Auth calls, not the substring: /vendor/set-password is a
  // legitimate route name that contains the word.
  assert(!/password\s*:/i.test(ACTIVATION_SRC), "no password field is ever assigned");
  assert(!/generatePassword|randomPassword|defaultPassword|\botp\b/i.test(ACTIVATION_SRC), "no secret is minted");
  assert(!/inviteUserByEmail|resetPasswordForEmail|signInWithPassword|updateUserById/.test(ACTIVATION_SRC),
    "no password-mutating or session-minting Auth call");
});

check("50 [static] no messaging, assignment, matching or runtime-mode reach", () => {
  for (const banned of ["whatsapp", "sendMessage", "messaging_product", "communication_messages",
    "lead_assignments", "lead_matching_runs", "vendor_credit_logs", "auto_assignment_mode",
    "marketplace_runtime_settings", "runAutoLeadMatching"]) {
    assert(!new RegExp(banned, "i").test(ACTIVATION_SRC), `the service must not reference ${banned}`);
  }
});

check("51 [static] superadmin authority is derived internally and stays private", () => {
  assert(/async function requireSuperadminSession/.test(ACTIVATION_SRC), "the guard exists");
  assert(!/export\s+(async\s+)?function\s+requireSuperadminSession/.test(ACTIVATION_SRC), "and stays private");
  assert(!/export\s+async\s+function\s+performVendorLoginActivation/.test(ACTIVATION_SRC),
    "the raw provisioning write must stay private");
  assert(!/export\s+async\s+function\s+repairExistingActivation/.test(ACTIVATION_SRC),
    "the repair path must stay private too");
  assert(/admin_role/.test(ACTIVATION_SRC) && /SUPERADMIN_ADMIN_ROLE/.test(ACTIVATION_SRC),
    "Superadmin is checked, not merely admin");
  assert(/auth\.getUser\(\)/.test(ACTIVATION_SRC), "the session is validated by Supabase");
  assert(!/jsonwebtoken|jose|jwt\.sign|jwt\.verify/.test(ACTIVATION_SRC), "no custom token system");
  assert(/const superadmin = await requireSuperadminSession\(\);[\s\S]{0,120}if \(!superadmin\.ok\) return superadmin;/.test(ACTIVATION_SRC),
    "the public entry point must guard before doing anything");
});

check("52 [static] the linkage is REUSED, not reimplemented", () => {
  assert(/import \{ linkVendorAuthUser \} from "\.\/vendorAccessService"/.test(ACTIVATION_SRC),
    "the canonical linking function is imported");
  assert(!/from\("vendor_dashboard_users"\)[\s\S]{0,200}\.insert\(/.test(ACTIVATION_SRC),
    "the mapping insert must not be duplicated here");
  assert(/async function requireAdminSession/.test(ACCESS_SRC), "and it still derives its own authority");
});

check("53 [static] Phase 5C's resolver and the phone invariant are left intact", () => {
  assert(!/adminClient\(\)\s*\.\s*auth/.test(ACCESS_SRC),
    "vendorAccessService must still never reach adminClient().auth");
  assert(/never touches vendors\.user_id/.test(readFileSync("services/vendorAccessService.ts", "utf8")),
    "its documented contract is unchanged");
  assert(!/activateVendorLogin|createUser|generateLink|deleteUser/.test(ACCESS_SRC),
    "provisioning must not have leaked into the resolver");
  // The repair fixes the CALLER, never the identity rule.
  assert(/return \{ ok: false, code: "PHONE_MISSING_COUNTRY_CODE" \}/.test(PHONE_SRC),
    "normalizePhoneE164 must still reject a bare local number");
  assert(/if \(!normalized\.ok\) throw vendorLinkError\("VENDOR_LINK_INVALID_PHONE"\)/.test(ACCESS_SRC),
    "and the linker must still treat an unparseable phone as fatal");
});

check("54 [static] the redirect is always explicit and always fails closed", () => {
  assert(/options: \{ redirectTo \}/.test(ACTIVATION_SRC), "generateLink must pass redirectTo");
  assert(/const setPasswordUrl = vendorSetPasswordUrl\(\);[\s\S]{0,160}if \(!setPasswordUrl\.ok\) throw activationError\("SITE_URL_UNAVAILABLE"\)/.test(ACTIVATION_SRC),
    "the origin is resolved and enforced before anything else");
  assert(!/localhost|127\.0\.0\.1/.test(ACTIVATION_SRC), "no localhost literal in the service");
  assert(!/quickfurno\.in/.test(ACTIVATION_SRC), "the domain is configuration, not a hard-coded literal");
});

check("55 [static] the set-password route exists and consumes a recovery session", () => {
  assert(existsSync("app/vendor/set-password/page.tsx"), "the landing route must exist");
  assert(/setSession/.test(SETPW_SRC), "it adopts the recovery session");
  assert(/updateUser\(\{ password \}\)/.test(SETPW_SRC), "it sets the password through Supabase Auth");
  assert(/signOut/.test(SETPW_SRC), "and does not leave a recovery session logged in");
  assert(/history\.replaceState/.test(SETPW_SRC), "the tokens are stripped from the address bar");
  for (const banned of ["SERVICE_ROLE", "serviceRoleKey", "adminClient(", "auth.admin", "console.log"]) {
    assert(!SETPW_SRC.includes(banned), `the client page must not reference ${banned}`);
  }
});

check("56 [static] the server action is superadmin-gated and thin", () => {
  assert(/export const adminActivateVendorLogin/.test(ACTIONS_SRC), "the action exists");
  assert(/asAdmin\(\(\) => vendorLoginActivation\.activateVendorLogin/.test(ACTIONS_SRC), "it runs inside asAdmin");
  assert(/async function asAdmin[\s\S]{0,160}requireSuperadmin\(\)/.test(ACTIONS_SRC), "and asAdmin requires Superadmin");
});

check("57 [static] public vendor signup establishes the vendor role, with rollback", () => {
  assert(/ensureVendorPrincipalProfile\(auth\.user\.id\)/.test(ACTIONS_SRC),
    "signup must assert the role for the principal it just created");
  const order = ACTIONS_SRC.indexOf("ensureVendorPrincipalProfile(auth.user.id)");
  const register = ACTIONS_SRC.indexOf("vendors.registerVendor({");
  const create = ACTIONS_SRC.indexOf("db.auth.admin.createUser({");
  assert(create !== -1 && order > create, "the assertion runs AFTER the principal exists");
  assert(register !== -1 && order < register, "and BEFORE the vendor row is created");
  assert(/if \(!principalProfile\.ok\) \{[\s\S]{0,200}deleteUser\(auth\.user\.id\)/.test(ACTIONS_SRC),
    "a failed assertion must roll the principal back rather than ship an unusable account");
});

check("58 [static] the admin UI never handles a credential it should not", () => {
  assert(/adminActivateVendorLogin/.test(VENDORS_UI_SRC), "the UI calls the guarded action");
  assert(/Activate vendor login/.test(VENDORS_UI_SRC), "the action is reachable from the vendor menu");
  for (const banned of ["SERVICE_ROLE", "serviceRoleKey", "adminClient(", "auth.admin"]) {
    assert(!VENDORS_UI_SRC.includes(banned), `the client component must not reference ${banned}`);
  }
});

check("59 [static] the directory scan is bounded and fails closed when exhausted", () => {
  assert(/page <= AUTH_DIRECTORY_MAX_PAGES/.test(ACTIVATION_SRC), "the scan is bounded");
  assert(/if \(!directory\.readable\) throw activationError\("AUTH_DIRECTORY_UNREADABLE"\)/.test(ACTIVATION_SRC),
    "an exhausted or failed scan is a hard stop");
});

check("60 [static] no migration is introduced by this slice", () => {
  for (const src of [ACTIVATION_SRC, PROFILE_SRC, SITEURL_SRC]) {
    assert(!/create table|alter table|create policy|drop /i.test(src), "no DDL in the services");
  }
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

mutant("61 [mutant] dropping the NULL filter from the vendor CAS is rejected",
  ACTIVATION_SRC, (s) => s.replace('.is("user_id", null)', ""),
  (s) => /\.update\(\{ user_id: uncommittedAuthUserId \}\)[\s\S]{0,120}\.is\("user_id", null\)/.test(s));

mutant("62 [mutant] widening the CAS to an arbitrary affected-row count is rejected",
  ACTIVATION_SRC, (s) => s.replace("(claimed ?? []).length !== 1", "(claimed ?? []).length < 1"),
  (s) => /\(claimed \?\? \[\]\)\.length !== 1/.test(s));

mutant("63 [mutant] writing a business column alongside user_id is rejected",
  ACTIVATION_SRC,
  (s) => s.replace(".update({ user_id: uncommittedAuthUserId })",
    '.update({ user_id: uncommittedAuthUserId, status: "Approved" })'),
  onlyUserIdIsWritten);

mutant("64 [mutant] setting a login secret on the new principal is rejected",
  ACTIVATION_SRC, (s) => s.replace("email_confirm: true,", 'email_confirm: true,\n      password: "welcome123",'),
  (s) => !/password\s*:/i.test(s));

mutant("65 [mutant] downgrading the guard from Superadmin to admin is rejected",
  ACTIVATION_SRC,
  (s) => s.replace('if (adminRole !== SUPERADMIN_ADMIN_ROLE) return fail(appError("UNAUTHORIZED"));', ""),
  (s) => /SUPERADMIN_ADMIN_ROLE\) return fail/.test(s));

mutant("66 [mutant] treating an exhausted directory scan as 'no collision' is rejected",
  ACTIVATION_SRC,
  (s) => s.replace('if (!directory.readable) throw activationError("AUTH_DIRECTORY_UNREADABLE");', ""),
  (s) => /if \(!directory\.readable\) throw activationError\("AUTH_DIRECTORY_UNREADABLE"\)/.test(s));

mutant("67 [mutant] inserting a vendor row from this service is rejected",
  ACTIVATION_SRC,
  (s) => s.replace('.from("vendors")\n      .select(VENDOR_ACTIVATION_COLUMNS)',
    '.from("vendors")\n      .insert({ business_name: "x" })\n      .select(VENDOR_ACTIVATION_COLUMNS)'),
  (s) => !/from\("vendors"\)[\s\S]{0,200}\.insert\(/.test(s));

mutant("68 [mutant] reaching a messaging table from this service is rejected",
  ACTIVATION_SRC,
  (s) => s.replace("const db = adminClient();", 'const db = adminClient();\n    await db.from("communication_messages").select("id");'),
  (s) => !/communication_messages/i.test(s));

mutant("69 [mutant] exporting the private provisioning write is rejected",
  ACTIVATION_SRC,
  (s) => s.replace("async function performVendorLoginActivation", "export async function performVendorLoginActivation"),
  (s) => !/export\s+async\s+function\s+performVendorLoginActivation/.test(s));

mutant("70 [mutant] letting adminClient().auth into the Phase 5C resolver is rejected",
  ACCESS_SRC,
  (s) => s.replace("const { data: vendor, error: vendorError } = await adminClient()",
    "await adminClient().auth.admin.listUsers({ page: 1, perPage: 1 });\n    const { data: vendor, error: vendorError } = await adminClient()"),
  (s) => !/adminClient\(\)\s*\.\s*auth/.test(s));

mutant("71 [mutant] dropping the explicit redirect is rejected",
  ACTIVATION_SRC, (s) => s.replace("options: { redirectTo },", ""),
  (s) => /options: \{ redirectTo \}/.test(s));

mutant("72 [mutant] hard-coding the production domain in the service is rejected",
  ACTIVATION_SRC, (s) => s.replace("const redirectTo = setPasswordUrl.origin;",
    'const redirectTo = "https://quickfurno.in/vendor/set-password";'),
  (s) => !/quickfurno\.in/.test(s));

mutant("73 [mutant] loosening normalizePhoneE164 to accept a bare local number is rejected",
  PHONE_SRC, (s) => s.replace('return { ok: false, code: "PHONE_MISSING_COUNTRY_CODE" };', 'digits = "91" + stripped;'),
  (s) => /return \{ ok: false, code: "PHONE_MISSING_COUNTRY_CODE" \}/.test(s));

mutant("74 [mutant] dropping the NULL filter from the role CAS is rejected",
  PROFILE_SRC, (s) => s.replace('.is("role", null)', ""),
  (s) => /\.is\("role", null\)/.test(s));

mutant("75 [mutant] admitting an admin literal into the role module is rejected",
  PROFILE_SRC, (s) => s.replace('export const VENDOR_PRINCIPAL_ROLE = "vendor";',
    'export const VENDOR_PRINCIPAL_ROLE = "vendor";\nconst ESCALATE = "admin";'),
  (s) => !/"admin"|'admin'|Superadmin/.test(s));

mutant("76 [mutant] removing the signup role assertion is rejected",
  ACTIONS_SRC, (s) => s.replace("ensureVendorPrincipalProfile(auth.user.id)", "Promise.resolve({ ok: true })"),
  (s) => /ensureVendorPrincipalProfile\(auth\.user\.id\)/.test(s));

mutant("77 [mutant] moving the signup assertion after registerVendor is rejected",
  ACTIONS_SRC,
  (s) => {
    const call = "const principalProfile = await vendorPrincipalProfiles.ensureVendorPrincipalProfile(auth.user.id);";
    return s.replace(call, "").replace("return ok({ ...vendor.data, user_id: auth.user.id });",
      `${call}\n    return ok({ ...vendor.data, user_id: auth.user.id });`);
  },
  (s) => {
    const order = s.indexOf("ensureVendorPrincipalProfile(auth.user.id)");
    const register = s.indexOf("vendors.registerVendor({");
    return order !== -1 && register !== -1 && order < register;
  });

mutant("78 [mutant] a set-password page that never sets a password is rejected",
  SETPW_SRC, (s) => s.replace("updateUser({ password })", "updateUser({})"),
  (s) => /updateUser\(\{ password \}\)/.test(s));

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
