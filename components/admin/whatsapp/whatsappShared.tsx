"use client";

// ============================================================================
// QuickFurno Admin V2 — WhatsApp Command Center shared view pieces (C-WA1).
//
// Every element here is presentational. Nothing fetches, mutates, sends or
// authorizes. Colour vocabulary is restricted to the shades the `.admin-surface`
// dark remap in app/globals.css actually covers — an unmapped shade would render
// as a light-theme blowout inside the dark command center.
// ============================================================================

import type { ReactNode } from "react";
import { EmptyState, StatusBadge } from "../AdminPrimitives";
import { formatDateTime } from "../adminUtils";
import type { SectionFault } from "@/services/adminWhatsAppService";
import { faultCopy } from "./whatsappAdminTypes";

/** A section that could not be read. Never rendered as an empty data table. */
export function FaultNotice({ fault }: { fault: SectionFault }) {
  const copy = faultCopy(fault);
  return <EmptyState title={copy.title} message={copy.message} />;
}

/** Inline variant for a stat slot whose value is unknown. */
export function UnknownValue({ label = "Unknown" }: { label?: string }) {
  return <span className="text-[13px] font-medium text-slate-400">{label}</span>;
}

/**
 * A count that may be unknown. A null count renders as "Unknown", never as 0 —
 * "we could not count" and "there are none" are different facts.
 */
export function CountValue({ value }: { value: number | null }) {
  if (value === null) return <UnknownValue />;
  return <span className="tabular-nums">{value.toLocaleString("en-IN")}</span>;
}

type Tone = "emerald" | "blue" | "amber" | "rose" | "slate" | "violet" | "cyan";

/** Closed readiness vocabulary → tone. An unknown state stays neutral. */
export function readinessTone(state: string): Tone {
  switch (state) {
    case "READY":
      return "emerald";
    case "INVALID":
      return "rose";
    case "MISSING":
      return "amber";
    case "DISABLED_BY_RUNTIME_POLICY":
    case "ACCOUNT_NOT_READY":
    case "MAPPING_NOT_READY":
    case "CANARY_NOT_READY":
      return "slate";
    default:
      return "slate";
  }
}

export function messageStatusTone(status: string): Tone {
  switch (status) {
    case "delivered":
    case "read":
      return "emerald";
    case "sent":
    case "accepted":
      return "blue";
    case "queued":
    case "dispatching":
    case "retry_scheduled":
      return "amber";
    case "failed":
    case "dead_letter":
      return "rose";
    default:
      return "slate";
  }
}

export function jobStatusTone(status: string): Tone {
  switch (status) {
    case "succeeded":
      return "emerald";
    case "processing":
      return "blue";
    case "pending":
    case "retry_scheduled":
      return "amber";
    case "failed":
    case "dead_letter":
      return "rose";
    case "uncertain":
      return "violet";
    default:
      return "slate";
  }
}

/** Renders a closed-vocabulary state verbatim — the source word, never a paraphrase. */
export function VocabBadge({ value, tone }: { value: string; tone?: Tone }) {
  return <StatusBadge value={value} tone={tone} />;
}

/**
 * The honesty strip used at the top of every tab. The admin must never have to
 * guess whether a screen can act; this says so in words.
 */
export function ReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-[color:var(--qfa-inset)] px-3.5 py-2.5 text-[13px] leading-5 text-slate-600">
      {children}
    </p>
  );
}

/** A compact label/value row grid used across the provider and detail views. */
export function FactGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-0.5 min-w-0 break-words text-[13px] text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Timestamp formatting. An absent value is an em dash, never "now" or "never". */
export function when(value?: string | null): string {
  return formatDateTime(value, "—");
}

/** Snake-case vocabulary rendered readably WITHOUT changing the underlying word. */
export function humanize(value: string): string {
  return value.replace(/_/g, " ");
}
