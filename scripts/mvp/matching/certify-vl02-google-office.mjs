// VL-02: actual Core admin-office function, with mocked Google/network/DB boundaries.
// No credentials, live API, DB, real vendor, or business effects.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fs.readFileSync(path.join(root, "services/adminVendorLocationService.ts"), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const vendorId = "11111111-1111-4111-8111-111111111111";
const googleId = "ChIJvalidGooglePlace123";
const place = {
  id: googleId,
  formattedAddress: "Verified Google Shop, Pune, Maharashtra, India",
  location: { latitude: 18.55, longitude: 73.93 },
  addressComponents: [
    { longText: "Kharadi", types: ["sublocality_level_1"] },
    { longText: "Pune", types: ["locality"] },
  ],
};
let googleReply = { ok: true, json: async () => place };
let zoneStatus = "verified";
let cityList = [{ name: "Pune", slug: "pune", acceptedCityLabels: ["Pune"], serviceZoneId: "zone-1" }];
let updates = [];
let audits = [];
const env = { GOOGLE_MAPS_PLACES_SERVER_KEY: "test-server-key" };

const normalizeCoordinate = (latitude, longitude) =>
  typeof latitude === "number" && typeof longitude === "number" &&
  Number.isFinite(latitude) && Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
const db = {
  from(table) {
    assert.equal(table, "vendors");
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data: {
                  id: vendorId, business_name: "Fixture",
                  city: "Pune", office_city: "Pune",
                  location_verification_status: "unverified", service_zone_id: null,
                },
                error: null,
              }),
            };
          },
        };
      },
      update(payload) {
        return {
          eq: async (column, id) => {
            assert.equal(column, "id");
            assert.equal(id, vendorId);
            updates.push(payload);
            return { error: null };
          },
        };
      },
    };
  },
};
const mocks = {
  "server-only": {},
  "@/lib/supabase": { adminClient: () => db },
  "@/lib/errors": {
    appError: (code) => Object.assign(new Error(code), { code }),
    fail: (error) => ({ ok: false, code: error.code ?? "UNKNOWN" }),
    ok: (data) => ({ ok: true, data }),
  },
  "@/lib/geo/canonicalCoordinate": { normalizeCoordinate },
  "@/lib/locations/cityService": { getActiveCities: async () => cityList },
  "@/services/locationVerificationService": {
    verifyLocationForServiceArea: async () => ({
      status: zoneStatus, serviceZoneId: zoneStatus === "verified" ? "zone-1" : null,
      method: zoneStatus === "verified" ? "polygon" : "none",
      verifiedAt: "2026-10-13T00:00:00Z",
    }),
  },
  "@/services/adminService": { recordAuditLog: async (...args) => audits.push(args) },
};

const loaded = { exports: {} };
const load = new Function("module", "exports", "require", "fetch", "process", "AbortSignal", code);
load(
  loaded, loaded.exports,
  (name) => {
    if (!(name in mocks)) throw new Error("Unexpected dependency: " + name);
    return mocks[name];
  },
  async () => googleReply,
  { env }, AbortSignal,
);
const backfill = loaded.exports.backfillVendorExactLocation;
const input = {
  google_place_id: googleId,
  google_city: "Pune",
  formatted_address: "Forged browser address",
  latitude: 18.55,
  longitude: 73.93,
  area_normalized: "fake browser locality",
  sublocality: "fake",
  neighborhood: "fake",
};
function reset() {
  updates = [];
  audits = [];
  zoneStatus = "verified";
  cityList = [{ name: "Pune", slug: "pune", acceptedCityLabels: ["Pune"], serviceZoneId: "zone-1" }];
  env.GOOGLE_MAPS_PLACES_SERVER_KEY = "test-server-key";
  googleReply = { ok: true, json: async () => place };
}
let count = 0;
async function check(name, action, expectSuccess) {
  reset();
  await action();
  const result = await backfill(vendorId, input, "fixture-superadmin");
  assert.equal(result.ok, expectSuccess, name);
  assert.equal(updates.length, expectSuccess ? 1 : 0, name + " write isolation");
  assert.equal(audits.length, expectSuccess ? 1 : 0, name + " audit isolation");
  count++;
  console.log("PASS", name);
}

await check("verified Google identity, point, city and zone persist", async () => {}, true);
assert.equal(updates[0].office_latitude, place.location.latitude);
assert.equal(updates[0].formatted_address, place.formattedAddress);
assert.equal(updates[0].google_city, "Pune");
assert.equal(updates[0].area_normalized, "kharadi");
assert.equal(updates[0].service_zone_id, "zone-1");
assert.equal(updates[0].accepting_leads, undefined);
assert.equal(updates[0].remaining_credits, undefined);
await check("missing server Places key fails closed", async () => {
  delete env.GOOGLE_MAPS_PLACES_SERVER_KEY;
}, false);
await check("Google identity mismatch denied", async () => {
  googleReply = { ok: true, json: async () => ({ ...place, id: "another-id" }) };
}, false);
await check("server Google cross-city rejected despite Pune browser hint", async () => {
  googleReply = { ok: true, json: async () => ({
    ...place, addressComponents: [{ longText: "Mumbai", types: ["locality"] }],
  }) };
}, false);
await check("tampered browser coordinates rejected", async () => {
  googleReply = { ok: true, json: async () => ({
    ...place, location: { latitude: 18.61, longitude: 73.93 },
  }) };
}, false);
await check("Google API unavailability fails closed", async () => {
  googleReply = { ok: false, json: async () => ({}) };
}, false);
await check("missing city evidence fails closed", async () => {
  googleReply = { ok: true, json: async () => ({
    ...place, addressComponents: [{ longText: "Kharadi", types: ["sublocality_level_1"] }],
  }) };
}, false);
await check("Core service zone unavailable denies verification", async () => {
  zoneStatus = "unverified";
}, false);
await check("disabled active city denies verification", async () => {
  cityList = [];
}, false);
console.log("VL-02 Google office functional mock certification:", count + "/9 PASS");
