"use client";

import { AdminIcon } from "../../AdminIcon";
import type { AdminIconName } from "../../adminConfig";
import { formatNumber } from "../../adminUtils";
import { type QuickFilter, type Kpi } from "./leadCrmTypes";

/**
 * Operational summary for the Lead CRM.
 *
 * Every figure comes from buildKpis(), which counts the already-loaded snapshot
 * rows deterministically. There are no trends, forecasts, probabilities or
 * scores here — the snapshot exposes no historical comparison, so showing one
 * would be fabricated.
 *
 * The strip is split into "Needs attention" (queues a human must act on) and
 * "Pipeline volume" (context), because a flat grid of eleven equal cards makes
 * the actionable ones disappear.
 */

/** Queues that represent work waiting on a human, in priority order. */
const ATTENTION_KEYS = ["unassigned", "follow_ups", "hot"] as const;

const ICONS: Record<string, AdminIconName> = {
  total: "leads",
  new_today: "leads",
  hot: "notifications",
  unassigned: "distribution",
  assigned: "vendors",
  vendor_selected: "vendors",
  follow_ups: "crm",
  site_visit: "cities",
  won: "reports",
  lost: "reports",
  spam_dup: "audit",
};

export function Overview({
  kpis,
  onCard,
  onGoFollowUps,
}: {
  kpis: Kpi[];
  onCard: (f: QuickFilter) => void;
  onGoFollowUps: () => void;
}) {
  const handlerFor = (kpi: Kpi) =>
    kpi.key === "total"
      ? () => onCard("all")
      : kpi.key === "follow_ups"
        ? onGoFollowUps
        : () => onCard(kpi.key as QuickFilter);

  const attention = ATTENTION_KEYS.map((key) => kpis.find((k) => k.key === key)).filter(
    (k): k is Kpi => Boolean(k),
  );
  const volume = kpis.filter((k) => !ATTENTION_KEYS.includes(k.key as (typeof ATTENTION_KEYS)[number]));
  const openWork = attention.reduce((sum, k) => sum + k.value, 0);

  return (
    <div className="space-y-6">
      <section aria-labelledby="crm-attention-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="crm-attention-heading" className="text-base font-semibold tracking-tight text-slate-950">
            Needs attention
          </h2>
          <p className="text-sm text-slate-500">
            {openWork === 0
              ? "Nothing is waiting on a decision right now."
              : `${formatNumber(openWork)} lead${openWork === 1 ? "" : "s"} across ${attention.length} queues.`}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {attention.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} emphasis onClick={handlerFor(kpi)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="crm-volume-heading">
        <h2 id="crm-volume-heading" className="mb-3 text-base font-semibold tracking-tight text-slate-950">
          Pipeline volume
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {volume.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} onClick={handlerFor(kpi)} />
          ))}
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Counts are computed from the leads currently loaded in this view. Selecting a card filters the Lead Inbox.
      </p>
    </div>
  );
}

function KpiCard({ kpi, emphasis = false, onClick }: { kpi: Kpi; emphasis?: boolean; onClick: () => void }) {
  const idle = kpi.value === 0;
  // Emphasis is carried by the border + the "Open" affordance text, not colour
  // alone, so severity survives greyscale and colour-blind viewing.
  const frame = emphasis && !idle ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white";
  const chip = emphasis && !idle ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full flex-col rounded-xl border p-4 text-left outline-none transition duration-150 hover:shadow-sm focus-visible:ring-4 focus-visible:ring-slate-200 ${frame}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${chip}`}>
          <AdminIcon name={ICONS[kpi.key] ?? "crm"} className="h-4 w-4" />
        </span>
        {emphasis && !idle ? (
          <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Needs action
          </span>
        ) : null}
      </span>
      <span className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-slate-950">
        {formatNumber(kpi.value)}
      </span>
      <span className="mt-0.5 truncate text-sm font-semibold text-slate-800">{kpi.label}</span>
      <span className="mt-0.5 text-xs text-slate-500">{kpi.helper}</span>
      <span className="mt-2 text-xs font-semibold text-slate-600 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        Filter inbox →
      </span>
    </button>
  );
}
