import { useMemo, useState } from "react";
import {
  adminClearCityBoundary,
  adminCreateCity,
  adminSetCityActive,
  adminSetCityBoundary,
  adminSetCityMatchingEnabled,
  adminSetCityStrictLocation,
  adminUpdateCityMarketSettings,
} from "@/app/actions";
import {
  DataTable,
  PrimaryButton,
  SecondaryButton,
  StatCard,
  StatusBadge,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type City, type MarketplaceServiceZone } from "../adminTypes";
import { formatNumber, shortId } from "../adminUtils";
import { Strong } from "./shared";

type ActionResult = Promise<{ ok: boolean; error?: string }>;

function MarketConfigEditor({
  city,
  zone,
  runAction,
}: {
  city: City;
  zone: MarketplaceServiceZone;
  runAction: (title: string, action: () => ActionResult) => void;
}) {
  const [labels, setLabels] = useState((zone.accepted_city_labels ?? [city.name ?? ""]).join(", "));
  const [priority, setPriority] = useState(String(zone.resolution_priority ?? 100));

  function save() {
    const accepted = labels.split(",").map((value) => value.trim()).filter(Boolean);
    const numericPriority = Number(priority);
    runAction("Save market settings", () =>
      adminUpdateCityMarketSettings(city.id, {
        accepted_city_labels: accepted,
        resolution_priority: numericPriority,
      }),
    );
  }

  return (
    <div className="min-w-[250px] space-y-2">
      <input
        value={labels}
        onChange={(event) => setLabels(event.target.value)}
        aria-label={`Google city labels for ${city.name ?? "city"}`}
        className="qfa-focus h-8 w-full rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2 text-xs text-slate-800"
        placeholder="Mumbai, Navi Mumbai, Thane"
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          Priority
          <input
            value={priority}
            onChange={(event) => setPriority(event.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            className="qfa-focus h-8 w-16 rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2 text-xs text-slate-800"
          />
        </label>
        <SecondaryButton size="sm" onClick={save} disabled={!labels.trim() || priority === ""}>
          Save
        </SecondaryButton>
      </div>
    </div>
  );
}

function BoundaryEditor({
  city,
  zone,
  ask,
  runAction,
  notify,
}: {
  city: City;
  zone: MarketplaceServiceZone;
  ask: (title: string, message: string, action: () => ActionResult) => void;
  runAction: (title: string, action: () => ActionResult) => void;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [geojsonText, setGeojsonText] = useState("");
  const [source, setSource] = useState(zone.boundary_source ?? "");
  const [version, setVersion] = useState(zone.boundary_version ?? "");

  function parseGeoJson(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(geojsonText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        notify("Boundary GeoJSON must be an object.");
        return null;
      }
      const type = String((parsed as { type?: unknown }).type ?? "");
      if (!["Polygon", "MultiPolygon", "Feature", "FeatureCollection"].includes(type)) {
        notify("Boundary must be Polygon, MultiPolygon, Feature, or FeatureCollection GeoJSON.");
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      notify("Boundary GeoJSON is not valid JSON.");
      return null;
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      notify("Boundary file is too large. Maximum size is 2 MB.");
      return;
    }
    const text = await file.text();
    setGeojsonText(text);
    if (!source.trim()) setSource(file.name);
  }

  function save() {
    const geojson = parseGeoJson();
    if (!geojson) return;
    runAction("Save service boundary", () =>
      adminSetCityBoundary(city.id, {
        geojson,
        source: source.trim() || null,
        version: version.trim() || null,
      }),
    );
  }

  return (
    <div className="min-w-[280px]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge value={zone.boundary_configured ? "Polygon configured" : "No polygon"} />
        {zone.boundary_area_sq_km != null ? (
          <span className="text-[11px] text-slate-500">{Number(zone.boundary_area_sq_km).toLocaleString()} km²</span>
        ) : null}
        {zone.boundary_npoints != null ? (
          <span className="text-[11px] text-slate-500">{formatNumber(zone.boundary_npoints)} pts</span>
        ) : null}
        <SecondaryButton size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : zone.boundary_configured ? "Replace" : "Configure"}
        </SecondaryButton>
      </div>

      {open ? (
        <div className="mt-3 space-y-2 rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-slate-50 p-3">
          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={(event) => void loadFile(event.target.files?.[0])}
            className="block w-full text-[11px] text-slate-600"
          />
          <textarea
            value={geojsonText}
            onChange={(event) => setGeojsonText(event.target.value)}
            rows={7}
            placeholder='Paste Polygon / MultiPolygon GeoJSON here'
            className="qfa-focus w-full rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white p-2 font-mono text-[11px] text-slate-800"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="Boundary source"
              className="qfa-focus h-8 rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2 text-xs text-slate-800"
            />
            <input
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="Version / date"
              className="qfa-focus h-8 rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2 text-xs text-slate-800"
            />
          </div>
          <p className="text-[11px] leading-4 text-slate-500">
            The server accepts only valid polygonal GeoJSON, converts it to a PostGIS MultiPolygon, and rejects invalid or overly complex geometry.
          </p>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton size="sm" onClick={save} disabled={!geojsonText.trim()}>
              Validate & save
            </PrimaryButton>
            {zone.boundary_configured ? (
              <SecondaryButton
                size="sm"
                onClick={() =>
                  ask(
                    "Clear service boundary",
                    "This removes polygon geofencing for this market. Location resolution will fall back to accepted Google city evidence until another boundary is saved.",
                    () => adminClearCityBoundary(city.id),
                  )
                }
              >
                Clear boundary
              </SecondaryButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CitiesPage({
  cities,
  serviceZones,
  notify,
  ask,
  runAction,
}: {
  cities: City[];
  serviceZones: MarketplaceServiceZone[];
  notify: (message: string) => void;
  ask: (title: string, message: string, action: () => ActionResult) => void;
  runAction: (title: string, action: () => ActionResult) => void;
}) {
  const [newCity, setNewCity] = useState("");
  const zonesByCity = useMemo(
    () => new Map(serviceZones.map((zone) => [zone.city_id, zone])),
    [serviceZones],
  );

  const active = cities.filter((city) => city.is_active).length;
  const matching = serviceZones.filter((zone) => zone.is_active && zone.matching_enabled).length;
  const polygonBacked = serviceZones.filter((zone) => Boolean(zone.boundary_configured)).length;

  function addCity() {
    const name = newCity.trim();
    if (!name) return;
    runAction("Add city", async () => {
      const result = await adminCreateCity({ name, is_active: false });
      if (result.ok) setNewCity("");
      return result;
    });
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Configured Cities" value={formatNumber(cities.length)} helper="Real rows in Supabase" icon="cities" />
        <StatCard label="Public Active" value={formatNumber(active)} helper="Shown in city selectors" icon="cities" tone="emerald" />
        <StatCard label="Matching Enabled" value={formatNumber(matching)} helper="Markets allowed to match" icon="reports" tone="amber" />
        <StatCard label="Polygon Geofences" value={formatNumber(polygonBacked)} helper="Reviewed boundaries loaded" icon="reports" tone="slate" />
      </section>

      <section className="qfa-panel p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Add marketplace city</span>
            <input
              value={newCity}
              onChange={(event) => setNewCity(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCity();
                }
              }}
              placeholder="e.g. Mumbai"
              className="qfa-focus h-[var(--qfa-control-h)] w-full rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-white px-3 text-[13px] text-slate-900"
            />
          </label>
          <PrimaryButton onClick={addCity} disabled={!newCity.trim()}>
            Add city
          </PrimaryButton>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-slate-500">
          New cities are created disabled for matching. Enable the city first, then enable matching when its service market is ready.
        </p>
      </section>

      <DataTable
        rows={cities}
        getRowKey={(item) => item.id}
        emptyTitle="No cities configured"
        emptyMessage="Add the first marketplace city above."
        columns={[
          {
            header: "City",
            cell: (item) => {
              const zone = zonesByCity.get(item.id);
              return (
                <Strong
                  title={item.name || "Unnamed city"}
                  subtitle={zone?.slug || item.slug || shortId(item.id)}
                />
              );
            },
          },
          {
            header: "Public Active",
            cell: (item) => (
              <ToggleSwitch
                checked={Boolean(item.is_active)}
                label={item.is_active ? "Active" : "Disabled"}
                onChange={(next) =>
                  ask(
                    next ? "Enable city" : "Disable city",
                    next
                      ? "This city will become available to public city selectors. Matching remains independently controlled."
                      : "This removes the city from public selectors and automatically disables matching for its market.",
                    () => adminSetCityActive(item.id, next),
                  )
                }
              />
            ),
          },
          {
            header: "Matching",
            cell: (item) => {
              const zone = zonesByCity.get(item.id);
              const enabled = Boolean(zone?.matching_enabled);
              return (
                <ToggleSwitch
                  checked={enabled}
                  disabled={!item.is_active || !zone}
                  label={enabled ? "Enabled" : "Off"}
                  onChange={(next) =>
                    ask(
                      next ? "Enable city matching" : "Disable city matching",
                      next
                        ? "Automatic matching may use this service market. Service-zone rules and straight-line distance remain authoritative."
                        : "Automatic matching for this city will be stopped.",
                      () => adminSetCityMatchingEnabled(item.id, next),
                    )
                  }
                />
              );
            },
          },
          {
            header: "Location Authority",
            cell: (item) => {
              const zone = zonesByCity.get(item.id);
              if (!zone) return <StatusBadge value="Missing zone" />;
              return zone.boundary_configured
                ? <StatusBadge value="Polygon verified" />
                : <StatusBadge value="Provisional city evidence" />;
            },
          },
          {
            header: "Require resolved zone",
            cell: (item) => {
              const zone = zonesByCity.get(item.id);
              if (!zone) return "—";
              return (
                <ToggleSwitch
                  checked={Boolean(zone.requires_resolved_location)}
                  label={zone.requires_resolved_location ? "Strict" : "Backfill mode"}
                  onChange={(next) =>
                    ask(
                      next ? "Require resolved service zone" : "Allow unresolved legacy locations",
                      next
                        ? "Automatic assignment will require both client and vendor to resolve to this market. A polygon gives verified geofence resolution; until then Google city evidence can resolve provisionally."
                        : "Legacy unresolved locations can continue through city compatibility fallback while you finish backfill.",
                      () => adminSetCityStrictLocation(item.id, next),
                    )
                  }
                />
              );
            },
          },
          {
            header: "Market config",
            cell: (item) => {
              const zone = zonesByCity.get(item.id);
              if (!zone) return "—";
              return <MarketConfigEditor city={item} zone={zone} runAction={runAction} />;
            },
          },
          {
            header: "Boundary",
            cell: (item) => {
              const zone = zonesByCity.get(item.id);
              if (!zone) return "—";
              return (
                <BoundaryEditor
                  city={item}
                  zone={zone}
                  ask={ask}
                  runAction={runAction}
                  notify={notify}
                />
              );
            },
          },
        ]}
      />

      <p className="text-[11px] leading-4 text-slate-500">
        City and matching state shown here are live Supabase controls. There are no prefilled Mumbai/Delhi/Bengaluru launch values in application code.
      </p>
    </div>
  );
}
