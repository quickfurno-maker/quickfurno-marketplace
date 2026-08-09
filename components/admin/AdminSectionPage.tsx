"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminApproveVendorProfileChangeRequest,
  adminRejectVendorProfileChangeRequest,
  adminReplyVendorSupportThread,
  adminSetCategoryActive,
  adminSetCityActive,
  adminSetPackageActive,
  adminMarkFreeVendorInterestStatus,
  adminRecheckLeadAssignmentQueue,
  adminRunAutoMatchPreview,
  adminUpdateMarketplaceRuntimeSetting,
  adminUpdateLeadStatus,
} from "@/app/actions";
import { evaluateVendorEligibility, evaluateVendorLeadAssignmentEligibility, type VendorEligibility, type VendorLeadAssignmentEligibility } from "@/lib/vendors/vendorEligibility";
import { getVendorPublicVisibility, type VendorPublicVisibility } from "@/lib/vendors/vendorVisibility";
import {
  ActionMenu,
  ChartCard,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  InfoGrid,
  PageHeader,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  SelectFilter,
  SectionCard,
  StatCard,
  StatusBadge,
  Tabs,
  Toast,
  ToggleSwitch,
  Toolbar,
} from "./AdminPrimitives";
import { getAdminSectionByKey, type AdminSectionKey } from "./adminConfig";
import {
  AIAgentsPage,
  AdminUsersPage,
  AuditLogsPage,
  AutomationsPage,
  CategoriesPage,
  CitiesPage,
  LeadDistributionPage,
  LeadsPage,
  NotificationsPage,
  PackagesPage,
  PaymentsPage,
  ReportsPage,
  ReviewsPage,
  SettingsPage,
  SubscriptionsPage,
  VendorsPage,
  WebsiteContentPage,
} from "./sections";
import { emptySnapshot, type Category, type City, type Lead, type MarketplaceRuntimeSetting, type PackageRow, type Snapshot, type Vendor, type VendorProfileChangeRequest, type VendorSupportMessage, type VendorSupportThread } from "./adminTypes";
import {
  assignmentStatus,
  formatDate,
  formatINR,
  formatNumber,
  groupBy,
  includesQuery,
  leadName,
  maskPhone,
  packageName,
  shortId,
  uniqueOptions,
  vendorName,
} from "./adminUtils";
import { AOSControlCenter } from "./AOSControlCenter";
import { CRMDashboard } from "./CRMDashboard";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { AosAutomationControl } from "./AosAutomationControl";
import { LeadAssignmentApprovalControl } from "./LeadAssignmentApprovalControl";
import { DistributionLogsPanel, FailedAssignmentsPanel, RecentAssignmentsPanel } from "./AssignmentLedgerPanels";
import { CategoryManager } from "./CategoryManager";
import {
  BadLeadReportsReviewPanel,
  DeliveryLogsAuditPanel,
  MatchingRunsAuditPanel,
  PreviewMessagesPanel,
} from "./LeadMatchingAuditPanels";
import { ManualLeadAssignmentPanel } from "./ManualLeadAssignmentPanel";
import { RequirementGroupsPanel } from "./RequirementGroupsPanel";

export function AdminSectionPage({ section, snapshot, error }: { section: AdminSectionKey; snapshot: Snapshot | null; error?: string | null }) {
  const data = snapshot ?? emptySnapshot();
  const config = getAdminSectionByKey(section);
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
    <div className="space-y-5">
      <PageHeader
        title={config.label}
        description={config.description}
        actions={
          <>
            <SecondaryButton onClick={() => notify("Filter drawer placeholder is ready.")}>Filter</SecondaryButton>
            <PrimaryButton onClick={() => notify(`${config.addLabel} flow is ready for backend wiring.`)}>{config.addLabel}</PrimaryButton>
          </>
        }
      />

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          This page is showing safe fallback UI because Supabase returned: {error}
        </div>
      ) : null}

      {renderSection(section, data, { notify, ask, runAction, isPending, error: error ?? null })}

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
  data: Snapshot,
  helpers: {
    notify: (message: string, tone?: "success" | "error" | "info") => void;
    ask: (title: string, message: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
    runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
    isPending: boolean;
    error: string | null;
  }
) {
  switch (section) {
    case "leads":
      return <LeadsPage data={data} {...helpers} />;
    case "vendors":
      return <VendorsPage data={data} {...helpers} />;
    case "packages":
      return <PackagesPage data={data} {...helpers} />;
    case "categories":
      return <CategoriesPage data={data} {...helpers} />;
    case "cities":
      return <CitiesPage data={data} {...helpers} />;
    case "payments":
      return <PaymentsPage data={data} {...helpers} />;
    case "lead-distribution":
      return <LeadDistributionPage data={data} {...helpers} />;
    case "vendor-subscriptions":
      return <SubscriptionsPage data={data} {...helpers} />;
    case "reports":
      return <ReportsPage data={data} />;
    case "aos":
      return <AOSControlCenter notify={helpers.notify} data={data} />;
    case "crm":
      return <CRMDashboard data={data} notify={helpers.notify} error={helpers.error} />;
    case "analytics":
      return <AnalyticsDashboard data={data} />;
    case "ai-agents":
      return <AIAgentsPage />;
    case "automations":
      return <AutomationsPage notify={helpers.notify} />;
    case "website-content":
      return <WebsiteContentPage notify={helpers.notify} />;
    case "reviews":
      return <ReviewsPage />;
    case "notifications":
      return <NotificationsPage data={data} notify={helpers.notify} />;
    case "users":
      return <AdminUsersPage data={data} />;
    case "settings":
      return <SettingsPage data={data} notify={helpers.notify} runAction={helpers.runAction} />;
    case "audit-logs":
      return <AuditLogsPage data={data} />;
    default:
      return <EmptyState title="Page not available" message="This admin page is not configured yet." />;
  }
}
