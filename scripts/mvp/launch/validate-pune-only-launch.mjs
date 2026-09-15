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

const activeSurfaces = [
  "app",
  "components",
  "lib/analytics",
  "lib/crm",
  "lib/locations",
  "lib/quickfurno-data.ts",
  "services",
  "public/assets/quickfurno",
  "scripts/deactivate-extra-cities.mjs",
];

const activeFiles = activeSurfaces.flatMap(collectFiles).filter((file) => {
  const ext = file.toLowerCase();
  return ext.endsWith(".ts") || ext.endsWith(".tsx") || ext.endsWith(".js") || ext.endsWith(".mjs") || ext.endsWith(".css") || ext.endsWith(".svg");
});

const leaks = activeFiles.flatMap((file) => {
  const body = readFileSync(file, "utf8");
  return /\bmumbai\b/i.test(body) ? [relative(root, file)] : [];
});
assert(leaks.length === 0, `active launch surfaces contain no Mumbai references${leaks.length ? `: ${leaks.join(", ")}` : ""}`);

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
