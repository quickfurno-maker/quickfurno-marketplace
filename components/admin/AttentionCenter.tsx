"use client";

import Link from "next/link";
import { AdminIcon } from "./AdminIcon";
import type { AdminIconName } from "./adminConfig";

export type AttentionSeverity = "critical" | "warning" | "info" | "clear";

export type AttentionItem = {
  id: string;
  label: string;
  /** Real count from the snapshot. Never fabricated. */
  value: number;
  /** What the number actually means, in plain words. */
  detail: string;
  severity: AttentionSeverity;
  icon: AdminIconName;
  /** Only set when an existing admin route can actually action this. */
  href?: string;
  /**
   * True when the number is derived from the latest-N loaded rows rather than a
   * server-side aggregate. Rendered explicitly so a partial figure can never be
   * mistaken for a global total.
   */
  approximate?: boolean;
};

/** Severity is conveyed by label + icon + border, never by colour alone. */
const TONE: Record<AttentionSeverity, { wrap: string; chip: string; pill: string; word: string }> = {
  critical: {
    wrap: "border-rose-200 bg-rose-50/60 hover:border-rose-300",
    chip: "bg-rose-100 text-rose-700",
    pill: "border-rose-200 bg-white text-rose-700",
    word: "Critical",
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50/60 hover:border-amber-300",
    chip: "bg-amber-100 text-amber-800",
    pill: "border-amber-200 bg-white text-amber-800",
    word: "Needs action",
  },
  info: {
    wrap: "border-slate-200 bg-white hover:border-slate-300",
    chip: "bg-slate-100 text-slate-700",
    pill: "border-slate-200 bg-white text-slate-600",
    word: "Monitor",
  },
  clear: {
    wrap: "border-emerald-200 bg-emerald-50/50",
    chip: "bg-emerald-100 text-emerald-700",
    pill: "border-emerald-200 bg-white text-emerald-700",
    word: "Clear",
  },
};

export function AttentionCenter({ items }: { items: AttentionItem[] }) {
  const ranked = [...items].sort((a, b) => {
    const order: AttentionSeverity[] = ["critical", "warning", "info", "clear"];
    const bySeverity = order.indexOf(a.severity) - order.indexOf(b.severity);
    return bySeverity !== 0 ? bySeverity : b.value - a.value;
  });

  const needing = ranked.filter((item) => item.severity === "critical" || item.severity === "warning").length;

  return (
    <section aria-labelledby="qf-attention-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="qf-attention-heading" className="text-base font-semibold tracking-tight text-slate-950">
            Attention center
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {needing === 0
              ? "Nothing is waiting on a human decision right now."
              : `${needing} ${needing === 1 ? "queue needs" : "queues need"} a human decision.`}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden="true" />
          Live snapshot
        </span>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ranked.map((item) => {
          const tone = TONE[item.severity];
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone.chip}`}>
                  <AdminIcon name={item.icon} className="h-4 w-4" />
                </span>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.pill}`}
                >
                  {tone.word}
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-slate-950">{item.value}</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">{item.label}</p>
              <p className="mt-1 text-xs leading-4 text-slate-500">
                {item.detail}
                {item.approximate ? (
                  <span className="mt-1 block font-medium text-slate-400">
                    From the latest loaded rows — not a marketplace-wide total.
                  </span>
                ) : null}
              </p>
            </>
          );

          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  className={`block h-full rounded-xl border p-4 outline-none transition duration-150 hover:shadow-sm focus-visible:ring-4 focus-visible:ring-slate-200 ${tone.wrap}`}
                >
                  {body}
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                    Open queue
                    <span aria-hidden="true">→</span>
                  </span>
                </Link>
              ) : (
                <div className={`h-full rounded-xl border p-4 ${tone.wrap}`}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
