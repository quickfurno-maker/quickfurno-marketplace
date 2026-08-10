// ============================================================================
// QuickFurno — lib/adminPaging.ts
// C-PERF1: the LOCKED admin pagination policy, shared by every admin
// directory loader and by the shared <Pagination /> UI.
//
//   * Primary full-page operational directories: 20 rows per page, always.
//   * Embedded / dashboard / preview panels: 10 records maximum.
//   * There is deliberately NO page-size parameter in the directory query
//     types and NO page-size selector in the UI — page size is policy, not
//     preference. Normal admin routes can therefore never request 50/100/all.
//
// Server reads must be bounded AT THE QUERY (range/limit), never by slicing
// an oversized payload after the fact.
// ============================================================================

/** Locked page size for full-page admin directories (Leads, Vendors, CRM Inbox…). */
export const ADMIN_DIRECTORY_PAGE_SIZE = 20;

/** Locked maximum for embedded/dashboard/preview panels. */
export const ADMIN_EMBEDDED_PANEL_LIMIT = 10;

/** One page of a server-paged admin directory. `total` is the COUNT of all
 *  matching rows in the database, independent of the rows loaded. */
export type DirectoryPage<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
};

/** Normalize an untrusted page value (URL param / client input) to a
 *  1-based positive integer. Anything invalid becomes page 1. */
export function boundPage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  // Hard sanity ceiling so a hostile ?page=1e9 cannot request absurd offsets.
  return Math.min(n, 10_000);
}

/** Inclusive from/to range for supabase .range() at the locked page size. */
export function pageRange(page: number, pageSize: number = ADMIN_DIRECTORY_PAGE_SIZE) {
  const from = (boundPage(page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/**
 * Sanitize a user search term before it is embedded into a PostgREST
 * `.or("col.ilike.*term*")` filter string. Strips the grammar characters
 * (commas, parentheses, quotes, dots used as separators) and the ilike
 * wildcards, so user input can never alter the filter structure.
 */
export function sanitizeSearchTerm(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[,()"'\\%_*.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Sanitize an exact-match filter value for embedding into a PostgREST
 *  or() expression. Values are quoted at the call site; this strips the
 *  characters that could escape the quoting. */
export function sanitizeFilterValue(raw: unknown): string {
  return String(raw ?? "").replace(/["\\]/g, "").trim().slice(0, 120);
}

/** Display window for "Showing A–B of N". */
export function pageWindow(total: number, page: number, pageSize: number) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safePage = boundPage(page);
  const pageCount = Math.max(1, Math.ceil(safeTotal / pageSize));
  const clampedPage = Math.min(safePage, pageCount);
  const start = safeTotal === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const end = Math.min(safeTotal, clampedPage * pageSize);
  return { start, end, pageCount, page: clampedPage };
}
