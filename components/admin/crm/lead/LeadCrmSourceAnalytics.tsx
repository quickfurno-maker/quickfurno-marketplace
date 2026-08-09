"use client";

import {
  ChartCard,
} from "../../AdminPrimitives";
import { type CrmRow } from "./leadCrmTypes";
import {
  countByField,
} from "./leadCrmUtils";

export function SourceAnalytics({ rows }: { rows: CrmRow[] }) {
  const bySource = countByField(rows, (r) => r.source);
  const byUtm = countByField(rows, (r) => String(r.lead.utm_source ?? "").trim() || "Direct / none");
  const byCity = countByField(rows, (r) => r.city);
  const byService = countByField(rows, (r) => r.service);
  const preferredCount = rows.filter((r) => r.isPreferred).length;
  const intentRows = [
    { label: "Preferred vendor (client picked)", value: preferredCount },
    { label: "General auto-match", value: rows.length - preferredCount },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Leads by source" rows={bySource} />
      <ChartCard title="Leads by UTM source" rows={byUtm} />
      <ChartCard title="Leads by city" rows={byCity} />
      <ChartCard title="Leads by service / category" rows={byService} />
      <ChartCard title="Preferred vendor vs general" rows={intentRows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nurture (real: leads flagged nurture)
// ---------------------------------------------------------------------------
