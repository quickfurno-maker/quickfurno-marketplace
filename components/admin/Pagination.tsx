"use client";

// ============================================================================
// Shared admin pagination control (C-PERF1).
//
// Renders "Showing A–B of N <noun>" + Previous / compact page numbers / Next.
// Page size is never user-selectable — it is locked policy (20 primary,
// 10 embedded; see lib/adminPaging.ts). Styling uses the dark command-center
// qfa tokens so every directory pages the same way.
// ============================================================================

import { pageWindow } from "@/lib/adminPaging";
import { formatNumber } from "./adminUtils";

/** Compact page list: 1 … p-1 p p+1 … last (deduped, sorted). */
function pageNumbers(pageCount: number, page: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const wanted = [1, 2, page - 1, page, page + 1, pageCount - 1, pageCount]
    .filter((n) => n >= 1 && n <= pageCount);
  const unique = [...new Set(wanted)].sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  unique.forEach((n, index) => {
    if (index > 0 && n - (unique[index - 1] as number) > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = "records",
  isPending = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** e.g. "leads", "vendors" — used in the range sentence. */
  noun?: string;
  isPending?: boolean;
}) {
  const { start, end, pageCount, page: current } = pageWindow(total, page, pageSize);
  if (total <= 0) return null;

  const btn =
    "qfa-focus inline-flex h-10 min-w-10 items-center justify-center rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2 text-xs font-semibold text-slate-700 transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:min-w-8";

  return (
    <nav
      className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between"
      aria-label={`Pagination for ${noun}`}
    >
      <p className="text-[11px] font-medium text-slate-500" aria-live="polite">
        Showing {formatNumber(start)}–{formatNumber(end)} of {formatNumber(total)} {noun}
        {isPending ? <span className="ml-2 text-slate-400">Loading…</span> : null}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`Previous page of ${noun}`} className={btn} disabled={current <= 1 || isPending} onClick={() => onPageChange(current - 1)}>
          Previous
        </button>
        <span className="hidden items-center gap-1 sm:flex">
          {pageNumbers(pageCount, current).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-xs text-slate-400">…</span>
            ) : (
              <button
                key={item}
                type="button"
                aria-label={`Page ${item}`}
                aria-current={item === current ? "page" : undefined}
                disabled={isPending}
                onClick={() => onPageChange(item)}
                className={
                  item === current
                    ? "qfa-focus inline-flex h-10 min-w-10 items-center justify-center rounded-[var(--qfa-radius-sm)] border border-[#2d7cff]/60 bg-[#2d7cff]/[0.16] px-2 text-xs font-bold text-white shadow-[0_0_12px_rgba(45,124,255,0.2)] sm:h-8 sm:min-w-8"
                    : btn
                }
              >
                {item}
              </button>
            ),
          )}
        </span>
        <span className="text-[11px] font-medium text-slate-500 sm:hidden">
          Page {formatNumber(current)} of {formatNumber(pageCount)}
        </span>
        <button type="button" aria-label={`Next page of ${noun}`} className={btn} disabled={current >= pageCount || isPending} onClick={() => onPageChange(current + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}
