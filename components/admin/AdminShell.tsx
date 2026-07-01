"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useMemo, useState } from "react";
import { browserClient } from "@/lib/supabaseBrowser";
import { AdminIcon } from "./AdminIcon";
import { adminNavGroups, getAdminSectionByKey, getAdminSectionByPath } from "./adminConfig";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = useMemo(() => getAdminSectionByPath(pathname), [pathname]);

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

      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} onSignOut={signOut} />

      <div className="lg:pl-[296px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#f4f6fa]/85 px-4 py-3.5 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-h-14 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 pl-14 lg:pl-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                  Superadmin
                </span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="truncate">{current.label}</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live snapshot
                </span>
              </div>
              <h1 className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-slate-950">
                {current.label}
              </h1>
            </div>

            <div className="grid min-w-0 gap-2 sm:flex sm:items-center sm:justify-end">
              <div className="relative min-w-0 sm:w-80">
                <AdminIcon name="reports" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="Search admin workspace..."
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none shadow-sm transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700"
                  aria-label="Notifications"
                >
                  <AdminIcon name="notifications" className="h-4 w-4" />
                </button>
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

function Sidebar({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <aside className="qf-sidebar fixed inset-y-0 left-0 z-50 hidden w-[296px] border-r border-white/5 text-white lg:block">
        <SidebarContent pathname={pathname} onSignOut={onSignOut} />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} />
          <aside className="qf-sidebar absolute inset-y-0 left-0 w-[min(21rem,88vw)] border-r border-white/5 text-white shadow-2xl">
            <SidebarContent pathname={pathname} onNavigate={onClose} onSignOut={onSignOut} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
  onSignOut,
}: {
  pathname: string;
  onNavigate?: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-5 py-5">
        <Link href="/admin/dashboard" onClick={onNavigate} className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-400 text-sm font-black text-[#0a0f1c] shadow-lg shadow-emerald-950/30">
            QF
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-tight">QuickFurno</p>
            <p className="truncate text-xs font-medium text-slate-400">Superadmin Command Center</p>
          </div>
        </Link>
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
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        <div className="space-y-6">
          {adminNavGroups.map((group) => (
            <div key={group.title}>
              <p className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                {group.title}
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
                      className={`group relative flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
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
                      <span className="min-w-0">
                        <span className="block truncate">{section.label}</span>
                        <span className={`block truncate text-xs ${active ? "text-slate-500" : "text-slate-400/80"}`}>
                          {section.description}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-bold text-white ring-1 ring-white/10">
              SA
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Superadmin</p>
              <p className="truncate text-[11px] text-slate-400">Full access · Auth via Supabase</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sm font-semibold text-slate-300 transition hover:bg-white hover:text-slate-950"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
