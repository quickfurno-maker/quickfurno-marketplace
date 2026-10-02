import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const files = {
  shared: read("components/location/GooglePlaceAutocomplete.tsx"),
  publicInput: read("components/location/PublicGoogleLocationInput.tsx"),
  modal: read("components/ClientEnquiryModal.tsx"),
  home: read("components/home/PuneLaunchHomepage.tsx"),
  category: read("components/category/CategoryHero.tsx"),
  enquiry: read("components/LeadFunnel.tsx"),
  vendorProfile: read("components/vendors/ClientSelectedVendorEnquiry.tsx"),
  vendorRegister: read("components/VendorRegisterForm.tsx"),
  legacyHome: read("components/HomeEnquiryForm.tsx"),
  css: read("app/qf-redesign.css"),
};

let pass = 0;
let fail = 0;
function check(name, ok) {
  const no = String(pass + fail + 1).padStart(2, "0");
  if (ok) { pass++; console.log(`PASS ${no} ${name}`); }
  else { fail++; console.error(`FAIL ${no} ${name}`); }
}

check("shared autocomplete uses Places New suggestions", files.shared.includes("AutocompleteSuggestion.fetchAutocompleteSuggestions"));
check("shared autocomplete fetches place identity and coordinates", files.shared.includes('"id", "displayName", "formattedAddress", "addressComponents", "location"'));
check("shared autocomplete supports unclipped body portal", files.shared.includes("createPortal") && files.shared.includes("suggestionsPortal"));
check("portal dropdown has high UI layer", files.css.includes(".qf-place-suggest--portal") && files.css.includes("z-index: 2000"));
check("public quote location exposes place id", files.publicInput.includes("data-quote-place-id"));
check("public quote location exposes coordinates", files.publicInput.includes("data-quote-lat") && files.publicInput.includes("data-quote-lng"));
check("public quote location validates selected city", files.publicInput.includes("isPlaceCompatibleWithSelectedCity"));
check("modal trigger carries structured Google place", files.modal.includes("googlePlace?: NormalizedGooglePlace") && files.modal.includes("dataset.quotePlaceId"));
check("modal prefill preserves selected coordinates", files.modal.includes("lat: preselectedPlace?.lat") && files.modal.includes("lng: preselectedPlace?.lng"));
check("homepage hero uses shared Google location", files.home.includes("<PublicGoogleLocationInput") && files.home.includes('city="Pune"'));
check("homepage hero no longer uses area datalist", !files.home.includes('list="qfp-area-options"') && !files.home.includes('<datalist id="qfp-area-options">'));
check("category hero uses shared Google location", files.category.includes("<PublicGoogleLocationInput") && files.category.includes("data-quote-bar"));
check("category hero no longer uses static locality select", !files.category.includes("PUNE_ZONES") && !files.category.includes("Choose your area in Pune"));
check("/enquiry uses Google project location", files.enquiry.includes("<GooglePlaceAutocomplete") && files.enquiry.includes("google_place_id"));
check("vendor profile enquiry uses Google project location", files.vendorProfile.includes("<GooglePlaceAutocomplete") && files.vendorProfile.includes("google_place_id"));
check("vendor registration remains on the same Google component", files.vendorRegister.includes("<GooglePlaceAutocomplete") && files.vendorRegister.includes("googlePlaceId"));
check("legacy homepage form cannot reintroduce manual-only area", files.legacyHome.includes("<GooglePlaceAutocomplete") && files.legacyHome.includes("google_place_id"));
check("all structured public lead paths preserve manual fallback", [files.publicInput, files.enquiry, files.vendorProfile, files.legacyHome].every((s) => /manual/i.test(s)));
check("no Routes API introduced by public location UX", !Object.values(files).some((s) => /routes.googleapis.com|RouteMatrix|computeRoutes/.test(s)));
check("no browser Google API key literal introduced", !Object.values(files).some((s) => /AIza[0-9A-Za-z_-]{20,}/.test(s)));

console.log(`\nPublic Google location guard: ${pass}/${pass + fail} passed.`);
if (fail) process.exit(1);
