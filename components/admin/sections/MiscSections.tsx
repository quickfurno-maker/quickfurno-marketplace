"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DataTable,
  EmptyState,
  NoteBar,
  SectionCard,
  StatusBadge,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import {
  formatDate,
  formatNumber,
} from "../adminUtils";
import { AosAutomationControl } from "../AosAutomationControl";
import { Strong } from "./shared";

export const automationRows = [
  ["New Lead Notification", "New lead created", "Send admin notification", "Draft"],
  ["Vendor Lead Assignment", "Lead assigned", "Send vendor notification", "Draft"],
  ["Package Expiry Reminder", "Vendor package expiring", "Send reminder", "Draft"],
  ["Low Balance Reminder", "Vendor lead balance low", "Send renewal alert", "Draft"],
  ["Daily Lead Report", "Daily schedule", "Email report placeholder", "Draft"],
  ["Weekly Revenue Report", "Weekly schedule", "Email finance report", "Draft"],
  ["n8n Webhook", "CRM webhook placeholder", "Send webhook", "Disabled"],
  ["WhatsApp Notification", "Lead assigned", "WhatsApp placeholder", "Disabled"],
];

export const aiAgents = [
  ["Lead Quality Agent", "Analyze lead quality, budget strength, urgency and duplicate suspicion."],
  ["Vendor Matching Agent", "Suggest best vendors by city, category, rating, balance and response speed."],
  ["Follow-up Agent", "Detect leads that need follow-up today."],
  ["Vendor Renewal Agent", "Spot low-balance and expiring vendors."],
  ["Category Growth Agent", "Suggest categories that need more vendors."],
  ["City Expansion Agent", "Find city and locality demand signals."],
  ["Website UX Agent", "Suggest funnel and experience improvements."],
  ["Content Agent", "Draft homepage, FAQ, category and ad copy ideas."],
  ["Fraud/Duplicate Lead Agent", "Find repeated phones, spam entries and invalid leads."],
];

/**
 * C-PERF1 (P0-H): truthful AOS readiness page.
 *
 * The previous AOS Control Center rendered a fully fabricated operations
 * surface: sample entity ids, invented run counts, success rates, average
 * confidence, response times, sample memories, cost logs and approvals. None
 * of that data exists anywhere in QuickFurno, so none of it is rendered any
 * more. This page states exactly what is real:
 * the AOS foundation is NOT active, and the only live AOS-related control is
 * the guarded AOS / n8n forwarding switch on the Automations page.
 */
export function AosReadinessPage({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  return (
    <div className="space-y-4">
      <NoteBar>
        AOS foundation is not active. There are no live agent runs, decisions, memories, approvals or cost
        records to display — this page will become a real control center only after the AOS backend exists and
        persists real agent activity.
      </NoteBar>

      <SectionCard
        title="What is real today"
        description="The only live AOS-related control. Everything else previously shown here was sample data and has been removed."
      >
        <AosAutomationControl notify={notify} />
      </SectionCard>

      <SectionCard title="Planned agent roles" description="A roadmap catalogue, not a control surface. Nothing below is running.">
        <DataTable
          rows={aiAgents}
          emptyTitle="No planned agents"
          emptyMessage="Planned agent roles will be listed here."
          columns={[
            { header: "Agent", cell: (row) => <Strong title={row[0]} subtitle={row[1]} /> },
            { header: "Status", cell: () => <StatusBadge value="Not built" tone="slate" /> },
          ]}
        />
      </SectionCard>
    </div>
  );
}

/**
 * Planned agent catalogue — a roadmap list, not a control surface.
 *
 * What used to render here was fabricated end to end: a per-agent enable
 * switch driven by `index < 2` that persisted nothing, a "N suggestions" count
 * derived from the array index, a "Confidence 72%" chip that incremented by
 * position, and a suggestions table of three invented rows with invented
 * confidence scores and Accept/Reject actions wired to `() => {}`.
 *
 * No agent exists, no suggestion exists and no confidence is computed anywhere
 * in QuickFurno, so none of it is rendered. The catalogue below is the only
 * true statement this page can make about itself.
 */
export function AIAgentsPage() {
  return (
    <div className="space-y-4">
      <NoteBar tone="warning">
        No AI agent is built, connected or running. There is no agent runtime, no suggestion store and no scoring model
        in QuickFurno today. This page lists the agents that are planned — it does not control anything.
      </NoteBar>

      <SectionCard title="Planned agents" description="Scope only. Each entry becomes real work in a later phase.">
        <ul className="divide-y divide-[color:var(--qfa-line-soft)]">
          {aiAgents.map(([name, purpose]) => (
            <li key={name} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-900">{name}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{purpose}</p>
              </div>
              <StatusBadge value="Not built" tone="slate" />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

export function AutomationsPage({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  return (
    <div className="space-y-5">
      <AosAutomationControl notify={notify} />
      <SectionCard title="Automation Workflows" description="Placeholder workflow catalog. n8n forwarding is governed by the AOS / n8n control above.">
        <DataTable
          rows={automationRows}
          emptyTitle="No automations"
          emptyMessage="Automation workflows will appear here after the automations table is connected."
          columns={[
            { header: "Automation", cell: (row) => <Strong title={row[0]} subtitle={row[1]} /> },
            { header: "Trigger", cell: (row) => row[1] },
            { header: "Action", cell: (row) => row[2] },
            { header: "Status", cell: (row) => <StatusBadge value={row[3]} /> },
            { header: "Last Run", cell: () => "Not run" },
            { header: "Success", cell: () => "0" },
            { header: "Failed", cell: () => "0" },
            /* The Actions column offered "Test webhook" and "Enable/disable",
               both of which only fired a "…placeholder ready" toast. This is a
               read-only catalogue, so it no longer pretends to have controls. */
          ]}
        />
      </SectionCard>
    </div>
  );
}

/**
 * CMS scope list.
 *
 * Each of these eight blocks used to render a title input, a content textarea
 * and a Save button. None of the fields was bound to state or to any record,
 * and Save only fired a "<section> save placeholder ready." toast — so an
 * operator could type a full homepage rewrite, press Save, see a success
 * message, and lose everything. That is worse than having no editor at all.
 */
export function WebsiteContentPage() {
  const sections = ["Hero Content", "CTA Buttons", "Featured Categories", "Featured Cities", "Testimonials", "FAQs", "Contact Info", "SEO Settings"];
  return (
    <div className="space-y-4">
      <NoteBar tone="warning">
        No content editor is connected. There is no CMS table behind this page, so nothing typed here could be saved.
        Website copy is currently changed in code and deployed.
      </NoteBar>
      <SectionCard title="Planned content blocks" description="Scope only — editing is not available.">
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <li key={section} className="flex items-center justify-between gap-2 text-[13px] text-slate-700">
              <span className="min-w-0 truncate">{section}</span>
              <StatusBadge value="Not built" tone="slate" />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

export function ReviewsPage() {
  return (
    <DataTable
      rows={[] as Array<[string, string, string, string, string]>}
      emptyTitle="No reviews found"
      emptyMessage="Client reviews will appear here when the reviews table receives records."
      columns={[
        { header: "Vendor", cell: (row) => row[0] },
        { header: "Client", cell: (row) => row[1] },
        { header: "Rating", cell: (row) => row[2] },
        { header: "Status", cell: (row) => <StatusBadge value={row[3]} /> },
        /* Approve/Reject were wired to `() => {}`. There is no moderation
           action behind this page yet, so no action column is rendered. */
      ]}
    />
  );
}

/**
 * C-PERF2: derived alerts over bounded reads (≤10 recent leads + ≤10
 * low-credit vendors). No notifications table exists, so a paged "directory"
 * here would be fabricated — the note says exactly what this is.
 */
export function NotificationsPage({ data }: { data: { recentLeads: Array<{ id: string; name?: string | null; created_at?: string | null }>; lowCreditVendors: Array<{ id: string; business_name?: string | null; remaining_credits?: number | null; created_at?: string | null }> } | null }) {
  const notifications = [
    ...(data?.recentLeads ?? []).map((lead) => ({ id: `lead-${lead.id}`, title: "New lead", message: `${lead.name || "Client"} submitted a requirement`, type: "New lead", priority: "High", date: lead.created_at })),
    ...(data?.lowCreditVendors ?? []).map((vendor) => ({ id: `vendor-${vendor.id}`, title: "Low balance vendor", message: `${vendor.business_name || "Vendor"} has low lead balance`, type: "Low balance vendor", priority: "Medium", date: vendor.created_at })),
  ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return (
    <div className="space-y-3">
      <NoteBar>
        Derived alerts from live data (latest {formatNumber((data?.recentLeads ?? []).length)} leads and{" "}
        {formatNumber((data?.lowCreditVendors ?? []).length)} low-credit vendors). No notification persistence or
        read-state exists yet, so nothing here is markable.
      </NoteBar>
      <DataTable
        rows={notifications}
        getRowKey={(row) => row.id}
        emptyTitle="No notifications"
        emptyMessage="Admin alerts will appear here when notification persistence is connected."
        columns={[
          { header: "Title", cell: (row) => <Strong title={row.title} subtitle={row.message} /> },
          { header: "Type", cell: (row) => row.type },
          { header: "Priority", cell: (row) => <StatusBadge value={row.priority} /> },
          { header: "Date", cell: (row) => formatDate(row.date) },
        ]}
      />
    </div>
  );
}

/** C-PERF2: server-paged admin profiles (narrow fields only — no auth secrets). */
export function AdminUsersPage({ data }: { data: { result: { rows: Array<{ id: string; created_at?: string | null; full_name?: string | null; is_active?: boolean | null }>; page: number; pageSize: number; total: number } } | null }) {
  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  return (
    <div className="space-y-3">
      <DataTable
        rows={result.rows}
        getRowKey={(profile) => profile.id}
        emptyTitle="No admin users found"
        emptyMessage="Supabase Auth users with admin profiles will appear here."
        columns={[
          { header: "Name", cell: (profile) => <Strong title={profile.full_name || "Admin user"} subtitle={profile.id} /> },
          { header: "Email", cell: () => "Managed in Supabase Auth" },
          { header: "Role", cell: () => <StatusBadge value="Superadmin" /> },
          { header: "Status", cell: (profile) => <StatusBadge value={profile.is_active === false ? "Disabled" : "Active"} /> },
          { header: "Last Login", cell: () => "Auth dashboard" },
          { header: "Created", cell: (profile) => formatDate(profile.created_at) },
        ]}
      />
      <UrlPagination result={result} noun="admin users" />
    </div>
  );
}

/** C-PERF2: real bounded audit-log viewer (20/page, thin summary rows). */
export function AuditLogsPage({ data }: { data: { result: { rows: Array<{ id: string; created_at?: string | null; action?: string | null; entity_type?: string | null; entity_id?: string | null }>; page: number; pageSize: number; total: number }; unavailable?: boolean } | null }) {
  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  if (data?.unavailable) {
    return (
      <EmptyState
        title="Audit log table not available"
        message="The audit_logs table is not present in this environment yet. Rows will appear here once it exists."
      />
    );
  }
  return (
    <div className="space-y-3">
      <DataTable
        rows={result.rows}
        density="compact"
        getRowKey={(row) => row.id}
        emptyTitle="No audit log rows"
        emptyMessage="Sensitive admin actions are recorded here as they happen."
        columns={[
          { header: "When", cell: (row) => <span className="whitespace-nowrap text-[11px] text-slate-500">{formatDate(row.created_at)}</span> },
          { header: "Action", cell: (row) => <StatusBadge value={row.action || "unknown"} tone="slate" /> },
          { header: "Entity", cell: (row) => <Strong title={row.entity_type || "—"} subtitle={row.entity_id || ""} /> },
        ]}
      />
      <UrlPagination result={result} noun="audit log rows" />
    </div>
  );
}

/** Shared URL-driven pager for simple ?page= sections. */
function UrlPagination({ result, noun }: { result: { page: number; pageSize: number; total: number }; noun: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <Pagination
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      noun={noun}
      onPageChange={(page) => {
        const next = new URLSearchParams(searchParams.toString());
        if (page <= 1) next.delete("page");
        else next.set("page", String(page));
        router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
      }}
    />
  );
}
