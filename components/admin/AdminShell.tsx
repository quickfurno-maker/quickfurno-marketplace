"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/supabaseBrowser";
import { AdminIcon } from "./AdminIcon";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { adminNavGroups, getAdminSectionByKey, getAdminSectionByPath } from "./adminConfig";

const COLLAPSE_STORAGE_KEY = "qf.admin.sidebarCollapsed";

/**
 * The shell owns page identity for the whole admin: breadcrumb, the single h1,
 * and the section description. Pages must NOT print their own title again —
 * that duplication is what made every screen open with two stacked headers and
 * ~140px of chrome before any data.
 */
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
    <div className="admin-surface min-h-screen bg-[color:var(--qfa-page)] font-sans text-slate-950">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="qfa-focus fixed left-3 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-white text-slate-700 shadow-[var(--qfa-shadow-1)] lg:hidden"
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

      <div className={collapsed ? "lg:pl-[76px]" : "lg:pl-[264px]"}>
        <header className="sticky top-0 z-30 border-b border-[color:var(--qfa-line)] bg-[color:var(--qfa-page)]/90 px-4 py-2.5 backdrop-blur-xl sm:px-5 lg:px-7">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 pl-12 lg:pl-0">
              <nav aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <li>
                    <Link href="/admin/dashboard" className="qfa-focus rounded transition-colors hover:text-slate-900">
                      Admin
                    </Link>
                  </li>
                  <li aria-hidden="true" className="text-slate-300">/</li>
                  <li className="truncate">{group}</li>
                  <li aria-hidden="true" className="text-slate-300">/</li>
                  <li className="truncate font-semibold text-slate-700" aria-current="page">{current.label}</li>
                </ol>
              </nav>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950">{current.label}</h1>
                <p className="min-w-0 truncate text-[13px] text-slate-500">{current.description}</p>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-1.5 sm:justify-end">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-haspopup="dialog"
                className="qfa-control qfa-focus flex min-w-0 flex-1 items-center gap-2 bg-white pl-2.5 pr-1.5 text-left text-slate-500 sm:w-64 sm:flex-none"
              >
                <AdminIcon name="reports" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-[13px]">Jump to section…</span>
                <kbd className="hidden shrink-0 rounded border border-[color:var(--qfa-line)] bg-[color:var(--qfa-inset)] px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 sm:block">
                  Ctrl K
                </kbd>
              </button>
              <Link
                href="/admin/notifications"
                className="qfa-control qfa-focus grid w-[var(--qfa-control-h)] shrink-0 place-items-center text-slate-600 hover:text-emerald-700"
                aria-label="Notifications"
              >
                <AdminIcon name="notifications" className="h-4 w-4" />
              </Link>
              <div className="hidden shrink-0 items-center gap-2 md:flex">
                <span className="grid h-[var(--qfa-control-h)] w-[var(--qfa-control-h)] place-items-center rounded-[var(--qfa-radius)] bg-slate-900 text-[11px] font-bold text-white">
                  SA
                </span>
                <div className="leading-tight">
                  <p className="text-[13px] font-semibold text-slate-950">Superadmin</p>
                  <p className="text-[11px] text-slate-500">QuickFurno</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-5 lg:px-7 lg:py-6">{children}</main>
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
          collapsed ? "w-[76px]" : "w-[264px]"
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
          <aside className="qf-sidebar absolute inset-y-0 left-0 w-[min(19rem,86vw)] border-r border-white/5 text-white shadow-2xl">
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
      <div className={`border-b border-white/10 py-3.5 ${collapsed ? "px-2.5" : "px-4"}`}>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/dashboard"
            onClick={onNavigate}
            className="qfa-focus flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--qfa-radius)]"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--qfa-radius)] bg-emerald-400 text-[13px] font-black text-[#0a0f1c]">
              QF
            </span>
            {collapsed ? null : (
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold tracking-tight">QuickFurno</p>
                <p className="truncate text-[11px] text-slate-400">Superadmin</p>
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
              className="qfa-focus hidden h-7 w-7 shrink-0 place-items-center rounded-[var(--qfa-radius-sm)] border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white lg:grid"
            >
              <span aria-hidden="true" className="text-[11px] font-bold">{collapsed ? "»" : "«"}</span>
            </button>
          ) : null}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="Admin sections">
        <div className="space-y-4">
          {adminNavGroups.map((group) => (
            <div key={group.title}>
              <p
                className={`text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 ${
                  collapsed ? "text-center" : "px-2.5"
                }`}
              >
                {collapsed ? <span aria-hidden="true">•</span> : group.title}
                {collapsed ? <span className="sr-only">{group.title}</span> : null}
              </p>
              <div className="mt-1.5 space-y-0.5">
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
                      title={collapsed ? section.label : section.description}
                      className={`qfa-focus group relative flex min-w-0 items-center gap-2.5 rounded-[var(--qfa-radius)] py-1.5 text-[13px] font-medium transition-colors ${
                        collapsed ? "justify-center px-1.5" : "px-2.5"
                      } ${
                        active
                          ? "bg-white/95 text-slate-950"
                          : "text-slate-300 hover:bg-white/[0.07] hover:text-white"
                      }`}
                    >
                      {active && !collapsed ? (
                        <span aria-hidden="true" className="absolute inset-y-1.5 -left-2.5 w-0.5 rounded-full bg-emerald-400" />
                      ) : null}
                      <AdminIcon
                        name={section.icon}
                        className={`h-4 w-4 shrink-0 ${active ? "text-emerald-600" : "text-slate-400 group-hover:text-emerald-300"}`}
                      />
                      {collapsed ? (
                        <span className="sr-only">{section.label}</span>
                      ) : (
                        /* Single-line labels. The old two-line rows truncated
                           the description on almost every item, which read as
                           clutter rather than context — the description now
                           lives in the title attribute and the page header. */
                        <span className="min-w-0 truncate">{section.label}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className={`border-t border-white/10 ${collapsed ? "p-2.5" : "p-3"}`}>
        {collapsed ? null : (
          <div className="mb-2.5 rounded-[var(--qfa-radius)] border border-white/10 bg-white/[0.04] px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-300">Preview-safe mode</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-emerald-400" />
                Safe
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">
              No WhatsApp · No vendor notification · No credit deduction · No auto-assignment.
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title={collapsed ? "Sign out" : undefined}
          className="qfa-focus inline-flex h-8 w-full items-center justify-center rounded-[var(--qfa-radius-sm)] border border-white/10 bg-white/5 text-[13px] font-semibold text-slate-300 transition-colors hover:bg-white hover:text-slate-950"
        >
          {collapsed ? <span aria-hidden="true">⏻</span> : "Sign out"}
          {collapsed ? <span className="sr-only">Sign out</span> : null}
        </button>
      </div>
    </div>
  );
}
