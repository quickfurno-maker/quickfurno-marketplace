"use client";

import { type ReactNode } from "react";
import {
  ProgressBar,
} from "../AdminPrimitives";
import {
  formatNumber,
} from "../adminUtils";

export function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}


export function CreditsMeter({ value, total }: { value: number; total: number }) {
  const normalizedTotal = Math.max(total, value, 1);
  const percentage = Math.round((Math.max(value, 0) / normalizedTotal) * 100);
  const tone = percentage <= 20 ? "rose" : percentage <= 45 ? "amber" : "emerald";

  return (
    <div className="min-w-36 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-medium">
        <span className="text-slate-500">Credits</span>
        <span className="text-slate-900">{formatNumber(value)} / {formatNumber(normalizedTotal)}</span>
      </div>
      <ProgressBar value={percentage} tone={tone} />
    </div>
  );
}


export function Strong({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="min-w-44">
      <p className="font-semibold text-slate-950">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
