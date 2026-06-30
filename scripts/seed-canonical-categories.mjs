// ============================================================================
// QuickFurno — Phase 14C (governance): seed the canonical category taxonomy
//
//   Parents:  Interior, Sofa, Painter, Civil Work
//   Interior subcategories: Interior Designers, Carpenters, Modular Factory,
//                           Premium Interiors
//
// SAFE + REVERSIBLE:
//   - Upserts the canonical categories (activates them) and SOFT-deactivates the
//     older demo categories (is_active = false). NO delete / drop / truncate, so
//     old leads/vendors referencing those names are never broken.
//   - Reads .env.local READ-ONLY for the Supabase URL + service-role key (same
//     pattern as scripts/grant-superadmin.mjs). Never writes .env.
//   - No WhatsApp, no vendor notification, no credit deduction, no n8n.
//
// Usage (PowerShell):  node scripts/seed-canonical-categories.mjs
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

const OLD_SLUGS = [
  "full-home-interior", "modular-kitchen", "wardrobe", "carpentry",
  "false-ceiling", "painting", "home-renovation", "custom-furniture",
  "interior-design", "renovation",
];

// Detect whether the hierarchy columns exist (some live DBs only have the base
// table id/name/slug/is_active — migration 006/021 not applied yet).
const probe = await supabase.from("service_categories").select("id, parent_id, sort_order").limit(1);
const hasHierarchy = !probe.error;
if (!hasHierarchy) {
  console.log("Note: parent_id/sort_order columns not found — seeding FLAT names only.");
  console.log("      Apply migration 021 for the parent/subcategory hierarchy.\n");
}

const decorate = (rows) =>
  hasHierarchy ? rows : rows.map(({ name, slug, is_active }) => ({ name, slug, is_active }));

const PARENTS = [
  { name: "Interior", slug: "interior", is_active: true, parent_id: null, sort_order: 10 },
  { name: "Sofa", slug: "sofa", is_active: true, parent_id: null, sort_order: 20 },
  { name: "Painter", slug: "painter", is_active: true, parent_id: null, sort_order: 30 },
  { name: "Civil Work", slug: "civil-work", is_active: true, parent_id: null, sort_order: 40 },
];

const up1 = await supabase.from("service_categories").upsert(decorate(PARENTS), { onConflict: "slug" });
if (up1.error) { console.error("Failed to upsert parents:", up1.error.message); process.exit(1); }

let interiorId = null;
if (hasHierarchy) {
  const { data: interior } = await supabase.from("service_categories").select("id").eq("slug", "interior").maybeSingle();
  interiorId = interior?.id ?? null;
}

const SUBS = [
  { name: "Interior Designers", slug: "interior-designers", is_active: true, parent_id: interiorId, sort_order: 11 },
  { name: "Carpenters", slug: "carpenters", is_active: true, parent_id: interiorId, sort_order: 12 },
  { name: "Modular Factory", slug: "modular-factory", is_active: true, parent_id: interiorId, sort_order: 13 },
  { name: "Premium Interiors", slug: "premium-interiors", is_active: true, parent_id: interiorId, sort_order: 14 },
];

const up2 = await supabase.from("service_categories").upsert(decorate(SUBS), { onConflict: "slug" });
if (up2.error) { console.error("Failed to upsert subcategories:", up2.error.message); process.exit(1); }

const off = await supabase.from("service_categories").update({ is_active: false }).in("slug", OLD_SLUGS);
if (off.error) console.error("Warning: could not deactivate old categories:", off.error.message);

const selectCols = hasHierarchy ? "name, parent_id" : "name";
const { data: active, error: afterErr } = await supabase
  .from("service_categories").select(selectCols).eq("is_active", true).order("name");
if (afterErr) { console.error("Could not re-read categories:", afterErr.message); process.exit(1); }

console.log("\nActive categories (admin source of truth):");
for (const c of active ?? []) {
  console.log(`  ${hasHierarchy && c.parent_id ? "   ↳ " : "• "}${c.name}`);
}
console.log("\nDone. Manage these from Admin → Categories (add / edit / activate / deactivate).\n");
