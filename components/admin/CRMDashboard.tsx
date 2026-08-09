"use client";

// ============================================================================
// QuickFurno Operations CRM (command center)
// A real, read-mostly CRM built entirely from the existing admin snapshot
// (leads, vendors, lead_assignments, lead_assignment_queue, lead_delivery_logs,
// client_notification_logs, free_vendor_profile_interests). No sample/fake data.
//
// Writes are limited to lead STATUS changes via the existing, superadmin-guarded
// adminUpdateLeadStatus action. No assignment logic, credit deduction, WhatsApp
// send, or schema change happens here. Priority labels are computed for display
// only and are never persisted.
// ============================================================================

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminGetLeadClarificationResponses,
  adminPrepareLeadClarification,
  adminSaveLeadClarificationResponses,
  adminUpdateLeadStatus,
} from "@/app/actions";
import {
  ActionMenu,
  ChartCard,
  DataTable,
  Drawer,
  EmptyState,
  InfoGrid,
  SectionCard,
  SelectFilter,
  StatCard,
  StatusBadge,
  Tabs,
  Toolbar,
} from "./AdminPrimitives";
import type {
  Assignment,
  ClientNotificationLog,
  Lead,
  LeadAssignmentQueueRow,
  LeadClarificationRequest,
  LeadClarificationResponseRow,
  LeadDeliveryLog,
  Snapshot,
  Vendor,
} from "./adminTypes";
import { formatDate, formatNumber, includesQuery, maskEmail, uniqueOptions } from "./adminUtils";
import { computeLeadSignals } from "@/lib/crm/adapters/leadAdapter";
import {
  AssignmentQueue,
  FollowUps,
  LeadDrawer,
  LeadInbox,
  Nurture,
  Overview,
  PipelineBoard,
  SourceAnalytics,
  TABS,
  VendorResponse,
  buildKpis,
  buildRows,
  groupByLead,
  type CRMDashboardProps,
  type CrmRow,
  type QuickFilter,
} from "./crm/lead";
import type { LeadScoringSignals } from "@/lib/crm/types";

export function CRMDashboard({ data, notify, error }: CRMDashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState(TABS[0]);
  const [selected, setSelected] = useState<CrmRow | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const rows = useMemo(() => buildRows(data), [data]);

  const deliveryByLead = useMemo(() => groupByLead(data.leadDeliveryLogs ?? []), [data.leadDeliveryLogs]);
  const notifByLead = useMemo(() => groupByLead(data.clientNotificationLogs ?? []), [data.clientNotificationLogs]);
  const vendorsById = useMemo(() => {
    const map = new Map<string, Vendor>();
    (data.vendors ?? []).forEach((v) => map.set(v.id, v));
    return map;
  }, [data.vendors]);

  function updateStatus(leadId: string, status: string) {
    startTransition(async () => {
      const result = await adminUpdateLeadStatus(leadId, status);
      if (!result.ok) {
        notify(result.error ?? "Could not update lead status.", "error");
        return;
      }
      notify(`Lead marked ${status}.`, "success");
      router.refresh();
    });
  }

  function prepareClarification(leadId: string) {
    startTransition(async () => {
      const result = await adminPrepareLeadClarification(leadId);
      if (!result.ok) {
        notify(result.error ?? "Could not prepare clarification preview.", "error");
        return;
      }
      notify("Clarification preview prepared.", "success");
      router.refresh();
    });
  }

  function openInbox(filter: QuickFilter) {
    setQuickFilter(filter);
    setActive("Lead Inbox");
  }

  const kpis = useMemo(() => buildKpis(rows), [rows]);

  // Row-limit note: the snapshot returns the LATEST leads only (see
  // services/adminService.ts). KPI totals shown across admin stay accurate via
  // server-side count queries. TODO(pagination): move CRM lists to server-side
  // pagination + filters so all leads become browsable.
  const meta = data.snapshotMeta;
  const totalLeads = meta?.totals?.total_leads ?? rows.length;
  const isLimited = Boolean(meta && meta.rowsLoaded?.leads < totalLeads);

  return (
    <div className="space-y-4">
      {/* Context strip, not a banner card. AdminShell already titles this page
          "CRM", so the workspace opens straight onto its own navigation. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {isLimited
            ? `Latest ${formatNumber(rows.length)} of ${formatNumber(totalLeads)} leads`
            : `${formatNumber(rows.length)} leads`}
        </span>
        <span aria-hidden="true" className="text-slate-300">·</span>
        <span>Priority labels are computed for display only and are never written to the database.</span>
        {isLimited ? <span>KPI totals are counted live and stay accurate.</span> : null}
        {error ? <span className="font-medium text-amber-700">Some data was limited: {error}</span> : null}
      </div>

      <Tabs tabs={TABS} active={active} onChange={setActive} label="Lead CRM sections" />

      {active === "Overview" ? (
        <Overview kpis={kpis} onCard={openInbox} onGoFollowUps={() => setActive("Follow-ups")} />
      ) : null}

      {active === "Lead Inbox" ? (
        <LeadInbox
          rows={rows}
          quickFilter={quickFilter}
          setQuickFilter={setQuickFilter}
          onSelect={setSelected}
          onUpdateStatus={updateStatus}
          onAssign={() => {
            notify("Opening Lead Distribution for manual vendor assignment…", "info");
            router.push("/admin/lead-distribution");
          }}
          isPending={isPending}
        />
      ) : null}

      {active === "Pipeline Board" ? <PipelineBoard rows={rows} onSelect={setSelected} /> : null}
      {active === "Follow-ups" ? <FollowUps rows={rows} onSelect={setSelected} /> : null}
      {active === "Assignment Queue" ? <AssignmentQueue queue={data.leadAssignmentQueue ?? []} /> : null}
      {active === "Vendor Activity" ? <VendorResponse rows={rows} vendorsById={vendorsById} deliveryLogs={data.leadDeliveryLogs ?? []} /> : null}
      {active === "Source Analytics" ? <SourceAnalytics rows={rows} /> : null}
      {active === "Nurture" ? <Nurture rows={rows} onSelect={setSelected} /> : null}

      {selected ? (
        <LeadDrawer
          row={selected}
          vendorsById={vendorsById}
          deliveryLogs={deliveryByLead.get(selected.id) ?? []}
          notificationLogs={notifByLead.get(selected.id) ?? []}
          onPrepareClarification={prepareClarification}
          onRefresh={() => router.refresh()}
          notify={notify}
          isPending={isPending}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPIs / Overview
// ---------------------------------------------------------------------------
