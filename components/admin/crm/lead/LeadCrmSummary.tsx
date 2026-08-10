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
    <div className="space-y-4">
      <section aria-labelledby="crm-attention-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="crm-attention-heading" className="text-[13px] font-bold uppercase tracking-wide text-slate-500">
            Needs attention
          </h2>
          <p className="text-[11px] text-slate-500">
            {openWork === 0
              ? "Nothing is waiting on a decision right now."
              : `${formatNumber(openWork)} lead${openWork === 1 ? "" : "s"} across ${attention.length} queues`}
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {attention.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} emphasis onClick={handlerFor(kpi)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="crm-volume-heading">
        <h2 id="crm-volume-heading" className="mb-2 text-[13px] font-bold uppercase tracking-wide text-slate-500">
          Pipeline volume
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {volume.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} onClick={handlerFor(kpi)} />
          ))}
        </div>
      </section>

      <p className="text-[11px] text-slate-500">
        Counts are computed from the leads currently loaded in this view. Selecting a tile filters the Lead Inbox.
      </p>
    </div>
  );
}

function KpiCard({ kpi, emphasis = false, onClick }: { kpi: Kpi; emphasis?: boolean; onClick: () => void }) {
  const idle = kpi.value === 0;
  const active = emphasis && !idle;
  // Emphasis is carried by the rail + the "Needs action" word, not colour
  // alone, so severity survives greyscale and colour-blind viewing.
  const frame = active
    ? "border-amber-200 bg-amber-50/50 hover:border-amber-300"
    : "border-[color:var(--qfa-line)] bg-white hover:border-[color:var(--qfa-line-strong)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`qfa-focus group relative flex w-full items-center gap-3 overflow-hidden rounded-[var(--qfa-radius-lg)] border px-3.5 py-3 text-left shadow-[var(--qfa-shadow-1)] transition-colors ${frame}`}
    >
      {active ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-amber-500" /> : null}
      <AdminIcon
        name={ICONS[kpi.key] ?? "crm"}
        className={`h-4 w-4 shrink-0 ${active ? "text-amber-600" : "text-slate-400"}`}
      />
      <span className="shrink-0 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-slate-950">
        {formatNumber(kpi.value)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-900">{kpi.label}</span>
        <span className="block truncate text-[11px] text-slate-500">{kpi.helper}</span>
      </span>
      {active ? (
        <span className="shrink-0 rounded-[var(--qfa-radius-xs)] border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
          Needs action
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0 text-xs font-semibold text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          →
        </span>
      )}
    </button>
  );
}
