"use client";

// ============================================================================
// QuickFurno Admin V2 — Automation visibility (C-WA1).
//
// READ-ONLY orchestration visibility. There is no Run now, Retry now, Force
// complete, Release, Unclaim, Change family or Activate n8n control here, and
// none may be added: claiming and completing a job are transport operations
// owned by the executor, and the workflow family is re-proven from durable Core
// truth rather than being selectable.
//
// AUTHORITY, stated plainly on the page: Core decides the action, the entity,
// the recipient, the template, the variables, consent, eligibility, the provider
// and the outcome. n8n orchestrates. It is not business authority.
// ============================================================================

import { DataTable, SelectFilter, StatusBadge } from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import type { WhatsAppAutomationPageResult, WhatsAppAutomationRow } from "@/services/adminWhatsAppService";
import type { WhatsAppQuery } from "./whatsappAdminTypes";
import { FaultNotice, ReadOnlyNotice, humanize, jobStatusTone, when } from "./whatsappShared";

const FAMILY_OPTIONS = ["All", "client_whatsapp", "vendor_whatsapp", "campaign_execution"];
const STATUS_OPTIONS = [
  "All",
  "pending",
  "processing",
  "retry_scheduled",
  "succeeded",
  "failed",
  "uncertain",
  "dead_letter",
  "cancelled",
];

export function WhatsAppAutomationTab({
  result,
  query,
  setParam,
}: {
  result?: WhatsAppAutomationPageResult;
  query: WhatsAppQuery;
  setParam: (key: string, value?: string) => void;
}) {
  if (!result) return <FaultNotice fault="UNAVAILABLE" />;
  if (result.fault) return <FaultNotice fault={result.fault} />;

  return (
    <div className="space-y-4">
      <ReadOnlyNotice>
        <strong>Core decides</strong> the action, entity, recipient, template, variables, consent,
        eligibility, provider and outcome. <strong>n8n orchestrates</strong> — it is not business
        authority and cannot choose any of those. This view is visibility only: there is no run,
        retry, release, unclaim, force-complete or family-change control.
      </ReadOnlyNotice>

      <div className="flex flex-wrap items-center gap-2">
        <SelectFilter
          label="Workflow family"
          value={query.family ?? "All"}
          onChange={(value) => setParam("family", value)}
          options={FAMILY_OPTIONS}
        />
        <SelectFilter
          label="Job status"
          value={query.status ?? "All"}
          onChange={(value) => setParam("status", value)}
          options={STATUS_OPTIONS}
        />
      </div>

      <DataTable<WhatsAppAutomationRow>
        density="compact"
        getRowKey={(row) => row.jobId}
        columns={[
          { header: "Created", cell: (row) => <span className="whitespace-nowrap">{when(row.createdAt)}</span> },
          {
            header: "Family",
            cell: (row) => (
              <StatusBadge
                value={humanize(row.workflowFamily)}
                tone={row.workflowFamily === "unknown" ? "rose" : "blue"}
              />
            ),
          },
          { header: "Action", cell: (row) => row.actionType },
          { header: "Entity", cell: (row) => row.entityType },
          {
            header: "Status",
            cell: (row) => <StatusBadge value={humanize(row.status)} tone={jobStatusTone(row.status)} />,
          },
          {
            header: "Attempts",
            cell: (row) => (
              <span className="tabular-nums">
                {row.attemptCount} / {row.maxAttempts}
              </span>
            ),
          },
          {
            header: "Classification",
            cell: (row) =>
              row.lastResultClassification ? (
                humanize(row.lastResultClassification)
              ) : (
                <span className="text-slate-400">—</span>
              ),
          },
          {
            header: "Safe code",
            cell: (row) =>
              row.lastSafeCode ? (
                <code className="text-[12px]">{row.lastSafeCode}</code>
              ) : (
                <span className="text-slate-400">—</span>
              ),
          },
          { header: "Source", cell: (row) => row.requestSource },
          { header: "Next retry", cell: (row) => when(row.nextRetryAt) },
        ]}
        rows={[...result.rows]}
        emptyTitle="No automation jobs"
        emptyMessage="No automation job matches these filters in this environment."
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        onPageChange={(page) => setParam("page", String(page))}
        noun="automation jobs"
      />

      <p className="text-[11px] leading-4 text-slate-500">
        The workflow family shown is re-derived from the frozen action registry, exactly as the
        executor derives it — it is never read from a request. A family shown as{" "}
        <strong>unknown</strong> means the action type is not in the registry and would not be
        claimable by any executor.
      </p>
    </div>
  );
}
