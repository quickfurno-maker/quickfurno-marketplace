import type { Snapshot, Vendor } from "@/components/admin/adminTypes";
import { getCrmLeadModel } from "@/lib/crm/crmAdapter";
import { runOpsBrief, type OpsBriefReport } from "@/lib/aos/sync/aosCrmSyncService";
import type {
  AgentAnalyticsRow,
  AnalyticsMetric,
  AreaMetric,
  CampaignMetric,
  FunnelMetric,
  RevenueMetric,
  ServiceMetric,
  SourceMetric,
  VendorMetric,
} from "@/lib/analytics/types";
import type { CRMLead, CRMLeadStatus } from "@/lib/crm/types";

export interface QuickFurnoAnalyticsModel {
  cards: AnalyticsMetric[];
  sources: SourceMetric[];
  campaigns: CampaignMetric[];
  funnel: FunnelMetric[];
  services: ServiceMetric[];
  areas: AreaMetric[];
  vendors: VendorMetric[];
  revenue: RevenueMetric[];
  followUps: AnalyticsMetric[];
  agents: AgentAnalyticsRow[];
  opsBrief: OpsBriefReport;
}

const sourceCategories = [
  "website",
  "google_ads",
  "meta_ads",
  "whatsapp",
  "manual",
  "referral",
  "organic_seo",
  "justdial_competitor_tracking_placeholder",
] as const;

const serviceCategories = ["interiors", "carpentry", "modular kitchen", "sofa", "painting", "civil work"] as const;

const funnelStages: Array<{ key: string; status: CRMLeadStatus | "contacted"; label: string }> = [
  { key: "new", status: "new", label: "new" },
  { key: "qualified", status: "qualified", label: "qualified" },
  { key: "assigned", status: "assigned", label: "assigned" },
  { key: "contacted", status: "contacted", label: "contacted" },
  { key: "site_visit_scheduled", status: "site_visit_scheduled", label: "site_visit_scheduled" },
  { key: "quotation_sent", status: "quotation_sent", label: "quotation_sent" },
  { key: "won", status: "won", label: "won" },
  { key: "lost", status: "lost", label: "lost" },
];

function statNumber(data: Snapshot, key: string, fallback: number) {
  const raw = data.stats?.[key];
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

function normalizeSource(value?: string | null): (typeof sourceCategories)[number] {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("google")) return "google_ads";
  if (normalized.includes("meta") || normalized.includes("facebook") || normalized.includes("instagram")) return "meta_ads";
  if (normalized.includes("whatsapp")) return "whatsapp";
  if (normalized.includes("refer")) return "referral";
  if (normalized.includes("seo") || normalized.includes("organic")) return "organic_seo";
  if (normalized.includes("justdial")) return "justdial_competitor_tracking_placeholder";
  if (normalized.includes("manual")) return "manual";
  return "website";
}

function normalizeService(value?: string | null): (typeof serviceCategories)[number] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("carpent") || normalized.includes("wardrobe")) return "carpentry";
  if (normalized.includes("kitchen")) return "modular kitchen";
  if (normalized.includes("sofa")) return "sofa";
  if (normalized.includes("paint")) return "painting";
  if (normalized.includes("civil") || normalized.includes("renovation")) return "civil work";
  return "interiors";
}

function isAssigned(lead: CRMLead) {
  return (lead.assigned_vendor_count ?? 0) > 0 || lead.status === "assigned";
}

function countStatus(leads: CRMLead[], stage: CRMLeadStatus | "contacted") {
  if (stage === "contacted") return leads.filter((lead) => lead.status === "client_contacted" || lead.status === "vendor_contact_pending").length;
  return leads.filter((lead) => lead.status === stage).length;
}

function vendorDisplayName(vendor: Vendor, index: number) {
  return vendor.business_name || vendor.owner_name || `Vendor ${index + 1}`;
}

export function buildAnalyticsModel(data: Snapshot): QuickFurnoAnalyticsModel {
  const crm = getCrmLeadModel({ leads: data.leads, warnings: data.warnings });
  const leads = crm.leads;
  const vendors = data.vendors ?? [];
  const activeVendorCount = statNumber(
    data,
    "active_vendors",
    vendors.filter((vendor) => vendor.is_active !== false && !String(vendor.status ?? "").toLowerCase().includes("suspend")).length,
  );
  const paidVendorCount = statNumber(data, "paid_vendors", 0);
  const followUpsDue = leads.filter((lead) => lead.next_follow_up_date).length;

  const cards: AnalyticsMetric[] = [
    { key: "total_leads", label: "Total Leads", value: statNumber(data, "total_leads", leads.length), helper: crm.isSample ? "Sample placeholder" : "Safe admin snapshot", kind: crm.isSample ? "placeholder" : "live" },
    { key: "leads_today", label: "Leads Today", value: statNumber(data, "leads_today", leads.filter((lead) => isToday(lead.created_at)).length), helper: "Created today", kind: crm.isSample ? "placeholder" : "live" },
    { key: "conversion_rate", label: "Conversion Rate placeholder", value: "0%", helper: "Not active yet", kind: "placeholder" },
    { key: "revenue", label: "Revenue placeholder", value: "INR --", helper: "Payments not connected", kind: "placeholder" },
    { key: "active_vendors", label: "Active Vendors", value: activeVendorCount, helper: "Safe vendor count", kind: "live" },
    { key: "paid_vendors", label: "Paid Vendors", value: paidVendorCount, helper: "Package count when available", kind: "live" },
    { key: "followups_due", label: "Follow-ups Due", value: followUpsDue, helper: "CRM placeholder queue", kind: "placeholder" },
    { key: "aos_events", label: "AOS Events placeholder", value: "0", helper: "No agent runs connected", kind: "placeholder" },
  ];

  const sources: SourceMetric[] = sourceCategories.map((source) => {
    const rows = leads.filter((lead) => normalizeSource(lead.source) === source);
    return {
      source,
      leads: rows.length,
      hot_leads: rows.filter((lead) => lead.priority === "hot").length,
      assigned_leads: rows.filter(isAssigned).length,
      won_leads: rows.filter((lead) => lead.status === "won").length,
      lost_leads: rows.filter((lead) => lead.status === "lost").length,
      cost_placeholder: "INR --",
      cpl_placeholder: "INR --",
      cost_per_hot_lead_placeholder: "INR --",
      cost_per_won_lead_placeholder: "INR --",
    };
  });

  const campaigns: CampaignMetric[] = [
    { id: "campaign-website", campaign: "Website direct intake", source: "website", leads: sources.find((s) => s.source === "website")?.leads ?? 0, spend_placeholder: "INR --", cpl_placeholder: "INR --", conversion_placeholder: "--" },
    { id: "campaign-google", campaign: "Google Ads search", source: "google_ads", leads: sources.find((s) => s.source === "google_ads")?.leads ?? 0, spend_placeholder: "INR --", cpl_placeholder: "INR --", conversion_placeholder: "--" },
    { id: "campaign-meta", campaign: "Meta lead campaign", source: "meta_ads", leads: sources.find((s) => s.source === "meta_ads")?.leads ?? 0, spend_placeholder: "INR --", cpl_placeholder: "INR --", conversion_placeholder: "--" },
    { id: "campaign-referral", campaign: "Referral tracking", source: "referral", leads: sources.find((s) => s.source === "referral")?.leads ?? 0, spend_placeholder: "INR --", cpl_placeholder: "INR --", conversion_placeholder: "--" },
  ];

  const funnel: FunnelMetric[] = funnelStages.map((stage) => ({
    key: stage.key,
    stage: stage.label,
    count: countStatus(leads, stage.status),
  }));

  const services: ServiceMetric[] = serviceCategories.map((service) => {
    const rows = leads.filter((lead) => normalizeService(lead.service) === service);
    return {
      service,
      leads: rows.length,
      hot_leads: rows.filter((lead) => lead.priority === "hot").length,
      assigned: rows.filter(isAssigned).length,
      won: rows.filter((lead) => lead.status === "won").length,
      revenue_estimate: "INR --",
      vendor_supply_gap_placeholder: "Placeholder",
    };
  });

  const areaMap = new Map<string, AreaMetric>();
  leads.forEach((lead) => {
    const city = lead.city || "Unknown";
    const locality = lead.area || "Unknown";
    const key = `${city}:${locality}`;
    const current = areaMap.get(key) ?? {
      city,
      locality,
      area: locality,
      leads: 0,
      lead_count: 0,
      hot_leads: 0,
      active_vendors: 0,
      vendor_count: 0,
      assigned_leads: 0,
      unassigned_leads: 0,
      demand_supply_gap: "Placeholder",
    };
    current.leads += 1;
    current.lead_count = current.leads;
    if (lead.priority === "hot") current.hot_leads += 1;
    if (isAssigned(lead)) current.assigned_leads += 1;
    else current.unassigned_leads += 1;
    areaMap.set(key, current);
  });

  areaMap.forEach((row) => {
    const matchingVendors = vendors.filter((vendor) => {
      const cityMatch = String(vendor.city ?? "").toLowerCase() === row.city.toLowerCase();
      const areaMatch = (vendor.areas_covered ?? []).some((area) => String(area).toLowerCase() === row.locality.toLowerCase());
      return cityMatch || areaMatch;
    }).length;
    row.vendor_count = matchingVendors;
    row.active_vendors = matchingVendors;
  });

  const areas = [...areaMap.values()].slice(0, 12);
  if (areas.length === 0) {
    areas.push(
      { city: "Pune", locality: "Kharadi", area: "Kharadi", leads: 0, lead_count: 0, hot_leads: 0, active_vendors: 0, vendor_count: 0, assigned_leads: 0, unassigned_leads: 0, demand_supply_gap: "Placeholder" },
      { city: "Mumbai", locality: "Thane", area: "Thane", leads: 0, lead_count: 0, hot_leads: 0, active_vendors: 0, vendor_count: 0, assigned_leads: 0, unassigned_leads: 0, demand_supply_gap: "Placeholder" },
    );
  }

  const assignmentCounts = new Map<string, number>();
  (data.assignments ?? []).forEach((assignment) => {
    if (!assignment.vendor_id) return;
    assignmentCounts.set(assignment.vendor_id, (assignmentCounts.get(assignment.vendor_id) ?? 0) + 1);
  });

  const vendorSource = vendors.length
    ? vendors
    : [
        { id: "sample-vendor-1", business_name: "Verified Interiors Studio", status: "Active", remaining_credits: 12, service_categories: ["interiors"], city: "Pune" },
        { id: "sample-vendor-2", business_name: "Premium Carpentry Works", status: "Active", remaining_credits: 8, service_categories: ["carpentry"], city: "Mumbai" },
      ];

  const vendorRows: VendorMetric[] = vendorSource.slice(0, 12).map((vendor, index) => ({
    vendor: vendorDisplayName(vendor, index),
    assigned_leads: assignmentCounts.get(vendor.id) ?? 0,
    response_rate_placeholder: "--",
    package: index === 0 ? "Premium placeholder" : "Package placeholder",
    status: vendor.status ?? "Active",
    lead_balance_placeholder: vendor.remaining_credits != null ? String(vendor.remaining_credits) : "--",
    category: vendor.service_categories?.[0] ?? "Not set",
    city: vendor.city ?? "Not set",
    leads_received: assignmentCounts.get(vendor.id) ?? 0,
    response_time_placeholder: "--",
    rating_placeholder: "--",
    credits_placeholder: vendor.remaining_credits != null ? String(vendor.remaining_credits) : "--",
  }));

  const revenue: RevenueMetric[] = [
    { key: "package_revenue", label: "Package revenue", value: "INR --", kind: "placeholder" },
    { key: "pending_payments", label: "Pending payments", value: "INR --", kind: "placeholder" },
    { key: "expired_packages", label: "Expired packages", value: String(statNumber(data, "expired_vendors", 0)), kind: "placeholder" },
    { key: "renewals_due", label: "Renewals due", value: "--", kind: "placeholder" },
    { key: "monthly_revenue", label: "Monthly revenue placeholder", value: "INR --", kind: "placeholder" },
  ];

  const followUps: AnalyticsMetric[] = [
    { key: "followups_due", label: "Follow-ups Due", value: followUpsDue, helper: "Placeholder CRM task count", kind: "placeholder" },
  ];

  const agents: AgentAnalyticsRow[] = ["LeadLens", "TrustShield", "MatchForge", "LeadFlow", "ClientCare", "OpsBrief"].map((agent) => ({
    agent,
    runs: "0",
    success_rate: "Placeholder",
    error_count: "0",
    avg_confidence: "Placeholder",
    last_run: "Not active",
  }));

  return {
    cards,
    sources,
    campaigns,
    funnel,
    services,
    areas,
    vendors: vendorRows,
    revenue,
    followUps,
    agents,
    opsBrief: runOpsBrief(leads, activeVendorCount),
  };
}
