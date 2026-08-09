"use client";

// ============================================================================
// C-PERF2: this shell no longer receives (or renders from) the broad
// every-table snapshot. The route resolves a SECTION-SCOPED payload first
// (app/admin/[section]/page.tsx) and this component adapts it to each
// section's narrow props. Sections with no server data receive none.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, EmptyState, Toast } from "./AdminPrimitives";
import { type AdminSectionKey } from "./adminConfig";
import { emptySnapshot, type Snapshot } from "./adminTypes";
import {
  AIAgentsPage,
  AdminUsersPage,
  AosReadinessPage,
  AuditLogsPage,
  AutomationsPage,
  CategoriesPage,
  CitiesPage,
  LeadDistributionPage,
  NotificationsPage,
  PackagesPage,
  PaymentsPage,
  ReportsPage,
  ReviewsPage,
  SettingsPage,
  SubscriptionsPage,
  WebsiteContentPage,
} from "./sections";
import { CRMDashboard } from "./CRMDashboard";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

export function AdminSectionPage({ section, payload, error }: { section: AdminSectionKey; payload: any; error?: string | null }) {
  const router = useRouter();
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<{ ok: boolean; error?: string }> } | null>(null);
  const [isPending, startTransition] = useTransition();

  function notify(message: string, tone: "success" | "error" | "info" = "info") {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2800);
  }

  function runAction(title: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        notify(result.error ?? `${title} failed.`, "error");
        return;
      }
      notify(`${title} completed.`, "success");
      router.refresh();
    });
  }

  function ask(title: string, message: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setConfirm({ title, message, action });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          This page is showing safe fallback UI because Supabase returned: {error}
        </div>
      ) : null}

      {renderSection(section, payload, { notify, ask, runAction, isPending, error: error ?? null })}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const action = confirm.action;
            const title = confirm.title;
            setConfirm(null);
            runAction(title, action);
          }}
        />
      ) : null}
    </div>
  );
}

function renderSection(
  section: AdminSectionKey,
  payload: any,
  helpers: {
    notify: (message: string, tone?: "success" | "error" | "info") => void;
    ask: (title: string, message: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
    runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
    isPending: boolean;
    error: string | null;
  }
) {
  switch (section) {
    // "leads" and "vendors" are served by dedicated server-paged directory
    // routes and never reach this switch — see app/admin/[section]/page.tsx.
    case "packages":
      return <PackagesPage packages={payload?.packages ?? []} totalRevenue={Number(payload?.totalRevenue ?? 0)} notify={helpers.notify} ask={helpers.ask} />;
    case "categories":
      return <CategoriesPage categories={payload?.categories ?? []} notify={helpers.notify} />;
    case "cities":
      return <CitiesPage cities={payload?.cities ?? []} notify={helpers.notify} ask={helpers.ask} />;
    case "payments":
      return <PaymentsPage data={payload} />;
    case "lead-distribution":
      return <LeadDistributionPage notify={helpers.notify} runAction={helpers.runAction} />;
    case "vendor-subscriptions":
      return <SubscriptionsPage data={payload} />;
    case "reports":
      return <ReportsPage leadSample={payload?.leadSample ?? []} />;
    case "aos":
      return <AosReadinessPage notify={helpers.notify} />;
    case "crm":
      return <CRMDashboard base={payload} notify={helpers.notify} error={helpers.error} />;
    case "analytics": {
      // AnalyticsDashboard keeps its Snapshot-shaped input; the payload is the
      // narrow analytics contract (stats + labelled thin samples), adapted here.
      const analyticsData: Snapshot = {
        ...emptySnapshot(),
        stats: payload?.stats ?? {},
        leads: payload?.leads ?? [],
        vendors: payload?.vendors ?? [],
        assignments: payload?.assignments ?? [],
      };
      return <AnalyticsDashboard data={analyticsData} />;
    }
    case "ai-agents":
      return <AIAgentsPage />;
    case "automations":
      return <AutomationsPage notify={helpers.notify} />;
    case "website-content":
      return <WebsiteContentPage />;
    case "reviews":
      return <ReviewsPage />;
    case "notifications":
      return <NotificationsPage data={payload} />;
    case "users":
      return <AdminUsersPage data={payload} />;
    case "settings":
      return (
        <SettingsPage
          data={{ ...emptySnapshot(), marketplaceSettings: payload?.marketplaceSettings ?? [], settings: payload?.settings ?? [] }}
          notify={helpers.notify}
          runAction={helpers.runAction}
        />
      );
    case "audit-logs":
      return <AuditLogsPage data={payload} />;
    default:
      return <EmptyState title="Page not available" message="This admin page is not configured yet." />;
  }
}
