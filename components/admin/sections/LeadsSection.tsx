"use client";

// ============================================================================
// C-PERF2: the legacy client-filtered LeadsPage (latest-50 snapshot subset
// presented as "Complete lead database") has been REMOVED. The Leads route is
// served by the server-paged LeadsDirectory. This module keeps only the
// shared vocabulary, badges and the lead detail drawer that directory reuses.
// ============================================================================

import {
  Drawer,
  InfoGrid,
  StatusBadge,
} from "../AdminPrimitives";
import { type Lead, type Vendor } from "../adminTypes";
import {
  assignmentStatus,
  shortId,
  vendorName,
} from "../adminUtils";

export const closedLeadStatuses = new Set(["converted", "won", "lost", "duplicate", "spam", "invalid"]);

export const leadStatuses = ["All", "New", "Assigned", "Contacted", "Interested", "Site Visit Scheduled", "Quotation Sent", "Converted", "Lost", "Duplicate", "Spam", "Invalid"];


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
