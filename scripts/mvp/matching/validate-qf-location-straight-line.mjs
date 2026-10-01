import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const matcher = read("services/leadMatchingEngine.ts");
const clientForm = read("components/ClientEnquiryModal.tsx");
const vendorForm = read("components/VendorRegisterForm.tsx");
const autocomplete = read("components/location/GooglePlaceAutocomplete.tsx");
const envExample = read(".env.example");
const diagnostics = read("services/leadProcessingDiagnosticsCore.ts");
const reasons = read("lib/matchcore/automaticMatchDecision.ts");

const migrationFiles = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.includes("qf_verified_location_geofence_straight_line"));
assert.equal(migrationFiles.length, 1, "exactly one verified-location migration must exist");
const migration = read(path.join("supabase", "migrations", migrationFiles[0]));

assert.match(matcher, /verified_location_straight_line_v1/);
assert.match(diagnostics, /verified_location_straight_line_v1/);
assert.match(matcher, /geography_model:\s*"straight_line_wgs84_v1"/);
assert.match(matcher, /external_route_provider_used:\s*false/);
assert.match(matcher, /route_provider_call_count:\s*0/);
for (const forbidden of [
  "measureLeadRouteTimes",
  "leadRouteTimeService",
  "routeTimeProviderService",
  "GOOGLE_ROUTES_API_KEY",
  "ROUTE_TIME_PROVIDER_ENABLED",
]) {
  assert.equal(matcher.includes(forbidden), false, `live matcher must not contain ${forbidden}`);
  assert.equal(envExample.includes(forbidden), false, `.env.example must not contain ${forbidden}`);
}

for (const removed of [
  "services/leadRouteTimeService.ts",
  "services/routeTimeProviderService.ts",
  "lib/geo/googleRouteMatrixProtocol.ts",
]) {
  assert.equal(exists(removed), false, `${removed} must be removed`);
}

assert.match(clientForm, /mode="address"/);
assert.match(vendorForm, /mode="address"/);
assert.match(clientForm, /google_city:\s*form\.googleCity/);
assert.match(vendorForm, /google_city:\s*f\.googleCity/);
assert.match(autocomplete, /"location"/);
assert.match(autocomplete, /fetchFields/);

assert.match(migration, /create table if not exists public\.marketplace_service_zones/);
assert.match(migration, /extensions\.geometry\(MultiPolygon, 4326\)/);
assert.match(migration, /extensions\.ST_Covers/);
assert.match(migration, /city_fallback/);
assert.match(migration, /outside_service_area/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.marketplace_service_zones from public, anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on table public\.marketplace_service_zones to service_role/);

// The launch row is intentionally boundary-less until a reviewed business
// polygon is loaded. Never hide an invented rectangle in a migration.
assert.match(migration, /pune-pcmc-launch/);
assert.equal(/ST_MakeEnvelope|POLYGON\s*\(\(/i.test(migration), false);

assert.match(reasons, /"outside_service_area"/);
assert.match(reasons, /"service_zone_mismatch"/);

console.log("QF verified-location / straight-line matching guard: PASS");
