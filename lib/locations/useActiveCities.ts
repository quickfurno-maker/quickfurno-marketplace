"use client";

// ============================================================================
// QuickFurno — Phase 14B: useActiveCities (client hook)
//
// Fetches the admin-managed ACTIVE cities from GET /api/cities so every public
// form and client-side dropdown uses the same source of truth. When no active
// cities are configured, callers should show the safe fallback message:
//   "No active cities configured. Add cities from Admin → Cities & Locations."
// ============================================================================
import { useEffect, useState } from "react";
import { filterLaunchCityNames } from "@/lib/locations/launchCityPolicy";

export const NO_ACTIVE_CITIES_MESSAGE =
  "No active cities configured. Add cities from Admin → Cities & Locations.";

export interface ActiveCitiesState {
  cities: string[];
  loading: boolean;
  loaded: boolean;
}

export function useActiveCities(): ActiveCitiesState {
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/cities", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (res.ok && data?.ok && Array.isArray(data.cities)) {
          setCities(filterLaunchCityNames(data.cities));
        }
      } catch {
        // Leave the list empty; callers render the safe fallback message.
      } finally {
        if (active) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { cities, loading, loaded };
}
