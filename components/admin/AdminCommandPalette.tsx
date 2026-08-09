"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminIcon } from "./AdminIcon";
import { adminNavGroups, adminSections, getAdminSectionByKey } from "./adminConfig";
import { useAdminModalFocus } from "./useAdminModalFocus";

/**
 * Navigation-only command palette.
 *
 * It resolves EXCLUSIVELY against the statically declared admin sections in
 * adminConfig — no database search, no new backend authority, no network call.
 * That keeps the topbar search honest: everything it offers is a route that
 * already exists and that the current user can already reach from the sidebar.
 */
export function AdminCommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of adminNavGroups) {
      for (const key of group.sections) map.set(key, group.title);
    }
    return map;
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ordered = adminNavGroups.flatMap((group) =>
      group.sections.map((key) => getAdminSectionByKey(key)),
    );
    const seen = new Set<string>();
    const unique = ordered.filter((s) => (seen.has(s.key) ? false : seen.add(s.key)));
    const rest = adminSections.filter((s) => !seen.has(s.key));
    const all = [...unique, ...rest];
    if (!q) return all.slice(0, 8);
    return all
      .filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.key.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useAdminModalFocus({ open, containerRef: dialogRef, initialFocusRef: inputRef, onClose });

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const activeResultId = results[active] ? `qf-cmdk-option-${results[active].key}` : undefined;

  function go(href: string) {
    onClose();
    setQuery("");
    router.push(href);
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Admin command palette"
    >
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        tabIndex={-1}
      />

      <div
        className="qf-cmdk relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4">
          <AdminIcon name="reports" className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a section…"
            aria-label="Search admin sections"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="qf-cmdk-results"
            aria-activedescendant={activeResultId}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => (results.length ? (index + 1) % results.length : 0));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const hit = results[active];
                if (hit) go(hit.href);
              }
            }}
            className="h-14 w-full border-0 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="qfa-focus inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--qfa-radius)] border border-slate-200 text-lg text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div id="qf-cmdk-results" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p role="status" className="px-3 py-8 text-center text-sm text-slate-500">
              No admin section matches “{query.trim()}”.
            </p>
          ) : (
            results.map((section, index) => (
              <div
                key={section.key}
                id={`qf-cmdk-option-${section.key}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(section.href)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  index === active ? "bg-slate-100" : "hover:bg-slate-50"
                }`}
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${
                    index === active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <AdminIcon name={section.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{section.label}</span>
                  <span className="block truncate text-xs text-slate-500">{section.description}</span>
                </span>
                <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:block">
                  {groupOf.get(section.key) ?? "Admin"}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500">
          <span>Navigation only — no records are searched.</span>
          <span className="hidden items-center gap-2 sm:flex">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-semibold">↑↓</kbd>
            move
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-semibold">↵</kbd>
            open
          </span>
        </div>
      </div>
    </div>
  );
}
