"use client";

import {
  ActionMenu,
  DataTable,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusBadge,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type Category, type City, type Lead, type Snapshot, type Vendor } from "../adminTypes";
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

export function AIAgentsPage() {
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {aiAgents.map(([name, purpose], index) => (
          <article key={name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{name}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{purpose}</p>
              </div>
              <ToggleSwitch checked={index < 2} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <StatusBadge value={index < 2 ? "Draft" : "Disabled"} />
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{index + 2} suggestions</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Confidence {72 + index}%</span>
            </div>
          </article>
        ))}
      </section>
      <DataTable
        rows={[
          ["Lead quality", "Lead", "Budget and urgency look strong", "86%", "New"],
          ["Vendor match", "Vendor", "Prioritize vendors with remaining credits", "78%", "New"],
          ["Renewal", "Vendor", "Low balance vendor needs reminder", "74%", "Draft"],
        ]}
        emptyTitle="No AI suggestions"
        emptyMessage="Suggestions will appear here when AI agents are connected."
        columns={[
          { header: "Suggestion", cell: (row) => row[2] },
          { header: "Module", cell: (row) => row[1] },
          { header: "Confidence", cell: (row) => row[3] },
          { header: "Status", cell: (row) => <StatusBadge value={row[4]} /> },
          { header: "Action", cell: () => <ActionMenu actions={[{ label: "Accept", onClick: () => {} }, { label: "Reject", onClick: () => {} }]} /> },
        ]}
      />
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
            { header: "Actions", cell: () => <ActionMenu actions={[{ label: "Test webhook", onClick: () => notify("Webhook test placeholder ready.") }, { label: "Enable/disable", onClick: () => notify("Automation toggle placeholder ready.") }]} /> },
          ]}
        />
      </SectionCard>
    </div>
  );
}

export function WebsiteContentPage({ notify }: { notify: (message: string) => void }) {
  const sections = ["Hero Content", "CTA Buttons", "Featured Categories", "Featured Cities", "Testimonials", "FAQs", "Contact Info", "SEO Settings"];
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {sections.map((section) => (
        <article key={section} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">{section}</h2>
          <div className="mt-4 space-y-3">
            <input className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder={`${section} title`} />
            <textarea className="min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder={`${section} content`} />
            <PrimaryButton onClick={() => notify(`${section} save placeholder ready.`)}>Save</PrimaryButton>
          </div>
        </article>
      ))}
    </section>
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
        { header: "Actions", cell: () => <ActionMenu actions={[{ label: "Approve", onClick: () => {} }, { label: "Reject", onClick: () => {} }]} /> },
      ]}
    />
  );
}

export function NotificationsPage({ data, notify }: { data: Snapshot; notify: (message: string) => void }) {
  const notifications = [
    ...data.leads.slice(0, 4).map((lead) => ({ title: "New lead", message: `${lead.name || "Client"} submitted a requirement`, type: "New lead", priority: "High", date: lead.created_at })),
    ...data.vendors.filter((vendor) => Number(vendor.remaining_credits ?? 0) <= 3).slice(0, 4).map((vendor) => ({ title: "Low balance vendor", message: `${vendor.business_name || "Vendor"} has low lead balance`, type: "Low balance vendor", priority: "Medium", date: vendor.created_at })),
  ];
  return (
    <DataTable
      rows={notifications}
      emptyTitle="No notifications"
      emptyMessage="Admin alerts will appear here when notification persistence is connected."
      columns={[
        { header: "Title", cell: (row) => <Strong title={row.title} subtitle={row.message} /> },
        { header: "Type", cell: (row) => row.type },
        { header: "Priority", cell: (row) => <StatusBadge value={row.priority} /> },
        { header: "Read", cell: () => <StatusBadge value="Unread" /> },
        { header: "Date", cell: (row) => formatDate(row.date) },
        { header: "Actions", cell: () => <SecondaryButton onClick={() => notify("Notification marked read placeholder.")}>Mark read</SecondaryButton> },
      ]}
    />
  );
}

export function AdminUsersPage({ data }: { data: Snapshot }) {
  return (
    <DataTable
      rows={data.profiles.filter((profile) => profile.role === "admin")}
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
  );
}


export function AuditLogsPage({ data }: { data: Snapshot }) {
  return (
    <EmptyState
      title="Audit log UI is ready"
      message={`Admin audit log rows need the audit_logs table exposed to the server snapshot. Current snapshot contains ${formatNumber(data.badReports.length)} bad-lead reports and ${formatNumber(data.assignments.length)} assignments for context.`}
    />
  );
}
