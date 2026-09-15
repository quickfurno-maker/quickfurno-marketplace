// ============================================================================
// QuickFurno — Pune-only launch: deactivate every non-launch city
//
// The database may contain historical/future city rows. Pune is the only launch
// city allowed to remain active. This script deactivates every non-Pune row so
// rerunning maintenance cannot accidentally re-enable another city.
//
// SAFE + REVERSIBLE:
//   - Only sets is_active = false (NO delete / drop / truncate).
//   - Non-Pune rows are retained for future launches, but stay inactive.
//   - Reads .env.local READ-ONLY for the Supabase URL + service-role key (the
//     same pattern as scripts/grant-superadmin.mjs). Never writes .env.
//   - No WhatsApp, no vendor notification, no credit deduction, no n8n.
//
// Usage (PowerShell):  node scripts/deactivate-extra-cities.mjs
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) {
  console.error("Missing required env variables:", missing.join(", "));
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const LAUNCH_CITY = "pune";

const { data: before, error: readErr } = await supabase
  .from("cities")
  .select("id, name, slug, is_active")
  .order("name", { ascending: true });

if (readErr) {
  console.error("Could not read cities table:", readErr.message);
  process.exit(1);
}

console.log("\nBefore — cities in DB:");
for (const c of before ?? []) {
  console.log(`  ${c.is_active ? "ACTIVE  " : "inactive"}  ${c.name}`);
}

// Deactivate every active row that is not Pune (match name or slug).
const toDeactivate = (before ?? []).filter((c) => {
  const name = String(c.name ?? "").trim().toLowerCase();
  const slug = String(c.slug ?? "").trim().toLowerCase();
  return name !== LAUNCH_CITY && slug !== LAUNCH_CITY && c.is_active !== false;
});
for (const c of toDeactivate) {
  const { error } = await supabase.from("cities").update({ is_active: false }).eq("id", c.id);
  if (error) console.error(`  Failed to deactivate ${c.name}:`, error.message);
  else console.log(`  → deactivated ${c.name}`);
}

// Ensure Pune stays active.
const toActivate = (before ?? []).filter((c) => {
  const name = String(c.name ?? "").trim().toLowerCase();
  const slug = String(c.slug ?? "").trim().toLowerCase();
  return (name === LAUNCH_CITY || slug === LAUNCH_CITY) && c.is_active !== true;
});
for (const c of toActivate) {
  const { error } = await supabase.from("cities").update({ is_active: true }).eq("id", c.id);
  if (error) console.error(`  Failed to activate ${c.name}:`, error.message);
  else console.log(`  → activated ${c.name}`);
}

const { data: after, error: afterErr } = await supabase
  .from("cities")
  .select("name, is_active")
  .eq("is_active", true)
  .order("name", { ascending: true });

if (afterErr) {
  console.error("Could not re-read cities:", afterErr.message);
  process.exit(1);
}

console.log("\nAfter — ACTIVE cities (what every dropdown will show):");
for (const c of after ?? []) console.log(`  • ${c.name}`);
console.log("\nDone. Pune is the only launch-active city.\n");
