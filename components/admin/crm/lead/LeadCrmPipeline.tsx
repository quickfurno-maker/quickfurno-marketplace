"use client";

import {
  StatusBadge,
} from "../../AdminPrimitives";
import { formatDate } from "../../adminUtils";
import { PIPELINE_COLUMNS, PRIORITY_TONE, type CrmRow } from "./leadCrmTypes";
import {
  preferredBadge,
  cap,
} from "./leadCrmUtils";

/** Cards rendered per column before the "+N more" notice. */
const PIPELINE_CARD_LIMIT = 8;

export function PipelineBoard({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  return (
    <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
      {PIPELINE_COLUMNS.map((column) => {
        const columnRows = rows.filter((row) => (column.bucket === "spam" ? row.bucket === "spam" || row.bucket === "duplicate" : row.bucket === column.bucket));
        const headingId = `pipeline-${column.bucket}`;
        return (
          <section
            key={column.bucket}
            aria-labelledby={headingId}
            className="qfa-quiet flex min-w-0 flex-col p-2.5"
          >
            <div className="flex items-center justify-between gap-2 px-0.5 pb-2">
              <h3 id={headingId} className="truncate text-[13px] font-semibold text-slate-900">
                {column.label}
              </h3>
              <span className="shrink-0 rounded-[var(--qfa-radius-xs)] bg-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 ring-1 ring-[color:var(--qfa-line)]">
                {columnRows.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {columnRows.length ? (
                columnRows.slice(0, PIPELINE_CARD_LIMIT).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelect(row)}
                    className="qfa-focus block w-full rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-white p-2.5 text-left transition-colors hover:border-[color:var(--qfa-line-strong)]"
                  >
                    <p className="truncate text-[13px] font-semibold text-slate-900">{row.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{row.service} · {row.city}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} />
                      {row.preferredBadge ? <StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /> : null}
                      <StatusBadge
                        value={row.assignedCount === 0 ? "Unassigned" : `${row.assignedCount} vendor${row.assignedCount === 1 ? "" : "s"}`}
                        tone={row.assignedCount === 0 ? "amber" : "slate"}
                      />
                    </div>
                    <p className="mt-1.5 truncate text-[10px] text-slate-400">
                      Created {formatDate(row.createdAt)}
                      {row.followUp ? ` · Follow-up ${formatDate(row.followUp)}` : ""}
                    </p>
                  </button>
                ))
              ) : (
                <p className="px-1 py-3 text-center text-[11px] text-slate-400">No leads</p>
              )}
              {/* The board cut off at 8 cards with no indication, so a busy
                  column silently hid leads. Say what is not shown — once. An
                  earlier pass left two overlapping "+N more" notices here. */}
              {columnRows.length > PIPELINE_CARD_LIMIT ? (
                <p className="px-0.5 pt-0.5 text-[11px] font-medium text-slate-500">
                  +{columnRows.length - PIPELINE_CARD_LIMIT} more not shown — open the Lead Inbox to see them all.
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups (real follow_up_date data only)
// ---------------------------------------------------------------------------
