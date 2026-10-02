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

const service = read("services/adminVendorLocationService.ts");
const actions = read("app/actions.ts");
const crm = read("services/vendorCrmService.ts");
const profile = read("components/admin/crm/VendorCrmProfile.tsx");
const locationUi = read("components/admin/crm/VendorLocationBackfill.tsx");
const directory = read("components/admin/crm/VendorCrmDirectory.tsx");
const directoryPage = read("app/admin/vendor-crm/page.tsx");
const validation = read("lib/crm/vendorCrmValidation.ts");

check("01 backfill requires Google Place ID, Google city, formatted address and canonical coordinates",
  /!placeId \|\| !googleCity \|\| !formattedAddress \|\| !point/.test(service));
check("02 server checks Google city against admin-managed accepted labels",
  /acceptedCityLabels\.some/.test(service) && /googleCityAccepted/.test(service));
check("03 server independently runs the QuickFurno service-zone resolver",
  /verifyLocationForServiceArea/.test(service) && /serviceZoneId/.test(service));
check("04 outside/unresolved location cannot be promoted to a matching point",
  /OUTSIDE_SERVICE_AREA/.test(service) && /status !== "provisional"/.test(service) && /status !== "verified"/.test(service));
check("05 resolver market must agree with the vendor Core city market",
  /market\.serviceZoneId/.test(service) && /verification\.serviceZoneId !== market\.serviceZoneId/.test(service));
check("06 Core write is scoped to location authority fields only",
  /office_latitude/.test(service) && /office_longitude/.test(service)
  && /google_place_id/.test(service) && /location_verification_status/.test(service)
  && !/remaining_credits:|total_credits:|package_status:|accepting_leads:|covers_full_city:|areas_covered:/.test(service));
check("07 audit records actor-bound location authority without raw coordinates",
  /vendor\.location_backfilled/.test(service)
  && /actorUserId/.test(service)
  && /verification_status/.test(service)
  && !/metadata:[\s\S]{0,400}(latitude|longitude)/.test(service));
check("08 public browser cannot call the mutation directly; action is superadmin asAdmin wrapped",
  /adminBackfillVendorLocation/.test(actions)
  && /asAdmin\(async \(actor\)/.test(actions)
  && /backfillVendorExactLocation\(vendorId, input, actor\)/.test(actions));
check("09 Vendor CRM service still never writes the vendors Core table",
  !/from\("vendors"\)\.(update|insert|delete)/.test(crm));
check("10 Location tab requires address-mode Google selection",
  /mode="address"/.test(locationUi)
  && /Choose a Google suggestion/.test(locationUi)
  && /disabled=\{pending \|\| !selected\}/.test(locationUi));
check("11 Location tab rejects cross-city selections using admin-managed labels",
  /isPlaceCompatibleWithSelectedCity/.test(locationUi)
  && /acceptedCityLabels/.test(locationUi));
check("12 profile exposes a dedicated Location tab wired to the Core action",
  /location: "Location"/.test(profile)
  && /VendorLocationBackfill/.test(profile)
  && /adminBackfillVendorLocation/.test(profile));
check("13 directory exposes location state and a bounded backfill filter",
  /header: "Location"/.test(directory)
  && /Needs backfill/.test(directory)
  && /location: "needs_backfill"/.test(validation));
check("14 needs-backfill filter is server-side on location_verification_status",
  /q\.location === "needs_backfill"/.test(crm)
  && /location_verification_status", "unverified"/.test(crm));
check("15 no historical lead mutation is introduced by this vendor backfill slice",
  !/from\("leads"\)\.(update|insert|delete)/.test(service));

if (failed) {
  console.error("\nVendor location backfill guard: " + failed + " checks failed");
  process.exit(1);
}
console.log("\nVendor location backfill guard: 15/15 checks passed.");
