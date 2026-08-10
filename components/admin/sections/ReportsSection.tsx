"use client";

// ============================================================================
// C-PERF2: narrow section contract — a thin latest-N lead sample only,
// labelled as such. The previous per-report "Export" buttons performed
// nothing and are replaced by an honest scope list.
// ============================================================================

import {
  ChartCard,
  NoteBar,
  SectionCard,
  StatusBadge,
} from "../AdminPrimitives";
import type { LeadSampleRow } from "../adminTypes";
import {
  formatNumber,
  groupBy,
} from "../adminUtils";

export function ReportsPage({ leadSample }: { leadSample: Array<Pick<LeadSampleRow, "id" | "status" | "city" | "source" | "service_required" | "category">> }) {
  const reports = ["Daily leads", "Weekly leads", "Monthly leads", "Leads by category", "Leads by city", "Leads by source", "Vendor-wise usage", "Revenue by package", "Low balance vendors", "Duplicate/spam leads", "Lost lead reasons"];
  return (
    <div className="space-y-5">
      <NoteBar>
        Breakdowns below cover the latest {formatNumber(leadSample.length)} leads and are labelled as such. Accurate
        marketplace KPI totals live on the Dashboard and Analytics pages.
      </NoteBar>
      <section className="grid gap-4 xl:grid-cols-3">
        <ChartCard title={`Leads by Category (latest ${formatNumber(leadSample.length)})`} rows={groupBy(leadSample, (lead) => lead.service_required || lead.category)} />
        <ChartCard title={`Leads by City (latest ${formatNumber(leadSample.length)})`} rows={groupBy(leadSample, (lead) => lead.city)} />
        <ChartCard title={`Leads by Source (latest ${formatNumber(leadSample.length)})`} rows={groupBy(leadSample, (lead) => lead.source || "Website")} />
      </section>
      {/* The old grid rendered an Export button per report that was wired to
          nothing. Exports are not built; this list is scope, not controls. */}
      <SectionCard title="Planned exports" description="Not built yet — no export, CSV or print pipeline exists.">
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {reports.map((report) => (
            <li key={report} className="flex items-center justify-between gap-2 text-[13px] text-slate-700">
              <span className="min-w-0 truncate">{report}</span>
              <StatusBadge value="Not built" tone="slate" />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
