// QuickFurno — active-city client hook.
// Fetches exactly the admin-managed active cities from /api/cities. No
// hard-coded launch-city filter is applied in the browser.
import { useEffect, useState } from "react";

export const NO_ACTIVE_CITIES_MESSAGE =
  "No active cities configured. Add cities from Admin → Cities & Locations.";

export interface ActiveCityRecord {
  id: string;
  name: string;
  slug: string | null;
  serviceZoneId: string | null;
  acceptedCityLabels: string[];
  matchingEnabled: boolean;
  requiresResolvedLocation: boolean;
}

export interface ActiveCitiesState {
  cities: string[];
  records: ActiveCityRecord[];
  loading: boolean;
  loaded: boolean;
}

export function useActiveCities(): ActiveCitiesState {
  const [cities, setCities] = useState<string[]>([]);
  const [records, setRecords] = useState<ActiveCityRecord[]>([]);
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
          const seen = new Set<string>();
          const next = data.cities
            .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
            .filter((value: string) => {
              const k = value.toLowerCase();
              if (!k || seen.has(k)) return false;
              seen.add(k);
              return true;
            });
          setCities(next);
          if (Array.isArray(data.records)) {
            setRecords(
              data.records
                .filter((record: unknown): record is ActiveCityRecord => {
                  if (!record || typeof record !== "object") return false;
                  const row = record as Partial<ActiveCityRecord>;
                  return typeof row.id === "string" && typeof row.name === "string";
                })
                .map((record: ActiveCityRecord) => ({
                  ...record,
                  acceptedCityLabels: Array.isArray(record.acceptedCityLabels)
                    ? record.acceptedCityLabels.filter((label) => typeof label === "string" && label.trim())
                    : [record.name],
                })),
            );
          }
        }
      } catch {
        // Leave empty; callers show the safe fallback message.
      } finally {
        if (active) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  return { cities, records, loading, loaded };
}
