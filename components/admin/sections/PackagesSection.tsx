"use client";

import {
  adminSetPackageActive,
} from "@/app/actions";
import {
  ActionMenu,
  DataTable,
  StatCard,
  StatusBadge,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type City, type Lead, type PackageRow, type Snapshot } from "../adminTypes";
import {
  formatINR,
  formatNumber,
  shortId,
} from "../adminUtils";
import { Strong } from "./shared";

export const packageTemplates = [
  { name: "Starter Package", price: "INR 1,250", leads: "5 leads", validity: "30 days", features: ["Basic delivery", "City/category match", "Standard support"] },
  { name: "Growth Package", price: "INR 3,500", leads: "15 leads", validity: "45 days", features: ["Priority delivery", "Daily lead controls", "Renewal alerts"] },
  { name: "Premium Package", price: "Custom", leads: "50 leads", validity: "90 days", features: ["Featured listing", "Priority delivery", "Performance review"] },
  { name: "Enterprise Package", price: "Custom", leads: "Custom", validity: "Custom", features: ["Dedicated support", "Featured placement", "Custom lead caps"] },
];

export function PackagesPage({ data, notify, ask }: { data: Snapshot; notify: (message: string) => void; ask: any }) {
  const activePackages = data.packages.filter((item) => item.is_active !== false).length;
  const avgLeadPrice = data.packages.length
    ? Math.round(data.packages.reduce((sum, item) => sum + Number(item.price_per_lead ?? 0), 0) / data.packages.length)
    : 0;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Packages" value={formatNumber(data.packages.length || packageTemplates.length)} helper="Live rows or templates" icon="packages" />
        <StatCard label="Active" value={formatNumber(activePackages)} helper="Visible for sales" icon="subscriptions" tone="emerald" />
        <StatCard label="Avg Lead Price" value={avgLeadPrice ? formatINR(avgLeadPrice) : "Prepared"} helper="From package rows" icon="payments" tone="indigo" />
        <StatCard label="Revenue" value={formatINR(data.stats.total_revenue)} helper="Paid collections" icon="reports" tone="amber" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.packages.length ? (
          data.packages.map((item) => (
            <PackageRowCard key={item.id} item={item} notify={notify} ask={ask} />
          ))
        ) : (
          packageTemplates.map((item) => (
            <PackageTemplateCard key={item.name} item={item} notify={notify} />
          ))
        )}
      </section>

      <DataTable
        rows={data.packages}
        emptyTitle="No packages in Supabase"
        emptyMessage="Package templates are shown above. Real package rows will appear here after creation."
        columns={[
          { header: "Package Name", cell: (item) => <Strong title={item.name || "Unnamed package"} subtitle={`ID ${shortId(item.id)}`} /> },
          { header: "Price", cell: (item) => formatINR(item.total_price || item.display_price) },
          { header: "Leads", cell: (item) => formatNumber(item.lead_count) },
          { header: "Per Lead", cell: (item) => item.price_per_lead ? formatINR(item.price_per_lead) : "Not set" },
          { header: "Validity", cell: (item) => `${formatNumber(item.validity_days)} days` },
          { header: "Status", cell: (item) => <StatusBadge value={item.is_active ? "Active" : "Inactive"} /> },
          {
            header: "Actions",
            cell: (item) => (
              <ActionMenu actions={[
                { label: item.is_active ? "Disable" : "Enable", onClick: () => ask("Update package", "This will change package visibility.", () => adminSetPackageActive(item.id, !item.is_active)) },
              ]} />
            ),
          },
        ]}
      />
    </div>
  );
}


export function PackageRowCard({ item, notify, ask }: { item: PackageRow; notify: (message: string) => void; ask: any }) {
  const features = packageFeatures(item);

  return (
    <article className="qf-card-shadow qf-card-hover rounded-xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-slate-950">{item.name || "Unnamed package"}</h2>
          <p className="mt-1 text-sm text-slate-500">{formatNumber(item.lead_count)} leads / {formatNumber(item.validity_days)} days</p>
        </div>
        <StatusBadge value={item.is_active ? "Active" : "Inactive"} />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">{formatINR(item.total_price || item.display_price)}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-600">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <ToggleSwitch checked={Boolean(item.is_active)} label="Visible" />
        <ActionMenu actions={[
          { label: item.is_active ? "Disable" : "Enable", onClick: () => ask("Update package", "This will change package visibility.", () => adminSetPackageActive(item.id, !item.is_active)) },
        ]} />
      </div>
    </article>
  );
}

export function PackageTemplateCard({ item, notify }: { item: (typeof packageTemplates)[number]; notify: (message: string) => void }) {
  return (
    <article className="rounded-lg border border-dashed border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{item.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{item.leads} / {item.validity}</p>
        </div>
        <StatusBadge value="Template" tone="slate" />
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">{item.price}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-600">
        {item.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {/* "Configure package" only fired a "Package editor placeholder ready."
          toast — there is no package editor. Activation, the one real control
          on this page, stays in the row action menu above. */}
    </article>
  );
}


export function packageFeatures(item: PackageRow) {
  return [
    `${formatNumber(item.lead_count)} verified leads`,
    `${formatNumber(item.validity_days)} day validity`,
    item.price_per_lead ? `${formatINR(item.price_per_lead)} per lead` : "Pricing review prepared",
  ];
}
