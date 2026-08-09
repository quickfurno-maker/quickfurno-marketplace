"use client";

import {
  adminSetCityActive,
} from "@/app/actions";
import {
  ActionMenu,
  DataTable,
  ProgressBar,
  StatCard,
  StatusBadge,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type City, type Snapshot } from "../adminTypes";
import {
  formatNumber,
  shortId,
} from "../adminUtils";
import { Strong } from "./shared";

export function CitiesPage({ data, notify, ask }: { data: Snapshot; notify: (message: string) => void; ask: any }) {
  const active = data.cities.filter((city) => city.is_active).length;
  const comingSoon = data.cities.filter((city) => city.launch_status === "Coming Soon").length;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Cities" value={formatNumber(data.cities.length)} helper="All configured cities" icon="cities" />
        <StatCard label="Active Cities" value={formatNumber(active)} helper="Accepting leads" icon="cities" tone="emerald" />
        <StatCard label="Coming Soon" value={formatNumber(comingSoon)} helper="Visible but paused" icon="notifications" tone="amber" />
        <StatCard label="Locality Manager" value="Prepared" helper="Placeholder UI only" icon="reports" tone="slate" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.cities.slice(0, 6).map((city) => (
          <CityCoverageCard key={city.id} city={city} data={data} />
        ))}
      </section>

      <DataTable
        rows={data.cities}
        emptyTitle="No cities found"
        emptyMessage="Cities from Supabase will appear here. Only active cities should show in public lead forms."
        columns={[
          { header: "City", cell: (item) => <Strong title={item.name || "Unnamed city"} subtitle={item.slug || shortId(item.id)} /> },
          { header: "State", cell: (item) => item.state || "Maharashtra" },
          { header: "Demand", cell: (item) => <StatusBadge value={`${formatNumber(cityDemand(item, data))} leads`} tone="blue" /> },
          { header: "Supply", cell: (item) => <StatusBadge value={`${formatNumber(citySupply(item, data))} vendors`} tone="emerald" /> },
          { header: "Launch Status", cell: (item) => <StatusBadge value={item.launch_status || (item.is_active ? "Active" : "Hidden")} /> },
          { header: "Homepage", cell: (item) => <ToggleSwitch checked={Boolean(item.show_on_homepage ?? true)} /> },
          { header: "Localities", cell: () => <StatusBadge value="Manager prepared" tone="slate" /> },
          { header: "Actions", cell: (item) => <ActionMenu actions={[{ label: item.is_active ? "Disable" : "Enable", onClick: () => ask("Update city", "This changes public form city visibility.", () => adminSetCityActive(item.id, !item.is_active)) }, { label: "Manage localities", onClick: () => notify("Locality manager placeholder ready.") }]} /> },
        ]}
      />
    </div>
  );
}


export function CityCoverageCard({ city, data }: { city: City; data: Snapshot }) {
  const demand = cityDemand(city, data);
  const supply = citySupply(city, data);
  const balance = demand ? Math.min(100, Math.round((supply / Math.max(demand, 1)) * 100)) : supply ? 100 : 0;

  return (
    <article className="qf-card-shadow qf-card-hover rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200">
      <div className="flex items-start justify-between gap-3">
        <Strong title={city.name || "Unnamed city"} subtitle={city.state || "Maharashtra"} />
        <StatusBadge value={city.launch_status || (city.is_active ? "Active" : "Hidden")} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Demand</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(demand)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">Supply</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(supply)}</p>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
          <span>Demand/supply fit</span>
          <span>{formatNumber(balance)}%</span>
        </div>
        <ProgressBar value={balance} tone={balance >= 60 ? "emerald" : balance >= 30 ? "amber" : "rose"} />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
        <span className="text-sm font-semibold text-slate-600">Localities</span>
        <StatusBadge value="Prepared" tone="slate" />
      </div>
    </article>
  );
}


export function cityDemand(city: City, data: Snapshot) {
  return data.leads.filter((lead) => String(lead.city ?? "").toLowerCase() === String(city.name ?? "").toLowerCase()).length;
}

export function citySupply(city: City, data: Snapshot) {
  return data.vendors.filter((vendor) => String(vendor.city ?? "").toLowerCase() === String(city.name ?? "").toLowerCase()).length;
}
