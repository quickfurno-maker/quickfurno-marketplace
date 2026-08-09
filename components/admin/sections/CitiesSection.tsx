"use client";

// ============================================================================
// C-PERF2: narrow section contract — the complete (small) city config set
// only. The previous demand/supply figures were counted from the latest-50
// lead/vendor snapshot subsets and could masquerade as marketplace truth, so
// they are removed rather than restyled; real per-city aggregates can return
// later behind purpose-built count queries.
// ============================================================================

import {
  adminSetCityActive,
} from "@/app/actions";
import {
  ActionMenu,
  DataTable,
  StatCard,
  StatusBadge,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type City } from "../adminTypes";
import {
  formatNumber,
  shortId,
} from "../adminUtils";
import { Strong } from "./shared";

export function CitiesPage({ cities, notify, ask }: { cities: City[]; notify: (message: string) => void; ask: any }) {
  const active = cities.filter((city) => city.is_active).length;
  const comingSoon = cities.filter((city) => city.launch_status === "Coming Soon").length;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Cities" value={formatNumber(cities.length)} helper="All configured cities" icon="cities" />
        <StatCard label="Active Cities" value={formatNumber(active)} helper="Accepting leads" icon="cities" tone="emerald" />
        <StatCard label="Coming Soon" value={formatNumber(comingSoon)} helper="Visible but paused" icon="notifications" tone="amber" />
        <StatCard label="Hidden" value={formatNumber(cities.length - active)} helper="Not shown on public forms" icon="reports" tone="slate" />
      </section>

      <DataTable
        rows={cities}
        getRowKey={(item) => item.id}
        emptyTitle="No cities found"
        emptyMessage="Cities from Supabase will appear here. Only active cities should show in public lead forms."
        columns={[
          { header: "City", cell: (item) => <Strong title={item.name || "Unnamed city"} subtitle={item.slug || shortId(item.id)} /> },
          { header: "State", cell: (item) => item.state || "Maharashtra" },
          { header: "Launch Status", cell: (item) => <StatusBadge value={item.launch_status || (item.is_active ? "Active" : "Hidden")} /> },
          { header: "Homepage", cell: (item) => <ToggleSwitch checked={Boolean(item.show_on_homepage ?? true)} /> },
          {
            header: "Actions",
            cell: (item) => (
              <ActionMenu
                actions={[
                  {
                    label: item.is_active ? "Disable" : "Enable",
                    onClick: () => ask("Update city", "This changes public form city visibility.", () => adminSetCityActive(item.id, !item.is_active)),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <p className="text-[11px] text-slate-500">
        Per-city demand/supply analytics are not shown here: the previous figures were derived from a latest-rows
        subset and could misrepresent marketplace totals. Locality management is not built yet.
      </p>
    </div>
  );
}
