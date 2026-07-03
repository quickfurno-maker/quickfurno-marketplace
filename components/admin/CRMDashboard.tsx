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

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminPrepareLeadClarification, adminUpdateLeadStatus } from "@/app/actions";
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
  LeadDeliveryLog,
  Snapshot,
  Vendor,
} from "./adminTypes";
import { formatDate, formatNumber, includesQuery, maskEmail, uniqueOptions } from "./adminUtils";
import { computeLeadSignals } from "@/lib/crm/adapters/leadAdapter";
import type { LeadScoringSignals } from "@/lib/crm/types";

type Tone = "emerald" | "indigo" | "amber" | "rose" | "slate";
type BadgeTone = "emerald" | "blue" | "amber" | "rose" | "slate" | "violet" | "cyan";

type CRMDashboardProps = {
  data: Snapshot;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  error?: string | null;
};

type CrmPriority = "hot" | "warm" | "cold" | "weak" | "spam" | "duplicate";
type CrmStatusBucket =
  | "new"
  | "contacted"
  | "assigned"
  | "site_visit"
  | "quotation"
  | "won"
  | "lost"
  | "spam"
  | "duplicate";

type PreferredBadge =
  | { label: string; tone: BadgeTone }
  | null;

type QualityBadge =
  | { label: string; tone: BadgeTone }
  | null;

type CrmRow = {
  lead: Lead;
  id: string;
  name: string;
  phone: string;
  phoneDigits: string;
  city: string;
  area: string;
  service: string;
  budget: string;
  timeline: string;
  source: string;
  intent: string;
  isPreferred: boolean;
  preferredBadge: PreferredBadge;
  qualityBadge: QualityBadge;
  latestClarification: LeadClarificationRequest | null;
  assignedCount: number;
  assignments: Assignment[];
  priority: CrmPriority;
  bucket: CrmStatusBucket;
  statusLabel: string;
  createdAt: string | null;
  followUp: string | null;
  signals: LeadScoringSignals;
};

const TABS = [
  "Overview",
  "Lead Inbox",
  "Pipeline Board",
  "Follow-ups",
  "Assignment Queue",
  "Vendor Response",
  "Source Analytics",
  "Nurture",
];

type QuickFilter =
  | "all"
  | "new_today"
  | "hot"
  | "unassigned"
  | "assigned"
  | "vendor_selected"
  | "site_visit"
  | "won"
  | "lost"
  | "spam_dup";

const PIPELINE_COLUMNS: Array<{ bucket: CrmStatusBucket; label: string }> = [
  { bucket: "new", label: "New" },
  { bucket: "contacted", label: "Contacted" },
  { bucket: "assigned", label: "Assigned" },
  { bucket: "site_visit", label: "Site Visit" },
  { bucket: "quotation", label: "Quotation" },
  { bucket: "won", label: "Won" },
  { bucket: "lost", label: "Lost" },
  { bucket: "spam", label: "Spam / Duplicate" },
];

const PRIORITY_TONE: Record<CrmPriority, BadgeTone> = {
  hot: "rose",
  warm: "amber",
  cold: "slate",
  weak: "slate",
  spam: "rose",
  duplicate: "violet",
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function digitsOnly(value?: string | null): string {
  return String(value ?? "").replace(/\D/g, "");
}

function waNumber(digits: string): string {
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

function computePriority(lead: Lead, signals: LeadScoringSignals): CrmPriority {
  if (lead.is_duplicate) return "duplicate";
  const qualityClass = String(lead.lead_quality_class ?? "").toUpperCase();
  if (qualityClass === "A+" || qualityClass === "A") return "hot";
  if (qualityClass === "B") return "warm";
  if (qualityClass === "C") return "weak";
  if (qualityClass === "D") return "spam";
  const status = String(lead.status ?? "").toLowerCase();
  if (/spam|bad|invalid|junk/.test(status)) return "spam";
  if (signals.looks_like_test_name || (signals.blank_requirement && !signals.has_valid_phone)) return "weak";
  if (signals.has_budget && signals.has_urgency && signals.has_valid_phone) return "hot";
  if (signals.has_valid_phone && (signals.has_service || signals.has_budget || signals.has_area)) return "warm";
  return "cold";
}

function statusBucket(lead: Lead, assignedCount: number): CrmStatusBucket {
  const s = String(lead.status ?? "").toLowerCase();
  if (lead.is_duplicate || s.includes("duplicate")) return "duplicate";
  if (/spam|bad|invalid|junk|rejected quality/.test(s) || String(lead.lead_quality_class ?? "").toUpperCase() === "D") return "spam";
  if (s.includes("won") || s.includes("convert")) return "won";
  if (s.includes("lost")) return "lost";
  if (s.includes("quotation")) return "quotation";
  if (s.includes("site")) return "site_visit";
  if (s.includes("contact")) return "contacted";
  if (s.includes("assign") || assignedCount > 0) return "assigned";
  return "new";
}

function leadQualityBadge(lead: Lead): QualityBadge {
  if (lead.is_duplicate) return { label: "Duplicate", tone: "violet" };
  const action = String(lead.lead_quality_recommended_action ?? "").toLowerCase();
  const hardBlock = String(lead.lead_quality_hard_block_reason ?? "").toLowerCase();
  if (action.includes("consent_required") || hardBlock.includes("share_consent")) {
    return { label: "No Consent", tone: "amber" };
  }
  const qualityClass = String(lead.lead_quality_class ?? "").toUpperCase();
  if (qualityClass === "A+") return { label: "A+ Hot", tone: "rose" };
  if (qualityClass === "A") return { label: "A Verified", tone: "emerald" };
  if (qualityClass === "B") return { label: "B Clarification", tone: "amber" };
  if (qualityClass === "C") return { label: "C Weak", tone: "slate" };
  if (qualityClass === "D") return { label: "D Reject/Spam", tone: "rose" };
  return null;
}

function preferredBadge(lead: Lead, assignedCount: number): PreferredBadge {
  if (String(lead.lead_intent ?? "").toLowerCase() !== "preferred_vendor") return null;
  const status = String(lead.preferred_vendor_status ?? "").toLowerCase();
  if (status.includes("assigned") || (status === "" && assignedCount > 0)) {
    return { label: "Preferred vendor assigned", tone: "emerald" };
  }
  if (status.includes("no_credit") || status.includes("no credit") || status.includes("fallback")) {
    return { label: "No credit / fallback needed", tone: "amber" };
  }
  if (status.includes("pending") || status.includes("not_eligible") || status.includes("not eligible") || status.includes("review")) {
    return { label: "Admin review", tone: "rose" };
  }
  return { label: "Client selected vendor", tone: "blue" };
}

function isToday(value?: string | null): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return d.toDateString() === new Date().toDateString();
}

function followUpDue(value?: string | null): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getTime() <= now.getTime() || d.toDateString() === now.toDateString();
}

function buildRows(data: Snapshot): CrmRow[] {
  const leads = data.leads ?? [];
  const clarificationByLead = latestClarificationByLead(data.leadClarificationRequests ?? []);
  const phoneFrequency = new Map<string, number>();
  leads.forEach((lead) => {
    const d = digitsOnly(lead.phone);
    if (d) phoneFrequency.set(d, (phoneFrequency.get(d) ?? 0) + 1);
  });

  return leads
    .filter((lead) => lead && lead.id)
    .map((lead) => {
      const assignments = lead.lead_assignments ?? [];
      const assignedCount = new Set(assignments.map((a) => String(a.vendor_id ?? "")).filter(Boolean)).size;
      const signals = computeLeadSignals(lead, phoneFrequency);
      const phoneDigits = digitsOnly(lead.phone);
      return {
        lead,
        id: lead.id,
        name: lead.name || "Unnamed lead",
        phone: lead.phone || "",
        phoneDigits,
        city: lead.city || "Not set",
        area: lead.locality || lead.area || "",
        service: lead.service_required || lead.category || "Not set",
        budget: lead.budget || "Not set",
        timeline: lead.timeline || "Not set",
        source: lead.source || "Unknown",
        intent: String(lead.lead_intent ?? "general_auto_match"),
        isPreferred: String(lead.lead_intent ?? "").toLowerCase() === "preferred_vendor",
        preferredBadge: preferredBadge(lead, assignedCount),
        qualityBadge: leadQualityBadge(lead),
        latestClarification: clarificationByLead.get(lead.id) ?? null,
        assignedCount,
        assignments,
        priority: computePriority(lead, signals),
        bucket: statusBucket(lead, assignedCount),
        statusLabel: lead.status || "New",
        createdAt: lead.created_at ?? null,
        followUp: lead.follow_up_date ?? null,
        signals,
      };
    });
}

function countByField(rows: CrmRow[], pick: (row: CrmRow) => string): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const key = pick(row) || "Unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function latestClarificationByLead(rows: LeadClarificationRequest[]): Map<string, LeadClarificationRequest> {
  const map = new Map<string, LeadClarificationRequest>();
  rows.forEach((request) => {
    const leadId = String(request.lead_id ?? "");
    if (!leadId || map.has(leadId)) return;
    map.set(leadId, request);
  });
  return map;
}

function clarificationLabel(row: CrmRow): string {
  const status = row.latestClarification?.status ?? row.lead.clarification_status;
  const missingCount = row.lead.clarification_missing_fields?.length ?? row.latestClarification?.missing_fields?.length ?? 0;
  if (!status && !row.lead.clarification_required) return "Not prepared";
  return `${String(status ?? "required").replace(/_/g, " ")}${missingCount ? ` (${missingCount})` : ""}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
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
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
        Operations CRM — live from your lead pipeline. Priority labels are
        computed for display only and are never written to the database.
        {isLimited
          ? ` Showing the latest ${formatNumber(rows.length)} of ${formatNumber(totalLeads)} leads — KPI totals below are accurate.`
          : ` Showing ${formatNumber(rows.length)} leads.`}
        {error ? ` Some data was limited: ${error}` : ""}
      </div>

      <Tabs tabs={TABS} active={active} onChange={setActive} />

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
          onScheduleFollowUp={() => notify("Follow-up scheduling is read-only in this phase (shows existing follow-up dates).", "info")}
          isPending={isPending}
        />
      ) : null}

      {active === "Pipeline Board" ? <PipelineBoard rows={rows} onSelect={setSelected} /> : null}
      {active === "Follow-ups" ? <FollowUps rows={rows} onSelect={setSelected} /> : null}
      {active === "Assignment Queue" ? <AssignmentQueue queue={data.leadAssignmentQueue ?? []} /> : null}
      {active === "Vendor Response" ? <VendorResponse rows={rows} vendorsById={vendorsById} deliveryLogs={data.leadDeliveryLogs ?? []} /> : null}
      {active === "Source Analytics" ? <SourceAnalytics rows={rows} /> : null}
      {active === "Nurture" ? <Nurture rows={rows} onSelect={setSelected} /> : null}

      {selected ? (
        <LeadDrawer
          row={selected}
          vendorsById={vendorsById}
          deliveryLogs={deliveryByLead.get(selected.id) ?? []}
          notificationLogs={notifByLead.get(selected.id) ?? []}
          onPrepareClarification={prepareClarification}
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
type Kpi = { key: QuickFilter | "follow_ups" | "total"; label: string; value: number; helper: string; tone: Tone };

function buildKpis(rows: CrmRow[]): Kpi[] {
  const count = (fn: (r: CrmRow) => boolean) => rows.filter(fn).length;
  return [
    { key: "total", label: "Total leads", value: rows.length, helper: "All captured leads", tone: "indigo" },
    { key: "new_today", label: "New today", value: count((r) => isToday(r.createdAt)), helper: "Created today", tone: "emerald" },
    { key: "hot", label: "Hot leads", value: count((r) => r.priority === "hot"), helper: "Budget + urgency + valid phone", tone: "rose" },
    { key: "unassigned", label: "Unassigned", value: count((r) => r.assignedCount === 0 && !["won", "lost", "spam", "duplicate"].includes(r.bucket)), helper: "No vendor yet", tone: "amber" },
    { key: "assigned", label: "Assigned", value: count((r) => r.assignedCount > 0), helper: "At least one vendor", tone: "emerald" },
    { key: "vendor_selected", label: "Vendor-selected", value: count((r) => r.isPreferred), helper: "Client picked a vendor", tone: "indigo" },
    { key: "follow_ups", label: "Follow-ups due", value: count((r) => followUpDue(r.followUp)), helper: "Due or overdue", tone: "amber" },
    { key: "site_visit", label: "Site visits", value: count((r) => r.bucket === "site_visit"), helper: "Scheduled", tone: "indigo" },
    { key: "won", label: "Won", value: count((r) => r.bucket === "won"), helper: "Converted", tone: "emerald" },
    { key: "lost", label: "Lost", value: count((r) => r.bucket === "lost"), helper: "Closed lost", tone: "rose" },
    { key: "spam_dup", label: "Spam / duplicate", value: count((r) => r.bucket === "spam" || r.bucket === "duplicate"), helper: "Flagged low quality", tone: "slate" },
  ];
}

function Overview({ kpis, onCard, onGoFollowUps }: { kpis: Kpi[]; onCard: (f: QuickFilter) => void; onGoFollowUps: () => void }) {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const handler =
            kpi.key === "total"
              ? () => onCard("all")
              : kpi.key === "follow_ups"
                ? onGoFollowUps
                : () => onCard(kpi.key as QuickFilter);
          return (
            <button
              key={kpi.label}
              type="button"
              onClick={handler}
              className="rounded-2xl text-left outline-none transition focus-visible:ring-4 focus-visible:ring-emerald-100"
              title={`Filter: ${kpi.label}`}
            >
              <StatCard label={kpi.label} value={formatNumber(kpi.value)} helper={kpi.helper} icon="crm" tone={kpi.tone} />
            </button>
          );
        })}
      </section>
      <p className="text-xs text-slate-500">Tap any card to jump into the Lead Inbox filtered for that segment.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead Inbox
// ---------------------------------------------------------------------------
function passesQuickFilter(row: CrmRow, filter: QuickFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "new_today": return isToday(row.createdAt);
    case "hot": return row.priority === "hot";
    case "unassigned": return row.assignedCount === 0 && !["won", "lost", "spam", "duplicate"].includes(row.bucket);
    case "assigned": return row.assignedCount > 0;
    case "vendor_selected": return row.isPreferred;
    case "site_visit": return row.bucket === "site_visit";
    case "won": return row.bucket === "won";
    case "lost": return row.bucket === "lost";
    case "spam_dup": return row.bucket === "spam" || row.bucket === "duplicate";
    default: return true;
  }
}

const QUICK_FILTER_LABEL: Record<QuickFilter, string> = {
  all: "All leads",
  new_today: "New today",
  hot: "Hot leads",
  unassigned: "Unassigned",
  assigned: "Assigned",
  vendor_selected: "Vendor-selected",
  site_visit: "Site visits",
  won: "Won",
  lost: "Lost",
  spam_dup: "Spam / duplicate",
};

function LeadInbox({
  rows,
  quickFilter,
  setQuickFilter,
  onSelect,
  onUpdateStatus,
  onAssign,
  onScheduleFollowUp,
  isPending,
}: {
  rows: CrmRow[];
  quickFilter: QuickFilter;
  setQuickFilter: (f: QuickFilter) => void;
  onSelect: (row: CrmRow) => void;
  onUpdateStatus: (leadId: string, status: string) => void;
  onAssign: (row: CrmRow) => void;
  onScheduleFollowUp: (row: CrmRow) => void;
  isPending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All");
  const [service, setService] = useState("All");
  const [priority, setPriority] = useState("All");
  const [source, setSource] = useState("All");
  const [intent, setIntent] = useState("All");

  const filtered = useMemo(() => rows.filter((row) => {
    return passesQuickFilter(row, quickFilter)
      && includesQuery([row.name, row.phone, row.city, row.area, row.service, row.statusLabel, row.source, row.priority, row.qualityBadge?.label], query)
      && (city === "All" || row.city === city)
      && (service === "All" || row.service === service)
      && (priority === "All" || row.priority === priority.toLowerCase())
      && (source === "All" || row.source === source)
      && (intent === "All" || (intent === "Preferred vendor" ? row.isPreferred : !row.isPreferred));
  }), [rows, quickFilter, query, city, service, priority, source, intent]);

  return (
    <div className="space-y-4">
      <div className="sticky top-2 z-20">
        <Toolbar
          query={query}
          setQuery={setQuery}
          placeholder="Search name, phone, city, service, status…"
          filters={
            <>
              <SelectFilter label="City" value={city} onChange={setCity} options={uniqueOptions(rows.map((r) => r.city))} />
              <SelectFilter label="Service" value={service} onChange={setService} options={uniqueOptions(rows.map((r) => r.service))} />
              <SelectFilter label="Priority" value={priority} onChange={setPriority} options={["All", "Hot", "Warm", "Cold", "Weak", "Spam", "Duplicate"]} />
              <SelectFilter label="Source" value={source} onChange={setSource} options={uniqueOptions(rows.map((r) => r.source))} />
              <SelectFilter label="Intent" value={intent} onChange={setIntent} options={["All", "Preferred vendor", "General auto-match"]} />
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-500">Showing {formatNumber(filtered.length)} of {formatNumber(rows.length)}</span>
        {quickFilter !== "all" ? (
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700"
          >
            {QUICK_FILTER_LABEL[quickFilter]} <span aria-hidden>✕</span>
          </button>
        ) : null}
        {isPending ? <span className="text-slate-400">Saving…</span> : null}
      </div>

      <DataTable
        rows={filtered}
        emptyTitle="No leads match this view"
        emptyMessage="Adjust the filters, clear the quick filter, or wait for new lead submissions."
        columns={[
          { header: "Priority", cell: (row) => <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} /> },
          { header: "Quality", cell: (row) => row.qualityBadge
            ? <StatusBadge value={row.qualityBadge.label} tone={row.qualityBadge.tone} />
            : <StatusBadge value="Not scored" tone="slate" /> },
          { header: "Clarification", cell: (row) => <StatusBadge value={clarificationLabel(row)} tone={row.lead.clarification_required ? "amber" : "slate"} /> },
          { header: "Client", cell: (row) => (
            <div className="min-w-40">
              <p className="font-semibold text-slate-900">{row.name}</p>
              {row.preferredBadge ? <div className="mt-1"><StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /></div> : null}
            </div>
          ) },
          { header: "Phone", cell: (row) => row.phoneDigits
            ? <a href={`tel:${row.phoneDigits}`} className="font-mono text-sm text-emerald-700 hover:underline">{row.phone}</a>
            : <span className="text-slate-400">Not set</span> },
          { header: "City / Area", cell: (row) => <span className="whitespace-nowrap">{[row.area, row.city].filter((v) => v && v !== "Not set").join(", ") || row.city}</span> },
          { header: "Service", cell: (row) => <span className="whitespace-nowrap">{row.service}</span> },
          { header: "Budget", cell: (row) => row.budget },
          { header: "Timeline", cell: (row) => row.timeline },
          { header: "Source", cell: (row) => <StatusBadge value={row.source} /> },
          { header: "Intent", cell: (row) => <StatusBadge value={row.isPreferred ? "Preferred" : "Auto-match"} tone={row.isPreferred ? "violet" : "slate"} /> },
          { header: "Vendors", cell: (row) => <StatusBadge value={`${row.assignedCount}/3`} tone={row.assignedCount > 0 ? "emerald" : "amber"} /> },
          { header: "Status", cell: (row) => <StatusBadge value={row.statusLabel} /> },
          { header: "Created", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.createdAt)}</span> },
          { header: "Next follow-up", cell: (row) => row.followUp
            ? <StatusBadge value={formatDate(row.followUp)} tone={followUpDue(row.followUp) ? "rose" : "slate"} />
            : <span className="text-slate-400">—</span> },
          { header: "Actions", cell: (row) => (
            <div className="flex items-center gap-1.5">
              {row.phoneDigits ? (
                <>
                  <a href={`tel:${row.phoneDigits}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50" title="Call client">Call</a>
                  <a href={`https://wa.me/${waNumber(row.phoneDigits)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100" title="Open WhatsApp">WA</a>
                </>
              ) : null}
              <ActionMenu
                actions={[
                  { label: "View details", onClick: () => onSelect(row) },
                  { label: "Mark contacted", onClick: () => onUpdateStatus(row.id, "Contacted") },
                  { label: "Mark converted", onClick: () => onUpdateStatus(row.id, "Converted") },
                  { label: "Mark lost", onClick: () => onUpdateStatus(row.id, "Lost") },
                  { label: "Mark spam", onClick: () => onUpdateStatus(row.id, "Spam") },
                  { label: "Assign vendor", onClick: () => onAssign(row) },
                  { label: "Schedule follow-up", onClick: () => onScheduleFollowUp(row) },
                ]}
              />
            </div>
          ) },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Board
// ---------------------------------------------------------------------------
function PipelineBoard({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PIPELINE_COLUMNS.map((column) => {
        const columnRows = rows.filter((row) => (column.bucket === "spam" ? row.bucket === "spam" || row.bucket === "duplicate" : row.bucket === column.bucket));
        return (
          <section key={column.bucket} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">{column.label}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{columnRows.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {columnRows.length ? (
                columnRows.slice(0, 8).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onSelect(row)}
                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
                  >
                    <p className="truncate text-sm font-semibold text-slate-900">{row.name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{row.service} · {row.city}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} />
                      {row.preferredBadge ? <StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /> : null}
                    </div>
                  </button>
                ))
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">No leads</p>
              )}
              {columnRows.length > 8 ? <p className="px-1 text-center text-xs text-slate-400">+{columnRows.length - 8} more</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups (real follow_up_date data only)
// ---------------------------------------------------------------------------
function FollowUps({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  const withFollowUp = rows
    .filter((row) => row.followUp)
    .sort((a, b) => new Date(a.followUp ?? 0).getTime() - new Date(b.followUp ?? 0).getTime());

  return (
    <DataTable
      rows={withFollowUp}
      emptyTitle="No scheduled follow-ups"
      emptyMessage="Leads with a follow_up_date will appear here. Scheduling new follow-ups is not enabled in this phase."
      columns={[
        { header: "Client", cell: (row) => <button type="button" onClick={() => onSelect(row)} className="font-semibold text-emerald-700 hover:underline">{row.name}</button> },
        { header: "Service", cell: (row) => row.service },
        { header: "City", cell: (row) => row.city },
        { header: "Priority", cell: (row) => <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} /> },
        { header: "Status", cell: (row) => <StatusBadge value={row.statusLabel} /> },
        { header: "Follow-up", cell: (row) => <StatusBadge value={formatDate(row.followUp)} tone={followUpDue(row.followUp) ? "rose" : "slate"} /> },
        { header: "State", cell: (row) => <StatusBadge value={followUpDue(row.followUp) ? "Due / overdue" : "Upcoming"} tone={followUpDue(row.followUp) ? "amber" : "slate"} /> },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Assignment Queue (real lead_assignment_queue rows)
// ---------------------------------------------------------------------------
function AssignmentQueue({ queue }: { queue: LeadAssignmentQueueRow[] }) {
  const active = queue.filter((row) => (row.queue_status ?? "queued") !== "resolved");
  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queue rows" value={formatNumber(queue.length)} helper="All queue entries" icon="distribution" tone="indigo" />
        <StatCard label="Active" value={formatNumber(active.length)} helper="Not yet resolved" icon="distribution" tone="amber" />
        <StatCard label="Resolved" value={formatNumber(queue.length - active.length)} helper="Completed" icon="distribution" tone="emerald" />
        <StatCard label="Due now" value={formatNumber(active.filter((r) => followUpDue(r.next_retry_at)).length)} helper="next_retry_at reached" icon="notifications" tone="rose" />
      </section>
      <DataTable
        rows={queue}
        emptyTitle="Assignment queue is empty"
        emptyMessage="Queued leads awaiting delayed fill or vendor availability will appear here."
        columns={[
          { header: "Lead", cell: (row) => <span className="font-mono text-xs">{String(row.lead_id).slice(0, 8)}</span> },
          { header: "City / Category", cell: (row) => <span className="whitespace-nowrap">{[row.city, row.category].filter(Boolean).join(" · ") || "—"}</span> },
          { header: "Status", cell: (row) => <StatusBadge value={row.queue_status || "queued"} /> },
          { header: "Reason", cell: (row) => <span className="text-xs">{(row.queue_reason || "—").replace(/_/g, " ")}</span> },
          { header: "Selected", cell: (row) => <StatusBadge value={`${(row.selected_vendor_ids ?? []).length}/${row.required_vendor_count ?? 3}`} tone="slate" /> },
          { header: "Attempts", cell: (row) => formatNumber(row.matching_attempt_count ?? 0) },
          { header: "Next retry", cell: (row) => <span className="whitespace-nowrap">{row.next_retry_at ? formatDate(row.next_retry_at) : "—"}</span> },
          { header: "Created", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.created_at)}</span> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Response (vendor_status on assignments + delivery logs)
// ---------------------------------------------------------------------------
function VendorResponse({ rows, vendorsById, deliveryLogs }: { rows: CrmRow[]; vendorsById: Map<string, Vendor>; deliveryLogs: LeadDeliveryLog[] }) {
  const responseCounts = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => row.assignments.forEach((a) => {
      const status = a.vendor_status || "New";
      map.set(status, (map.get(status) ?? 0) + 1);
    }));
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const recentDeliveries = deliveryLogs.slice(0, 40);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Vendor response status" rows={responseCounts} />
        <SectionCard title="Delivery snapshot" description="Dashboard + WhatsApp-preview delivery logs (preview only — no live sends).">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Delivery logs" value={deliveryLogs.length} tone="blue" />
            <MiniStat label="Contact shared" value={deliveryLogs.filter((l) => l.contact_shared).length} tone="emerald" />
            <MiniStat label="Credit deducted" value={deliveryLogs.filter((l) => l.credit_deducted).length} tone="amber" />
          </div>
        </SectionCard>
      </div>

      <DataTable
        rows={recentDeliveries}
        emptyTitle="No delivery logs yet"
        emptyMessage="Vendor lead deliveries (dashboard + WhatsApp preview) will appear here."
        columns={[
          { header: "Lead", cell: (row) => <span className="font-mono text-xs">{String(row.lead_id ?? "").slice(0, 8)}</span> },
          { header: "Vendor", cell: (row) => vendorsById.get(String(row.vendor_id ?? ""))?.business_name ?? <span className="font-mono text-xs">{String(row.vendor_id ?? "").slice(0, 8)}</span> },
          { header: "Channel", cell: (row) => <StatusBadge value={row.delivery_channel || "—"} tone="slate" /> },
          { header: "Status", cell: (row) => <StatusBadge value={row.delivery_status || "—"} /> },
          { header: "Contact", cell: (row) => <StatusBadge value={row.contact_shared ? "Shared" : "Held"} tone={row.contact_shared ? "emerald" : "amber"} /> },
          { header: "WhatsApp", cell: (row) => <StatusBadge value={row.whatsapp_status || "preview_only"} tone="slate" /> },
          { header: "Created", cell: (row) => <span className="whitespace-nowrap">{formatDate(row.created_at)}</span> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source Analytics
// ---------------------------------------------------------------------------
function SourceAnalytics({ rows }: { rows: CrmRow[] }) {
  const bySource = countByField(rows, (r) => r.source);
  const byUtm = countByField(rows, (r) => String(r.lead.utm_source ?? "").trim() || "Direct / none");
  const byCity = countByField(rows, (r) => r.city);
  const byService = countByField(rows, (r) => r.service);
  const preferredCount = rows.filter((r) => r.isPreferred).length;
  const intentRows = [
    { label: "Preferred vendor (client picked)", value: preferredCount },
    { label: "General auto-match", value: rows.length - preferredCount },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Leads by source" rows={bySource} />
      <ChartCard title="Leads by UTM source" rows={byUtm} />
      <ChartCard title="Leads by city" rows={byCity} />
      <ChartCard title="Leads by service / category" rows={byService} />
      <ChartCard title="Preferred vendor vs general" rows={intentRows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nurture (real: leads flagged nurture)
// ---------------------------------------------------------------------------
function Nurture({ rows, onSelect }: { rows: CrmRow[]; onSelect: (row: CrmRow) => void }) {
  const nurtureRows = rows.filter((row) => String(row.lead.status ?? "").toLowerCase().includes("nurture"));
  return (
    <DataTable
      rows={nurtureRows}
      emptyTitle="No nurture leads"
      emptyMessage="Leads marked for nurture will appear here. Automated nurture sequences are not enabled in this phase."
      columns={[
        { header: "Client", cell: (row) => <button type="button" onClick={() => onSelect(row)} className="font-semibold text-emerald-700 hover:underline">{row.name}</button> },
        { header: "Service", cell: (row) => row.service },
        { header: "City", cell: (row) => row.city },
        { header: "Priority", cell: (row) => <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} /> },
        { header: "Status", cell: (row) => <StatusBadge value={row.statusLabel} /> },
        { header: "Follow-up", cell: (row) => row.followUp ? formatDate(row.followUp) : "—" },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Lead detail drawer
// ---------------------------------------------------------------------------
function LeadDrawer({
  row,
  vendorsById,
  deliveryLogs,
  notificationLogs,
  onPrepareClarification,
  isPending,
  onClose,
}: {
  row: CrmRow;
  vendorsById: Map<string, Vendor>;
  deliveryLogs: LeadDeliveryLog[];
  notificationLogs: ClientNotificationLog[];
  onPrepareClarification: (leadId: string) => void;
  isPending: boolean;
  onClose: () => void;
}) {
  const lead = row.lead;
  return (
    <Drawer title={row.name} subtitle={`${row.service} · ${row.city}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} />
          {row.qualityBadge ? <StatusBadge value={row.qualityBadge.label} tone={row.qualityBadge.tone} /> : null}
          <StatusBadge value={row.statusLabel} />
          {row.preferredBadge ? <StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /> : null}
          {row.phoneDigits ? (
            <>
              <a href={`tel:${row.phoneDigits}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Call</a>
              <a href={`https://wa.me/${waNumber(row.phoneDigits)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">WhatsApp</a>
            </>
          ) : null}
        </div>

        <DrawerSection title="Client details">
          <InfoGrid rows={[
            ["Name", row.name],
            ["Phone", row.phone || "Not set"],
            ["Email", lead.email || maskEmail(lead.email) || "Not set"],
            ["City / Area", [row.area, row.city].filter((v) => v && v !== "Not set").join(", ") || row.city],
          ]} />
        </DrawerSection>

        <DrawerSection title="Requirement">
          <InfoGrid rows={[
            ["Service", row.service],
            ["Subcategory", lead.subcategory || "Not set"],
            ["Budget", row.budget],
            ["Timeline", row.timeline],
            ["Property type", lead.property_type || "Not set"],
            ["Message", lead.message || "None"],
          ]} />
        </DrawerSection>

        <DrawerSection title="Lead quality">
          <InfoGrid rows={[
            ["Score", lead.lead_quality_score != null ? `${lead.lead_quality_score}/100` : "Not scored"],
            ["Class", lead.lead_quality_class || "Not scored"],
            ["Quality status", (lead.lead_quality_status || "Not set").replace(/_/g, " ")],
            ["Recommended action", (lead.lead_quality_recommended_action || "Not set").replace(/_/g, " ")],
            ["Hard block", (lead.lead_quality_hard_block_reason || "None").replace(/_/g, " ")],
            ["Checked at", lead.lead_quality_checked_at ? formatDate(lead.lead_quality_checked_at) : "Not checked"],
            ["Breakdown", "Latest score summary is mirrored here. TODO: load restricted lead_scores history for detailed breakdown."],
          ]} />
        </DrawerSection>

        <DrawerSection title="WhatsApp Clarification">
          <div className="space-y-3">
            <InfoGrid rows={[
              ["Required", lead.clarification_required ? "Yes" : "No"],
              ["Status", clarificationLabel(row)],
              ["Missing fields", (lead.clarification_missing_fields ?? row.latestClarification?.missing_fields ?? []).join(", ") || "None"],
              ["Score before", row.latestClarification?.score_before != null ? `${row.latestClarification.score_before}/100` : "Not captured"],
              ["Class before", row.latestClarification?.score_class_before || "Not captured"],
              ["Parent category", row.latestClarification?.parent_category_group || "Not set"],
              ["Marketplace category", row.latestClarification?.marketplace_category || "Not set"],
              ["Service required", row.latestClarification?.service_required || "Not set"],
              ["Response status", row.latestClarification?.response_received_at ? "Response received" : "No response yet"],
            ]} />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onPrepareClarification(row.id)}
                disabled={isPending || Boolean(row.latestClarification)}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {row.latestClarification ? "Preview already prepared" : "Prepare clarification preview"}
              </button>
              <button
                type="button"
                disabled
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 opacity-70"
              >
                Send WhatsApp disabled in this phase
              </button>
            </div>

            {row.latestClarification?.preview_message ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preview message</p>
                <pre className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{row.latestClarification.preview_message}</pre>
              </div>
            ) : (
              <EmptyState title="No clarification preview" message="Prepare a preview for B leads before any WhatsApp sending is enabled." compact />
            )}

            {row.latestClarification?.questions_json?.length ? (
              <div className="space-y-2">
                {row.latestClarification.questions_json.map((question, index) => (
                  <div key={String(question.key ?? index)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-900">{index + 1}. {String(question.text ?? "Question")}</p>
                    <p className="mt-1 text-xs text-slate-500">Options: {questionOptions(question)}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </DrawerSection>

        <DrawerSection title="Source & attribution">
          <InfoGrid rows={[
            ["Source", row.source],
            ["UTM source", lead.utm_source || "—"],
            ["UTM medium", lead.utm_medium || "—"],
            ["UTM campaign", lead.utm_campaign || "—"],
            ["Landing page", lead.page_url || "—"],
            ["Created", formatDate(row.createdAt)],
          ]} />
        </DrawerSection>

        {row.isPreferred ? (
          <DrawerSection title="Preferred vendor">
            <InfoGrid rows={[
              ["Intent", "Client selected a specific vendor"],
              ["Target vendor", lead.target_vendor_name || "—"],
              ["Category", lead.target_vendor_category || "—"],
              ["Preferred status", (lead.preferred_vendor_status || "—").replace(/_/g, " ")],
              ["Status reason", (lead.preferred_vendor_status_reason || "—").replace(/_/g, " ")],
            ]} />
          </DrawerSection>
        ) : null}

        <DrawerSection title={`Assigned vendors (${row.assignedCount}/3)`}>
          {row.assignments.length ? (
            <div className="space-y-2">
              {row.assignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{vendorsById.get(String(a.vendor_id ?? ""))?.business_name ?? String(a.vendor_id ?? "").slice(0, 8)}</p>
                    <p className="text-xs text-slate-500">{(a.assignment_type || "assigned").replace(/_/g, " ")} · {formatDate(a.assigned_at || a.created_at)}</p>
                  </div>
                  <StatusBadge value={a.vendor_status || "New"} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No vendors assigned" message="This lead has not been shared with any vendor yet." compact />
          )}
        </DrawerSection>

        <DrawerSection title={`Delivery logs (${deliveryLogs.length})`}>
          {deliveryLogs.length ? (
            <div className="space-y-2">
              {deliveryLogs.slice(0, 12).map((log) => (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge value={log.delivery_channel || "channel"} tone="slate" />
                    <StatusBadge value={log.delivery_status || "—"} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {vendorsById.get(String(log.vendor_id ?? ""))?.business_name ?? "Vendor"} · {formatDate(log.created_at)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No delivery logs" message="No dashboard or WhatsApp-preview deliveries recorded for this lead." compact />
          )}
        </DrawerSection>

        <DrawerSection title={`Client notifications (${notificationLogs.length})`}>
          {notificationLogs.length ? (
            <div className="space-y-2">
              {notificationLogs.slice(0, 12).map((log) => (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge value={log.notification_type || "notification"} tone="slate" />
                    <StatusBadge value={log.status || "—"} />
                  </div>
                  {log.message ? <p className="mt-1 text-xs text-slate-600">{log.message}</p> : null}
                  <p className="mt-1 text-xs text-slate-400">{formatDate(log.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No client notifications" message="No client-facing notification previews recorded for this lead." compact />
          )}
        </DrawerSection>

        <DrawerSection title="Follow-up & notes">
          <InfoGrid rows={[
            ["Next follow-up", row.followUp ? formatDate(row.followUp) : "Not scheduled"],
            ["Verification", lead.verification_status || "—"],
            ["Admin notes", lead.internal_notes || "None"],
          ]} />
        </DrawerSection>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// small helpers / sub-components
// ---------------------------------------------------------------------------
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: BadgeTone }) {
  const toneClass: Record<BadgeTone, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-sky-200 bg-sky-50 text-sky-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{formatNumber(value)}</p>
    </div>
  );
}

function groupByLead<T extends { lead_id?: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  rows.forEach((row) => {
    const key = String(row.lead_id ?? "");
    if (!key) return;
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  });
  return map;
}

function questionOptions(question: Record<string, unknown>): string {
  const options = Array.isArray(question.options) ? question.options : [];
  const labels = options.map((option) => {
    if (typeof option === "string") return option;
    if (option && typeof option === "object" && "label" in option) return String((option as { label?: unknown }).label ?? "");
    return "";
  }).filter(Boolean);
  return labels.join(", ") || "Free text";
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
