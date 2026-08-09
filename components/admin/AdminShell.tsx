"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/supabaseBrowser";
import { AdminIcon } from "./AdminIcon";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { adminNavGroups, getAdminSectionByKey, getAdminSectionByPath } from "./adminConfig";

const COLLAPSE_STORAGE_KEY = "qf.admin.sidebarCollapsed";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const current = useMemo(() => getAdminSectionByPath(pathname), [pathname]);

  const group = useMemo(
    () => adminNavGroups.find((g) => g.sections.includes(current.key))?.title ?? "Admin",
    [current.key],
  );

  // Purely cosmetic preference, browser-local. Read after mount so the server
  // and first client render agree (no hydration mismatch).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — keep the expanded default */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Cmd/Ctrl+K opens the navigation palette; Escape closes the mobile drawer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "Escape") {
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close the drawer on navigation so the overlay can never strand the page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  async function signOut() {
    await browserClient().auth.signOut();
    router.refresh();
    router.push("/admin/login");
  }

  return (
    <div className="admin-surface min-h-screen bg-[#f4f6fa] font-sans text-slate-950">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
        aria-label="Open admin menu"
      >
        <span className="h-0.5 w-5 rounded bg-current shadow-[0_6px_0_currentColor,0_-6px_0_currentColor]" />
      </button>

      <Sidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onClose={() => setMobileOpen(false)}
        onSignOut={signOut}
      />

      <AdminCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <div className={collapsed ? "lg:pl-[88px]" : "lg:pl-[296px]"}>
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#f4f6fa]/85 px-4 py-3.5 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-h-14 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 pl-14 lg:pl-0">
              <nav aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                  <li>
                    <Link href="/admin/dashboard" className="rounded text-slate-600 transition hover:text-slate-900">
                      Admin
                    </Link>
                  </li>
                  <li aria-hidden="true" className="text-slate-300">/</li>
                  <li className="truncate text-slate-500">{group}</li>
                  <li aria-hidden="true" className="text-slate-300">/</li>
                  <li className="truncate text-slate-900" aria-current="page">{current.label}</li>
                  <li>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live snapshot
                    </span>
                  </li>
                </ol>
              </nav>
              <h1 className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-slate-950">
                {current.label}
              </h1>
            </div>

            <div className="grid min-w-0 gap-2 sm:flex sm:items-center sm:justify-end">
              <div className="relative min-w-0 sm:w-80">
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-haspopup="dialog"
                  className="group flex h-10 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white pl-3 pr-2 text-left text-sm text-slate-500 shadow-sm outline-none transition hover:border-slate-300 focus-visible:border-emerald-300 focus-visible:ring-4 focus-visible:ring-emerald-100"
                >
                  <AdminIcon name="reports" className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">Jump to section…</span>
                  <kbd className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 sm:block">
                    Ctrl K
                  </kbd>
                </button>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href="/admin/notifications"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm outline-none transition hover:border-emerald-200 hover:text-emerald-700 focus-visible:ring-4 focus-visible:ring-emerald-100"
                  aria-label="Notifications"
                >
                  <AdminIcon name="notifications" className="h-4 w-4" />
                </Link>
                <Link
                  href="/admin/leads"
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/10 transition hover:bg-emerald-700"
                >
                  <AdminIcon name="leads" className="h-4 w-4" />
                  Add Lead
                </Link>
                <div className="hidden h-10 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 shadow-sm md:flex">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-slate-950 text-xs font-bold text-white">SA</span>
                  <div className="leading-tight">
                    <p className="text-sm font-semibold text-slate-950">Superadmin</p>
                    <p className="text-xs text-slate-500">QuickFurno</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  open,
  collapsed,
  onToggleCollapsed,
  onClose,
  onSignOut,
}: {
  open: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <aside
        className={`qf-sidebar fixed inset-y-0 left-0 z-50 hidden border-r border-white/5 text-white lg:block ${
          collapsed ? "w-[88px]" : "w-[296px]"
        }`}
        aria-label="Admin navigation"
      >
        <SidebarContent
          pathname={pathname}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onSignOut={onSignOut}
        />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <button
            type="button"
            aria-label="Close admin menu"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-sm"
            onClick={onClose}
          />
          <aside className="qf-sidebar absolute inset-y-0 left-0 w-[min(21rem,88vw)] border-r border-white/5 text-white shadow-2xl">
            <SidebarContent pathname={pathname} collapsed={false} onNavigate={onClose} onSignOut={onSignOut} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function SidebarContent({
  pathname,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  onSignOut,
}: {
  pathname: string;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`border-b border-white/10 py-5 ${collapsed ? "px-3" : "px-5"}`}>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dashboard"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-400 text-sm font-black text-[#0a0f1c] shadow-lg shadow-emerald-950/30">
              QF
            </span>
            {collapsed ? null : (
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight">QuickFurno</p>
                <p className="truncate text-xs font-medium text-slate-400">Superadmin Command Center</p>
              </div>
            )}
          </Link>
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-pressed={collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-400/70 lg:grid"
            >
              <span aria-hidden="true" className="text-xs font-bold">{collapsed ? "»" : "«"}</span>
            </button>
          ) : null}
        </div>
        {collapsed ? null : (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-300">Preview-safe mode</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Safe
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-400">
              No WhatsApp · No vendor notification · No credit deduction · No auto-assignment.
            </p>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label="Admin sections">
        <div className="space-y-6">
          {adminNavGroups.map((group) => (
            <div key={group.title}>
              <p
                className={`text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 ${
                  collapsed ? "px-0 text-center" : "px-3"
                }`}
              >
                {collapsed ? <span aria-hidden="true">•</span> : group.title}
                {collapsed ? <span className="sr-only">{group.title}</span> : null}
              </p>
              <div className="mt-2 space-y-1">
                {group.sections.map((key) => {
                  const section = getAdminSectionByKey(key);
                  const active =
                    pathname === section.href ||
                    pathname.startsWith(`${section.href}/`) ||
                    (pathname === "/admin" && section.key === "dashboard");

                  return (
                    <Link
                      key={section.key}
                      href={section.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? section.label : undefined}
                      className={`group relative flex min-w-0 items-center gap-3 rounded-xl py-2.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
                        collapsed ? "justify-center px-2" : "px-3"
                      } ${
                        active
                          ? "bg-white text-slate-950 shadow-sm shadow-emerald-950/10"
                          : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      {active ? (
                        <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-emerald-400" />
                      ) : null}
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${
                          active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-white/[0.06] text-slate-400 group-hover:bg-white/10 group-hover:text-emerald-200"
                        }`}
                      >
                        <AdminIcon name={section.icon} className="h-4 w-4" />
                      </span>
                      {collapsed ? (
                        <span className="sr-only">{section.label}</span>
                      ) : (
                        <span className="min-w-0">
                          <span className="block truncate">{section.label}</span>
                          <span className={`block truncate text-xs ${active ? "text-slate-500" : "text-slate-400/80"}`}>
                            {section.description}
                          </span>
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className={`border-t border-white/10 ${collapsed ? "p-3" : "p-4"}`}>
        <div className={`rounded-xl border border-white/10 bg-white/[0.04] ${collapsed ? "p-2" : "p-4"}`}>
          {collapsed ? null : (
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-bold text-white ring-1 ring-white/10">
                SA
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">Superadmin</p>
                <p className="truncate text-[11px] text-slate-400">Full access · Auth via Supabase</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onSignOut}
            title={collapsed ? "Sign out" : undefined}
            className={`inline-flex h-9 w-full items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sm font-semibold text-slate-300 outline-none transition hover:bg-white hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
              collapsed ? "" : "mt-4"
            }`}
          >
            {collapsed ? <span aria-hidden="true">⏻</span> : "Sign out"}
            {collapsed ? <span className="sr-only">Sign out</span> : null}
          </button>
        </div>
      </div>
    </div>
  );
}
