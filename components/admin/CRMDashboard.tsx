"use client";

// ============================================================================
// QuickFurno CRM Dashboard (CRM + Analytics foundation)
// Display-only superadmin CRM. Uses existing leads when available and safe
// masked sample data when not. No WhatsApp, n8n, assignment, credit deduction,
// calendar sync, or database write is triggered from this component.
// ============================================================================

import { useMemo, useState } from "react";
import {
  DataTable,
  EmptyState,
  InfoGrid,
  StatCard,
  StatusBadge,
  Tabs,
} from "./AdminPrimitives";
import type { Snapshot } from "./adminTypes";
import { formatDate } from "./adminUtils";
import {
  buildCrmActivities,
  buildCrmCalendarEvents,
  buildCrmFollowUpTasks,
  getCrmLeadModel,
} from "@/lib/crm/crmAdapter";
import {
  crmCalendarEventTypes,
  crmLeadPriorities,
  crmLeadStatuses,
  crmNurtureReasons,
  crmNurtureStages,
  isFollowUpOverdue,
  type CRMCalendarEvent,
  type CRMLead,
} from "@/lib/crm/types";

type CRMDashboardProps = {
  data: Snapshot;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  error?: string | null;
};

const tabs = [
  "CRM Overview",
  "Lead Pipeline Board",
  "Lead Detail Placeholder",
  "Follow-up Tasks",
  "Nurture Queue",
  "CRM Calendar Placeholder",
  "CRM Activity Timeline Placeholder",
];

function label(value?: string | null) {
  return String(value ?? "Not set").replace(/_/g, " ");
}

function isLeadUnassigned(lead: CRMLead) {
  return (lead.assigned_vendor_count ?? 0) === 0 && !["won", "lost", "invalid", "duplicate"].includes(lead.status);
}

function hasFollowUpDue(lead: CRMLead) {
  if (!lead.next_follow_up_date) return false;
  if (isFollowUpOverdue(lead.next_follow_up_date)) return true;
  const today = new Date().toDateString();
  return new Date(lead.next_follow_up_date).toDateString() === today;
}

export function CRMDashboard({ data, error }: CRMDashboardProps) {
  const [active, setActive] = useState(tabs[0]);
  const crmModel = useMemo(() => getCrmLeadModel({ leads: data.leads, error, warnings: data.warnings }), [data.leads, data.warnings, error]);
  const leads = crmModel.leads;

  return (
    <div className="space-y-5">
      <CRMStatusBanner
        count={leads.length}
        isSample={crmModel.isSample}
        warning={crmModel.warning}
        usedFallbackColumns={crmModel.usedFallbackColumns}
      />

      <Tabs tabs={tabs} active={active} onChange={setActive} />

      {active === "CRM Overview" ? <CRMOverview leads={leads} /> : null}
      {active === "Lead Pipeline Board" ? <PipelineBoard leads={leads} /> : null}
      {active === "Lead Detail Placeholder" ? <LeadDetailPlaceholder leads={leads} /> : null}
      {active === "Follow-up Tasks" ? <FollowUpTasks leads={leads} /> : null}
      {active === "Nurture Queue" ? <NurtureQueue leads={leads} /> : null}
      {active === "CRM Calendar Placeholder" ? <CRMCalendarPlaceholder leads={leads} /> : null}
      {active === "CRM Activity Timeline Placeholder" ? <ActivityTimelinePlaceholder leads={leads} /> : null}
    </div>
  );
}

function CRMStatusBanner({
  count,
  isSample,
  warning,
  usedFallbackColumns,
}: {
  count: number;
  isSample: boolean;
  warning?: string | null;
  usedFallbackColumns: boolean;
}) {
  return (
    <div className="space-y-3">
      <section className={`rounded-2xl border px-5 py-4 text-sm leading-6 ${
        isSample ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}>
        CRM foundation is display-only. Phone numbers are masked in admin views. No WhatsApp, n8n,
        Google Calendar sync, auto assignment, credit deduction, or database write is active.
        {isSample
          ? ` Showing ${count} safe sample leads because live lead data is unavailable.`
          : ` Showing ${count} masked leads from existing lead data.`}
        {warning ? ` ${warning}` : ""}
        {usedFallbackColumns ? " Some optional lead columns were unavailable and safe fallbacks were used." : ""}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-xs leading-5 text-slate-500">
        CRM overlay tables are treated as not active until migrations are reviewed and applied manually.
        Notes, tasks, follow-ups, nurture, calendar, and timeline rows shown here are placeholders.
      </section>
    </div>
  );
}

function CRMOverview({ leads }: { leads: CRMLead[] }) {
  const count = (fn: (lead: CRMLead) => boolean) => leads.filter(fn).length;
  const cards = [
    { label: "Total CRM Leads", value: leads.length, helper: "Existing or sample CRM leads", tone: "indigo" as const },
    { label: "New Leads", value: count((lead) => lead.status === "new"), helper: "Awaiting qualification", tone: "amber" as const },
    { label: "Hot Leads", value: count((lead) => lead.priority === "hot"), helper: "High-intent badge only", tone: "rose" as const },
    { label: "Unassigned Leads", value: count(isLeadUnassigned), helper: "No vendor automation", tone: "slate" as const },
    { label: "Follow-ups Due", value: count(hasFollowUpDue), helper: "Placeholder schedule", tone: "amber" as const },
    { label: "Nurture Leads", value: count((lead) => lead.status === "nurture_later"), helper: "Long-term queue", tone: "slate" as const },
    { label: "Site Visits Scheduled", value: count((lead) => lead.status === "site_visit_scheduled"), helper: "Calendar placeholder", tone: "indigo" as const },
    { label: "Won Leads", value: count((lead) => lead.status === "won"), helper: "Closed won", tone: "emerald" as const },
    { label: "Lost Leads", value: count((lead) => lead.status === "lost"), helper: "Closed lost", tone: "rose" as const },
  ];

  return (
    <div className="space-y-5">
      <LabelPanel title="Lead priority labels" values={crmLeadPriorities} />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} helper={card.helper} icon="crm" tone={card.tone} />
        ))}
      </section>
    </div>
  );
}

function PipelineBoard({ leads }: { leads: CRMLead[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {crmLeadStatuses.map((status) => {
        const columnLeads = leads.filter((lead) => lead.status === status);
        return (
          <section key={status} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold capitalize text-slate-950">{label(status)}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{columnLeads.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {columnLeads.length ? (
                columnLeads.slice(0, 4).map((lead) => (
                  <article key={lead.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="truncate text-sm font-semibold text-slate-900">{lead.client_name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{lead.service} / {lead.area}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge value={lead.priority} />
                      <span className="font-mono text-xs text-slate-400">{lead.phone_masked}</span>
                    </div>
                  </article>
                ))
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No leads</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LeadDetailPlaceholder({ leads }: { leads: CRMLead[] }) {
  const [selectedId, setSelectedId] = useState(leads[0]?.id ?? "");
  const lead = leads.find((item) => item.id === selectedId) ?? leads[0];

  if (!lead) {
    return <EmptyState title="No lead selected" message="Lead detail placeholders will appear once lead data exists." />;
  }

  return (
    <div className="space-y-5">
      <label className="block max-w-sm">
        <span className="text-xs font-semibold uppercase text-slate-500">Select lead</span>
        <select
          value={lead.id}
          onChange={(event) => setSelectedId(event.target.value)}
          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
        >
          {leads.map((item) => (
            <option key={item.id} value={item.id}>{item.client_name} / {item.service}</option>
          ))}
        </select>
      </label>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">Lead Detail Placeholder</h3>
        <div className="mt-4">
          <InfoGrid rows={[
            ["Client name", lead.client_name],
            ["Phone masked", lead.phone_masked],
            ["City", lead.city ?? "Not set"],
            ["Service category", lead.service ?? "Not set"],
            ["Budget", lead.budget ?? "Not set"],
            ["Source", lead.source ?? "Unknown"],
            ["Status", <StatusBadge key="status" value={lead.status} />],
            ["Priority", <StatusBadge key="priority" value={lead.priority} />],
            ["Assigned vendors placeholder", `${lead.assigned_vendor_count ?? 0} / 3 vendors`],
            ["Timeline placeholder", "Lead timeline will appear after crm_activities is active"],
            ["Notes placeholder", "Notes will appear after crm_lead_notes is active"],
            ["Follow-up placeholder", lead.next_follow_up_date ? formatDate(lead.next_follow_up_date) : "Not scheduled"],
          ]} />
        </div>
      </section>
    </div>
  );
}

function FollowUpTasks({ leads }: { leads: CRMLead[] }) {
  const tasks = buildCrmFollowUpTasks(leads);
  return (
    <DataTable
      rows={tasks}
      emptyTitle="No follow-up tasks"
      emptyMessage="Follow-up tasks are placeholders until crm_lead_tasks is active."
      columns={[
        { header: "Lead", cell: (row) => row.title },
        { header: "Task type", cell: (row) => label(row.task_type) },
        { header: "Due date", cell: (row) => formatDate(row.due_date) },
        { header: "Owner", cell: (row) => row.owner ?? "Unassigned" },
        { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
      ]}
    />
  );
}

function NurtureQueue({ leads }: { leads: CRMLead[] }) {
  const nurtureLeads = leads.filter((lead) => lead.status === "nurture_later" || lead.nurture_stage);
  return (
    <div className="space-y-5">
      <LabelPanel title="Nurture stage labels" values={crmNurtureStages} />
      <LabelPanel title="Nurture reason labels" values={crmNurtureReasons} />

      <DataTable
        rows={nurtureLeads}
        emptyTitle="No nurture leads"
        emptyMessage="Nurture rows are placeholders only. No reminders are scheduled."
        columns={[
          { header: "Lead", cell: (row) => row.client_name },
          { header: "Masked phone", cell: (row) => <span className="font-mono">{row.phone_masked}</span> },
          { header: "Stage", cell: (row) => <StatusBadge value={row.nurture_stage ?? "not_ready_now"} /> },
          { header: "Reason", cell: (row) => label(row.nurture_reason ?? "other") },
          { header: "Follow-up placeholder", cell: (row) => formatDate(row.nurture_follow_up_date ?? row.next_follow_up_date) },
          { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
        ]}
      />
    </div>
  );
}

function CRMCalendarPlaceholder({ leads }: { leads: CRMLead[] }) {
  const events = buildCrmCalendarEvents(leads);
  return (
    <div className="space-y-5">
      <LabelPanel title="CRM calendar event types" values={crmCalendarEventTypes} />
      <DataTable
        rows={events}
        emptyTitle="No calendar events"
        emptyMessage="Calendar events are placeholders only. Google Calendar is not connected."
        columns={[
          { header: "Lead", cell: (row) => eventLeadName(row, leads) },
          { header: "Event type", cell: (row) => <StatusBadge value={row.event_type} /> },
          { header: "Due date", cell: (row) => formatDate(row.scheduled_at) },
          { header: "Owner", cell: (row) => row.owner ?? "Unassigned" },
          { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
        ]}
      />
    </div>
  );
}

function ActivityTimelinePlaceholder({ leads }: { leads: CRMLead[] }) {
  const activities = buildCrmActivities(leads);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-950">CRM Activity Timeline Placeholder</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {activities.map((activity) => (
          <article key={activity.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-slate-950">{activity.summary}</p>
              <StatusBadge value={activity.activity_type} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{activity.actor ?? "System"} / {formatDate(activity.created_at)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LabelPanel({ title, values }: { title: string; values: readonly string[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {values.map((value) => <StatusBadge key={value} value={value} />)}
      </div>
    </section>
  );
}

function eventLeadName(event: CRMCalendarEvent, leads: CRMLead[]) {
  return leads.find((lead) => lead.id === event.lead_id)?.client_name ?? "Placeholder lead";
}
