import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function text(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function collectFiles(rel) {
  const abs = join(root, rel);
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs).flatMap((name) => {
    const child = join(abs, name);
    return statSync(child).isDirectory() ? collectFiles(relative(root, child)) : [child];
  });
}

// WHAT "PUNE-ONLY" ACTUALLY HAS TO MEAN
//
// This rule used to ban the string "Mumbai" from every file under app/ and
// components/. That is broader than the policy it protects, and it took the
// approved "Made in Pune. Coming to your city next." roadmap off the homepage
// and the vendor page as collateral - six city tiles, five marked "Coming
// soon", none of them selectable.
//
// Pune-only is a claim about what the product will TRANSACT in, not about
// which city names a visitor may read. A roadmap tile is marketing; a city in
// a dropdown, a lead's city field or a vendor's registration is the launch
// boundary. So the ban now covers the surfaces where a city name can become
// behaviour, and the checks below - which are the real enforcement - are
// unchanged: launch policy, public vendor query, lead capture, vendor
// registration, admin reactivation and the bootstrap seed all still fail
// closed outside Pune.
const activeSurfaces = [
  "lib/analytics",
  "lib/crm",
  "lib/locations",
  "lib/quickfurno-data.ts",
  "services",
  "scripts/deactivate-extra-cities.mjs",
];

// Presentation surfaces may NAME a future city, but must never offer one.
// These are the shapes that would turn a name into a selectable or submitted
// value, and they stay banned everywhere.
const presentationSurfaces = ["app", "components", "public/assets/quickfurno"];
const OFFERS_A_CITY = [
  /<option[^>]*>\s*Mumbai/i,          // a city dropdown
  /value\s*=\s*["']Mumbai["']/i,       // a submitted value
  /city\s*[:=]\s*["']Mumbai["']/i,     // a city field set to Mumbai
  /LAUNCH_CIT(Y|IES)[^\n]*Mumbai/i,    // widening the launch policy
];

const activeFiles = activeSurfaces.flatMap(collectFiles).filter((file) => {
  const ext = file.toLowerCase();
  return ext.endsWith(".ts") || ext.endsWith(".tsx") || ext.endsWith(".js") || ext.endsWith(".mjs") || ext.endsWith(".css") || ext.endsWith(".svg");
});

const leaks = activeFiles.flatMap((file) => {
  const body = readFileSync(file, "utf8");
  return /\bmumbai\b/i.test(body) ? [relative(root, file)] : [];
});
assert(leaks.length === 0, `functional launch surfaces contain no Mumbai references${leaks.length ? `: ${leaks.join(", ")}` : ""}`);

// A name may appear on a page. An OFFER may not.
const presentationFiles = presentationSurfaces.flatMap(collectFiles).filter((file) => {
  const ext = file.toLowerCase();
  return ext.endsWith(".ts") || ext.endsWith(".tsx") || ext.endsWith(".js") || ext.endsWith(".mjs") || ext.endsWith(".css") || ext.endsWith(".svg");
});
const offers = presentationFiles.flatMap((file) => {
  const body = readFileSync(file, "utf8");
  const hit = OFFERS_A_CITY.find((re) => re.test(body));
  return hit ? [`${relative(root, file)} (${hit})`] : [];
});
assert(offers.length === 0, `no page offers a non-launch city as a choice${offers.length ? `: ${offers.join(", ")}` : ""}`);

// The roadmap the approved mockup shows must stay a ROADMAP: every city other
// than Pune carries "Coming soon", and only Pune is ever marked live. If
// someone flips one of these to live without the launch policy changing, the
// page would promise service the product refuses to deliver.
for (const rel of ["components/home/PuneLaunchHomepage.tsx", "app/vendors/page.tsx"]) {
  const body = readFileSync(join(root, rel), "utf8");
  if (!/\bmumbai\b/i.test(body)) continue;
  assert(/Coming soon/.test(body), `${rel} marks non-launch cities as Coming soon`);
  assert(
    (body.match(/live:\s*true/g) || []).length === 1,
    `${rel} marks exactly one city live`,
  );
}

const policy = text("lib/locations/launchCityPolicy.ts");
assert(policy.includes('export const LAUNCH_CITY = "Pune" as const;'), "launch-city policy is canonically Pune");
assert(policy.includes('export const LAUNCH_CITIES = [LAUNCH_CITY] as const;'), "launch-city list has one authority");
assert(policy.includes("return isLaunchCity(value) ? LAUNCH_CITY : null;"), "unsupported city normalization fails closed");

const publicVendors = text("services/publicVendorService.ts");
assert(publicVendors.includes('.ilike("city", LAUNCH_CITY)'), "public vendor query is server-filtered to Pune");
assert(!publicVendors.includes('"Pune" | "Mumbai"'), "public vendor contract has no Pune/Mumbai union");

const leadService = text("services/leadService.ts");
assert(leadService.includes("normalizeLaunchCity(input.city)"), "lead capture validates launch city on the server");
const vendorService = text("services/vendorService.ts");
assert(vendorService.includes("normalizeLaunchCity(input.city)"), "vendor registration validates launch city on the server");

const adminService = text("services/adminService.ts");
assert(adminService.includes("!isLaunchCity(city.name) && !isLaunchCity(city.slug)"), "admin cannot reactivate a non-launch city");

const maintenance = text("scripts/deactivate-extra-cities.mjs");
assert(maintenance.includes('const LAUNCH_CITY = "pune";'), "city maintenance keeps only Pune active");
assert(!maintenance.includes("KEEP_ACTIVE"), "city maintenance has no multi-city keep list");

const bootstrap = text("db/003_seed_data.sql");
assert(bootstrap.includes("('Pune',      'pune',      true)"), "fresh bootstrap activates Pune");
assert(bootstrap.includes("('Mumbai',    'mumbai',    false)"), "fresh bootstrap keeps Mumbai inactive");
assert(bootstrap.includes("on conflict (slug) do update set is_active = excluded.is_active;"), "bootstrap cannot reactivate a non-launch city by stale defaults");

assert(!existsSync(join(root, "public/assets/quickfurno/images/city/pune-mumbai-line-art.svg")), "old dual-city artwork is removed");
assert(existsSync(join(root, "public/assets/quickfurno/images/city/pune-line-art.svg")), "Pune-only artwork exists");

const exotel = text("lib/communication/providers/exotelConfig.ts");
assert(exotel.includes("api.in.exotel.com"), "Exotel India endpoint remains untouched");

console.log(`\nPune-only launch guard: ${passed}/${passed} checks passed.`);
