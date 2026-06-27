// ============================================================================
// QuickFurno Analytics foundation types (Phase 3)
// Safe, mock-friendly metric shapes for the superadmin Analytics module.
// All cost / spend / revenue figures are placeholders until real ad spend,
// payment, and AI cost sources are connected.
// TODO(analytics): map to real Supabase reads + campaign_performance table.
// ============================================================================

export interface AnalyticsMetric {
  key: string;
  label: string;
  value: string | number;
  helper?: string;
  // "placeholder" marks values that are not yet backed by real data sources.
  kind?: "live" | "placeholder";
}

export interface CampaignMetric {
  id: string;
  campaign: string;
  source: string;
  leads: number;
  hot_leads: number;
  won_leads: number;
  spend_placeholder?: string | null;
  cpl_placeholder?: string | null;
  quality_score_placeholder?: string | null;
}

export interface FunnelMetric {
  stage: string;
  key: string;
  count: number;
}

export interface ServiceMetric {
  service: string;
  leads: number;
  hot_leads: number;
  assigned: number;
  won: number;
  revenue_estimate?: string | null;
  vendor_supply_gap_placeholder?: string | null;
}

export interface AreaMetric {
  area: string;
  city?: string | null;
  leads: number;
  hot_leads: number;
  active_vendors: number;
  assigned_leads: number;
  unassigned_leads: number;
  demand_supply_gap?: string | null;
}

export interface VendorMetric {
  vendor: string;
  category?: string | null;
  city?: string | null;
  leads_received: number;
  response_time_placeholder?: string | null;
  rating_placeholder?: string | null;
  credits_placeholder?: string | null;
  status?: string | null;
}

export interface RevenueMetric {
  key: string;
  label: string;
  value: string;
  kind?: "live" | "placeholder";
}

export interface SourceMetric {
  source: string;
  leads: number;
  hot_leads: number;
  assigned_leads: number;
  won_leads: number;
  lost_leads: number;
  cost_placeholder?: string | null;
  cpl_placeholder?: string | null;
  cost_per_hot_lead_placeholder?: string | null;
  cost_per_won_lead_placeholder?: string | null;
}

export interface FollowUpAnalytics {
  follow_ups_due: number;
  overdue: number;
  completed: number;
  nurture_scheduled: number;
  site_visits: number;
  quotation_followups: number;
}

export interface AgentAnalyticsRow {
  agent: string;
  runs: number | string;
  success_rate: string;
  error_count: number | string;
  avg_confidence: string;
  last_run: string;
}
