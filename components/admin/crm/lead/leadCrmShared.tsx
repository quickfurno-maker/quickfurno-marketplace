"use client";

import {
  formatNumber,
} from "../../adminUtils";
import { type BadgeTone } from "./leadCrmTypes";

export function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    /* Drawer sections are grouped by a heading, not by another nested white
       card. Stacking ten bordered cards inside an already-panelled drawer was
       the main reason the detail view read as a wall. */
    <section>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export function MiniStat({ label, value, tone }: { label: string; value: number; tone: BadgeTone }) {
  const toneClass: Record<BadgeTone, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-sky-200 bg-sky-50 text-sky-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  };
  return (
    <div className={`rounded-[var(--qfa-radius)] border px-3 py-2 ${toneClass[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{formatNumber(value)}</p>
    </div>
  );
}
