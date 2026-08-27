"use client";

import Link from "next/link";
import { AdminIcon } from "./AdminIcon";
import type { AdminIconName } from "./adminConfig";

/**
 * `unavailable` is not a degree of severity — it is the absence of a fact.
 *
 * It exists because an operations queue that cannot read a source must say so.
 * Rendering an unreadable source as a calm zero is the one failure mode this
 * component is not allowed to have, so `unavailable` is a first-class state
 * with its own word, its own rail and its own rank.
 */
export type AttentionSeverity = "critical" | "unavailable" | "warning" | "info" | "clear";

export type AttentionItem = {
  id: string;
  label: string;
  /**
   * A PROVEN count, or null when the source could not be read.
   *
   * null is NOT zero. It is never coerced, never summed, never sorted as zero
   * and never rendered as a number — it renders as "Unavailable" and forces the
   * row into the `unavailable` state regardless of the severity passed in.
   */
  value: number | null;
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

/** Severity is conveyed by label + icon + rail, never by colour alone. */
const TONE: Record<AttentionSeverity, { rail: string; chip: string; icon: string; word: string }> = {
  critical: {
    rail: "bg-rose-500",
    chip: "border-rose-200 bg-rose-50 text-rose-800",
    icon: "text-rose-600",
    word: "Critical",
  },
  unavailable: {
    rail: "bg-slate-400",
    chip: "border-dashed border-slate-400 bg-slate-50 text-slate-700",
    icon: "text-slate-500",
    word: "Unavailable",
  },
  warning: {
    rail: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-900",
    icon: "text-amber-600",
    word: "Needs action",
  },
  info: {
    rail: "bg-slate-300",
    chip: "border-slate-200 bg-slate-50 text-slate-700",
    icon: "text-slate-500",
    word: "Monitor",
  },
  clear: {
    rail: "bg-emerald-400",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: "text-emerald-600",
    word: "Clear",
  },
};

/**
 * An unreadable count outranks every state except a proven critical one: it may
 * be concealing a critical, so it must never sink below the healthy rows.
 */
const SEVERITY_ORDER: AttentionSeverity[] = ["critical", "unavailable", "warning", "info", "clear"];

/**
 * The single place severity is decided.
 *
 * A null value forces `unavailable` whatever the caller passed, which is what
 * makes "sorted as a healthy zero" and "labelled Clear" structurally
 * unreachable rather than merely discouraged.
 */
function effectiveSeverity(item: AttentionItem): AttentionSeverity {
  return item.value === null ? "unavailable" : item.severity;
}

/**
 * The operational queue.
 *
 * A ranked list: severity rail, the count (or an explicit Unavailable), what it
 * means, and the route that actions it. Scanning top-to-bottom answers "what do
 * I do next?" in one pass.
 */
export function AttentionCenter({ items }: { items: AttentionItem[] }) {
  const ranked = [...items].sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(effectiveSeverity(a)) - SEVERITY_ORDER.indexOf(effectiveSeverity(b));
    if (bySeverity !== 0) return bySeverity;
    // An unknown value sorts below every proven one inside the same state.
    return (b.value ?? -1) - (a.value ?? -1);
  });

  const needing = ranked.filter((item) => {
    const severity = effectiveSeverity(item);
    return severity === "critical" || severity === "warning";
  }).length;

  const unavailable = ranked.filter((item) => effectiveSeverity(item) === "unavailable").length;

  const summary = (() => {
    const decisions =
      needing === 0 ? null : `${needing} ${needing === 1 ? "queue needs" : "queues need"} a decision`;
    const unread =
      unavailable === 0
        ? null
        : `${unavailable} ${unavailable === 1 ? "source" : "sources"} could not be read`;

    if (decisions && unread) return `${decisions} · ${unread}`;
    if (decisions) return decisions;
    // Never claim nothing is waiting while a source is unreadable.
    if (unread) return `${unread} — health cannot be confirmed`;
    return "Nothing is waiting on a human decision right now.";
  })();

  return (
    <section aria-labelledby="qf-attention-heading" className="qfa-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--qfa-line-soft)] px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id="qf-attention-heading" className="text-[15px] font-semibold tracking-tight text-slate-950">
            Attention center
          </h2>
          <p className="min-w-0 truncate text-xs text-slate-500">{summary}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${unavailable === 0 ? "bg-emerald-500" : "bg-amber-500"}`}
            aria-hidden="true"
          />
          {unavailable === 0 ? "Live snapshot" : "Partial snapshot"}
        </span>
      </div>

      <ul className="divide-y divide-[color:var(--qfa-line-soft)]">
        {ranked.map((item) => {
          const severity = effectiveSeverity(item);
          const tone = TONE[severity];
          const unknown = item.value === null;
          const body = (
            <>
              <span aria-hidden="true" className={`h-9 w-0.5 shrink-0 rounded-full ${tone.rail}`} />
              <AdminIcon name={item.icon} className={`h-4 w-4 shrink-0 ${tone.icon}`} />

              <span className="w-24 shrink-0 sm:w-28">
                <span
                  className={`inline-flex items-center rounded-[var(--qfa-radius-xs)] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.chip}`}
                >
                  {tone.word}
                </span>
              </span>

              <span className="w-14 shrink-0 text-right text-lg font-semibold tabular-nums leading-none text-slate-950 sm:w-16">
                {unknown ? (
                  <>
                    <span aria-hidden="true" className="text-slate-400">
                      —
                    </span>
                    <span className="sr-only">Unavailable</span>
                  </>
                ) : (
                  item.value
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-900">{item.label}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {item.detail}
                  {item.approximate && !unknown
                    ? " Counted over the latest loaded rows, not marketplace-wide."
                    : ""}
                </span>
              </span>

              {item.href ? (
                <span className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-slate-500 transition-colors group-hover:text-emerald-700 sm:inline-flex">
                  Open queue
                  <span aria-hidden="true">→</span>
                </span>
              ) : null}
            </>
          );

          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="qfa-focus group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[color:var(--qfa-inset)]"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
