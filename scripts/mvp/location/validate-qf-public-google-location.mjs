import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const files = {
  shared: read("components/location/GooglePlaceAutocomplete.tsx"),
  publicInput: read("components/location/PublicGoogleLocationInput.tsx"),
  projectProvider: read("components/location/ProjectLocationProvider.tsx"),
  projectLocation: read("lib/locations/projectLocation.ts"),
  modal: read("components/ClientEnquiryModal.tsx"),
  home: read("components/home/PuneLaunchHomepage.tsx"),
  category: read("components/category/CategoryHero.tsx"),
  categoryPage: read("app/category/[slug]/page.tsx"),
  enquiry: read("components/LeadFunnel.tsx"),
  vendorProfile: read("components/vendors/ClientSelectedVendorEnquiry.tsx"),
  vendorRegister: read("components/VendorRegisterForm.tsx"),
  vendorService: read("services/vendorService.ts"),
  types: read("lib/types.ts"),
  legacyHome: read("components/HomeEnquiryForm.tsx"),
  header: read("components/Header.tsx"),
  layout: read("app/layout.tsx"),
  publicVendors: read("services/publicVendorService.ts"),
  leadQuality: read("services/leadQualityService.ts"),
  css: read("app/qf-public-v2.css") + "\n" + read("app/qf-redesign.css"),
};

let pass = 0;
let fail = 0;
function check(name, ok) {
  const no = String(pass + fail + 1).padStart(2, "0");
  if (ok) { pass++; console.log(`PASS ${no} ${name}`); }
  else { fail++; console.error(`FAIL ${no} ${name}`); }
}

const captureSurfaces = [
  files.publicInput,
  files.projectProvider,
  files.modal,
  files.enquiry,
  files.vendorProfile,
  files.vendorRegister,
  files.legacyHome,
];

check("shared autocomplete uses Places New suggestions",
  files.shared.includes("AutocompleteSuggestion.fetchAutocompleteSuggestions"));
check("shared autocomplete fetches place identity and coordinates",
  files.shared.includes('"id", "displayName", "formattedAddress", "addressComponents", "location"'));
check("shared autocomplete supports unclipped body portal",
  files.shared.includes("createPortal") && files.shared.includes("suggestionsPortal"));
check("portal dropdown has high UI layer",
  files.css.includes(".qf-place-suggest--portal") && files.css.includes("z-index: 2000"));

check("global project location accepts Google-place source only",
  files.projectLocation.includes('source: "google_place"')
  && !files.projectLocation.includes("browser_gps"));
check("global project location requires place id + finite lat/lng",
  files.projectLocation.includes("if (!placeId || !city || latitude == null || longitude == null) return null"));
check("project location persists outside the URL",
  files.projectProvider.includes("localStorage")
  && files.projectProvider.includes("document.cookie")
  && !/URLSearchParams|router\.(push|replace)\(/.test(files.projectProvider));
check("project location cookie is SameSite and secure on HTTPS",
  files.projectProvider.includes("SameSite=Lax")
  && files.projectProvider.includes('window.location.protocol === "https:"'));
check("server-ranking cookie excludes detailed address components",
  (() => {
    const body = files.projectLocation
      .split("export function serializeProjectLocationCookie")[1]
      ?.split("export function parseProjectLocationCookie")[0] ?? "";
    return body.includes("placeId: location.placeId")
      && body.includes("latitude: location.latitude")
      && body.includes("longitude: location.longitude")
      && !/formattedAddress|areaNormalized|sublocality|neighborhood|serviceZoneId/.test(body);
  })());
check("first-visit picker is limited to client marketplace surfaces",
  files.projectProvider.includes('pathname === "/"')
  && files.projectProvider.includes('pathname === "/enquiry"')
  && files.projectProvider.includes('pathname.startsWith("/category/")')
  && !files.projectProvider.includes('pathname === "/vendors") return true'));
check("project location picker rejects unsupported cities",
  files.projectProvider.includes("isn't serving")
  && files.projectProvider.includes("active QuickFurno city"));
check("saved city is reconciled against Admin active cities without clearing on empty lookup",
  files.projectProvider.includes("records.length === 0 || !location")
  && files.projectProvider.includes("persistLocation(null)"));
check("project location picker contains no phone or WhatsApp capture",
  !/whatsapp|phone|mobile number/i.test(files.projectProvider));
check("project location picker locks scroll and supports Escape",
  files.projectProvider.includes('root.style.overflow = "hidden"')
  && files.projectProvider.includes('event.key === "Escape"'));

check("root layout provides project location before enquiry modal",
  /<ProjectLocationProvider>[\s\S]*<EnquiryModalProvider>/.test(files.layout));
check("header exposes selected project location and Change action",
  files.header.includes("useProjectLocation")
  && files.header.includes("openPicker")
  && files.header.includes('"Change"'));
check("header project-location control is responsive",
  files.css.includes(".qf-location-pill--button")
  && files.css.includes(".qf-project-location-overlay"));

check("public quote location exposes place id",
  files.publicInput.includes("data-quote-place-id"));
check("public quote location exposes coordinates",
  files.publicInput.includes("data-quote-lat") && files.publicInput.includes("data-quote-lng"));
check("public quote location resolves selected place against all active cities",
  files.publicInput.includes("records.find((record)")
  && files.publicInput.includes("isPlaceCompatibleWithSelectedCity"));
check("manual public edit clears stale precise global location",
  files.publicInput.includes("clearLocation({ refresh: true })"));
check("public Google selection updates global context and reranks server content",
  files.publicInput.includes("setGoogleLocation(next, cityRecord, { refresh: true })"));
check("known unsupported Google city is rejected instead of degraded to manual",
  files.publicInput.includes("setSelectionError(")
  && files.publicInput.includes("setValue(\"\")")
  && files.publicInput.includes("choose an active city location")
  && files.publicInput.includes("clearLocation({ refresh: true })"));

check("modal trigger carries structured Google place",
  files.modal.includes("googlePlace?: NormalizedGooglePlace")
  && files.modal.includes("dataset.quotePlaceId"));
check("modal inherits global Google location when CTA has no explicit area",
  files.modal.includes("globalProjectLocation")
  && files.modal.includes("projectLocationToGooglePlace(globalProjectLocation)"));
check("explicit manual CTA area cannot inherit stale global coordinates",
  files.modal.includes("!options.area && globalProjectLocation"));
check("modal Google selection updates global context without closing form",
  files.modal.includes("setGlobalProjectLocation(place, globalCityRecord, { refresh: false })"));
check("modal manual area clears stale global context",
  files.modal.includes("clearGlobalProjectLocation({ refresh: false })"));
check("modal verified tick is Google-place only",
  files.modal.includes('ValidationIcon state={form.googlePlaceId ? "valid"'));

check("homepage hero uses shared Google location",
  files.home.includes("<PublicGoogleLocationInput") && files.home.includes('city="Pune"'));
check("homepage hero no longer uses area datalist",
  !files.home.includes('list="qfp-area-options"') && !files.home.includes('<datalist id="qfp-area-options">'));
check("category hero uses shared Google location",
  files.category.includes("<PublicGoogleLocationInput") && files.category.includes("data-quote-bar"));
check("category hero no longer uses static locality select",
  !files.category.includes("PUNE_ZONES") && !files.category.includes("Choose your area in Pune"));

check("category page reads persisted project location server-side",
  files.categoryPage.includes("PROJECT_LOCATION_COOKIE")
  && files.categoryPage.includes("parseProjectLocationCookie"));
check("category page validates persisted city against DB active cities",
  files.categoryPage.includes("getActiveCities")
  && files.categoryPage.includes("selectedActiveCity"));
check("category listing receives selected Google coordinates",
  files.categoryPage.includes("verifiedBrowsingLocation?.latitude")
  && files.categoryPage.includes("verifiedBrowsingLocation?.longitude"));
check("category heading follows selected project area",
  files.categoryPage.includes("verifiedBrowsingLocation?.label ?? pageCity"));

check("/enquiry inherits and updates global Google project location",
  files.enquiry.includes("useProjectLocation")
  && files.enquiry.includes("projectLocationToGooglePlace")
  && files.enquiry.includes("setGlobalProjectLocation"));
check("vendor-profile enquiry inherits and updates global Google project location",
  files.vendorProfile.includes("useProjectLocation")
  && files.vendorProfile.includes("projectLocationToGooglePlace")
  && files.vendorProfile.includes("setGlobalProjectLocation"));
check("legacy homepage form inherits and updates global Google project location",
  files.legacyHome.includes("useProjectLocation")
  && files.legacyHome.includes("projectLocationToGooglePlace")
  && files.legacyHome.includes("setGlobalProjectLocation"));

check("vendor registration remains Google office/base location",
  files.vendorRegister.includes("<GooglePlaceAutocomplete")
  && files.vendorRegister.includes("googlePlaceId")
  && files.vendorRegister.includes("office_latitude: f.baseLatitude")
  && files.vendorRegister.includes("office_longitude: f.baseLongitude"));
check("vendor registration has no device-location wizard step",
  files.vendorRegister.includes("Step 5 of 5")
  && !files.vendorRegister.includes("Allow location for better matching")
  && !files.vendorRegister.includes("requestLocation"));
check("new vendor server writes Google office coordinates only",
  files.vendorService.includes("office_latitude: input.office_latitude")
  && files.vendorService.includes("office_longitude: input.office_longitude")
  && !files.vendorService.includes("latitude: input.latitude")
  && !files.vendorService.includes("longitude: input.longitude")
  && !files.vendorService.includes("input.location_permission_status"));
check("vendor registration input contract exposes no device-coordinate fields",
  !/base_latitude\?:|base_longitude\?:|location_permission_status\?:/.test(files.types.split("export interface VendorRegistrationInput")[1]?.split("export interface VendorProfileSummary")[0] ?? ""));

check("all active capture surfaces contain no browser geolocation API",
  captureSurfaces.every((s) => !/navigator\.geolocation|getCurrentPosition|watchPosition/.test(s)));
check("all active capture surfaces contain no current-device-location CTA",
  captureSurfaces.every((s) => !/use my current location|allow location for better matching|requesting location/i.test(s)));
check("all active capture surfaces create no browser_gps source",
  captureSurfaces.every((s) => !/browser_gps/.test(s)));

check("public vendor ordering derives service zone from server active city",
  files.publicVendors.includes("service_zone_id: activeCity.serviceZoneId")
  && !files.publicVendors.includes("discovery.serviceZoneId"));
check("public vendor discovery uses selected Google point only for straight-line distance",
  files.publicVendors.includes("haversineKm")
  && files.publicVendors.includes("discovery.latitude")
  && files.publicVendors.includes("discovery.longitude"));
check("public browsing still reads fairness without mutating it",
  files.publicVendors.includes("loadFairOpportunitySnapshots")
  && !/qf_(snapshot|consume|restore)_vendor_fair_opportunity/.test(files.publicVendors));
check("lead-quality trusted location source is Google Place only",
  files.leadQuality.includes('const trustedLocationSource = locationSource === "google_place"')
  && !files.leadQuality.includes('locationSource === "browser_gps"'));
check("lead-quality confidence requires Google source + place id + valid coordinates",
  /trustedLocationSource[\s\S]*firstText\(input\.google_place_id\)[\s\S]*validLat[\s\S]*validLng/.test(files.leadQuality)
  && files.leadQuality.includes("structured_google_place_evidence"));

check("structured public lead paths preserve manual fallback",
  [files.publicInput, files.enquiry, files.vendorProfile, files.legacyHome].every((s) => /manual/i.test(s)));
check("no Routes API introduced by location UX",
  !Object.values(files).some((s) => /routes.googleapis.com|RouteMatrix|computeRoutes/.test(s)));
check("no browser Google API key literal introduced",
  !Object.values(files).some((s) => /AIza[0-9A-Za-z_-]{20,}/.test(s)));

console.log(`\nPublic Google + global project location guard: ${pass}/${pass + fail} passed.`);
if (fail) process.exit(1);
