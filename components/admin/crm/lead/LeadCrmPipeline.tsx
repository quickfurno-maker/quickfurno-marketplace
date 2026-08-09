"use client";

import {
  StatusBadge,
} from "../../AdminPrimitives";
import { PIPELINE_COLUMNS, PRIORITY_TONE, type CrmRow } from "./leadCrmTypes";
import {
  preferredBadge,
  cap,
} from "./leadCrmUtils";

export function PipelineBoard({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PIPELINE_COLUMNS.map((column) => {
        const columnRows = rows.filter((row) => (column.bucket === "spam" ? row.bucket === "spam" || row.bucket === "duplicate" : row.bucket === column.bucket));
        return (
          <section key={column.bucket} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">{column.label}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{columnRows.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {columnRows.length ? (
                columnRows.slice(0, 8).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelect(row)}
                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
                  >
                    <p className="truncate text-sm font-semibold text-slate-900">{row.name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{row.service} · {row.city}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} />
                      {row.preferredBadge ? <StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /> : null}
                    </div>
                  </button>
                ))
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No leads</p>
              )}
              {columnRows.length > 8 ? <p className="px-1 text-center text-xs text-slate-400">+{columnRows.length - 8} more</p> : null}
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
