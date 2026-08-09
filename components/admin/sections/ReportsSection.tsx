"use client";

import {
  ChartCard,
} from "../AdminPrimitives";
import { type Category, type City, type Snapshot, type Vendor } from "../adminTypes";
import {
  groupBy,
} from "../adminUtils";

export function ReportsPage({ data }: { data: Snapshot }) {
  const reports = ["Daily leads", "Weekly leads", "Monthly leads", "Leads by category", "Leads by city", "Leads by source", "Vendor-wise usage", "Revenue by package", "Low balance vendors", "Duplicate/spam leads", "Lost lead reasons"];
  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Leads by Category" rows={groupBy(data.leads, (lead) => lead.service_required || lead.category)} />
        <ChartCard title="Leads by City" rows={groupBy(data.leads, (lead) => lead.city)} />
        <ChartCard title="Leads by Source" rows={groupBy(data.leads, (lead) => lead.source || "Website")} />
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => (
          <article key={report} className="qfa-panel p-4">
            <h2 className="text-base font-semibold text-slate-950">{report}</h2>
            <p className="mt-2 text-sm text-slate-500">CSV, Excel-compatible export, and printable layout placeholder.</p>
            <button type="button" className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Export</button>
          </article>
        ))}
      </section>
    </div>
  );
}
