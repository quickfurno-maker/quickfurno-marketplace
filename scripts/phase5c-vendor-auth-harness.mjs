import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5C — QuickFurno Vendor Authentication Foundation harness.
 *
 * Exercises the vendor access resolver, the password-login service, security-event
 * integration, identifier canonicalization/hashing, and the separation between
 * authentication and every business state.
 *
 * The mock database models the REAL constraints the migration declares:
 *   • partial unique index on vendor_dashboard_users(user_id) WHERE user_id IS NOT NULL
 *   • unique (vendor_id, phone), with PostgreSQL NULL-distinct semantics
 *   • user_id FK → auth.users(id) ON DELETE SET NULL
 *   • the RLS grant + policy model (anon deny, authenticated self-read SELECT only)
 * so a write production would reject is rejected here too.
 */

const outDir = resolve(".phase5c-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/identity/principal.ts",
  "lib/identity/verification.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/identity/vendorAccess.ts",
  "lib/identity/vendorLoginIdentifier.ts",
  "services/authSecurityEventService.ts",
  "services/vendorAccessService.ts",
  "services/vendorAuthService.ts",
];

const tsconfigPath = resolve(".phase5c-tsconfig.json");
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
// Source + migration text
// ----------------------------------------------------------------------------
const MIGRATION = "supabase/migrations/20260708000180_vendor_authentication_foundation.sql";
const rawSql = readFileSync(MIGRATION, "utf8");
const strippedSql = rawSql.replace(/--[^\n]*/g, "");
const normalizedSql = strippedSql.toLowerCase().replace(/\s+/g, " ");

const PHASE_5A_MIGRATION = readFileSync("supabase/migrations/20260708000160_identity_security_foundation.sql", "utf8");
const PHASE_5B_MIGRATION = readFileSync("supabase/migrations/20260708000170_unified_communication_core.sql", "utf8");

/** Source scans must inspect CODE, not the prose in comments that describes it. */
function readCode(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const AUTH_SERVICE_SRC = readCode("services/vendorAuthService.ts");
const ACCESS_SERVICE_SRC = readCode("services/vendorAccessService.ts");
const EVENT_SERVICE_SRC = readCode("services/authSecurityEventService.ts");
const ALL_NEW_SERVICE_SRC = AUTH_SERVICE_SRC + ACCESS_SERVICE_SRC + EVENT_SERVICE_SRC;

/** Slice one top-level `export async function <name>` out of a source file. */
function extractExportedFunction(src, name) {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`${name} not found`);
  const rest = src.slice(start + 1);
  const nextExport = rest.indexOf("\nexport ");
  return nextExport === -1 ? src.slice(start) : src.slice(start, start + 1 + nextExport);
}

const RESOLVE_VENDOR_ACCESS_SRC = extractExportedFunction(ACCESS_SERVICE_SRC, "resolveVendorAccess");

// ----------------------------------------------------------------------------
// Mock database — models the real constraints
// ----------------------------------------------------------------------------
const UNIQUE_INDEXES = {
  vendor_dashboard_users: [
    {
      name: "uq_vendor_dashboard_users_user_id",
      cols: ["user_id"],
      where: (r) => r.user_id !== null && r.user_id !== undefined,
    },
    {
      name: "vendor_dashboard_users_vendor_id_phone_key",
      cols: ["vendor_id", "phone"],
    },
  ],
};

/** PostgreSQL: NULL never conflicts; a partial index only covers matching rows. */
function findUniqueViolation(table, newRow, rows, excludeId = null) {
  for (const index of UNIQUE_INDEXES[table] ?? []) {
    if (index.where && !index.where(newRow)) continue;
    if (index.cols.some((c) => newRow[c] === null || newRow[c] === undefined)) continue;

    const clash = rows.some(
      (existing) =>
        existing.id !== excludeId &&
        (!index.where || index.where(existing)) &&
        index.cols.every((c) => existing[c] === newRow[c])
    );
    if (clash) {
      return {
        code: "23505",
        message: `duplicate key value violates unique constraint "${index.name}"`,
        constraint: index.name,
      };
    }
  }
  return null;
}

const AUTH_USER_A = "auth-user-a";
const AUTH_USER_B = "auth-user-b";
const AUTH_USER_ORPHAN = "auth-user-orphan";
const AUTH_USER_ADMIN = "auth-user-admin";

const VENDOR_A = "vendor-a";
const VENDOR_B = "vendor-b";

const EMAIL_A = "owner-a@example.com";
const PHONE_A = "+919876543210";
const PASSWORD_A = "correct-horse-battery-staple";

const db = {};
let signOutCalls = 0;
let signInCalls = [];
let currentSessionUserId = null;

function resetDb() {
  signOutCalls = 0;
  signInCalls = [];
  currentSessionUserId = null;

  // auth.users (Supabase Auth authority)
  db.auth_users = [
    { id: AUTH_USER_A, email: EMAIL_A, phone: PHONE_A, password: PASSWORD_A },
    { id: AUTH_USER_B, email: "owner-b@example.com", phone: "+918800000002", password: "pw-b" },
    { id: AUTH_USER_ORPHAN, email: "orphan@example.com", phone: null, password: "pw-orphan" },
    { id: AUTH_USER_ADMIN, email: "admin@example.com", phone: null, password: "pw-admin" },
  ];

  db.profiles = [
    { id: AUTH_USER_ADMIN, role: "admin" },
    { id: AUTH_USER_A, role: "vendor" },
  ];

  // Vendors deliberately carry HOSTILE business state: pending verification,
  // unpaid, zero credits, not accepting leads, inactive package.
  db.vendors = [
    {
      id: VENDOR_A, user_id: AUTH_USER_A, phone: PHONE_A, email: EMAIL_A,
      verification_status: "Pending", paid_status: "Unpaid", package_status: "inactive",
      remaining_credits: 0, total_credits: 0, accepting_leads: false, is_active: false,
    },
    {
      id: VENDOR_B, user_id: AUTH_USER_B, phone: "+918800000002", email: "owner-b@example.com",
      verification_status: "Verified", paid_status: "Paid", package_status: "active",
      remaining_credits: 50, total_credits: 100, accepting_leads: true, is_active: true,
    },
  ];

  db.vendor_dashboard_users = [
    {
      id: "vdu-a", vendor_id: VENDOR_A, user_id: AUTH_USER_A, phone: PHONE_A, email: EMAIL_A,
      role: "owner", status: "active", phone_verified: false, whatsapp_otp_enabled: false,
      last_login_method: null, last_login_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: "vdu-b", vendor_id: VENDOR_B, user_id: AUTH_USER_B, phone: "+918800000002", email: "owner-b@example.com",
      role: "owner", status: "active", phone_verified: false, whatsapp_otp_enabled: false,
      last_login_method: null, last_login_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ];

  db.auth_security_events = [];
}

/** Models the user_id FK: ON DELETE SET NULL (never cascades into the vendor). */
function deleteAuthUser(userId) {
  db.auth_users = db.auth_users.filter((u) => u.id !== userId);
  for (const row of db.vendor_dashboard_users) {
    if (row.user_id === userId) row.user_id = null;
  }
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
  insert(row) { this.action = "insert"; this.actionData = row; return this; }
  update(patch) { this.action = "update"; this.actionData = patch; return this; }

  async maybeSingle() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : [data];
    // Real PostgREST: maybeSingle() errors when more than one row matches.
    if (rows.length > 1) {
      return { data: null, error: { code: "PGRST116", message: "multiple (or no) rows returned" } };
    }
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
      const supplied = Object.fromEntries(Object.entries(this.actionData).filter(([, v]) => v !== undefined));
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...supplied };
      const violation = findUniqueViolation(this.table, row, db[this.table]);
      if (violation) return { data: null, error: violation };
      db[this.table].push(row);
      return { data: [row], error: null };
    }

    if (this.action === "update") {
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

// ----------------------------------------------------------------------------
// Fake Supabase Auth client (request-scoped SSR client stand-in)
// ----------------------------------------------------------------------------
function fakeAuthClient() {
  return {
    from: (table) => new MockQueryBuilder(table),
    auth: {
      async signInWithPassword(credentials) {
        signInCalls.push(credentials);
        const user = db.auth_users.find(
          (u) =>
            ((credentials.email && u.email === credentials.email) ||
              (credentials.phone && u.phone === credentials.phone)) &&
            u.password === credentials.password
        );
        if (!user) {
          return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
        }
        currentSessionUserId = user.id;
        return { data: { user: { id: user.id }, session: { access_token: "supabase-managed" } }, error: null };
      },
      async getUser() {
        if (!currentSessionUserId) return { data: { user: null }, error: { message: "no session" } };
        return { data: { user: { id: currentSessionUserId } }, error: null };
      },
      async signOut() {
        signOutCalls += 1;
        currentSessionUserId = null;
        return { error: null };
      },
    },
  };
}

resetDb();

const requireFromBuild = createRequire(`${outDir}/`);
const supabaseMod = requireFromBuild("./lib/supabase.js");
supabaseMod.adminClient = () => ({ from: (table) => new MockQueryBuilder(table) });
supabaseMod.serverClient = async () => fakeAuthClient();

const AccessService = requireFromBuild("./services/vendorAccessService.js");
const AuthService = requireFromBuild("./services/vendorAuthService.js");
const EventService = requireFromBuild("./services/authSecurityEventService.js");
const VendorAccessMod = requireFromBuild("./lib/identity/vendorAccess.js");
const IdentifierMod = requireFromBuild("./lib/identity/vendorLoginIdentifier.js");
const AuthEventMod = requireFromBuild("./lib/identity/authSecurityEvent.js");

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function signIn(userId) { currentSessionUserId = userId; }
function events() { return db.auth_security_events; }
function lastEvent() { return db.auth_security_events[db.auth_security_events.length - 1]; }

// ----------------------------------------------------------------------------
// RLS model — mirrors the migration's grants + policies exactly.
// The static SQL checks below assert the migration really declares this model.
// ----------------------------------------------------------------------------
const RLS = {
  table: "vendor_dashboard_users",
  grants: {
    anon: [],                                   // revoke all ... from anon
    authenticated: ["select"],                  // grant select only
    service_role: ["select", "insert", "update"],
  },
  bypassRls: ["service_role"],
  policies: [
    {
      name: "vendor_dashboard_users self read",
      cmd: "select",
      role: "authenticated",
      using: (row, ctx) => ctx.uid !== null && ctx.uid === row.user_id,
    },
    {
      name: "vendor_dashboard_users admin read",
      cmd: "select",
      role: "authenticated",
      using: (_row, ctx) => ctx.isAdmin === true,
    },
  ],
};

function rlsSelect(role, ctx, rows) {
  if (!(RLS.grants[role] ?? []).includes("select")) return { denied: "no_grant", rows: [] };
  if (RLS.bypassRls.includes(role)) return { denied: null, rows };
  const applicable = RLS.policies.filter((p) => p.cmd === "select" && p.role === role);
  if (applicable.length === 0) return { denied: "no_policy", rows: [] };
  return { denied: null, rows: rows.filter((r) => applicable.some((p) => p.using(r, ctx))) };
}

function rlsWrite(role, cmd) {
  if (!(RLS.grants[role] ?? []).includes(cmd)) return { denied: "no_grant" };
  if (RLS.bypassRls.includes(role)) return { denied: null };
  const applicable = RLS.policies.filter((p) => p.cmd === cmd && p.role === role);
  if (applicable.length === 0) return { denied: "no_policy" };
  return { denied: null };
}

/** JS translation of the migration's backfill predicate, for behavioural testing. */
function runBackfill() {
  const inserted = [];
  for (const v of db.vendors) {
    if (!v.user_id) continue;
    if (db.vendor_dashboard_users.some((d) => d.vendor_id === v.id)) continue;
    if (db.vendor_dashboard_users.some((d) => d.user_id === v.user_id)) continue;
    if (db.vendors.filter((v2) => v2.user_id === v.user_id).length !== 1) continue;

    const row = {
      id: crypto.randomUUID(), vendor_id: v.id, user_id: v.user_id, phone: v.phone, email: v.email,
      role: "owner", status: "active", phone_verified: false, whatsapp_otp_enabled: false,
      last_login_method: null, last_login_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    // ON CONFLICT DO NOTHING — fail safely, never reassign identity ownership.
    if (findUniqueViolation("vendor_dashboard_users", row, db.vendor_dashboard_users)) continue;
    db.vendor_dashboard_users.push(row);
    inserted.push(row);
  }
  return inserted;
}

// ============================================================================
// 1–3. ACCESS RESOLUTION
// ============================================================================
check("1. valid Supabase-authenticated vendor user resolves the correct VendorAccessContext", async () => {
  resetDb();
  const res = await AccessService.resolveVendorAccess(AUTH_USER_A);
  assert(res.ok === true, `expected access, got ${res.ok ? "" : res.reason}`);
  assert(res.context.authUserId === AUTH_USER_A, "authUserId");
  assert(res.context.vendorId === VENDOR_A, "vendorId comes from the mapping");
  assert(res.context.vendorDashboardUserId === "vdu-a", "vendorDashboardUserId");
  assert(res.context.role === "owner", "role");
  assert(res.context.membershipStatus === "active", "membershipStatus");
});

check("2. missing vendor mapping fails closed", async () => {
  resetDb();
  const res = await AccessService.resolveVendorAccess(AUTH_USER_ORPHAN);
  assert(res.ok === false, "must deny");
  assert(res.reason === "no_vendor_mapping", `expected no_vendor_mapping, got ${res.reason}`);

  const empty = await AccessService.resolveVendorAccess("");
  assert(empty.ok === false && empty.reason === "not_authenticated", "empty user id denied");
});

check("3. inactive vendor dashboard membership fails closed", async () => {
  for (const status of ["suspended", "revoked", "invited", "", "ACTIVE_BUT_WRONG", null]) {
    resetDb();
    db.vendor_dashboard_users[0].status = status;
    const res = await AccessService.resolveVendorAccess(AUTH_USER_A);
    assert(res.ok === false, `status ${JSON.stringify(status)} must deny`);
    assert(res.reason === "membership_not_active", `status ${JSON.stringify(status)}: got ${res.reason}`);
  }
  // Sanity: the exact literal, case/space tolerant, is the only thing that grants.
  resetDb();
  db.vendor_dashboard_users[0].status = " Active ";
  assert((await AccessService.resolveVendorAccess(AUTH_USER_A)).ok === true, "trimmed/cased active grants");
});

check("3b. malformed mapping and missing vendor fail closed", async () => {
  resetDb();
  db.vendor_dashboard_users[0].vendor_id = null;
  assert((await AccessService.resolveVendorAccess(AUTH_USER_A)).reason === "malformed_mapping", "null vendor_id");

  resetDb();
  db.vendors = db.vendors.filter((v) => v.id !== VENDOR_A);
  assert((await AccessService.resolveVendorAccess(AUTH_USER_A)).reason === "vendor_not_found", "vendor row gone");

  // A duplicate non-null user_id that somehow escaped the index must fail closed,
  // never silently pick one of the two vendor businesses.
  resetDb();
  db.vendor_dashboard_users.push({ ...db.vendor_dashboard_users[0], id: "vdu-dup", vendor_id: VENDOR_B });
  assert((await AccessService.resolveVendorAccess(AUTH_USER_A)).reason === "lookup_failed", "duplicate mapping denies");
});

// ============================================================================
// 4–7. BUSINESS STATE MUST NOT AFFECT AUTHENTICATION
// ============================================================================
check("4-7. pending verification / unpaid / zero credits / accepting_leads=false do not invalidate authentication", async () => {
  resetDb();
  const vendor = db.vendors[0];
  // Every hostile business state at once.
  assert(vendor.verification_status === "Pending", "fixture: verification pending");
  assert(vendor.paid_status === "Unpaid", "fixture: unpaid");
  assert(vendor.package_status === "inactive", "fixture: package inactive");
  assert(vendor.remaining_credits === 0, "fixture: zero credits");
  assert(vendor.accepting_leads === false, "fixture: not accepting leads");
  assert(vendor.is_active === false, "fixture: business inactive");

  const res = await AccessService.resolveVendorAccess(AUTH_USER_A);
  assert(res.ok === true, `authentication must survive every business state: ${res.ok ? "" : res.reason}`);
  assert(res.context.vendorId === VENDOR_A, "vendor still resolves");
});

check("4b. the access resolver never reads a business-state column", () => {
  // The resolver function body must not mention ANY excluded column.
  for (const column of VendorAccessMod.BUSINESS_STATE_FIELDS_EXCLUDED_FROM_AUTHENTICATION) {
    assert(!RESOLVE_VENDOR_ACCESS_SRC.includes(column), `resolveVendorAccess must not reference ${column}`);
    assert(!AUTH_SERVICE_SRC.includes(column), `vendorAuthService must not reference ${column}`);
  }

  // Elsewhere in the access service, the two verification flags may appear ONLY as
  // never-inferred insert defaults (`phone_verified: false`), never as a read.
  for (const flag of ["phone_verified", "whatsapp_otp_enabled"]) {
    const occurrences = ACCESS_SERVICE_SRC.match(new RegExp(`${flag}[^,\\n]*`, "g")) ?? [];
    for (const occurrence of occurrences) {
      assert(occurrence.trim() === `${flag}: false`, `${flag} may only be written as false, saw "${occurrence.trim()}"`);
    }
  }
  // The rest of the excluded set must not appear at all.
  for (const column of ["verification_status", "paid_status", "package_status", "remaining_credits", "total_credits", "accepting_leads", "public_visibility"]) {
    assert(!ACCESS_SERVICE_SRC.includes(column), `vendorAccessService must not reference ${column}`);
  }

  assert(VendorAccessMod.VENDOR_IDENTITY_LOOKUP_COLUMNS === "id", "vendors lookup must select existence only");
  assert(/VENDOR_IDENTITY_LOOKUP_COLUMNS/.test(ACCESS_SERVICE_SRC), "resolver must use the constrained column list");
  assert(/MAPPING_COLUMNS = "id, vendor_id, user_id, role, status"/.test(ACCESS_SERVICE_SRC),
    "the mapping select list must carry no business state");
});

// ============================================================================
// 8–9. UNTRUSTED vendor_id
// ============================================================================
check("8. a client-supplied vendor_id cannot override the mapped vendorId", async () => {
  resetDb();
  signIn(AUTH_USER_A);

  const scoped = await AccessService.requireVendorScope(VENDOR_A);
  assert(scoped.ok === true, "own vendor id validates");
  assert(scoped.data.vendorId === VENDOR_A, "canonical vendorId returned from the mapping");

  // The guard returns the mapping's vendorId, never the caller's argument.
  const ctx = { authUserId: AUTH_USER_A, vendorDashboardUserId: "vdu-a", vendorId: VENDOR_A, role: "owner", membershipStatus: "active" };
  assert(VendorAccessMod.vendorScopeMatches(ctx, VENDOR_B) === false, "foreign id never matches");
  assert(VendorAccessMod.vendorScopeMatches(ctx, "") === false, "empty id never matches");
  assert(VendorAccessMod.vendorScopeMatches(ctx, null) === false, "null id never matches");
  assert(VendorAccessMod.vendorScopeMatches(ctx, undefined) === false, "undefined id never matches");
});

check("9. cross-vendor access attempt is denied", async () => {
  resetDb();
  signIn(AUTH_USER_A);
  const res = await AccessService.requireVendorScope(VENDOR_B);
  assert(res.ok === false, "vendor A must not reach vendor B");
  assert(res.code === "UNAUTHORIZED", `generic denial expected, got ${res.code}`);

  signIn(null);
  const anon = await AccessService.requireVendorAccess();
  assert(anon.ok === false && anon.code === "UNAUTHORIZED", "unauthenticated denied");
});

check("9b. resolveCurrentVendorAccess trusts only Supabase Auth", async () => {
  resetDb();
  signIn(AUTH_USER_A);
  const res = await AccessService.resolveCurrentVendorAccess();
  assert(res.ok === true && res.context.vendorId === VENDOR_A, "session user resolves");

  signIn(null);
  const none = await AccessService.resolveCurrentVendorAccess();
  assert(none.ok === false && none.reason === "not_authenticated", "no session → not_authenticated");

  assert(/auth\.getUser\(\)/.test(ACCESS_SERVICE_SRC), "must validate via supabase.auth.getUser()");
  assert(!/jwt|decode|jose|jsonwebtoken/i.test(ACCESS_SERVICE_SRC), "must not decode a custom JWT");
});

// ============================================================================
// 10–13. PASSWORD LOGIN
// ============================================================================
check("10. valid email/password auth path resolves the mapping", async () => {
  resetDb();
  const res = await AuthService.vendorPasswordLogin({ identifier: `  ${EMAIL_A.toUpperCase()} `, password: PASSWORD_A });
  assert(res.ok === true, `login should succeed: ${res.ok ? "" : res.code}`);
  assert(res.data.vendorId === VENDOR_A, "vendorId from mapping");
  assert(res.data.authUserId === AUTH_USER_A, "authUserId");
  assert(res.data.identifierKind === "email", "email identifier");
  assert(signInCalls[0].email === EMAIL_A, `email canonicalized to lowercase/trimmed, got ${signInCalls[0].email}`);
  assert(signOutCalls === 0, "a valid session is kept");
});

check("11. valid international phone/password path canonicalizes to E.164", async () => {
  resetDb();
  const res = await AuthService.vendorPasswordLogin({ identifier: "+91 98765-43210", password: PASSWORD_A });
  assert(res.ok === true, `phone login should succeed: ${res.ok ? "" : res.code}`);
  assert(res.data.identifierKind === "phone", "phone identifier");
  assert(signInCalls[0].phone === "+919876543210", `E.164 expected, got ${signInCalls[0].phone}`);
  assert(signInCalls[0].email === undefined, "phone login must not send an email field");

  // Equivalent formats reach Supabase Auth identically.
  for (const format of ["+919876543210", "0091 98765 43210", "+91 (98765) 43210"]) {
    resetDb();
    await AuthService.vendorPasswordLogin({ identifier: format, password: PASSWORD_A });
    assert(signInCalls[0].phone === "+919876543210", `${format} → +919876543210`);
  }
});

check("12. ambiguous local phone login identifier is rejected, never country-guessed", async () => {
  resetDb();
  const res = await AuthService.vendorPasswordLogin({ identifier: "9876543210", password: PASSWORD_A });
  assert(res.ok === false, "bare national number must be refused");
  assert(res.code === AuthService.VENDOR_LOGIN_FAILED_CODE, "generic failure code");
  assert(signInCalls.length === 0, "Supabase Auth must never be called with a guessed country code");

  assert(events().length === 1, "one audit row");
  assert(lastEvent().metadata.failure_classification === "invalid_login_identifier", "classified");
  assert(lastEvent().destination_hash === null, "an uncanonicalizable identifier contributes no hash");

  const normalized = IdentifierMod.normalizeVendorLoginIdentifier("9876543210");
  assert(normalized.ok === false && normalized.code === "LOGIN_IDENTIFIER_AMBIGUOUS_LOCAL_PHONE", "explicit code");
});

check("13. every failed login returns one indistinguishable generic error", async () => {
  const failures = [];

  resetDb();
  failures.push(await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: "wrong-password" }));

  resetDb();
  failures.push(await AuthService.vendorPasswordLogin({ identifier: "nobody@example.com", password: "x" }));

  resetDb();
  failures.push(await AuthService.vendorPasswordLogin({ identifier: "orphan@example.com", password: "pw-orphan" }));

  resetDb();
  db.vendor_dashboard_users[0].status = "suspended";
  failures.push(await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: PASSWORD_A }));

  resetDb();
  failures.push(await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: "" }));

  resetDb();
  failures.push(await AuthService.vendorPasswordLogin({ identifier: "9876543210", password: PASSWORD_A }));

  for (const f of failures) assert(f.ok === false, "all must fail");
  const codes = new Set(failures.map((f) => f.code));
  const messages = new Set(failures.map((f) => f.error));
  assert(codes.size === 1, `one public code only, got ${[...codes].join(", ")}`);
  assert(messages.size === 1, `one public message only, got ${[...messages].join(" | ")}`);
  assert([...codes][0] === "VENDOR_LOGIN_FAILED", "stable public code");
  // Nothing about which of email/phone/vendor/mapping/password was at fault.
  const publicText = [...messages][0].toLowerCase();
  for (const leak of ["email", "phone", "vendor", "mapping", "suspend", "exist", "not found"]) {
    assert(!publicText.includes(leak), `public message leaks "${leak}"`);
  }
});

// ============================================================================
// 14–18. AUDIT INTEGRATION
// ============================================================================
check("14. failed login audit contains no raw password", async () => {
  resetDb();
  await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: PASSWORD_A + "-nope" });
  const serialized = JSON.stringify(events());
  assert(events().length === 1, "one audit row");
  assert(!serialized.includes(PASSWORD_A), "password must never be persisted");
  assert(!serialized.includes("nope"), "no password fragment persisted");
  assert(!/password"\s*:/.test(serialized) || serialized.includes('"login_method":"password"'),
    "only the login METHOD may be named 'password'");
});

check("15. failed login audit contains no raw identifier", async () => {
  resetDb();
  await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: "wrong" });
  let serialized = JSON.stringify(events());
  assert(!serialized.includes(EMAIL_A), "raw email must never be persisted");
  assert(!serialized.includes("example.com"), "no email domain persisted");

  resetDb();
  await AuthService.vendorPasswordLogin({ identifier: PHONE_A, password: "wrong" });
  serialized = JSON.stringify(events());
  assert(!serialized.includes(PHONE_A), "raw phone must never be persisted");
  assert(!serialized.includes("9876543210"), "no phone digits persisted");

  // The persistence path itself refuses a raw identifier, whatever the caller does.
  resetDb();
  const rejectedHash = await EventService.recordAuthSecurityEvent({
    eventType: "vendor.login_failed", destinationHash: EMAIL_A,
  });
  assert(rejectedHash.ok === false && rejectedHash.code === "AUTH_SECURITY_EVENT_DESTINATION_NOT_HASHED",
    `raw destination must be rejected, got ${rejectedHash.code}`);

  const rejectedMeta = await EventService.recordAuthSecurityEvent({
    eventType: "vendor.login_failed", metadata: { typed_value: "vendor@example.com" },
  });
  assert(rejectedMeta.ok === false && rejectedMeta.code === "AUTH_SECURITY_EVENT_RAW_IDENTIFIER_FORBIDDEN",
    `identifier-shaped metadata must be rejected, got ${rejectedMeta.code}`);

  const rejectedPhoneMeta = await EventService.recordAuthSecurityEvent({
    eventType: "vendor.login_failed", metadata: { nested: { at: "+919876543210" } },
  });
  assert(rejectedPhoneMeta.ok === false, "E.164-shaped metadata must be rejected");
  assert(events().length === 0, "none of the rejected events were written");
});

check("16. failed login identifier hash is deterministic and non-reversible", () => {
  const variants = ["+919876543210", "+91 98765 43210", "+91-98765-43210", "0091 98765 43210"];
  const hashes = variants.map((v) => IdentifierMod.hashRawVendorLoginIdentifier(v));
  assert(new Set(hashes).size === 1, `equivalent phones must hash identically: ${JSON.stringify(hashes)}`);

  const emails = [EMAIL_A, ` ${EMAIL_A.toUpperCase()} `, EMAIL_A.replace("owner", "OWNER")];
  const emailHashes = emails.map((v) => IdentifierMod.hashRawVendorLoginIdentifier(v));
  assert(new Set(emailHashes).size === 1, "equivalent emails must hash identically");

  assert(hashes[0] !== emailHashes[0], "different identifiers hash differently");
  assert(/^[a-f0-9]{64}$/.test(hashes[0]), "sha-256 hex digest");
  assert(!hashes[0].includes("9876543210"), "hash is not reversible by inspection");
  assert(IdentifierMod.hashRawVendorLoginIdentifier("9876543210") === null, "invalid identifier yields no hash");

  // A phone identifier hash equals the Phase 5B destination_hash for the same
  // number, so audit rows correlate across phases.
  const phase5bHash = crypto.createHash("sha256").update("+919876543210").digest("hex");
  assert(hashes[0] === phase5bHash, "phone hash must match Phase 5B destination_hash");
});

check("17. successful login records vendor.login_success", async () => {
  resetDb();
  const res = await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: PASSWORD_A });
  assert(res.ok === true, "login ok");
  assert(res.data.auditRecorded === true, "audit written");

  assert(events().length === 1, `one event, got ${events().length}`);
  const e = lastEvent();
  assert(e.event_type === AuthEventMod.AuthSecurityEventType.VENDOR_LOGIN_SUCCESS, `got ${e.event_type}`);
  assert(e.event_type === "vendor.login_success", "Phase 5A vocabulary reused");
  assert(e.principal_type === "vendor", "principal type");
  assert(e.principal_id === VENDOR_A, "principal id is the vendor business");
  assert(e.actor_user_id === AUTH_USER_A, "actor user id");
  assert(e.metadata.login_method === "password", "login method");
  assert(e.destination_hash === IdentifierMod.hashRawVendorLoginIdentifier(EMAIL_A), "hashed identifier");
});

check("18. failed login records vendor.login_failed", async () => {
  resetDb();
  await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: "wrong" });
  const e = lastEvent();
  assert(e.event_type === AuthEventMod.AuthSecurityEventType.VENDOR_LOGIN_FAILED, `got ${e.event_type}`);
  assert(e.event_type === "vendor.login_failed", "Phase 5A vocabulary reused");
  assert(e.actor_user_id === null, "unauthenticated failure has no actor");
  assert(e.metadata.failure_classification === "authentication_rejected", "internal classification retained");
  assert(e.destination_hash === IdentifierMod.hashRawVendorLoginIdentifier(EMAIL_A), "hash for correlation");

  // The Phase 5A table is the ONLY security-event store.
  assert(/auth_security_events/.test(EVENT_SERVICE_SRC), "writes auth_security_events");
  assert(/sanitizeAuthSecurityMetadata/.test(EVENT_SERVICE_SRC), "reuses Phase 5A sanitization");
});

// ============================================================================
// 19–21. LOGIN SIDE EFFECTS
// ============================================================================
check("19-20. successful login stamps last_login_at and last_login_method=password", async () => {
  resetDb();
  const before = db.vendor_dashboard_users[0];
  assert(before.last_login_at === null && before.last_login_method === null, "fixture clean");

  await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: PASSWORD_A });

  const after = db.vendor_dashboard_users.find((r) => r.id === "vdu-a");
  assert(after.last_login_method === "password", `expected password, got ${after.last_login_method}`);
  assert(typeof after.last_login_at === "string" && !Number.isNaN(Date.parse(after.last_login_at)), "last_login_at stamped");
  // Login must not silently promote any other state.
  assert(after.phone_verified === false, "login never marks phone_verified");
  assert(after.whatsapp_otp_enabled === false, "login never enables WhatsApp OTP");
  assert(after.status === "active" && after.role === "owner", "role/status untouched");
});

check("21. authenticated user with no vendor mapping is signed out and denied", async () => {
  resetDb();
  const res = await AuthService.vendorPasswordLogin({ identifier: "orphan@example.com", password: "pw-orphan" });

  assert(res.ok === false && res.code === "VENDOR_LOGIN_FAILED", "generic denial");
  assert(signInCalls.length === 1, "Supabase Auth did authenticate the user");
  assert(signOutCalls === 1, "the newly established session must be invalidated");
  assert(currentSessionUserId === null, "no session survives");

  const e = lastEvent();
  assert(e.event_type === "vendor.login_failed", "failure audited");
  assert(e.actor_user_id === AUTH_USER_ORPHAN, "actor known after authentication");
  assert(e.metadata.failure_classification === "no_vendor_mapping", "internal classification");

  // Same for a suspended membership.
  resetDb();
  db.vendor_dashboard_users[0].status = "suspended";
  const suspended = await AuthService.vendorPasswordLogin({ identifier: EMAIL_A, password: PASSWORD_A });
  assert(suspended.ok === false, "suspended denied");
  assert(signOutCalls === 1, "suspended session invalidated");
  assert(lastEvent().metadata.failure_classification === "membership_not_active", "classification");
});

// ============================================================================
// 22–28. RLS MODEL
// ============================================================================
check("22. RLS allows an authenticated user to read only their own mapping row", () => {
  resetDb();
  const result = rlsSelect("authenticated", { uid: AUTH_USER_A, isAdmin: false }, db.vendor_dashboard_users);
  assert(result.denied === null, "select granted");
  assert(result.rows.length === 1, `only one row visible, got ${result.rows.length}`);
  assert(result.rows[0].user_id === AUTH_USER_A, "own row only");

  // Unclaimed invitations (user_id IS NULL) match nobody.
  db.vendor_dashboard_users.push({ id: "vdu-null", vendor_id: "vendor-c", user_id: null, status: "active", role: "owner" });
  const withNull = rlsSelect("authenticated", { uid: null, isAdmin: false }, db.vendor_dashboard_users);
  assert(withNull.rows.length === 0, "auth.uid() null must never match a null user_id row");

  const admin = rlsSelect("authenticated", { uid: AUTH_USER_ADMIN, isAdmin: true }, db.vendor_dashboard_users);
  assert(admin.rows.length === db.vendor_dashboard_users.length, "admin read via is_admin()");
});

check("23. RLS denies anon entirely", () => {
  resetDb();
  const result = rlsSelect("anon", { uid: null, isAdmin: false }, db.vendor_dashboard_users);
  assert(result.denied === "no_grant", `anon must have no grant, got ${result.denied}`);
  assert(result.rows.length === 0, "anon sees nothing");
  for (const cmd of ["insert", "update", "delete"]) {
    assert(rlsWrite("anon", cmd).denied === "no_grant", `anon must not ${cmd}`);
  }
  assert(normalizedSql.includes("revoke all on public.vendor_dashboard_users from anon;"), "migration revokes anon");
  assert(!/grant[^;]*to anon/.test(normalizedSql), "no grant to anon anywhere");
});

check("24-28. an authenticated vendor cannot modify vendor_id, user_id, role, status, phone_verified (or anything else)", () => {
  for (const cmd of ["insert", "update", "delete"]) {
    const w = rlsWrite("authenticated", cmd);
    assert(w.denied === "no_grant", `authenticated must have no ${cmd} grant, got ${w.denied}`);
  }
  // No column-level path exists, because no UPDATE grant and no UPDATE policy exist.
  for (const column of ["vendor_id", "user_id", "role", "status", "phone_verified", "whatsapp_otp_enabled"]) {
    assert(rlsWrite("authenticated", "update").denied === "no_grant", `cannot update ${column}`);
  }
  assert(!/grant[^;]*insert[^;]*on public\.vendor_dashboard_users to authenticated/.test(normalizedSql), "no authenticated insert grant");
  assert(!/grant[^;]*update[^;]*on public\.vendor_dashboard_users to authenticated/.test(normalizedSql), "no authenticated update grant");
  assert(!/grant[^;]*delete[^;]*on public\.vendor_dashboard_users to authenticated/.test(normalizedSql), "no authenticated delete grant");
  assert(normalizedSql.includes("grant select on public.vendor_dashboard_users to authenticated;"), "select-only grant");
  assert(!/for (insert|update|delete)/.test(normalizedSql), "no write policy on the table");
  assert(!/grant[^;]*delete[^;]*on public\.vendor_dashboard_users to service_role/.test(normalizedSql), "service_role holds no delete grant");
});

check("22b. the migration declares exactly the RLS model this harness simulates", () => {
  assert(normalizedSql.includes("alter table public.vendor_dashboard_users enable row level security;"), "RLS enabled");
  assert(normalizedSql.includes("revoke all on public.vendor_dashboard_users from authenticated;"), "authenticated revoked first");
  assert(normalizedSql.includes("grant select, insert, update on public.vendor_dashboard_users to service_role;"), "service_role grants");
  assert(/create policy "vendor_dashboard_users self read" on public\.vendor_dashboard_users for select to authenticated using \(auth\.uid\(\) is not null and auth\.uid\(\) = user_id\)/.test(normalizedSql),
    "self-read policy must be exactly auth.uid() IS NOT NULL AND auth.uid() = user_id");
  assert(/create policy "vendor_dashboard_users admin read" on public\.vendor_dashboard_users for select to authenticated using \(public\.is_admin\(\)\)/.test(normalizedSql),
    "admin read must use the repository's is_admin() convention");
  assert(!/using \(true\)/.test(normalizedSql), "no broad public-read policy");
});

// ============================================================================
// 29–30. CONSTRAINTS
// ============================================================================
check("29. user_id FK uses ON DELETE SET NULL (auth deletion never removes the vendor)", () => {
  resetDb();
  const vendorsBefore = JSON.stringify(db.vendors);

  deleteAuthUser(AUTH_USER_A);

  const mapping = db.vendor_dashboard_users.find((r) => r.id === "vdu-a");
  assert(mapping, "the mapping row survives");
  assert(mapping.user_id === null, "user_id is set to null, not deleted");
  assert(mapping.vendor_id === VENDOR_A, "vendor link preserved");
  assert(JSON.stringify(db.vendors) === vendorsBefore, "no vendor business was harmed");

  assert(/references auth\.users\(id\) on delete set null/.test(normalizedSql), "FK declares ON DELETE SET NULL");
  assert(!/references auth\.users\(id\) on delete cascade/.test(normalizedSql), "must never cascade from auth.users");
  assert(/references public\.vendors\(id\) on delete cascade/.test(normalizedSql), "existing vendor_id FK behavior preserved");
});

check("30. a duplicate non-null user_id mapping is rejected by the partial unique index", async () => {
  resetDb();
  const { error } = await supabaseMod.adminClient()
    .from("vendor_dashboard_users")
    .insert({ vendor_id: VENDOR_B, user_id: AUTH_USER_A, phone: "+918800000009", role: "owner", status: "active" })
    .select("id")
    .single();

  assert(error !== null, "a second mapping for the same auth principal must be rejected");
  assert(error.code === "23505", `expected 23505, got ${error.code}`);
  assert(error.constraint === "uq_vendor_dashboard_users_user_id", `wrong constraint: ${error.constraint}`);
  assert(db.vendor_dashboard_users.length === 2, "no row was inserted");

  // NULL user_id rows never conflict (PostgreSQL NULL-distinct semantics).
  const a = await supabaseMod.adminClient().from("vendor_dashboard_users")
    .insert({ vendor_id: "vendor-c", user_id: null, phone: "+918800000010", role: "owner", status: "active" }).select("id").single();
  const b = await supabaseMod.adminClient().from("vendor_dashboard_users")
    .insert({ vendor_id: "vendor-d", user_id: null, phone: "+918800000011", role: "owner", status: "active" }).select("id").single();
  assert(a.error === null && b.error === null, "multiple unclaimed invitations are allowed");

  assert(/create unique index if not exists uq_vendor_dashboard_users_user_id on public\.vendor_dashboard_users\(user_id\) where user_id is not null/.test(normalizedSql),
    "migration declares the partial unique index");
});

check("30b. linkVendorAuthUser is idempotent and never reassigns identity ownership", async () => {
  resetDb();
  const auth = { adminUserId: AUTH_USER_ADMIN };

  // Idempotent re-link of an existing, matching mapping.
  const same = await AccessService.linkVendorAuthUser(auth, { vendorId: VENDOR_A, authUserId: AUTH_USER_A, role: "owner" });
  assert(same.ok === true && same.data.vendorDashboardUserId === "vdu-a", "existing mapping returned unchanged");
  assert(db.vendor_dashboard_users.length === 2, "no row created");

  // Cross-vendor reassignment must fail closed.
  const cross = await AccessService.linkVendorAuthUser(auth, { vendorId: VENDOR_B, authUserId: AUTH_USER_A, role: "owner" });
  assert(cross.ok === false && cross.code === "CROSS_VENDOR_LINK_CONFLICT", `got ${cross.code}`);
  assert(db.vendor_dashboard_users.find((r) => r.id === "vdu-a").vendor_id === VENDOR_A, "ownership untouched");

  // Fresh link: never marks verification, never touches vendors.
  resetDb();
  db.vendor_dashboard_users = [];
  const vendorsBefore = JSON.stringify(db.vendors);
  const fresh = await AccessService.linkVendorAuthUser(auth, {
    vendorId: VENDOR_A, authUserId: AUTH_USER_A, phone: "+91 98765 43210", email: " Owner-A@Example.com ", role: "owner",
  });
  assert(fresh.ok === true, `fresh link: ${fresh.ok ? "" : fresh.code}`);
  const row = db.vendor_dashboard_users[0];
  assert(row.phone === "+919876543210", "phone canonicalized to E.164");
  assert(row.email === EMAIL_A, "email canonicalized");
  assert(row.phone_verified === false && row.whatsapp_otp_enabled === false, "no verification inferred");
  assert(row.status === "active" && row.role === "owner", "membership defaults");
  assert(JSON.stringify(db.vendors) === vendorsBefore, "vendors table untouched");

  // Ambiguous local phone rejected here too.
  resetDb();
  db.vendor_dashboard_users = [];
  const bad = await AccessService.linkVendorAuthUser(auth, { vendorId: VENDOR_A, authUserId: AUTH_USER_A, phone: "9876543210", role: "owner" });
  assert(bad.ok === false && bad.code === "VENDOR_LINK_INVALID_PHONE", `got ${bad.code}`);
  assert(db.vendor_dashboard_users.length === 0, "no row on invalid phone");

  // Unauthorized callers never reach the write.
  const unauth = await AccessService.linkVendorAuthUser({ adminUserId: "" }, { vendorId: VENDOR_A, authUserId: AUTH_USER_A, role: "owner" });
  assert(unauth.ok === false && unauth.code === "UNAUTHORIZED", "admin authorization required");
});

// ============================================================================
// 31–33. BACKFILL
// ============================================================================
check("31. backfill preserves existing vendors.user_id links", () => {
  resetDb();
  db.vendor_dashboard_users = [];
  const vendorsBefore = JSON.stringify(db.vendors);

  const inserted = runBackfill();

  assert(inserted.length === 2, `both linked vendors backfilled, got ${inserted.length}`);
  assert(JSON.stringify(db.vendors) === vendorsBefore, "vendors.user_id must be preserved, never rewritten");
  const a = db.vendor_dashboard_users.find((r) => r.vendor_id === VENDOR_A);
  assert(a.user_id === AUTH_USER_A, "existing auth link carried across");
  assert(a.role === "owner" && a.status === "active", "owner/active");
  assert(a.last_login_at === null && a.last_login_method === null, "no login inferred");

  // Idempotent.
  const second = runBackfill();
  assert(second.length === 0, "re-running the backfill inserts nothing");
  assert(db.vendor_dashboard_users.length === 2, "still two rows");

  assert(/update public\.vendors/.test(normalizedSql) === false, "the migration must never UPDATE public.vendors");
  assert(/insert into public\.vendor_dashboard_users/.test(normalizedSql), "backfill inserts into the mapping table");
  assert(/on conflict do nothing/.test(normalizedSql), "fails safely on conflict");
});

check("32. backfill does not overwrite an existing dashboard mapping", () => {
  resetDb();
  // Vendor A already has a mapping pointing at a DIFFERENT auth principal.
  db.vendor_dashboard_users = [{
    id: "vdu-existing", vendor_id: VENDOR_A, user_id: AUTH_USER_B, phone: "+918800000002",
    email: "someone@example.com", role: "manager", status: "active",
    phone_verified: true, whatsapp_otp_enabled: true, last_login_method: "password", last_login_at: "2026-07-01T00:00:00Z",
  }];

  runBackfill();

  const rows = db.vendor_dashboard_users.filter((r) => r.vendor_id === VENDOR_A);
  assert(rows.length === 1, "no second mapping created for vendor A");
  assert(rows[0].user_id === AUTH_USER_B, "existing (even mismatched) ownership untouched");
  assert(rows[0].role === "manager", "existing role untouched");
  assert(rows[0].phone_verified === true, "existing verification untouched");

  // Vendor B's principal is already taken by vendor A's row → skipped, not stolen.
  assert(!db.vendor_dashboard_users.some((r) => r.vendor_id === VENDOR_B), "conflicting user_id skipped");

  assert(/not exists \( select 1 from public\.vendor_dashboard_users d where d\.vendor_id = v\.id \)/.test(normalizedSql), "vendor guard present");
  assert(/not exists \( select 1 from public\.vendor_dashboard_users d where d\.user_id = v\.user_id \)/.test(normalizedSql), "user guard present");
  assert(/select count\(\*\) from public\.vendors v2 where v2\.user_id = v\.user_id \) = 1/.test(normalizedSql), "ambiguity guard present");
});

check("32b. two vendors sharing one auth principal are both skipped, never arbitrated", () => {
  resetDb();
  db.vendor_dashboard_users = [];
  db.vendors[1].user_id = AUTH_USER_A;  // both vendors now claim the same principal

  const inserted = runBackfill();
  assert(inserted.length === 0, "an ambiguous claim must never pick a winner");
  assert(db.vendor_dashboard_users.length === 0, "no mapping created");
});

check("33. backfill never marks phone_verified or infers WhatsApp/paid/business state", () => {
  resetDb();
  db.vendor_dashboard_users = [];
  runBackfill();

  for (const row of db.vendor_dashboard_users) {
    assert(row.phone_verified === false, "phone_verified must never be inferred from a phone number");
    assert(row.whatsapp_otp_enabled === false, "whatsapp_otp_enabled must never be inferred");
  }
  // Vendor A is unpaid + unverified + zero credits and still received a mapping.
  const a = db.vendor_dashboard_users.find((r) => r.vendor_id === VENDOR_A);
  assert(a, "unverified, unpaid vendor still gets an authentication mapping");

  const backfillBlock = normalizedSql.slice(
    normalizedSql.indexOf("insert into public.vendor_dashboard_users"),
    normalizedSql.indexOf("on conflict do nothing")
  );
  assert(!/verification_status|paid_status|package_status|remaining_credits|accepting_leads/.test(backfillBlock),
    "the backfill must not read any business-state column");
  assert(!/true/.test(backfillBlock), "the backfill must not set any boolean to true");
});

// ============================================================================
// 34–36. STATE SEPARATION
// ============================================================================
check("34-36. WhatsApp verification, business verification, and paid status remain separate from login", async () => {
  resetDb();

  // WhatsApp verification: unverified phone must still authenticate.
  db.vendor_dashboard_users[0].phone_verified = false;
  db.vendor_dashboard_users[0].whatsapp_otp_enabled = false;
  assert((await AccessService.resolveVendorAccess(AUTH_USER_A)).ok === true, "unverified WhatsApp still authenticates");

  // ...and a verified phone grants nothing extra on its own.
  resetDb();
  db.vendor_dashboard_users[0].phone_verified = true;
  db.vendor_dashboard_users[0].status = "suspended";
  const res = await AccessService.resolveVendorAccess(AUTH_USER_A);
  assert(res.ok === false && res.reason === "membership_not_active",
    "phone_verified must never substitute for an active membership");

  // Business verification / paid status are never consulted.
  assert(!ACCESS_SERVICE_SRC.includes("verification_status"), "business verification not consulted");
  assert(!ACCESS_SERVICE_SRC.includes("paid_status"), "paid status not consulted");
  assert(!ACCESS_SERVICE_SRC.includes("phone_verified") || /phone_verified: false/.test(ACCESS_SERVICE_SRC),
    "phone_verified appears only as a never-inferred insert default");
  assert(!/phone_verified|whatsapp_otp_enabled/.test(AUTH_SERVICE_SRC), "login never touches WhatsApp verification");

  // The exclusion list is the documented contract.
  const excluded = VendorAccessMod.BUSINESS_STATE_FIELDS_EXCLUDED_FROM_AUTHENTICATION;
  for (const f of ["verification_status", "paid_status", "package_status", "remaining_credits", "accepting_leads", "phone_verified", "whatsapp_otp_enabled"]) {
    assert(excluded.includes(f), `${f} must be documented as excluded from authentication`);
  }
});

// ============================================================================
// 37–40. SCOPE + COMPATIBILITY
// ============================================================================
check("37. no credential column is created", () => {
  assert(!/password/i.test(strippedSql), "the migration must declare no password column (comments excluded)");
  assert(!/\b(password|passwd|password_hash|secret|token|session_token|refresh_token)\b\s+(text|varchar|bytea|char|uuid)/i.test(strippedSql),
    "no credential-shaped column");
  assert(!/\botp\b/i.test(strippedSql), "no OTP column");
});

check("38. no custom JWT or custom session system is introduced", () => {
  for (const banned of ["jsonwebtoken", "jose", "jwt.sign", "jwt.verify", "createSession", "sessionToken", "session_token", "setSessionCookie"]) {
    assert(!ALL_NEW_SERVICE_SRC.includes(banned), `Phase 5C must not use ${banned}`);
  }
  // Supabase Auth remains the only session authority.
  assert(/serverClient\(\)/.test(AUTH_SERVICE_SRC), "uses the request-scoped SSR auth client");
  assert(/auth\.signInWithPassword/.test(AUTH_SERVICE_SRC), "authenticates through Supabase Auth");
  assert(/auth\.signOut/.test(AUTH_SERVICE_SRC), "invalidates through Supabase Auth");
  // Service-role sign-in would bypass the request's auth context entirely.
  assert(!/adminClient\(\)\s*\.\s*auth/.test(ALL_NEW_SERVICE_SRC), "must never use adminClient().auth");
  assert(!/adminClient[\s\S]{0,80}signInWithPassword/.test(ALL_NEW_SERVICE_SRC), "must never sign in with the service role");
  assert(!/cookies\(\)/.test(ALL_NEW_SERVICE_SRC), "must not create a second session cookie");
});

check("39. no Phase 5B communication automation becomes active", () => {
  assert(!/communication_automation_catalog|communication_messages|communication_templates/.test(rawSql),
    "the Phase 5C migration must not touch Phase 5B communication tables");
  assert(!/communication/i.test(AUTH_SERVICE_SRC.replace(/from "\.\.\/lib\/communication\/[a-zA-Z]+"/g, "")),
    "vendor login requires no WhatsApp transport");

  // Phase 5B seed state is unchanged: everything wiring_pending + disabled.
  const b = PHASE_5B_MIGRATION.toLowerCase().replace(/\s+/g, " ");
  assert(b.includes("is_operationally_enabled boolean not null default false"), "5B enablement still defaults false");
  assert(b.includes("readiness_status text not null default 'wiring_pending'"), "5B readiness still wiring_pending");
  const seed = PHASE_5B_MIGRATION.match(/insert into public\.communication_automation_catalog[\s\S]*?on conflict/i);
  assert(seed && (seed[0].match(/'wiring_pending'/g) ?? []).length === 16, "all 16 automations remain wiring_pending");
  assert(seed && !/'active'/.test(seed[0]), "no automation seeded as active");
});

check("40. Phase 5A and Phase 5B schema contracts remain compatible", () => {
  // Phase 5C touches no Phase 5A/5B object.
  for (const table of ["client_accounts", "verification_challenges", "password_reset_grants",
                       "communication_messages", "communication_delivery_events", "communication_webhook_receipts"]) {
    assert(!rawSql.includes(table), `Phase 5C must not reference ${table}`);
  }
  // `drop policy if exists` is the sanctioned idempotent replacement idiom; a drop
  // of any OBJECT is not. Comments are excluded — this inspects SQL, not prose.
  assert(!/alter table public\.auth_security_events/i.test(strippedSql), "no alteration of Phase 5A objects");
  assert(!/drop\s+(table|column|index|constraint|function|schema|type|trigger)/i.test(strippedSql),
    "no object drop of any kind");

  // Every column this phase writes to auth_security_events exists in the 5A migration.
  for (const column of ["event_type", "principal_type", "principal_id", "actor_user_id", "purpose", "correlation_id", "destination_hash", "metadata"]) {
    assert(PHASE_5A_MIGRATION.includes(column), `Phase 5A must define auth_security_events.${column}`);
    assert(EVENT_SERVICE_SRC.includes(column), `event service must write ${column}`);
  }
  // Phase 5A grants service_role SELECT + INSERT only — we never update/delete.
  assert(/grant select, insert on public\.auth_security_events to service_role;/.test(PHASE_5A_MIGRATION), "5A append-only grant");
  assert(!/auth_security_events[\s\S]{0,120}\.update\(|auth_security_events[\s\S]{0,120}\.delete\(/.test(EVENT_SERVICE_SRC),
    "the event service must be append-only");

  // Phase 5C reuses the Phase 5B canonical E.164 normalization rather than a copy.
  assert(/from "\.\.\/communication\/phone"/.test(readCode("lib/identity/vendorLoginIdentifier.ts")),
    "phone canonicalization must reuse the Phase 5B helper");
  assert(AuthEventMod.isAuthSecurityEventType("vendor.login_success"), "5A event vocabulary intact");
  assert(AuthEventMod.isAuthSecurityEventType("vendor.login_failed"), "5A event vocabulary intact");
});

check("40b. migration is additive, idempotent, and non-destructive", () => {
  assert(!/drop table|drop column|truncate|delete from/i.test(strippedSql), "no destructive statement");
  assert(/create table if not exists public\.vendor_dashboard_users/.test(normalizedSql), "table create is guarded");
  assert(/create unique index if not exists/.test(normalizedSql), "index create is guarded");
  assert(/add column if not exists/.test(normalizedSql), "column adds are guarded");
  assert(/drop policy if exists/.test(normalizedSql), "policy replacement is guarded");
  // Only the FK add is unguarded by IF NOT EXISTS — it is wrapped in a DO block.
  assert(/do \$\$/.test(normalizedSql) && /if not exists \( select 1 from pg_constraint/.test(normalizedSql),
    "the FK add must be idempotent via pg_constraint lookup");
  // No production apply command in executable SQL or service code. (The migration
  // header comment names these commands precisely to forbid them.)
  assert(!/supabase\s+(db\s+push|migration\s+up|migration\s+repair|link)/i.test(strippedSql + ALL_NEW_SERVICE_SRC),
    "no production apply command");
});

check("40c. package.json wires test:phase5c without disturbing older harnesses", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase5c"] === "node scripts/phase5c-vendor-auth-harness.mjs", "test:phase5c wired");
  for (const s of ["test:phase3a", "test:phase3b:aos", "test:phase4a", "test:phase4b1", "test:phase4b2", "test:phase5a", "test:phase5b"]) {
    assert(typeof pkg.scripts[s] === "string", `${s} must remain available`);
  }
  assert(existsSync("docs/QF-Vendor-Authentication-Foundation-Phase-5C.md"), "Phase 5C doc exists");
});

// ============================================================================
// EXECUTE
// ============================================================================
async function runAll() {
  let passed = 0;
  let failed = 0;
  console.log("Running Phase 5C Vendor Authentication Foundation checks...\n");

  for (const c of checks) {
    try {
      await c.fn();
      console.log(`PASS ${c.name}`);
      passed++;
    } catch (e) {
      console.log(`FAIL ${c.name}`);
      console.error(e);
      failed++;
    }
  }

  rmSync(outDir, { recursive: true, force: true });

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
