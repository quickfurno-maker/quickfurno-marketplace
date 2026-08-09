"use client";

import {
  formatNumber,
} from "../../adminUtils";
import { type BadgeTone } from "./leadCrmTypes";

export function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-950">{title}</h3>
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
    <div className={`rounded-xl border px-4 py-3 ${toneClass[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{formatNumber(value)}</p>
    </div>
  );
}
