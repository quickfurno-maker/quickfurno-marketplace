"use client";

import { useMemo, useState } from "react";
import {
  adminUpdateLeadStatus,
} from "@/app/actions";
import {
  ActionMenu,
  DataTable,
  Drawer,
  InfoGrid,
  SecondaryButton,
  SelectFilter,
  StatCard,
  StatusBadge,
  Toolbar,
} from "../AdminPrimitives";
import { type Category, type City, type Lead, type Snapshot, type Vendor } from "../adminTypes";
import {
  assignmentStatus,
  formatDate,
  formatNumber,
  includesQuery,
  maskPhone,
  shortId,
  uniqueOptions,
  vendorName,
} from "../adminUtils";
import { BadLeadReportsReviewPanel } from "../LeadMatchingAuditPanels";
import { Strong } from "./shared";

export const closedLeadStatuses = new Set(["converted", "won", "lost", "duplicate", "spam", "invalid"]);

export const leadStatuses = ["All", "New", "Assigned", "Contacted", "Interested", "Site Visit Scheduled", "Quotation Sent", "Converted", "Lost", "Duplicate", "Spam", "Invalid"];

export function LeadsPage({ data, notify, runAction }: { data: Snapshot; notify: (message: string, tone?: "success" | "error" | "info") => void; runAction: any }) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [source, setSource] = useState("All");
  const [priority, setPriority] = useState("All");
  const [selected, setSelected] = useState<Lead | null>(null);

  const hotLeads = data.leads.filter(isHotLead);
  const unassignedLeads = data.leads.filter(isUnassignedLead);
  const leads = useMemo(() => data.leads.filter((lead) => {
    const leadCategory = lead.service_required || lead.category || "";
    const leadSource = lead.source || "Website";
    const leadPriorityValue = leadPriorityLabel(lead);
    return includesQuery([lead.name, lead.phone, lead.city, leadCategory, lead.status, leadSource, leadPriorityValue], query)
      && (city === "All" || lead.city === city)
      && (category === "All" || leadCategory === category)
      && (status === "All" || lead.status === status)
      && (source === "All" || leadSource === source)
      && (priority === "All" || leadPriorityValue === priority);
  }), [data.leads, query, city, category, status, source, priority]);

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="All Leads" value={formatNumber(data.leads.length)} helper="Complete lead database" icon="leads" />
        <StatCard label="Hot Leads" value={formatNumber(hotLeads.length)} helper="High intent or scored" icon="notifications" tone="amber" />
        <StatCard label="Unassigned" value={formatNumber(unassignedLeads.length)} helper="Needs vendor matching" icon="distribution" tone="rose" />
        <StatCard label="Filtered View" value={formatNumber(leads.length)} helper="Rows matching filters" icon="reports" tone="slate" />
      </section>

      <Toolbar
        query={query}
        setQuery={setQuery}
        placeholder="Search name, masked phone, city, category, source..."
        filters={
          <>
            <SelectFilter label="City" value={city} onChange={setCity} options={uniqueOptions(data.leads.map((lead) => lead.city))} />
            <SelectFilter label="Category" value={category} onChange={setCategory} options={uniqueOptions(data.leads.map((lead) => lead.service_required || lead.category))} />
            <SelectFilter label="Status" value={status} onChange={setStatus} options={leadStatuses} />
            <SelectFilter label="Priority" value={priority} onChange={setPriority} options={["All", "Hot", "High", "Normal", "Low"]} />
            <SelectFilter label="Source" value={source} onChange={setSource} options={uniqueOptions(data.leads.map((lead) => lead.source || "Website"))} />
          </>
        }
      />

      <BadLeadReportsReviewPanel data={data} notify={notify} runAction={runAction} />

      <DataTable
        rows={leads}
        emptyTitle="No leads match this view"
        emptyMessage="Try a different search or filter, or wait for new public form submissions."
        columns={[
          { header: "Client", cell: (lead) => <Strong title={lead.name || "Unnamed lead"} subtitle={maskPhone(lead.phone)} /> },
          { header: "Requirement", cell: (lead) => <Strong title={lead.service_required || lead.category || "Not set"} subtitle={lead.city || "City not set"} /> },
          { header: "Budget", cell: (lead) => lead.budget || "Not set" },
          { header: "Priority", cell: (lead) => <LeadPriorityBadge lead={lead} /> },
          { header: "Source", cell: (lead) => <SourceBadge value={lead.source || "Website"} /> },
          { header: "Status", cell: (lead) => <StatusBadge value={lead.status || "New"} /> },
          { header: "Assigned", cell: (lead) => <StatusBadge value={`${formatNumber(lead.lead_assignments?.length ?? 0)} vendors`} tone={(lead.lead_assignments?.length ?? 0) > 0 ? "emerald" : "amber"} /> },
          { header: "Created", cell: (lead) => formatDate(lead.created_at) },
          {
            header: "Actions",
            cell: (lead) => (
              <ActionMenu
                actions={[
                  { label: "View lead", onClick: () => setSelected(lead) },
                  { label: "Mark contacted", onClick: () => runAction("Lead status update", () => adminUpdateLeadStatus(lead.id, "Contacted")) },
                ]}
              />
            ),
          },
        ]}
      />

      {selected ? <LeadDetailDrawer lead={selected} vendors={data.vendors} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}


export function LeadPriorityBadge({ lead }: { lead: Lead }) {
  const priority = leadPriorityLabel(lead);
  return <StatusBadge value={priority} tone={priority === "Hot" || priority === "High" ? "amber" : priority === "Low" ? "slate" : "blue"} />;
}

export function SourceBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("google") || normalized.includes("ads") ? "violet" : normalized.includes("whatsapp") ? "emerald" : normalized.includes("website") ? "blue" : "slate";
  return <StatusBadge value={value} tone={tone} />;
}


export function isHotLead(lead: Lead) {
  const priority = String(lead.lead_priority ?? "").toLowerCase();
  const status = String(lead.status ?? "").toLowerCase();
  const score = Number(lead.lead_quality_score ?? 0);
  return priority.includes("hot") || priority.includes("high") || score >= 70 || status.includes("interested") || status.includes("quotation");
}

export function isUnassignedLead(lead: Lead) {
  const status = String(lead.status ?? "New").toLowerCase();
  return !closedLeadStatuses.has(status) && (lead.lead_assignments?.length ?? 0) === 0;
}

export function leadPriorityLabel(lead: Lead) {
  const priority = String(lead.lead_priority ?? "").trim();
  const score = Number(lead.lead_quality_score ?? 0);
  if (priority) return priority.charAt(0).toUpperCase() + priority.slice(1);
  if (isHotLead(lead)) return "Hot";
  if (score >= 50) return "High";
  if (score > 0 && score < 30) return "Low";
  return "Normal";
}


export function LeadDetailDrawer({ lead, vendors, onClose }: { lead: Lead; vendors: Vendor[]; onClose: () => void }) {
  return (
    <Drawer title={lead.name || "Lead details"} subtitle={`Lead ID ${shortId(lead.id)}`} onClose={onClose}>
      <div className="space-y-5">
        <InfoGrid rows={[
          ["Phone", lead.phone || "Not provided"],
          ["Email", lead.email || "Not provided"],
          ["City", lead.city || "Not provided"],
          ["Locality", lead.locality || lead.area || "Not provided"],
          ["Category", lead.service_required || lead.category || "Not provided"],
          ["Budget", lead.budget || "Not provided"],
          ["Timeline", lead.timeline || "Not provided"],
          ["Status", <StatusBadge key="status" value={lead.status || "New"} />],
        ]} />
        <article className="qfa-panel p-4">
          <h3 className="text-sm font-semibold text-slate-950">Requirement</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{lead.message || "No requirement message provided."}</p>
        </article>
        <article className="qfa-panel p-4">
          <h3 className="text-sm font-semibold text-slate-950">Assignment Timeline</h3>
          <div className="mt-3 space-y-2">
            {(lead.lead_assignments ?? []).length ? lead.lead_assignments?.map((assignment) => (
              <div key={assignment.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span>{vendorName(vendors, assignment.vendor_id)}</span>
                <StatusBadge value={assignmentStatus(assignment)} />
              </div>
            )) : <p className="text-sm text-slate-500">No assignment events yet.</p>}
          </div>
        </article>
      </div>
    </Drawer>
  );
}
