// ============================================================================
// QuickFurno — Phase 14B: City source-of-truth service (SERVER ONLY)
//
// Single source of truth for "which cities are live" = the admin-managed
// public.cities table, filtered to is_active = true. Everything (public forms,
// admin dropdowns, eligibility checker) reads from here so a city added or
// deactivated in Admin → Cities & Locations is reflected everywhere.
//
// SAFETY:
//   - SERVER ONLY (uses the service-role client). Never import from a client
//     component. The public surface is the GET /api/cities route.
//   - READ ONLY. No writes, no WhatsApp, no vendor notification, no credits,
//     no auto-assignment, no n8n.
//   - Never throws: any missing table/error resolves to an empty list so forms
//     degrade to the "no active cities configured" message instead of crashing.
// ============================================================================
import { adminClient } from "@/lib/supabase";

export interface ActiveCity {
  id: string;
  name: string;
  slug: string | null;
}

/** Active cities, ordered by name. Never throws — returns [] on any error. */
export async function getActiveCities(): Promise<ActiveCity[]> {
  try {
    const { data, error } = await adminClient()
      .from("cities")
      .select("id, name, slug, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error || !Array.isArray(data)) return [];

    const seen = new Set<string>();
    const out: ActiveCity[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: String(row.id ?? name),
        name,
        slug: typeof row.slug === "string" ? row.slug : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Active city names only — convenient for dropdowns. */
export async function getActiveCityNames(): Promise<string[]> {
  return (await getActiveCities()).map((city) => city.name);
}
