"use client";

// ============================================================================
// Admin Dashboard V2 — shared visual primitives.
//
// This file is the single visual contract for the whole admin. Every screen
// renders through these components, so the look is changed HERE, once, rather
// than by editing twenty pages into slightly different dialects.
//
// Design rules encoded below:
//   * Hierarchy comes from surface + line + type weight, not from wrapping
//     everything in a floating white card. `Panel` is raised, `Quiet` is inset,
//     and most sections need the second one.
//   * Control heights are fixed by token (38px page-level, 32px in-row) so a
//     toolbar never looks assembled from mismatched parts.
//   * Native <select> chrome is stripped and redrawn — the OS default control
//     is the single biggest "generic template" tell.
//   * Status is never carried by colour alone.
//
// NOTE: the `.qfa-*` classes and `--qfa-*` tokens keep light values on :root
// and receive the DARK command-center values under `.admin-surface` (see
// app/globals.css). Every current consumer renders inside `.admin-surface`,
// so the admin is dark while anything outside that scope stays light.
// ============================================================================

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AdminIcon } from "./AdminIcon";
import type { AdminIconName } from "./adminConfig";

type BadgeTone = "emerald" | "blue" | "amber" | "rose" | "slate" | "violet" | "cyan";

/**
 * Badge palette. Deliberately low-saturation: a table cell may hold two or
 * three of these at once and bright pills turn a data row into confetti.
 */
const badgeToneClasses: Record<BadgeTone, string> = {
  emerald: "border-emerald-200/70 bg-emerald-50 text-emerald-800",
  blue: "border-sky-200/70 bg-sky-50 text-sky-800",
  amber: "border-amber-200/70 bg-amber-50 text-amber-900",
  rose: "border-rose-200/70 bg-rose-50 text-rose-800",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  violet: "border-violet-200/70 bg-violet-50 text-violet-800",
  cyan: "border-cyan-200/70 bg-cyan-50 text-cyan-800",
};

function toneFromValue(value?: string | null): BadgeTone {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("active") || normalized.includes("paid") || normalized.includes("approved") || normalized.includes("converted") || normalized.includes("won") || normalized.includes("read")) return "emerald";
  if (normalized.includes("assigned") || normalized.includes("contacted") || normalized.includes("verified") || normalized.includes("website") || normalized.includes("manual")) return "blue";
  if (normalized.includes("pending") || normalized.includes("new") || normalized.includes("soon") || normalized.includes("draft") || normalized.includes("hot") || normalized.includes("high")) return "amber";
  if (normalized.includes("failed") || normalized.includes("lost") || normalized.includes("blocked") || normalized.includes("rejected") || normalized.includes("expired") || normalized.includes("spam") || normalized.includes("invalid")) return "rose";
  if (normalized.includes("premium") || normalized.includes("growth") || normalized.includes("featured")) return "violet";
  return "slate";
}

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

/**
 * Compact page header.
 *
 * AdminShell already renders the breadcrumb, the page title and the section
 * description in its sticky bar. A page that ALSO rendered a full-height white
 * hero card was printing its own name twice and burning ~140px before any data
 * appeared. This is now a low-profile strip: optional meta chips, an optional
 * sub-title for pages the shell cannot name, and page-level actions on the
 * right. `title` is rendered as an h2, never an h1 — the shell owns the h1.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  /** Set when the shell already displays this exact title (the usual case). */
  titleHidden = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  titleHidden?: boolean;
}) {
  const hasText = !titleHidden || Boolean(description);
  if (!hasText && !meta && !actions) return null;

  return (
    <div className="flex flex-col gap-3 border-b border-[color:var(--qfa-line)] pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {titleHidden ? (
          <h2 className="sr-only">{title}</h2>
        ) : (
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
        )}
        {description ? (
          <p className={`max-w-3xl text-sm leading-5 text-slate-500 ${titleHidden ? "" : "mt-1"}`}>{description}</p>
        ) : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons — four roles, two sizes, no shadow overload
// ---------------------------------------------------------------------------

type ButtonSize = "sm" | "md";
type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  size?: ButtonSize;
  title?: string;
  className?: string;
  "aria-label"?: string;
};

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50";

function sizeClasses(size: ButtonSize) {
  return size === "sm"
    ? "h-8 rounded-[var(--qfa-radius-sm)] px-2.5 text-xs"
    : "h-[var(--qfa-control-h)] rounded-[var(--qfa-radius)] px-3.5 text-[13px]";
}

export function PrimaryButton({ children, onClick, disabled, size = "md", title, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={rest["aria-label"]}
      className={`${BUTTON_BASE} ${sizeClasses(size)} qfa-focus bg-emerald-600 text-white hover:bg-emerald-700 ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, size = "md", title, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={rest["aria-label"]}
      className={`${BUTTON_BASE} ${sizeClasses(size)} qfa-focus border border-[color:var(--qfa-line)] bg-white text-slate-700 hover:border-[color:var(--qfa-line-strong)] hover:bg-slate-50 ${className}`}
    >
      {children}
    </button>
  );
}

/** Lowest-weight action. Use inside dense rows and panel headers. */
export function GhostButton({ children, onClick, disabled, size = "sm", title, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={rest["aria-label"]}
      className={`${BUTTON_BASE} ${sizeClasses(size)} qfa-focus text-slate-600 hover:bg-slate-100 hover:text-slate-900 ${className}`}
    >
      {children}
    </button>
  );
}

export function DangerButton({ children, onClick, disabled, size = "md", title, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={rest["aria-label"]}
      className={`${BUTTON_BASE} ${sizeClasses(size)} qfa-focus border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 ${className}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Raised surface — for blocks that are genuinely their own object (a table, a
 * chart, a form). Prefer `Quiet` when the block is context rather than an
 * object; that choice is what keeps the page from reading as a card stack.
 */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`qfa-panel min-w-0 ${className}`}>{children}</div>;
}

/** Inset grouping. No elevation, soft line — recedes behind real content. */
export function Quiet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`qfa-quiet min-w-0 ${className}`}>{children}</div>;
}

/**
 * A short explanatory strip. Used for the honesty banners the admin relies on
 * ("visibility only", "counts over loaded rows"). Quiet by construction so it
 * informs without competing with the data underneath.
 */
export function NoteBar({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  const cls =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-[color:var(--qfa-line-soft)] bg-[color:var(--qfa-inset)] text-slate-600";
  return (
    <p className={`rounded-[var(--qfa-radius)] border px-3.5 py-2.5 text-[13px] leading-5 ${cls}`}>{children}</p>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`qfa-panel min-w-0 ${className}`}>
      {title || description || action ? (
        <div className="flex flex-col gap-2 border-b border-[color:var(--qfa-line-soft)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="text-[15px] font-semibold tracking-tight text-slate-950">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Compact stat tile.
 *
 * Previously a tall white card with an uppercase micro-label and a coloured
 * icon square — the single most template-looking element in the product. The
 * number now leads, the icon is a quiet mark rather than a colour block, and
 * the whole tile fits in roughly half the previous height.
 *
 * `trend` renders only when a caller passes a REAL comparison. Nothing here
 * fabricates a delta, a percentage or an arrow.
 */
export function StatCard({
  label,
  value,
  helper,
  icon,
  tone = "emerald",
  trend,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  icon: AdminIconName;
  tone?: "emerald" | "indigo" | "amber" | "rose" | "slate";
  trend?: ReactNode;
}) {
  const accent = {
    emerald: "text-emerald-600",
    indigo: "text-indigo-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
    slate: "text-slate-500",
  }[tone];

  return (
    <article className="qfa-panel group min-w-0 px-4 py-3.5 transition-colors hover:border-[color:var(--qfa-line-strong)]">
      <div className="flex items-center gap-2">
        <AdminIcon name={icon} className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
        <p className="min-w-0 truncate text-xs font-semibold text-slate-600">{label}</p>
      </div>
      <div className="mt-2 truncate text-[26px] font-semibold leading-none tracking-tight text-slate-950 tabular-nums">
        {value}
      </div>
      {helper || trend ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="min-w-0 truncate">{helper}</span>
          {trend ? <span className="shrink-0 font-semibold text-slate-600">{trend}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

export function StatusBadge({ value, tone }: { value?: string | null; tone?: BadgeTone }) {
  const label = value || "Unknown";
  const badgeTone = tone ?? toneFromValue(label);

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--qfa-radius-xs)] border px-1.5 py-0.5 text-[11px] font-semibold leading-4 ${badgeToneClasses[badgeTone]}`}
    >
      {label}
    </span>
  );
}

export function ProgressBar({ value, tone = "emerald" }: { value: number; tone?: "emerald" | "amber" | "rose" | "slate" }) {
  const color = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    slate: "bg-slate-400",
  }[tone];
  const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function ChartCard({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const chartRows = rows.length ? rows.slice(0, 7) : [{ label: "No data yet", value: 0 }];
  const hidden = Math.max(0, rows.length - 7);

  return (
    <SectionCard title={title}>
      <div className="space-y-2.5">
        {chartRows.map((row) => (
          <div key={row.label} className="space-y-1">
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="min-w-0 truncate text-slate-600">{row.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900">{row.value}</span>
            </div>
            <ProgressBar value={Math.max(row.value ? 6 : 3, (row.value / max) * 100)} />
          </div>
        ))}
        {hidden ? (
          <p className="pt-1 text-[11px] text-slate-500">
            +{hidden} more not shown — the top 7 by count are listed.
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Filters and search
// ---------------------------------------------------------------------------

export function Toolbar({
  query,
  setQuery,
  filters,
  action,
  placeholder = "Search…",
}: {
  query: string;
  setQuery: (value: string) => void;
  filters?: ReactNode;
  action?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="qfa-panel flex flex-col gap-2 p-2 xl:flex-row xl:items-center">
      <div className="qfa-control relative flex min-w-0 flex-1 items-center bg-[color:var(--qfa-inset)] xl:max-w-sm">
        <AdminIcon name="reports" className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-full w-full min-w-0 rounded-[inherit] bg-transparent pl-8 pr-3 text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {filters}
        {action}
      </div>
    </div>
  );
}

/**
 * Labelled select with the OS chrome removed.
 *
 * The native indicator is replaced by a drawn chevron so the control matches
 * every other 38px element in the toolbar, but the element underneath is still
 * a real <select> — keyboard behaviour, screen-reader semantics and mobile
 * pickers are unchanged. Accessibility is not traded for looks.
 */
export function SelectFilter({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <label className="qfa-control group relative inline-flex min-w-0 cursor-pointer items-center gap-1.5 pl-2.5">
      <span className="hidden shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:inline">
        {label}
      </span>
      <span className="sr-only sm:hidden">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="qfa-select h-full min-w-0 max-w-[10rem] truncate bg-transparent text-[13px] font-semibold text-slate-800 outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 text-[9px] text-slate-400 group-hover:text-slate-600">
        ▼
      </span>
    </label>
  );
}

/** Removable active-filter chip. */
export function FilterChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="qfa-focus inline-flex h-7 items-center gap-1.5 rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2 text-xs text-slate-700 transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-slate-50"
    >
      <span className="text-slate-500">{label}:</span>
      <span className="max-w-[10rem] truncate font-medium">{value}</span>
      <span aria-hidden="true" className="text-slate-400">×</span>
      <span className="sr-only">Remove {label} filter</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function DataTable<T>({
  columns,
  rows,
  emptyTitle,
  emptyMessage,
  /** "comfortable" (default) or "compact" for high-row-count operational lists. */
  density = "comfortable",
  /** Keeps the header visible while a long table scrolls inside the page. */
  stickyHeader = true,
  /** Optional row identity + selection highlight. */
  getRowKey,
  isRowActive,
  onRowClick,
}: {
  columns: Array<{ header: string; cell: (row: T) => ReactNode; className?: string }>;
  rows: T[];
  emptyTitle: string;
  emptyMessage: string;
  density?: "comfortable" | "compact";
  stickyHeader?: boolean;
  getRowKey?: (row: T, index: number) => string;
  isRowActive?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
}) {
  const cellPad = density === "compact" ? "px-3 py-2" : "px-3.5 py-2.5";

  return (
    <div className="qfa-panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left">
          <thead className={stickyHeader ? "sticky top-0 z-10" : undefined}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={`qfa-th whitespace-nowrap px-3.5 py-2.5 ${column.className ?? ""}`}
                >
                  {column.header || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, index) => {
                const active = isRowActive?.(row) ?? false;
                return (
                  <tr
                    key={getRowKey ? getRowKey(row, index) : index}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    aria-selected={isRowActive ? active : undefined}
                    className={`qfa-row transition-colors ${onRowClick ? "cursor-pointer" : ""} ${
                      active ? "bg-emerald-50/60" : ""
                    }`}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.header}
                        className={`qfa-td align-middle ${cellPad} ${
                          active ? "border-l-emerald-300" : ""
                        } ${column.className ?? ""}`}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10">
                  <EmptyState title={emptyTitle} message={emptyMessage} compact />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Secondary text inside a table cell. Quiet by default, including "—". */
export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-[11px] text-slate-500">{children}</span>;
}

/** Explicitly-empty value. Never shout about missing data. */
export function Blank() {
  return <span className="text-slate-300" aria-label="Not set">—</span>;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({ title, message, compact = false }: { title: string; message: string; compact?: boolean }) {
  return (
    <div
      className={`mx-auto max-w-md text-center ${
        compact ? "py-4" : "rounded-[var(--qfa-radius-lg)] border border-dashed border-[color:var(--qfa-line-strong)] bg-[color:var(--qfa-inset)] p-8"
      }`}
    >
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-[var(--qfa-radius)] bg-white text-slate-400 ring-1 ring-[color:var(--qfa-line)]">
        <AdminIcon name="reports" className="h-4 w-4" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
      {message ? <p className="mt-1 text-[13px] leading-5 text-slate-500">{message}</p> : null}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="qfa-panel h-24 animate-pulse px-4 py-3.5">
          <div className="h-3 w-24 rounded bg-slate-100" />
          <div className="mt-3 h-6 w-20 rounded bg-slate-100" />
          <div className="mt-3 h-2 w-full rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

/**
 * Right-hand detail drawer.
 *
 * Escape closes, focus moves into the panel on open and returns to the trigger
 * on close, and background scroll is locked — the previous version relied on a
 * backdrop mousedown alone, which left keyboard users stuck behind the overlay.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  header,
  footer,
  width = "xl",
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Extra chrome under the title — badges, key facts, inline actions. */
  header?: ReactNode;
  footer?: ReactNode;
  width?: "xl" | "2xl";
}) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex h-full w-full flex-col bg-[color:var(--qfa-page)] shadow-[var(--qfa-shadow-pop)] outline-none ${
          width === "2xl" ? "max-w-2xl" : "max-w-xl"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[color:var(--qfa-line)] bg-white px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
              {subtitle ? <div className="mt-0.5 truncate text-[13px] text-slate-500">{subtitle}</div> : null}
            </div>
            <SecondaryButton onClick={onClose} size="sm" aria-label="Close panel">
              Close
            </SecondaryButton>
          </div>
          {header ? <div className="mt-3">{header}</div> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-[color:var(--qfa-line)] bg-white px-5 py-3">{footer}</div>
        ) : null}
      </aside>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-[var(--qfa-radius-lg)] border border-[color:var(--qfa-line)] bg-white p-5 shadow-[var(--qfa-shadow-pop)]"
      >
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1.5 text-[13px] leading-5 text-slate-500">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onConfirm}>Confirm</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

/**
 * State switch.
 *
 * WITHOUT `onChange` this renders as a READ-ONLY state indicator, not a
 * control. That is deliberate: the previous version kept a local `useState` and
 * flipped visually on click while persisting nothing, so every one of its call
 * sites showed an operator a switch that silently did nothing. A switch that
 * cannot write must not look like a switch that can.
 */
export function ToggleSwitch({
  checked = false,
  label,
  onChange,
  disabled = false,
}: {
  checked?: boolean;
  label?: string;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  const readOnly = !onChange;
  const track = checked ? "bg-emerald-500" : "bg-slate-300";

  if (readOnly) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <span
          aria-hidden="true"
          className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 opacity-70 ${track}`}
        >
          <span className={`h-3 w-3 rounded-full bg-white ${checked ? "translate-x-3" : ""}`} />
        </span>
        <span>{label ?? (checked ? "On" : "Off")}</span>
        <span className="sr-only">(read-only)</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="qfa-focus inline-flex items-center gap-2 text-xs font-medium text-slate-600 disabled:opacity-50"
    >
      <span className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${track}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/**
 * Workspace tab navigation.
 *
 * Underline rather than bordered pills: pills at this count read as a row of
 * HTML buttons floating above the content, while an underline reads as part of
 * the workspace. Implements the ARIA tab pattern — arrow keys move between
 * tabs, Home/End jump to the ends.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  label = "Workspace sections",
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
  label?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const last = tabs.length - 1;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
      else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      if (next === null) return;
      event.preventDefault();
      onChange(tabs[next]);
      refs.current[next]?.focus();
    },
    [tabs, onChange],
  );

  return (
    <div role="tablist" aria-label={label} className="flex gap-0.5 overflow-x-auto border-b border-[color:var(--qfa-line)]">
      {tabs.map((tab, index) => {
        const selected = active === tab;
        return (
          <button
            key={tab}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onChange(tab)}
            className={`qfa-focus -mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${
              selected
                ? "border-emerald-600 text-slate-950"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
            }`}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export function ActionMenu({ actions }: { actions: Array<{ label: string; onClick: () => void; danger?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-away and Escape. The previous menu stayed open until it was clicked
  // again, so two open menus could overlap each other in a table.
  useEffect(() => {
    if (!open) return;
    function onDocDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <SecondaryButton size="sm" onClick={() => setOpen((value) => !value)}>
        Actions
        <span aria-hidden="true" className="text-[9px] text-slate-400">▼</span>
      </SecondaryButton>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-9 z-30 w-52 overflow-hidden rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-white py-1 shadow-[var(--qfa-shadow-pop)]"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
              className={`block w-full px-3 py-1.5 text-left text-[13px] font-medium transition-colors ${
                action.danger ? "text-rose-700 hover:bg-rose-50" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key / value
// ---------------------------------------------------------------------------

/**
 * Field list.
 *
 * Every field used to be its own bordered white card, which turned a detail
 * drawer into a mosaic of ~30 boxes with no way to scan it. It is now a real
 * definition list on hairline rows: label left, value right, aligned, so the
 * eye can run down one column.
 */
export function InfoGrid({ rows, columns = 1 }: { rows: Array<[string, ReactNode]>; columns?: 1 | 2 }) {
  return (
    <dl className={`qfa-quiet divide-y divide-[color:var(--qfa-line-soft)] overflow-hidden ${columns === 2 ? "sm:columns-2 sm:gap-0 sm:divide-y-0" : ""}`}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 px-3 py-2">
          <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="min-w-0 break-words text-right text-[13px] font-medium text-slate-900">
            {value === "" || value === null || value === undefined ? <Blank /> : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export function Toast({ message, tone = "info" }: { message: string; tone?: "success" | "error" | "info" }) {
  const color =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-[color:var(--qfa-line)] bg-white text-slate-900";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-[var(--qfa-radius)] border px-3.5 py-2.5 text-[13px] font-semibold shadow-[var(--qfa-shadow-pop)] ${color}`}
    >
      {message}
    </div>
  );
}

export const AdminStatCard = StatCard;
export const AdminSectionCard = SectionCard;
export const AdminDataTable = DataTable;
export const AdminBadge = StatusBadge;
export const AdminEmptyState = EmptyState;
export const AdminFilterBar = Toolbar;
export const AdminActionButton = PrimaryButton;
