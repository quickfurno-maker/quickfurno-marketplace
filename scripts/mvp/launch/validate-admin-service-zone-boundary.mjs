import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failed = 0;

function check(name, condition) {
  if (condition) console.log("PASS", name);
  else { console.error("FAIL", name); failed += 1; }
}

const migration = read("supabase/migrations/20261001165000_qf_admin_service_zone_boundary_control.sql");
const adminService = read("services/adminService.ts");
const adminSections = read("services/adminSectionService.ts");
const actions = read("app/actions.ts");
const ui = read("components/admin/sections/CitiesSection.tsx");
const types = read("components/admin/adminTypes.ts");

check("01 boundary RPC is service-role only",
  /qf_admin_set_city_boundary_v1/.test(migration)
  && /grant execute on function public\.qf_admin_set_city_boundary_v1\(uuid,jsonb,text,text\)\s+to service_role/i.test(migration)
  && /revoke all on function public\.qf_admin_set_city_boundary_v1[\s\S]*authenticated/i.test(migration));

check("02 accepted boundary input is polygonal GeoJSON only",
  /FeatureCollection/.test(migration)
  && /Polygon/.test(migration)
  && /MultiPolygon/.test(migration)
  && /QF_BOUNDARY_MUST_BE_POLYGON_OR_MULTIPOLYGON/.test(migration));

check("03 invalid and empty geometry fail closed",
  /ST_IsValid\(v_geom\)/.test(migration)
  && /ST_IsValidReason/.test(migration)
  && /QF_BOUNDARY_EMPTY/.test(migration));

check("04 geometry complexity is bounded",
  /ST_NPoints/.test(migration)
  && /100000/.test(migration)
  && /QF_BOUNDARY_TOO_COMPLEX/.test(migration));

check("05 canonical stored geometry is WGS84 MultiPolygon",
  /ST_SetSRID/.test(migration)
  && /ST_Force2D/.test(migration)
  && /ST_Multi/.test(migration));

check("06 clearing a boundary is explicit",
  /qf_admin_clear_city_boundary_v1/.test(migration)
  && /boundary=null/.test(migration));

check("07 admin summary RPC avoids returning raw polygon geometry",
  /qf_admin_service_zone_summaries_v1/.test(migration)
  && /boundary_configured/.test(migration)
  && /boundary_npoints/.test(migration)
  && /boundary_area_sq_km/.test(migration));

check("08 admin page reads boundary summaries through RPC",
  /qf_admin_service_zone_summaries_v1/.test(adminSections)
  && !/select\([^)]*boundary[^)]*\)/s.test(adminSections));

check("09 boundary mutations are authenticated and audit logged",
  /export async function setCityBoundary/.test(adminService)
  && /city\.boundary_updated/.test(adminService)
  && /export async function clearCityBoundary/.test(adminService)
  && /city\.boundary_cleared/.test(adminService)
  && /actorUserId/.test(adminService));

const boundaryAuditCalls = (adminService.match(/await recordAuditLog\([^;]*?\);/gs) ?? [])
  .filter((call) => /city\.boundary_/.test(call));
check("10 audit metadata never stores the raw GeoJSON payload",
  boundaryAuditCalls.length === 2
  && boundaryAuditCalls.every((call) => !/input\.geojson|p_geojson/.test(call)));

check("11 server caps boundary payload size",
  /2_000_000/.test(adminService));

check("12 admin actions revalidate the Cities control plane",
  /adminSetCityBoundary/.test(actions)
  && /adminClearCityBoundary/.test(actions)
  && /revalidatePath\("\/admin\/cities"\)/.test(actions));

check("13 admin UI supports file upload and paste",
  /type="file"/.test(ui)
  && /\.geojson/.test(ui)
  && /<textarea/.test(ui));

check("14 admin UI exposes validate-save and explicit clear",
  /Validate & save/.test(ui)
  && /Clear boundary/.test(ui));

check("15 UI uses boundary summary fields instead of raw boundary",
  /boundary_configured/.test(ui)
  && /boundary_npoints/.test(ui)
  && /boundary_area_sq_km/.test(ui)
  && !/zone\.boundary(?!_)/.test(ui));

check("16 service-zone type contains summary fields, not raw geometry",
  /boundary_configured/.test(types)
  && /boundary_npoints/.test(types)
  && /boundary_area_sq_km/.test(types)
  && !/boundary\?: unknown/.test(types));

check("17 no city polygon or coordinate literals are seeded",
  !/"coordinates"\s*:/.test(migration)
  && !/73\.\d{3,}|18\.\d{3,}/.test(migration));

if (failed) {
  console.error("\nAdmin service-zone boundary: " + failed + " checks failed");
  process.exit(1);
}
console.log("\nAdmin service-zone boundary: 17/17 checks passed.");
