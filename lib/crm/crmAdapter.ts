import type { Lead } from "@/components/admin/adminTypes";
import {
  adaptCrmLeads,
  crmLeadAdapter as mapLeadToCrmLead,
  hasLeadFallbackWarning,
  normalizeLeadPriority,
  normalizeLeadStatus,
  resolveLeadSource,
} from "@/lib/crm/adapters/leadAdapter";
import {
  crmCalendarEventTypes,
  isFollowUpOverdue,
  type CRMActivity,
  type CRMCalendarEvent,
  type CRMLead,
  type CRMTask,
} from "@/lib/crm/types";

export {
  adaptCrmLeads,
  mapLeadToCrmLead,
  normalizeLeadPriority,
  normalizeLeadStatus,
  resolveLeadSource,
};

export type CRMLeadDisplayState = "live" | "sample";

export interface CRMAdapterResult {
  leads: CRMLead[];
  loadState: CRMLeadDisplayState;
  isSample: boolean;
  usedFallbackColumns: boolean;
  warning?: string | null;
}

function isoFromNow(days: number, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

export const sampleCrmLeads: CRMLead[] = [
  {
    id: "sample-crm-new",
    lead_id: "sample-crm-new",
    client_name: "Aarav Mehta",
    phone_masked: "98xxxxxx42",
    email_masked: "axxx@example.com",
    service: "interiors",
    subcategory: "Full home design",
    city: "Pune",
    area: "Kharadi",
    budget: "INR 8-12 lakh",
    priority: "hot",
    status: "new",
    source: "website",
    assigned_vendor_count: 0,
    owner: "Admin",
    created_at: isoFromNow(-1),
    next_follow_up_date: isoFromNow(0, 16),
    last_activity_at: isoFromNow(-1),
  },
  {
    id: "sample-crm-qualified",
    lead_id: "sample-crm-qualified",
    client_name: "Nisha Rao",
    phone_masked: "97xxxxxx18",
    email_masked: "nxxx@example.com",
    service: "modular kitchen",
    subcategory: "Kitchen renovation",
    city: "Mumbai",
    area: "Thane",
    budget: "INR 4-6 lakh",
    priority: "warm",
    status: "qualified",
    source: "google_ads",
    assigned_vendor_count: 0,
    owner: "CRM",
    created_at: isoFromNow(-2),
    next_follow_up_date: isoFromNow(1, 11),
    last_activity_at: isoFromNow(-1),
  },
  {
    id: "sample-crm-assigned",
    lead_id: "sample-crm-assigned",
    client_name: "Rohan Shah",
    phone_masked: "91xxxxxx05",
    email_masked: "rxxx@example.com",
    service: "carpentry",
    subcategory: "Wardrobe",
    city: "Pune",
    area: "Baner",
    budget: "INR 1-2 lakh",
    priority: "cold",
    status: "assigned",
    source: "referral",
    assigned_vendor_count: 2,
    owner: "Ops",
    created_at: isoFromNow(-4),
    next_follow_up_date: isoFromNow(2, 12),
    last_activity_at: isoFromNow(-1),
  },
  {
    id: "sample-crm-site-visit",
    lead_id: "sample-crm-site-visit",
    client_name: "Priya Iyer",
    phone_masked: "90xxxxxx77",
    email_masked: "pxxx@example.com",
    service: "painting",
    subcategory: "Full flat painting",
    city: "Mumbai",
    area: "Powai",
    budget: "INR 75,000",
    priority: "warm",
    status: "site_visit_scheduled",
    source: "meta_ads",
    assigned_vendor_count: 3,
    owner: "ClientCare",
    created_at: isoFromNow(-5),
    next_follow_up_date: isoFromNow(3, 15),
    last_activity_at: isoFromNow(-1),
  },
  {
    id: "sample-crm-quotation",
    lead_id: "sample-crm-quotation",
    client_name: "Kabir Joshi",
    phone_masked: "88xxxxxx66",
    email_masked: "kxxx@example.com",
    service: "sofa",
    subcategory: "Sofa repair",
    city: "Pune",
    area: "Wakad",
    budget: "INR 35,000",
    priority: "weak",
    status: "quotation_sent",
    source: "manual",
    assigned_vendor_count: 1,
    owner: "Sales",
    created_at: isoFromNow(-7),
    next_follow_up_date: isoFromNow(-1, 10),
    last_activity_at: isoFromNow(-2),
  },
  {
    id: "sample-crm-nurture",
    lead_id: "sample-crm-nurture",
    client_name: "Sana Khan",
    phone_masked: "99xxxxxx31",
    email_masked: "sxxx@example.com",
    service: "civil work",
    subcategory: "Renovation later",
    city: "Pune",
    area: "Viman Nagar",
    budget: "Not finalized",
    priority: "cold",
    status: "nurture_later",
    source: "organic_seo",
    assigned_vendor_count: 0,
    owner: "CRM",
    created_at: isoFromNow(-10),
    next_follow_up_date: isoFromNow(30, 10),
    nurture_stage: "nurture_30_days",
    nurture_reason: "renovation_later",
    nurture_follow_up_date: isoFromNow(30, 10),
    nurture_custom_date_enabled: false,
    last_activity_at: isoFromNow(-3),
  },
  {
    id: "sample-crm-spam",
    lead_id: "sample-crm-spam",
    client_name: "Sample Review",
    phone_masked: "12xxxxxx90",
    email_masked: "sxxx@example.com",
    service: "interiors",
    subcategory: "Review needed",
    city: "Pune",
    area: "Unknown",
    budget: "Not set",
    priority: "spam",
    status: "spam_review",
    source: "whatsapp",
    assigned_vendor_count: 0,
    owner: "TrustShield",
    created_at: isoFromNow(-1),
    next_follow_up_date: null,
    last_activity_at: isoFromNow(-1),
  },
];

export function getCrmLeadModel(input: {
  leads?: Lead[] | null;
  error?: string | null;
  warnings?: string[];
}): CRMAdapterResult {
  try {
    const liveLeads = adaptCrmLeads(input.leads);
    if (liveLeads.length > 0) {
      return {
        leads: liveLeads,
        loadState: "live",
        isSample: false,
        usedFallbackColumns: hasLeadFallbackWarning(input.warnings),
        warning: null,
      };
    }

    return {
      leads: sampleCrmLeads,
      loadState: "sample",
      isSample: true,
      usedFallbackColumns: hasLeadFallbackWarning(input.warnings),
      warning: input.error
        ? "Admin snapshot was unavailable, so CRM sample data is shown."
        : "No existing leads were available, so CRM sample data is shown.",
    };
  } catch {
    return {
      leads: sampleCrmLeads,
      loadState: "sample",
      isSample: true,
      usedFallbackColumns: false,
      warning: "CRM adapter recovered with sample data.",
    };
  }
}

export function buildCrmFollowUpTasks(leads: CRMLead[]): CRMTask[] {
  return leads
    .filter((lead) => lead.next_follow_up_date)
    .slice(0, 8)
    .map((lead, index) => ({
      id: `task-${lead.id}`,
      lead_id: lead.id,
      title: lead.client_name,
      task_type: index % 3 === 0 ? "client_call" : index % 3 === 1 ? "quotation_followup" : "nurture_followup",
      due_date: lead.next_follow_up_date,
      owner: lead.owner ?? "Unassigned",
      status: isFollowUpOverdue(lead.next_follow_up_date) ? "overdue" : "open",
      created_at: lead.created_at,
    }));
}

export function buildCrmActivities(leads: CRMLead[]): CRMActivity[] {
  const lead = leads[0] ?? sampleCrmLeads[0];
  const second = leads[1] ?? sampleCrmLeads[1];
  return [
    {
      id: "activity-lead-created",
      lead_id: lead.id,
      activity_type: "lead_created",
      summary: "Lead created",
      actor: "System",
      created_at: lead.created_at,
    },
    {
      id: "activity-lead-qualified",
      lead_id: second.id,
      activity_type: "lead_qualified",
      summary: "Lead qualified",
      actor: "CRM",
      created_at: second.last_activity_at ?? second.created_at,
    },
    {
      id: "activity-vendor-matched",
      lead_id: lead.id,
      activity_type: "vendor_matched",
      summary: "Vendor matched",
      actor: "MatchForge placeholder",
      created_at: isoFromNow(-1, 12),
    },
    {
      id: "activity-client-contacted",
      lead_id: second.id,
      activity_type: "client_contacted",
      summary: "Client contacted",
      actor: "ClientCare placeholder",
      created_at: isoFromNow(-1, 14),
    },
    {
      id: "activity-followup-scheduled",
      lead_id: lead.id,
      activity_type: "follow_up_scheduled",
      summary: "Follow-up scheduled",
      actor: "CRM",
      created_at: isoFromNow(0, 9),
    },
    {
      id: "activity-nurture-moved",
      lead_id: (leads.find((item) => item.status === "nurture_later") ?? sampleCrmLeads[5]).id,
      activity_type: "nurture_moved",
      summary: "Nurture moved",
      actor: "CRM",
      created_at: isoFromNow(0, 10),
    },
  ];
}

export function buildCrmCalendarEvents(leads: CRMLead[]): CRMCalendarEvent[] {
  return leads
    .filter((lead) => lead.next_follow_up_date || lead.nurture_follow_up_date)
    .slice(0, 12)
    .map((lead, index) => {
      const eventType = crmCalendarEventTypes[index % crmCalendarEventTypes.length];
      const scheduledAt = lead.nurture_follow_up_date ?? lead.next_follow_up_date ?? isoFromNow(index + 1);
      return {
        id: `calendar-${lead.id}`,
        lead_id: lead.id,
        title: `${eventType.replace(/_/g, " ")} - ${lead.client_name}`,
        event_type: eventType,
        scheduled_at: scheduledAt,
        owner: lead.owner ?? "Unassigned",
        status: isFollowUpOverdue(scheduledAt) ? "overdue" : "scheduled",
        notes: `${lead.service ?? "Service"} in ${lead.area ?? "area"}`,
      };
    });
}
