"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useMemo, useState } from "react";
import { browserClient } from "@/lib/supabaseBrowser";
import { AdminIcon } from "./AdminIcon";
import { adminSections, getAdminSectionByPath } from "./adminConfig";

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
    <div className="admin-surface min-h-screen bg-slate-50 text-slate-950">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
        aria-label="Open admin menu"
      >
        <span className="h-0.5 w-5 rounded bg-current shadow-[0_6px_0_currentColor,0_-6px_0_currentColor]" />
      </button>

      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-h-14 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 pl-14 lg:pl-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Admin / {current.label}
              </p>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-950">
                {current.label}
              </h1>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="relative min-w-0 sm:w-80">
                <span className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-slate-300" />
                <input
                  placeholder="Search marketplace..."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                />
              </div>
              <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50" aria-label="Notifications">
                <AdminIcon name="notifications" className="h-4 w-4" />
              </button>
              <Link href="/admin/leads" className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/10 hover:bg-emerald-700">
                Add Lead
              </Link>
              <div className="flex h-10 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 shadow-sm">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-950 text-xs font-bold text-white">SA</span>
                <div className="hidden leading-tight sm:block">
                  <p className="text-sm font-semibold text-slate-950">Superadmin</p>
                  <p className="text-xs text-slate-500">QuickFurno</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="fixed bottom-4 left-4 z-40 hidden rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-300 shadow-lg transition hover:bg-slate-800 hover:text-white lg:inline-flex"
      >
        Sign out
      </button>
    </div>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-72 border-r border-slate-800 bg-slate-950 text-white lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 w-[min(20rem,86vw)] border-r border-slate-800 bg-slate-950 text-white shadow-2xl">
            <SidebarContent pathname={pathname} onNavigate={onClose} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-5 py-5">
        <Link href="/admin/dashboard" onClick={onNavigate} className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/20">
            QF
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">QuickFurno</p>
            <p className="text-xs font-medium text-slate-400">Superadmin Console</p>
          </div>
        </Link>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {adminSections.map((section) => {
            const active = pathname === section.href || pathname.startsWith(`${section.href}/`) || (pathname === "/admin" && section.key === "dashboard");
            return (
              <Link
                key={section.key}
                href={section.href}
                onClick={onNavigate}
                className={`group flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-emerald-100 text-emerald-700" : "bg-white/5 text-slate-400 group-hover:text-white"}`}>
                  <AdminIcon name={section.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{section.label}</span>
                  <span className={`block truncate text-xs ${active ? "text-slate-500" : "text-slate-500"}`}>{section.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Role</p>
          <p className="mt-1 text-sm font-semibold text-white">Superadmin</p>
          <p className="mt-2 text-xs leading-5 text-slate-400">Full access. Password is managed in Supabase Auth.</p>
        </div>
      </div>
    </div>
  );
}
