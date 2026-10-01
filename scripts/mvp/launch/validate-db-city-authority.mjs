import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
let failed = 0;

function check(name, condition) {
  if (condition) console.log("PASS", name);
  else { console.error("FAIL", name); failed += 1; }
}

const cityService = read("lib/locations/cityService.ts");
const cityHook = read("lib/locations/useActiveCities.ts");
const leadService = read("services/leadService.ts");
const vendorService = read("services/vendorService.ts");
const publicVendors = read("services/publicVendorService.ts");
const adminService = read("services/adminService.ts");
const citiesUi = read("components/admin/sections/CitiesSection.tsx");
const cityApi = read("app/api/cities/route.ts");
const multiCityMigration = read("supabase/migrations/20261001153000_qf_multi_city_service_zone_authority.sql");
const runtimeMigration = read("supabase/migrations/20261001154500_qf_city_market_runtime_controls.sql");

check("01 active cities come from public.cities is_active=true",
  /from\("cities"\)/.test(cityService) && /eq\("is_active", true\)/.test(cityService));
check("02 browser city hook accepts API records without a hard-coded launch filter",
  /fetch\("\/api\/cities"/.test(cityHook)
  && !/LAUNCH_CITY|filterLaunchCityNames|normalizeLaunchCity/.test(cityHook));
check("03 lead capture resolves the selected city against the active DB authority",
  /resolveActiveCity\(input\.city\)/.test(leadService)
  && !/normalizeLaunchCity|LAUNCH_CITY/.test(leadService));
check("04 vendor registration resolves city against the active DB authority",
  /resolveActiveCity\(input\.city\)/.test(vendorService)
  && !/normalizeLaunchCity|LAUNCH_CITY/.test(vendorService));
check("05 public vendor visibility follows active DB cities",
  /getActiveCities\(\)/.test(publicVendors)
  && !/\.ilike\("city",\s*LAUNCH_CITY\)|normalizeLaunchCity/.test(publicVendors));
check("06 public city API delegates to the DB-backed service",
  /getActiveCities/.test(cityApi));
check("07 admin create and toggle operations use atomic city-market RPCs",
  /qf_admin_create_city_market_v1/.test(adminService)
  && /qf_admin_set_city_active_v1/.test(adminService)
  && /qf_admin_set_city_matching_v1/.test(adminService));
check("08 admin Cities UI exposes persisted public-active and matching controls",
  /adminSetCityActive/.test(citiesUi)
  && /adminSetCityMatchingEnabled/.test(citiesUi)
  && /onChange=/.test(citiesUi));
check("09 admin Cities UI has no fake Maharashtra/homepage defaults",
  !/\|\|\s*"Maharashtra"|show_on_homepage\s*\?\?\s*true/.test(citiesUi));
check("10 service zones are linked one-to-one to real city rows",
  /city_id uuid/.test(multiCityMigration)
  && /foreign key \(city_id\) references public\.cities\(id\)/i.test(multiCityMigration)
  && /unique \(city_id\)/i.test(multiCityMigration));
check("11 matching state is independently admin-controlled and disabling a city disarms matching",
  /qf_admin_set_city_matching_v1/.test(multiCityMigration)
  && /matching_enabled=case when coalesce\(p_active,false\) then matching_enabled else false end/.test(multiCityMigration));
check("12 service-zone id is the future matching authority, with city fallback only when unresolved",
  /service_zone_id is the long-term geographic authority/.test(read("services/leadMatchingEngine.ts"))
  && /if \(leadZoneId && vendorZoneId\)/.test(read("services/leadMatchingEngine.ts")));
check("13 overlapping markets use explicit priority and equal-priority ambiguity fails closed",
  /resolution_priority/.test(multiCityMigration)
  && /AMBIGUOUS_SERVICE_ZONE/.test(multiCityMigration));
check("14 no dummy future city values are seeded in the new city authority",
  !/['"](Mumbai|Delhi|Bengaluru|Bangalore|Chennai)['"]/.test(multiCityMigration));
check("15 obsolete Pune-only runtime policy and maintenance script are removed",
  !exists("lib/locations/launchCityPolicy.ts")
  && !exists("scripts/deactivate-extra-cities.mjs"));
check("16 accepted Google city labels and overlap priority are persisted by an admin RPC",
  /qf_admin_update_city_market_v1/.test(runtimeMigration)
  && /accepted_city_labels/.test(runtimeMigration)
  && /resolution_priority/.test(runtimeMigration)
  && /adminUpdateCityMarketSettings/.test(citiesUi));
check("17 location resolver follows active market state, not the matching switch",
  (() => {
    const start = runtimeMigration.indexOf("create or replace function public.qf_resolve_service_zone_v1(");
    const end = runtimeMigration.indexOf("create or replace function public.qf_vendor_assignment_eligible(", start);
    const resolver = start >= 0 && end > start ? runtimeMigration.slice(start, end) : "";
    return resolver.includes("z.is_active is true") && !resolver.includes("z.matching_enabled is true");
  })());
check("18 canonical assignment rejects a market whose matching switch is off",
  /service_zone_matching_disabled/.test(runtimeMigration)
  && /QF_ASSIGNMENT_SERVICE_ZONE_MATCHING_DISABLED/.test(runtimeMigration));
check("19 MatchCore mirrors the matching-disabled reason",
  /service_zone_matching_disabled/.test(read("services/leadMatchingEngine.ts"))
  && /service_zone_matching_disabled/.test(read("lib/matchcore/automaticMatchDecision.ts")));

if (failed) {
  console.error("\nDB city authority: " + failed + " checks failed");
  process.exit(1);
}
console.log("\nDB city authority: 19/19 checks passed.");
