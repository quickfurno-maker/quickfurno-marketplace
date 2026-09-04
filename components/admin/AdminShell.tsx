"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/supabaseBrowser";
import { AdminIcon } from "./AdminIcon";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { adminNavGroups, getAdminSectionByKey, getAdminSectionByPath } from "./adminConfig";
import { useAdminModalFocus } from "./useAdminModalFocus";

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
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
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

  /**
   * QF-UI-V2-13: dismissing the drawer returned focus to <body>, so keyboard
   * users landed at the top of the document instead of back on the control they
   * had just used. Only USER-initiated dismissal restores focus; a route change
   * closes the drawer too, and there focus belongs to the new page.
   */
  const closeMobileNav = useCallback(() => {
    setMobileOpen(false);
    // The trigger is aria-hidden/tabIndex=-1 while open, so wait for the
    // re-render that makes it focusable again.
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  // Cmd/Ctrl+K opens the navigation palette; Escape closes the mobile drawer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "Escape" && mobileOpen) {
        closeMobileNav();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, closeMobileNav]);

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
      <a
        href="#admin-main-content"
        className="qfa-focus sr-only fixed left-3 top-3 z-[90] rounded-[var(--qfa-radius)] bg-[color:var(--qfa-surface)] px-3 py-2 text-sm font-semibold text-slate-950 shadow-[var(--qfa-shadow-pop)] focus:not-sr-only"
      >
        Skip to admin content
      </a>
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setMobileOpen(true)}
        className="qfa-focus fixed left-3 top-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-white text-slate-700 shadow-[var(--qfa-shadow-1)] lg:hidden"
        aria-label="Open admin menu"
        aria-expanded={mobileOpen}
        aria-controls="admin-mobile-navigation"
        aria-hidden={mobileOpen || paletteOpen ? true : undefined}
        tabIndex={mobileOpen || paletteOpen ? -1 : 0}
      >
        <span className="h-0.5 w-5 rounded bg-current shadow-[0_6px_0_currentColor,0_-6px_0_currentColor]" />
      </button>

      <Sidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onClose={closeMobileNav}
        onSignOut={signOut}
        backgroundInert={paletteOpen}
      />

      <AdminCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <div
        className={collapsed ? "lg:pl-[76px]" : "lg:pl-[264px]"}
        aria-hidden={mobileOpen || paletteOpen ? true : undefined}
        inert={mobileOpen || paletteOpen ? ("" as unknown as boolean) : undefined}
      >
        <header className="sticky top-0 z-30 border-b border-[color:var(--qfa-line)] bg-[color:var(--qfa-page)]/90 px-4 py-2.5 backdrop-blur-xl sm:px-5 lg:px-7">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 pl-12 lg:pl-0">
              <nav aria-label="Breadcrumb">
                {/* list-none/p-0: globals.css loads @tailwind utilities WITHOUT
                    @tailwind base, so Preflight never resets lists and the UA default
                    painted a "1." marker and a 40px indent here. Scoped to this list
                    on purpose - no global ol/ul reset. Vertical margin is left alone
                    so the topbar height is unchanged. */}
                <ol className="flex list-none flex-wrap items-center gap-1.5 p-0 text-[11px] font-medium text-slate-500">
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
                <h1 className="break-words text-xl font-semibold tracking-tight text-slate-950">{current.label}</h1>
                <p className="min-w-0 break-words text-[13px] text-slate-500">{current.description}</p>
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

        <main id="admin-main-content" tabIndex={-1} className="mx-auto w-full max-w-[1680px] px-4 py-5 outline-none sm:px-5 lg:px-7 lg:py-6">{children}</main>
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
  backgroundInert,
}: {
  open: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onSignOut: () => void;
  backgroundInert: boolean;
}) {
  const pathname = usePathname();
  const mobileDialogRef = useRef<HTMLDivElement | null>(null);
  useAdminModalFocus({ open, containerRef: mobileDialogRef, onClose });

  return (
    <>
      <aside
        className={`qf-sidebar fixed inset-y-0 left-0 z-50 hidden border-r border-white/5 text-white lg:block ${
          collapsed ? "w-[76px]" : "w-[264px]"
        }`}
        aria-label="Admin navigation"
        aria-hidden={backgroundInert ? true : undefined}
        inert={backgroundInert ? ("" as unknown as boolean) : undefined}
      >
        <SidebarContent
          pathname={pathname}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onSignOut={onSignOut}
        />
      </aside>

      {open ? (
        <div
          ref={mobileDialogRef}
          id="admin-mobile-navigation"
          tabIndex={-1}
          className="fixed inset-0 z-50 outline-none lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-mobile-navigation-title"
        >
          <h2 id="admin-mobile-navigation-title" className="sr-only">Admin navigation</h2>
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
  const activeSection = getAdminSectionByPath(pathname);

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
                <p className="truncate text-[11px] text-slate-400">Command Center</p>
              </div>
            )}
          </Link>
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
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
                  const active = activeSection.key === section.key;

                  return (
                    <Link
                      key={section.key}
                      href={section.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? section.label : section.description}
                      className={`qfa-focus group relative flex min-h-10 min-w-0 items-center gap-2.5 rounded-[var(--qfa-radius)] py-2 text-[13px] font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                        collapsed ? "justify-center px-1.5" : "px-2.5"
                      } ${
                        active
                          ? "bg-[#2d7cff]/[0.16] text-white shadow-[inset_0_0_0_1px_rgba(45,124,255,0.35),0_0_18px_rgba(45,124,255,0.14)]"
                          : "text-slate-300 hover:bg-white/[0.07] hover:text-white"
                      }`}
                    >
                      {active && !collapsed ? (
                        <span aria-hidden="true" className="absolute inset-y-1.5 -left-2.5 w-0.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,216,255,0.8)]" />
                      ) : null}
                      <AdminIcon
                        name={section.icon}
                        className={`h-4 w-4 shrink-0 ${active ? "text-cyan-300" : "text-slate-400 group-hover:text-emerald-300"}`}
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

      {/* QF-MVP-80.03 — a static "Preview-safe mode / Safe" badge used to sit
          here, claiming "No WhatsApp · No vendor notification · No credit
          deduction · No auto-assignment" unconditionally.
          It was FALSE. The claim depends entirely on
          `marketplace_runtime_settings.auto_assignment_mode`, which this shell
          never read: `off` is the only true halt, while `preview` — despite its
          name — finalizes assignments and debits vendor credits through
          services/leadMatchingEngine. The badge would have rendered "Safe" in
          exactly the situation an operator most needs warning about.
          Removed rather than made live, because AdminShell receives only
          `children` and reading the runtime mode here would mean adding a fetch
          this slice deliberately does not introduce. The truthful live state
          belongs in Launch Control, which already reads the canonical setting. */}
      <div className={`border-t border-white/10 ${collapsed ? "p-2.5" : "p-3"}`}>
        <button
          type="button"
          onClick={onSignOut}
          title={collapsed ? "Sign out" : undefined}
          className="qfa-focus inline-flex h-10 w-full items-center justify-center rounded-[var(--qfa-radius-sm)] border border-white/10 bg-white/5 text-[13px] font-semibold text-slate-300 transition-colors hover:bg-white hover:text-slate-950 lg:h-8"
        >
          {collapsed ? <span aria-hidden="true">⏻</span> : "Sign out"}
          {collapsed ? <span className="sr-only">Sign out</span> : null}
        </button>
      </div>
    </div>
  );
}
