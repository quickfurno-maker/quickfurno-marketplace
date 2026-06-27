"use client";

// ============================================================================
// QuickFurno CRM Dashboard (Phase 3 foundation · Phase 5 real-lead connection)
// Superadmin CRM module. Reads REAL existing leads from the admin snapshot
// (public.leads) via the read-only crmLeadAdapter. Phone numbers are ALWAYS
// masked in list/table/card views — the full client phone is never rendered.
//
// SAFE MODE: no real AI, no WhatsApp sending, no Google Calendar, no live lead
// distribution, no credit deduction, and NO database writes. All action buttons
// are placeholders and all status/nurture changes are local UI state only.
//
// TODO(crm-sync): merge crm_* overlay rows (notes, tasks, nurture, owner) once
//   the Phase 3 migration is applied — adapter already leaves room for them.
// TODO(lead-status): wire real lead status updates through a guarded action.
// TODO(crm-writes): persist notes/tasks/nurture schedule to crm_* tables.
// TODO(aos-leadlens): replace the priority fallback with a real LeadLens score.
// TODO(aos-trustshield): surface TrustShield spam risk for spam_review routing.
// TODO(aos-matchforge): show MatchForge vendor suggestions (max 3, no disabled).
// ============================================================================

import { useMemo, useState, type ReactNode } from "react";
import {
  DataTable,
  EmptyState,
  InfoGrid,
  SecondaryButton,
  StatCard,
  StatusBadge,
  Tabs,
} from "./AdminPrimitives";
import type { Snapshot, Vendor } from "./adminTypes";
import { formatDate } from "./adminUtils";
import {
  adaptCrmLeads,
  hasLeadFallbackWarning,
  resolveLeadLoadState,
  type CRMLeadLoadState,
} from "@/lib/crm/adapters/leadAdapter";
import { AOS_LABELS, getLeadAosSnapshot } from "@/lib/aos/sync/aosCrmSyncService";
import {
  crmNurtureReasons,
  isFollowUpOverdue,
  nurturePresets,
  validateNurtureSchedule,
  type CRMActivity,
  type CRMCalendarEvent,
  type CRMCalendarEventType,
  type CRMLead,
  type CRMLeadStatus,
  type CRMNote,
  type CRMNurtureReason,
  type CRMSource,
  type CRMTask,
} from "@/lib/crm/types";

type CRMDashboardProps = {
  data: Snapshot;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  // Snapshot-level load error (set when the whole admin snapshot failed).
  error?: string | null;
};

const tabs = [
  "CRM Overview",
  "Lead Inbox",
  "Pipeline Board",
  "Lead Detail",
  "Follow-up Tasks",
  "Lead Notes",
  "Activity Timeline",
  "Nurture Queue",
  "CRM Calendar",
  "Source Tracking",
  "Vendor Assignment",
];

const pipelineColumns: Array<{ key: string; label: string; statuses: CRMLeadStatus[] }> = [
  { key: "new", label: "New", statuses: ["new"] },
  { key: "qualified", label: "Qualified", statuses: ["qualified", "vendor_matching", "spam_review"] },
  { key: "assigned", label: "Assigned", statuses: ["assigned", "vendor_contact_pending"] },
  { key: "contacted", label: "Contacted", statuses: ["client_contacted", "site_visit_scheduled"] },
  { key: "quotation", label: "Quotation", statuses: ["quotation_sent"] },
  { key: "won", label: "Won", statuses: ["won"] },
  { key: "lost", label: "Lost", statuses: ["lost", "invalid", "duplicate"] },
  { key: "nurture", label: "Nurture", statuses: ["nurture_later"] },
];

const calendarEventTypes: CRMCalendarEventType[] = [
  "client_call",
  "vendor_call",
  "site_visit",
  "quotation_followup",
  "nurture_followup",
  "complaint_followup",
  "renewal_followup",
];

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

export function CRMDashboard({ data, notify, error }: CRMDashboardProps) {
  const [active, setActive] = useState(tabs[0]);

  const leads = useMemo(() => adaptCrmLeads(data.leads), [data.leads]);
  const loadState: CRMLeadLoadState = useMemo(
    () => resolveLeadLoadState({ error, warnings: data.warnings, count: leads.length }),
    [error, data.warnings, leads.length],
  );
  const usedFallbackColumns = hasLeadFallbackWarning(data.warnings);

  function placeholder(action: string) {
    notify(`${action} is a safe placeholder. No live CRM action was executed.`);
  }

  return (
    <div className="space-y-5">
      <CRMStatusBanner loadState={loadState} count={leads.length} usedFallbackColumns={usedFallbackColumns} />

      <Tabs tabs={tabs} active={active} onChange={setActive} />

      {active === "CRM Overview" ? <CRMOverview leads={leads} loadState={loadState} /> : null}
      {active === "Lead Inbox" ? <LeadInbox leads={leads} loadState={loadState} placeholder={placeholder} /> : null}
      {active === "Pipeline Board" ? <PipelineBoard leads={leads} loadState={loadState} /> : null}
      {active === "Lead Detail" ? <LeadDetail leads={leads} vendors={data.vendors} placeholder={placeholder} /> : null}
      {active === "Follow-up Tasks" ? <FollowUpTasks leads={leads} placeholder={placeholder} /> : null}
      {active === "Lead Notes" ? <LeadNotes leads={leads} placeholder={placeholder} /> : null}
      {active === "Activity Timeline" ? <ActivityTimeline leads={leads} /> : null}
      {active === "Nurture Queue" ? <NurtureQueue leads={leads} notify={notify} placeholder={placeholder} /> : null}
      {active === "CRM Calendar" ? <CRMCalendar leads={leads} placeholder={placeholder} /> : null}
      {active === "Source Tracking" ? <SourceTracking leads={leads} loadState={loadState} /> : null}
      {active === "Vendor Assignment" ? <VendorAssignmentView leads={leads} placeholder={placeholder} /> : null}
    </div>
  );
}

// Top banner reflects the real load state and the CRM-overlay status.
function CRMStatusBanner({
  loadState,
  count,
  usedFallbackColumns,
}: {
  loadState: CRMLeadLoadState;
  count: number;
  usedFallbackColumns: boolean;
}) {
  return (
    <div className="space-y-3">
      {loadState === "failed" ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm leading-6 text-rose-900">
          Failed to load leads from Supabase. The CRM is showing safe empty states until the lead
          query recovers. No data was written.
        </section>
      ) : (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
          QuickFurno CRM is connected to existing leads in read-only mode. Phone numbers are masked,
          and no AI, WhatsApp, Google Calendar, lead distribution, or credit deduction is connected.
          {loadState === "live"
            ? ` Showing ${count} masked lead${count === 1 ? "" : "s"} from public.leads.`
            : " No leads were returned yet — empty states are shown below."}
          {usedFallbackColumns ? " Some lead columns were unavailable, so fallback columns were used." : ""}
        </section>
      )}

      {/* CRM overlay (crm_* tables) is optional and not required for this view. */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-xs leading-5 text-slate-500">
        CRM overlay tables (crm_leads, crm_lead_notes, crm_lead_tasks, crm_followups…) are not
        required for this page and are treated as not applied yet. Notes, tasks, status changes, and
        nurture scheduling are local UI placeholders only until those tables are applied and write
        flows are enabled.
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. CRM Overview
// ---------------------------------------------------------------------------
function CRMOverview({ leads, loadState }: { leads: CRMLead[]; loadState: CRMLeadLoadState }) {
  if (loadState === "failed") {
    return <EmptyState title="Failed to load leads" message="CRM overview metrics will appear once the lead query recovers. No data was written." />;
  }

  const count = (fn: (lead: CRMLead) => boolean) => leads.filter(fn).length;
  const followUpDue = count((l) => Boolean(l.next_follow_up_date) && !isFollowUpOverdue(l.next_follow_up_date));
  const overdue = count((l) => isFollowUpOverdue(l.next_follow_up_date));
  const nurture = count((l) => l.status === "nurture_later");

  const cards: Array<{ label: string; value: number; helper: string; tone?: "emerald" | "indigo" | "amber" | "rose" | "slate" }> = [
    { label: "Total leads", value: leads.length, helper: "From public.leads", tone: "indigo" },
    { label: "New leads", value: count((l) => l.status === "new"), helper: "Awaiting qualification", tone: "amber" },
    { label: "Hot leads", value: count((l) => l.priority === "hot"), helper: "High intent", tone: "rose" },
    { label: "Assigned leads", value: count((l) => l.status === "assigned" || (l.assigned_vendor_count ?? 0) > 0), helper: "Sent to vendors (max 3)" },
    { label: "Follow-up due", value: followUpDue, helper: "Scheduled ahead", tone: "amber" },
    { label: "Overdue follow-ups", value: overdue, helper: "Past due date", tone: "rose" },
    { label: "Nurture leads", value: nurture, helper: "Long-term pipeline", tone: "slate" },
    { label: "Won leads", value: count((l) => l.status === "won"), helper: "Closed won", tone: "emerald" },
    { label: "Lost leads", value: count((l) => l.status === "lost"), helper: "Closed lost", tone: "rose" },
    { label: "Site visits scheduled", value: count((l) => l.status === "site_visit_scheduled"), helper: "Upcoming visits" },
    { label: "Quotation follow-ups", value: count((l) => l.status === "quotation_sent"), helper: "Awaiting client decision", tone: "amber" },
    { label: "Calendar events this week", value: count((l) => Boolean(l.next_follow_up_date)), helper: "From follow-up dates", tone: "indigo" },
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <StatCard key={card.label} label={card.label} value={card.value} helper={card.helper} icon="leads" tone={card.tone} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Lead Inbox
// ---------------------------------------------------------------------------
function LeadInbox({ leads, loadState, placeholder }: { leads: CRMLead[]; loadState: CRMLeadLoadState; placeholder: (action: string) => void }) {
  if (loadState === "failed") {
    return <EmptyState title="Failed to load leads" message="We could not read leads from Supabase. Showing a safe empty state — no data was written. Try refreshing once the connection recovers." />;
  }
  if (loadState === "empty") {
    return <EmptyState title="No leads found" message="There are no leads in public.leads yet. New public form submissions will appear here automatically with masked phone numbers." />;
  }

  return (
    <DataTable
      rows={leads}
      emptyTitle="No leads found"
      emptyMessage="New public form submissions will appear here with masked phone numbers."
      columns={[
        { header: "Client name", cell: (row) => <Strong title={row.client_name} subtitle={row.owner ?? "Unassigned"} /> },
        { header: "Masked phone", cell: (row) => <span className="font-mono text-slate-700">{row.phone_masked}</span> },
        { header: "Service", cell: (row) => row.service },
        { header: "City/Area", cell: (row) => `${row.city} / ${row.area}` },
        { header: "Priority", cell: (row) => <StatusBadge value={row.priority} /> },
        { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "Source", cell: (row) => row.source },
        { header: "Assigned vendors", cell: (row) => `${row.assigned_vendor_count ?? 0} / 3` },
        { header: "Created", cell: (row) => formatDate(row.created_at) },
        { header: "Next follow-up", cell: (row) => <FollowUpCell date={row.next_follow_up_date} /> },
        { header: "Actions", cell: (row) => <SecondaryButton onClick={() => placeholder(`Open ${row.client_name}`)}>Open</SecondaryButton> },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// 3. Pipeline Board
// ---------------------------------------------------------------------------
function PipelineBoard({ leads, loadState }: { leads: CRMLead[]; loadState: CRMLeadLoadState }) {
  if (loadState !== "live") {
    return (
      <EmptyState
        title={loadState === "failed" ? "Failed to load leads" : "No leads to organize"}
        message={loadState === "failed" ? "The pipeline board will populate once leads load. No data was written." : "Leads will appear in the pipeline as soon as they exist in public.leads."}
      />
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {pipelineColumns.map((column) => {
        const columnLeads = leads.filter((lead) => column.statuses.includes(lead.status));
        return (
          <section key={column.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-950">{column.label}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{columnLeads.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {columnLeads.length ? (
                columnLeads.slice(0, 8).map((lead) => (
                  <article key={lead.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="truncate text-sm font-semibold text-slate-900">{lead.client_name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{lead.service} · {lead.area}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <StatusBadge value={lead.priority} />
                      <span className="font-mono text-xs text-slate-400">{lead.phone_masked}</span>
                    </div>
                  </article>
                ))
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No leads</p>
              )}
              {columnLeads.length > 8 ? (
                <p className="text-center text-xs text-slate-400">+{columnLeads.length - 8} more</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Lead Detail Placeholder
// ---------------------------------------------------------------------------
function LeadDetail({ leads, vendors, placeholder }: { leads: CRMLead[]; vendors: Vendor[]; placeholder: (action: string) => void }) {
  const [selectedId, setSelectedId] = useState(leads[0]?.id ?? "");
  const lead = leads.find((item) => item.id === selectedId) ?? leads[0];

  if (!lead) {
    return <EmptyState title="No lead selected" message="CRM leads will appear here once they exist in public.leads." />;
  }

  // Rule-based AOS snapshot for this lead. No AI call is made (AI is disabled).
  const aos = getLeadAosSnapshot(lead, vendors);

  return (
    <div className="space-y-5">
      <label className="block max-w-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Select lead</span>
        <select
          value={lead.id}
          onChange={(event) => setSelectedId(event.target.value)}
          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
        >
          {leads.map((item) => (
            <option key={item.id} value={item.id}>
              {item.client_name} · {item.service}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Client profile">
          <InfoGrid rows={[
            ["Client name", lead.client_name],
            ["Masked phone", lead.phone_masked],
            ["Masked email", lead.email_masked ?? "Not provided"],
            ["City / Area", `${lead.city} / ${lead.area}`],
            ["Owner", lead.owner ?? "Unassigned"],
            ["Priority", <StatusBadge key="p" value={lead.priority} />],
          ]} />
          {/* Phone stays masked even on detail. The route is superadmin-guarded, but
              full-number reveal must go through a dedicated, audited server action so
              the raw phone is never shipped in the client payload by default. */}
          <div className="mt-4">
            <SecondaryButton onClick={() => placeholder("Reveal full number (admin)")}>Reveal full number (admin)</SecondaryButton>
            {/* TODO(secure-reveal): add an audited server action that returns the full
                phone only for confirmed superadmins, logging the access. */}
          </div>
        </Panel>
        <Panel title="Requirement details">
          <InfoGrid rows={[
            ["Service", lead.service ?? "Not set"],
            ["Subcategory", lead.subcategory ?? "Not set"],
            ["Budget", lead.budget ?? "Not set"],
            ["Status", <StatusBadge key="s" value={lead.status} />],
            ["Created", formatDate(lead.created_at)],
            ["Next follow-up", <FollowUpCell key="f" date={lead.next_follow_up_date} />],
          ]} />
        </Panel>
        <Panel title="Lead source & UTM data">
          <InfoGrid rows={[
            ["Source", lead.source ?? "Unknown"],
            ["UTM source", lead.attribution?.utm_source ?? "Not captured"],
            ["UTM medium", lead.attribution?.utm_medium ?? "Not captured"],
            ["UTM campaign", lead.attribution?.utm_campaign ?? "Not captured"],
            ["Landing page", lead.attribution?.landing_page ?? "Not captured"],
            ["Device", lead.attribution?.device_type ?? "Not captured"],
          ]} />
        </Panel>
        <Panel title="LeadLens Score">
          <AosLabelRow label={aos.leadLens.agent_status} />
          <InfoGrid rows={[
            ["Lead score", `${aos.leadLens.lead_score} / 100`],
            ["Lead quality", <StatusBadge key="q" value={aos.leadLens.lead_quality} />],
            ["Confidence", `${aos.leadLens.confidence}%`],
            ["Mode", aos.leadLens.mode],
            ["Reason", aos.leadLens.reason],
          ]} />
        </Panel>
        <Panel title="TrustShield Risk">
          <AosLabelRow label={aos.trustShield.agent_status} />
          <InfoGrid rows={[
            ["Spam risk", <StatusBadge key="sr" value={aos.trustShield.spam_risk} />],
            ["Duplicate risk", <StatusBadge key="dr" value={aos.trustShield.duplicate_risk} />],
            ["Chargeable lead", aos.trustShield.chargeable_lead],
            ["Review recommended", aos.trustShield.review_recommended ? "Yes — manual review" : "No"],
            ["Reason", aos.trustShield.reason],
          ]} />
        </Panel>
        <Panel title="MatchForge Suggestions">
          <AosLabelRow label={aos.matchForge.agent_status} />
          <InfoGrid rows={[
            ["Suggested vendors", aos.matchForge.suggested_vendors.length
              ? aos.matchForge.suggested_vendors.map((v) => `${v.vendor_name} (${v.score})`).join("; ")
              : "None matched"],
            ["Ranking reason", aos.matchForge.ranking_reason],
            ["Assignment ready", aos.matchForge.assignment_ready ? "Yes (suggestion only)" : "No"],
            ["Human review required", aos.matchForge.human_review_required ? "Yes" : "No"],
            ["Auto-assignment", aos.matchForge.auto_assignment_enabled ? "Enabled" : "Disabled"],
            ["Reason", aos.matchForge.reason],
          ]} />
        </Panel>
        <Panel title="LeadFlow Assignment Status">
          <AosLabelRow label={aos.leadFlow.agent_status} />
          <InfoGrid rows={[
            ["Assignment status", aos.leadFlow.assignment_status],
            ["Notification status", `${aos.leadFlow.whatsapp_status} · ${AOS_LABELS.noWhatsApp}`],
            ["Credit deduction", `${aos.leadFlow.credit_deduction_status} · ${AOS_LABELS.noCredits}`],
            ["Audit log preview", aos.leadFlow.audit_log_preview],
            ["Reason", aos.leadFlow.reason],
          ]} />
        </Panel>
        <Panel title="Notes & tasks">
          <InfoGrid rows={[
            ["Notes", "Placeholder note feed (see Lead Notes tab)"],
            ["Tasks", "Placeholder task feed (see Follow-up Tasks tab)"],
            ["Call status", "Not logged"],
            ["Activity timeline", "Placeholder (see Activity Timeline tab)"],
          ]} />
        </Panel>
        <Panel title="Final outcome">
          <InfoGrid rows={[
            ["Outcome", lead.status === "won" ? "Won" : lead.status === "lost" ? "Lost" : "In progress"],
            ["Nurture stage", lead.nurture_stage ?? "Not nurturing"],
            ["Nurture reason", lead.nurture_reason ?? "None"],
            ["Last activity", formatDate(lead.last_activity_at)],
          ]} />
        </Panel>
      </div>

      {/* AOS Activity Timeline — rule-based placeholder events. No AI / WhatsApp / credits. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-950">AOS Activity Timeline</h2>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">{AOS_LABELS.aiNotActive}</span>
        </div>
        <ol className="mt-4 space-y-4">
          {aos.timeline.map((entry, index) => (
            <li key={`${entry.agent}-${index}`} className="flex gap-3">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-400" />
              <div className="min-w-0">
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{entry.agent}</span> · {entry.action.replace(/_/g, " ")} → {entry.decision}
                </p>
                <p className="mt-1 text-xs text-slate-400">{entry.label} · mode: {entry.mode}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// Small inline label chip used above each AOS panel.
function AosLabelRow({ label }: { label: string }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">{AOS_LABELS.aiNotActive}</span>
      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Follow-up Tasks (placeholder feed derived from real leads, read-only)
// ---------------------------------------------------------------------------
function FollowUpTasks({ leads, placeholder }: { leads: CRMLead[]; placeholder: (action: string) => void }) {
  // TODO(crm-writes): replace this derived feed with rows from crm_lead_tasks.
  const tasks: CRMTask[] = leads
    .filter((lead) => lead.next_follow_up_date)
    .slice(0, 20)
    .map((lead) => ({
      id: `task-${lead.id}`,
      lead_id: lead.id,
      title: `Follow up with ${lead.client_name}`,
      task_type: "follow_up",
      due_date: lead.next_follow_up_date,
      owner: lead.owner ?? "Unassigned",
      status: isFollowUpOverdue(lead.next_follow_up_date) ? "overdue" : "open",
      created_at: lead.created_at,
    }));

  return (
    <DataTable
      rows={tasks}
      emptyTitle="No follow-up tasks"
      emptyMessage="Tasks will appear here once leads have follow-up dates, or once crm_lead_tasks is applied."
      columns={[
        { header: "Task", cell: (row) => <Strong title={row.title} subtitle={row.task_type ?? ""} /> },
        { header: "Owner", cell: (row) => row.owner },
        { header: "Due", cell: (row) => <FollowUpCell date={row.due_date} /> },
        { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
        { header: "Actions", cell: (row) => <SecondaryButton onClick={() => placeholder(`Mark done: ${row.title}`)}>Mark Done</SecondaryButton> },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// 6. Lead Notes (placeholder — writes disabled until crm_lead_notes is applied)
// ---------------------------------------------------------------------------
function LeadNotes({ leads, placeholder }: { leads: CRMLead[]; placeholder: (action: string) => void }) {
  if (!leads.length) {
    return <EmptyState title="No notes yet" message="Lead notes will appear here once leads exist and crm_lead_notes is applied." />;
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* TODO(crm-writes): persist to crm_lead_notes via a guarded server action. */}
        <SecondaryButton onClick={() => placeholder("Add note")}>Add Note</SecondaryButton>
      </div>
      <EmptyState
        title="Notes not connected yet"
        message="The CRM note feed is read-only in this phase. Once crm_lead_notes is applied, notes for each lead will appear here. No notes are stored locally."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Activity Timeline (derived from real lead fields, read-only)
// ---------------------------------------------------------------------------
function ActivityTimeline({ leads }: { leads: CRMLead[] }) {
  if (!leads.length) {
    return <EmptyState title="No activity yet" message="Activity will appear here once leads exist in public.leads." />;
  }
  // TODO(crm-writes): replace with rows from crm_activities once applied.
  const activities: CRMActivity[] = leads.slice(0, 12).map((lead) => ({
    id: `act-${lead.id}`,
    lead_id: lead.id,
    activity_type: "lead_created",
    summary: `${lead.client_name} · ${lead.service} from ${lead.source}. Current status: ${lead.status.replace(/_/g, " ")}.`,
    actor: "System",
    created_at: lead.created_at,
  }));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-950">Activity Timeline</h3>
      <ol className="mt-4 space-y-4">
        {activities.map((activity) => (
          <li key={activity.id} className="flex gap-3">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
            <div className="min-w-0">
              <p className="text-sm text-slate-700">{activity.summary}</p>
              <p className="mt-1 text-xs text-slate-400">
                {activity.activity_type.replace(/_/g, " ")} · {activity.actor} · {formatDate(activity.created_at)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 8. Nurture Queue (with advanced nurture date selection)
// ---------------------------------------------------------------------------
function NurtureQueue({
  leads,
  notify,
  placeholder,
}: {
  leads: CRMLead[];
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  placeholder: (action: string) => void;
}) {
  const nurtureLeads = leads.filter((lead) => lead.status === "nurture_later" || lead.nurture_stage);

  return (
    <div className="space-y-5">
      <NurtureScheduler notify={notify} />

      <DataTable
        rows={nurtureLeads}
        emptyTitle="No nurture leads"
        emptyMessage="Leads marked for long-term follow-up will appear here. Scheduling below validates dates only — nothing is saved until crm_followups is applied."
        columns={[
          { header: "Client", cell: (row) => <Strong title={row.client_name} subtitle={row.phone_masked} /> },
          { header: "Service", cell: (row) => row.service },
          { header: "City/Area", cell: (row) => `${row.city} / ${row.area}` },
          { header: "Nurture stage", cell: (row) => <StatusBadge value={(row.nurture_stage ?? "not_set").replace(/_/g, " ")} /> },
          { header: "Nurture reason", cell: (row) => (row.nurture_reason ?? "—").replace(/_/g, " ") },
          { header: "Next follow-up", cell: (row) => <FollowUpCell date={row.nurture_follow_up_date ?? row.next_follow_up_date} /> },
          { header: "Owner", cell: (row) => row.owner ?? "Unassigned" },
          { header: "Last activity", cell: (row) => formatDate(row.last_activity_at) },
          { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
          {
            header: "Actions",
            cell: (row) => (
              <div className="flex flex-wrap gap-2">
                {["Reschedule Nurture Date", "Move Back to Active Lead", "Extend nurture", "Add Nurture Note"].map((action) => (
                  <SecondaryButton key={`${row.id}-${action}`} onClick={() => placeholder(`${action} for ${row.client_name}`)}>
                    {action}
                  </SecondaryButton>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function NurtureScheduler({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  const [preset, setPreset] = useState<string>("nurture_30_days");
  const [customDate, setCustomDate] = useState<string>("");
  const [reason, setReason] = useState<CRMNurtureReason | "">("");

  const isCustom = preset === "custom_nurture_date";

  function resolveDate(): string {
    if (isCustom) return customDate;
    const presetMeta = nurturePresets.find((item) => item.key === preset);
    if (!presetMeta || presetMeta.days == null) return customDate;
    return addDays(new Date(), presetMeta.days);
  }

  function schedule(actionLabel: string) {
    const targetDate = resolveDate();
    const error = validateNurtureSchedule({
      nurture_follow_up_date: targetDate,
      nurture_custom_date_enabled: isCustom,
      nurture_reason: reason || null,
    });
    if (error) {
      notify(error, "error");
      return;
    }
    // SAFE: validation only. No DB write, no WhatsApp, no calendar sync here.
    // TODO(crm-writes): persist into crm_followups / crm_leads.nurture_follow_up_date.
    // TODO(n8n-whatsapp): enqueue nurture reminder via n8n workflow.
    // TODO(aos): hand long-term nurture follow-ups to the future ClientCare agent.
    notify(`${actionLabel} validated for ${formatDate(targetDate)} (placeholder only — nothing was saved).`, "success");
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-950">Advanced nurture date selection</h3>
      <p className="mt-1 text-sm text-slate-500">
        Nurture follow-ups are not limited to 3/7/15/30/60 days. Pick a preset or a custom date
        beyond two months using the date picker. Custom dates require a nurture reason.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {nurturePresets.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setPreset(item.key)}
            className={`min-h-9 rounded-xl border px-3 text-xs font-semibold transition ${
              preset === item.key
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Custom nurture date</span>
          <input
            type="date"
            value={customDate}
            min={new Date().toISOString().slice(0, 10)}
            disabled={!isCustom}
            onChange={(event) => setCustomDate(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Nurture reason{isCustom ? " (required)" : ""}
          </span>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as CRMNurtureReason | "")}
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
          >
            <option value="">Select reason</option>
            {crmNurtureReasons.map((item) => (
              <option key={item} value={item}>
                {item.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <SecondaryButton onClick={() => schedule(isCustom ? "Schedule Custom Nurture Date" : "Schedule follow-up")}>
            {isCustom ? "Schedule Custom Nurture Date" : "Schedule follow-up"}
          </SecondaryButton>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {["Move to active", "Mark lost", "Add note"].map((action) => (
          <SecondaryButton key={action} onClick={() => notify(`${action} is a safe placeholder. No live CRM action was executed.`)}>
            {action}
          </SecondaryButton>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 9. CRM Calendar (foundation, derived from real follow-up dates, no Google sync)
// ---------------------------------------------------------------------------
function CRMCalendar({ leads, placeholder }: { leads: CRMLead[]; placeholder: (action: string) => void }) {
  // Derive calendar events from real follow-up dates where present.
  // TODO(google-calendar): sync these events to Google Calendar.
  // TODO(n8n-whatsapp): trigger reminder workflows for due/overdue events.
  // TODO(aos): ClientCare agent will auto-schedule nurture reminders later.
  const events: CRMCalendarEvent[] = leads
    .filter((lead) => lead.next_follow_up_date)
    .slice(0, 24)
    .map((lead, index) => {
      const type = calendarEventTypes[index % calendarEventTypes.length];
      return {
        id: `cal-${lead.id}`,
        lead_id: lead.id,
        title: `${type.replace(/_/g, " ")} · ${lead.client_name}`,
        event_type: type,
        scheduled_at: lead.next_follow_up_date as string,
        owner: lead.owner ?? "Unassigned",
        status: isFollowUpOverdue(lead.next_follow_up_date) ? "overdue" : "scheduled",
        notes: `${lead.service} · ${lead.area}`,
      };
    });

  const groups: Array<{ label: string; filter: (e: CRMCalendarEvent) => boolean }> = [
    { label: "Today's follow-ups", filter: (e) => isToday(e.scheduled_at) },
    { label: "Overdue follow-ups", filter: (e) => isFollowUpOverdue(e.scheduled_at) },
    { label: "Upcoming follow-ups", filter: (e) => withinDays(e.scheduled_at, 0, 7) },
    { label: "This Week", filter: (e) => withinDays(e.scheduled_at, 0, 7) },
    { label: "This Month", filter: (e) => withinDays(e.scheduled_at, 0, 31) },
    { label: "Next 90 Days", filter: (e) => withinDays(e.scheduled_at, 0, 90) },
    { label: "Future Follow-ups", filter: (e) => withinDays(e.scheduled_at, 90, 3650) },
    { label: "Site visits", filter: (e) => e.event_type === "site_visit" },
    { label: "Quotation follow-ups", filter: (e) => e.event_type === "quotation_followup" },
    { label: "Vendor calls", filter: (e) => e.event_type === "vendor_call" },
    { label: "Nurture follow-ups", filter: (e) => e.event_type === "nurture_followup" },
    { label: "Long-term nurture reminders", filter: (e) => e.event_type === "nurture_followup" && withinDays(e.scheduled_at, 60, 3650) },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm leading-6 text-indigo-900">
        Internal CRM calendar foundation derived from lead follow-up dates. Google Calendar is not
        connected yet, and no reminders are sent.
      </section>

      <div className="flex flex-wrap gap-2">
        {["Add to Calendar", "Reschedule", "Mark Done", "Create Follow-up"].map((action) => (
          <SecondaryButton key={action} onClick={() => placeholder(action)}>
            {action}
          </SecondaryButton>
        ))}
      </div>

      {events.length === 0 ? (
        <EmptyState title="No calendar events" message="Events appear here once leads have follow-up dates. Nothing is synced to an external calendar." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const groupEvents = events.filter(group.filter);
            return (
              <section key={group.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-950">{group.label}</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{groupEvents.length}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {groupEvents.length ? (
                    groupEvents.slice(0, 4).map((event) => (
                      <article key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="truncate text-sm font-semibold text-slate-900">{event.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDate(event.scheduled_at)} · {event.notes}</p>
                        <div className="mt-2"><StatusBadge value={event.status} /></div>
                      </article>
                    ))
                  ) : (
                    <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs text-slate-400">No events</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10. Source Tracking
// ---------------------------------------------------------------------------
function SourceTracking({ leads, loadState }: { leads: CRMLead[]; loadState: CRMLeadLoadState }) {
  const map = new Map<string, CRMSource>();
  leads.forEach((lead) => {
    const key = lead.source || "Unknown";
    const current = map.get(key) ?? { id: `src-${key}`, source: key, leads: 0, hot_leads: 0, assigned_leads: 0, won_leads: 0 };
    current.leads += 1;
    if (lead.priority === "hot") current.hot_leads = (current.hot_leads ?? 0) + 1;
    if ((lead.assigned_vendor_count ?? 0) > 0 || lead.status === "assigned") current.assigned_leads = (current.assigned_leads ?? 0) + 1;
    if (lead.status === "won") current.won_leads = (current.won_leads ?? 0) + 1;
    map.set(key, current);
  });
  const sources = [...map.values()].sort((a, b) => b.leads - a.leads);

  // Source tracking is "not available yet" when there is no usable source signal
  // (no leads, or every lead resolved to Unknown).
  const onlyUnknown = sources.length > 0 && sources.every((s) => s.source === "Unknown");
  if (loadState !== "live" || !sources.length || onlyUnknown) {
    return (
      <EmptyState
        title="Source tracking not available yet"
        message="Lead source / UTM tracking is not populated yet. Once leads carry source and UTM data (or lead_attribution is applied), the source breakdown will appear here."
      />
    );
  }

  return (
    <DataTable
      rows={sources}
      emptyTitle="No source data"
      emptyMessage="Lead source breakdown will appear here once leads carry source data."
      columns={[
        { header: "Source", cell: (row) => <Strong title={row.source} subtitle={row.channel ?? "Tracked channel"} /> },
        { header: "Leads", cell: (row) => row.leads },
        { header: "Hot leads", cell: (row) => row.hot_leads ?? 0 },
        { header: "Assigned leads", cell: (row) => row.assigned_leads ?? 0 },
        { header: "Won leads", cell: (row) => row.won_leads ?? 0 },
        { header: "Cost (placeholder)", cell: () => "INR — " },
        { header: "CPL (placeholder)", cell: () => "INR — " },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// 11. Vendor Assignment View
// ---------------------------------------------------------------------------
function VendorAssignmentView({ leads, placeholder }: { leads: CRMLead[]; placeholder: (action: string) => void }) {
  const assigned = leads.filter((lead) => (lead.assigned_vendor_count ?? 0) > 0 || lead.status === "assigned");

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
        Read-only assignment view. One lead is shared with a maximum of 3 matched vendors. Disabled
        vendors never receive leads. No live distribution or credit deduction happens from this page.
      </section>
      <DataTable
        rows={assigned}
        emptyTitle="No assigned leads"
        emptyMessage="Leads that already have vendor assignments will appear here. No distribution is triggered from this view."
        columns={[
          { header: "Client", cell: (row) => <Strong title={row.client_name} subtitle={row.phone_masked} /> },
          { header: "Service", cell: (row) => row.service },
          { header: "City/Area", cell: (row) => `${row.city} / ${row.area}` },
          { header: "Assigned vendors", cell: (row) => `${row.assigned_vendor_count ?? 0} / 3` },
          { header: "Status", cell: (row) => <StatusBadge value={row.status} /> },
          { header: "Created", cell: (row) => formatDate(row.created_at) },
          { header: "Actions", cell: (row) => <SecondaryButton onClick={() => placeholder(`View assignment for ${row.client_name}`)}>View</SecondaryButton> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Strong({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="min-w-40">
      <p className="font-semibold text-slate-950">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function FollowUpCell({ date }: { date?: string | null }) {
  if (!date) return <span className="text-slate-400">Not scheduled</span>;
  const overdue = isFollowUpOverdue(date);
  return (
    <span className={overdue ? "font-semibold text-rose-600" : "text-slate-700"}>
      {formatDate(date)}{overdue ? " · Overdue" : ""}
    </span>
  );
}

function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function withinDays(value: string | null | undefined, fromDays: number, toDays: number) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= fromDays && diffDays <= toDays;
}
