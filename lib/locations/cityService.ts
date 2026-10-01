// QuickFurno — database-backed city authority (SERVER ONLY).
//
// public.cities is the single source of truth for which marketplace cities are
// active. Admin changes take effect without a deploy. Service-zone geography is
// a separate authority layered on top of these active city rows.
import "server-only";
import { adminClient } from "@/lib/supabase";

export interface ActiveCity {
  id: string;
  name: string;
  slug: string | null;
  serviceZoneId: string | null;
  acceptedCityLabels: string[];
  matchingEnabled: boolean;
  requiresResolvedLocation: boolean;
}

function key(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Active cities, ordered by name. Never throws — returns [] on any error. */
export async function getActiveCities(): Promise<ActiveCity[]> {
  try {
    const db = adminClient();
    const [{ data, error }, zonesResult] = await Promise.all([
      db
        .from("cities")
        .select("id, name, slug, is_active")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      db
        .from("marketplace_service_zones")
        .select("id,city_id,accepted_city_labels,matching_enabled,requires_resolved_location"),
    ]);
    if (error || !Array.isArray(data)) return [];

    const zonesByCity = new Map<string, Record<string, unknown>>();
    if (!zonesResult.error && Array.isArray(zonesResult.data)) {
      for (const zone of zonesResult.data as Array<Record<string, unknown>>) {
        const cityId = typeof zone.city_id === "string" ? zone.city_id : "";
        if (cityId) zonesByCity.set(cityId, zone);
      }
    }

    const seen = new Set<string>();
    const out: ActiveCity[] = [];
    for (const row of data as Array<Record<string, unknown>>) {
      const id = typeof row.id === "string" ? row.id : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const slug = typeof row.slug === "string" && row.slug.trim() ? row.slug.trim() : null;
      if (!id || !name) continue;

      const dedupe = key(slug) || key(name);
      if (!dedupe || seen.has(dedupe)) continue;
      seen.add(dedupe);

      const zone = zonesByCity.get(id);
      const labels = Array.isArray(zone?.accepted_city_labels)
        ? zone.accepted_city_labels
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean)
        : [name];
      if (!labels.some((label) => key(label) === key(name))) labels.unshift(name);

      out.push({
        id,
        name,
        slug,
        serviceZoneId: typeof zone?.id === "string" ? zone.id : null,
        acceptedCityLabels: labels,
        matchingEnabled: zone?.matching_enabled === true,
        requiresResolvedLocation: zone?.requires_resolved_location === true,
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

/**
 * Resolve a user/admin supplied city name or slug to the canonical ACTIVE city
 * row. Returns null when disabled, unknown, or the city table is unavailable.
 */
export async function resolveActiveCity(value: unknown): Promise<ActiveCity | null> {
  const wanted = key(value);
  if (!wanted) return null;
  const cities = await getActiveCities();
  return cities.find((city) => key(city.name) === wanted || key(city.slug) === wanted) ?? null;
}

/** True only when the supplied name/slug currently resolves to an active DB row. */
export async function isActiveCity(value: unknown): Promise<boolean> {
  return Boolean(await resolveActiveCity(value));
}
