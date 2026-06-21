"use client";

import { ReactNode, useState } from "react";
import { AdminIcon } from "./AdminIcon";
import type { AdminIconName } from "./adminConfig";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function PrimaryButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/10 transition hover:bg-emerald-700"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

export function StatCard({
  label,
  value,
  helper,
  icon,
  tone = "emerald",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  icon: AdminIconName;
  tone?: "emerald" | "indigo" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  }[tone];

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <div className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
        </div>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ${toneClass}`}>
          <AdminIcon name={icon} className="h-5 w-5" />
        </span>
      </div>
      {helper ? <p className="mt-4 text-xs font-medium text-slate-500">{helper}</p> : null}
    </article>
  );
}

export function StatusBadge({ value }: { value?: string | null }) {
  const label = value || "Unknown";
  const normalized = label.toLowerCase();
  const tone = normalized.includes("active") || normalized.includes("paid") || normalized.includes("approved") || normalized.includes("converted") || normalized.includes("read")
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : normalized.includes("pending") || normalized.includes("new") || normalized.includes("soon") || normalized.includes("draft")
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : normalized.includes("failed") || normalized.includes("lost") || normalized.includes("blocked") || normalized.includes("rejected") || normalized.includes("expired") || normalized.includes("spam")
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

export function Toolbar({
  query,
  setQuery,
  filters,
  action,
  placeholder = "Search...",
}: {
  query: string;
  setQuery: (value: string) => void;
  filters?: ReactNode;
  action?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-slate-300" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {filters}
        {action}
      </div>
    </div>
  );
}

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
    <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600">
      <span className="hidden sm:inline">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent text-sm font-semibold text-slate-800 outline-none">
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DataTable<T>({
  columns,
  rows,
  emptyTitle,
  emptyMessage,
}: {
  columns: Array<{ header: string; cell: (row: T) => ReactNode; className?: string }>;
  rows: T[];
  emptyTitle: string;
  emptyMessage: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column.header} className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${column.className ?? ""}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length > 0 ? (
              rows.map((row, index) => (
                <tr key={index} className="transition hover:bg-slate-50/70">
                  {columns.map((column) => (
                    <td key={column.header} className={`px-4 py-4 align-middle text-slate-700 ${column.className ?? ""}`}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12">
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

export function ChartCard({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const chartRows = rows.length ? rows.slice(0, 7) : [{ label: "No data yet", value: 0 }];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Live</span>
      </div>
      <div className="mt-5 space-y-4">
        {chartRows.map((row) => (
          <div key={row.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-4 text-xs font-medium">
              <span className="truncate text-slate-600">{row.label}</span>
              <span className="text-slate-900">{row.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(row.value ? 8 : 4, (row.value / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function EmptyState({ title, message, compact = false }: { title: string; message: string; compact?: boolean }) {
  return (
    <div className={`mx-auto max-w-md text-center ${compact ? "" : "rounded-2xl border border-dashed border-slate-300 bg-white p-8"}`}>
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <AdminIcon name="reports" className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-3 w-24 rounded bg-slate-100" />
          <div className="mt-5 h-7 w-20 rounded bg-slate-100" />
          <div className="mt-5 h-2 w-full rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm" onMouseDown={onClose}>
      <aside
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Close
          </button>
        </div>
        <div className="p-6">{children}</div>
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
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onConfirm}>Confirm</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export function ToggleSwitch({ checked: initial = false, label }: { checked?: boolean; label?: string }) {
  const [checked, setChecked] = useState(initial);
  return (
    <button
      type="button"
      onClick={() => setChecked((value) => !value)}
      className="inline-flex items-center gap-2 text-sm font-medium text-slate-600"
      aria-pressed={checked}
    >
      <span className={`flex h-6 w-11 items-center rounded-full p-1 transition ${checked ? "bg-emerald-500" : "bg-slate-200"}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : ""}`} />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${active === tab ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function ActionMenu({ actions }: { actions: Array<{ label: string; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
        Actions
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-20 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
              className="block w-full px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function InfoGrid({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">{value || "Not provided"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Toast({ message, tone = "info" }: { message: string; tone?: "success" | "error" | "info" }) {
  const color = tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-800";
  return (
    <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl ${color}`}>
      {message}
    </div>
  );
}
