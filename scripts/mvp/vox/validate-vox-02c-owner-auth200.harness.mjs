// ============================================================================
// VOX P0-1 — synthetic authenticated Owner HTTP 200 harness.
//
// Runs the REAL app/api/vox/v1/overview/route.ts GET handler and the REAL
// services/vox/verifiedStaffBearer.ts in-process, with ONLY the Supabase network
// boundary replaced by a deterministic fixture (fixtures/vox-overview-supabase-fixture.mjs)
// via a test-only ESM loader (fixtures/vox-overview-auth200.loader.mjs).
//
// What runs for real (NO bypass in production code):
//   - header Bearer parsing + JWT shape/length checks
//   - verifySupabaseBearerUser -> fixture auth.getUser(token)
//   - AAL2 claim check, exp/iat window, non-anonymous
//   - profiles role=admin & is_active, app_metadata.admin_role=Superadmin
//   - the four bounded data reads + projectVoxOverview projection
//
// Asserts: authenticated Owner => 200 + strict qf.vox.overview.v1 projection,
// no-PII, actionsEnabled=false; AND preserves negative paths (401 anon, 401 bogus,
// 401 AAL1, 405 POST/PUT/DELETE); AND cross-checks the captured live queries
// against the managed-schema fixture (priority present, topic absent).
//
// Executable with: node scripts/mvp/vox/validate-vox-02c-owner-auth200.harness.mjs
// (requires the pinned `typescript` dependency to be installed; it transpiles the
//  real .ts route/bearer exactly as the repo MVP loader does.)
// ============================================================================
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const schema = JSON.parse(readFileSync(resolve(HERE, "fixtures", "vox-overview-managed-schema.json"), "utf8"));

// Dummy env so lib/supabase.ts requiredEnv() passes; values go only to the fixture.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://fixture.supabase.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "fixture-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "fixture-service-role-key";

register("./fixtures/vox-overview-auth200.loader.mjs", import.meta.url);

const fixture = await import("./fixtures/vox-overview-supabase-fixture.mjs");
const route = await import("@/app/api/vox/v1/overview/route.ts");

const now = Math.floor(Date.now() / 1000);
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
function makeToken(payload) {
  // header . payload . signature — padded so the whole token > 100 chars and
  // matches the route's JWT shape regex (base64url charset only).
  return ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", b64url(payload), "s".repeat(64)].join(".");
}
const goodToken = makeToken({ sub: fixture.SYNTHETIC_OWNER.id, aal: "aal2", exp: now + 3600, iat: now - 1, is_anonymous: false });
const aal1Token = makeToken({ sub: fixture.SYNTHETIC_OWNER.id, aal: "aal1", exp: now + 3600, iat: now - 1, is_anonymous: false });

const url = "https://core.local/api/vox/v1/overview";
const req = (headers) => new Request(url, { headers });

let n = 0;
async function test(name, fn) { await fn(); n++; console.log("PASS " + name); }

// ---- Positive: synthetic authenticated Owner at AAL2 => 200 --------------
let capturedQueries = null;
await test("authenticated Owner AAL2 returns HTTP 200 with strict qf.vox.overview.v1", async () => {
  fixture.QUERY_LOG.length = 0;
  const res = await route.GET(req({ authorization: "Bearer " + goodToken }));
  assert.equal(res.status, 200, "expected 200 for valid Owner");
  assert.equal(res.headers.get("cache-control")?.includes("no-store"), true, "must be no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", "must be nosniff");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.view.schema, "qf.vox.overview.v1");
  assert.equal(body.view.source, "quickfurno-core");
  assert.equal(body.view.actionsEnabled, false);
  assert.deepEqual(body.view.permissions, ["OWNER_READ_ONLY"]);
  for (const k of ["prospectPreview", "vendorCrmPreview", "supportPreview", "humanDeskPreview"]) {
    assert.ok(Array.isArray(body.view[k]), `${k} must be an array`);
    assert.ok(body.view[k].length <= 8, `${k} must be bounded to 8`);
  }
  const support = body.view.supportPreview[0];
  assert.ok(support && "priority" in support, "support preview must carry priority");
  assert.ok(!("topic" in support), "support preview must NOT carry topic");
  assert.equal(support.priority, "normal", "priority value projected from fixture row");
  capturedQueries = fixture.QUERY_LOG.map((q) => ({ ...q, filters: [...q.filters] }));
});

// ---- Captured live queries match the managed-schema contract -------------
await test("captured live queries match managed-schema expectedQueries exactly", async () => {
  assert.equal(capturedQueries.length, 4, `expected 4 data reads, captured ${capturedQueries.length}`);
  for (const expected of schema.expectedQueries) {
    const actual = capturedQueries.find((q) => q.table === expected.table);
    assert.ok(actual, `no captured query for ${expected.table}`);
    assert.deepEqual(actual.select.split(",").map((s) => s.trim()), expected.select, `${expected.table}: select mismatch`);
    assert.deepEqual(actual.order, expected.order, `${expected.table}: order mismatch`);
    assert.deepEqual(actual.filters, expected.filters, `${expected.table}: filters mismatch`);
    assert.equal(actual.limit, expected.limit, `${expected.table}: limit mismatch`);
  }
  const support = capturedQueries.find((q) => q.table === "vendor_support_threads");
  assert.ok(support.select.includes("priority") && !support.select.includes("topic"), "support must read priority, never topic");
});

// ---- Negatives preserved -------------------------------------------------
await test("anonymous (no Authorization) returns 401", async () => {
  const res = await route.GET(req({}));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "UNAUTHORIZED");
});

await test("malformed bearer returns 401", async () => {
  const res = await route.GET(req({ authorization: "Bearer invalid.invalid.invalid" }));
  assert.equal(res.status, 401);
});

await test("valid user but AAL1 (not AAL2) returns 401", async () => {
  const res = await route.GET(req({ authorization: "Bearer " + aal1Token }));
  assert.equal(res.status, 401);
});

await test("POST/PUT/DELETE return 405 READ_ONLY", async () => {
  for (const verb of ["POST", "PUT", "DELETE"]) {
    const res = route[verb]();
    assert.equal(res.status, 405, `${verb} must be 405`);
    assert.equal((await res.json()).error, "READ_ONLY");
  }
});

console.log("VOX_02C_OWNER_AUTH200_PASS " + n + "/6 (synthetic Owner AAL2 200 + negatives, no prod bypass)");
