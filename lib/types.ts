// ============================================================================
// QuickFurno — lib/types.ts
// ============================================================================

export type VendorStatus = "Pending" | "Approved" | "Rejected" | "Suspended";
export type LeadStatus =
  | "New" | "Assigned" | "Contacted" | "Site Visit Scheduled"
  | "Quotation Sent" | "Won" | "Lost" | "Duplicate";
export type VendorLeadStatus =
  | "New" | "Contacted" | "Site Visit Scheduled" | "Quotation Sent" | "Won" | "Lost";
export type AssignmentType = "client_selected" | "auto_assigned" | "admin_assigned";

export interface CreateLeadInput {
  name: string;
  phone: string;
  city: string;
  area?: string;
  service_required: string;
  budget?: string;
  property_type?: string;
  timeline?: string;
  message?: string;
  source?: string;
}

export interface PublicVendorCard {
  id: string;
  business_name: string;
  city: string;
  areas_covered: string[] | null;
  service_categories: string[] | null;
  experience: string | null;
  portfolio_urls: string[] | null;
  profile_image_url: string | null;
  rating: number;
  completed_projects: number;
}

export interface AssignResult {
  status: string;
  lead_id: string;
  assigned: string[];
  skipped: string[];
  assigned_count: number;
}

export interface VendorRegistrationInput {
  business_name: string;
  owner_name?: string;
  phone: string;
  email?: string;
  city: string;
  areas_covered?: string[];
  covers_full_city?: boolean;
  service_categories?: string[];
  experience?: string;
  portfolio_urls?: string[];
  profile_image_url?: string;
  gst_number?: string;
  user_id?: string;
}

export interface VendorDashboardStats {
  remaining_credits: number;
  total_credits: number;
  total_leads: number;
  won: number;
  lost: number;
  in_progress: number;
  bad_lead_reports: number;
}

export interface AdminDashboardStats {
  total_leads: number;
  assigned_leads: number;
  duplicate_leads: number;
  total_vendors: number;
  approved_vendors: number;
  pending_vendors: number;
  active_vendors: number;
  total_revenue: number;
  leads_distributed: number;
  remaining_vendor_credits: number;
  bad_lead_reports_pending: number;
}
