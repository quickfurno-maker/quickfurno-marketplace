"use client";

import {
  StatCard,
} from "../../AdminPrimitives";
import {
  type Lead,
} from "../../adminTypes";
import {
  formatNumber,
} from "../../adminUtils";
import { type QuickFilter, type Kpi } from "./leadCrmTypes";

export function Overview({ kpis, onCard, onGoFollowUps }: { kpis: Kpi[]; onCard: (f: QuickFilter) => void; onGoFollowUps: () => void }) {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const handler =
            kpi.key === "total"
              ? () => onCard("all")
              : kpi.key === "follow_ups"
                ? onGoFollowUps
                : () => onCard(kpi.key as QuickFilter);
          return (
            <button
              key={kpi.label}
              type="button"
              onClick={handler}
              className="rounded-2xl text-left outline-none transition focus-visible:ring-4 focus-visible:ring-emerald-100"
              title={`Filter: ${kpi.label}`}
            >
              <StatCard label={kpi.label} value={formatNumber(kpi.value)} helper={kpi.helper} icon="crm" tone={kpi.tone} />
            </button>
          );
        })}
      </section>
      <p className="text-xs text-slate-500">Tap any card to jump into the Lead Inbox filtered for that segment.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead Inbox
// ---------------------------------------------------------------------------
