// ============================================================================
// QuickFurno — lib/types.ts
// ============================================================================

export type VendorStatus = "Pending" | "Approved" | "Rejected" | "Suspended";
export type LeadStatus =
  | "New" | "Assigned" | "Contacted" | "Site Visit Scheduled"
  | "Quotation Sent" | "Won" | "Lost" | "Duplicate";
export type VendorLeadStatus =
  | "New" | "Contacted" | "Follow-up Needed" | "Site Visit Scheduled" | "Quotation Sent" | "Converted" | "Won" | "Lost";
export type AssignmentType = "client_selected" | "auto_assigned" | "admin_assigned";

export interface CreateLeadInput {
  name: string;
  phone: string;
  city: string;
  area?: string;
  service_required?: string;
  service_category?: string;
  serviceCategory?: string;
  subcategory?: string;
  budget?: string;
  budget_range?: string;
  budgetRange?: string;
  property_type?: string;
  timeline?: string;
  message?: string;
  requirement?: string;
  source?: string;
  // Tracking readiness + consent (stored once 008_lead_capture_consent.sql runs).
  source_url?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  location_consent?: boolean;
  share_consent?: boolean;
  // Phase 26A-2D: requirement-group / client-selected-vendor context. Persisted
  // once 20260701000032_phase26a2d_client_requirement_groups.sql runs; ignored
  // gracefully if the columns are not there yet.
  parent_category_group?: string;
  requirement_group_id?: string;
  selected_vendor_id?: string;
  selected_vendor_name?: string;
  // "client_selected_vendor" tells createLead to SKIP the immediate max-3 auto
  // match so the client-selected priority + 1-hour window can run instead.
  assignment_intent?: string;
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
  message?: string;
  user_id?: string;
  // Vendor base location (optional, browser GPS) — used later for nearest-client
  // lead matching. All optional so registration still works without GPS.
  base_latitude?: number;
  base_longitude?: number;
  location_accuracy_meters?: number;
  location_source?: string;
  location_captured_at?: string;
  service_radius_km?: number;
  base_area?: string;
  base_pincode?: string;
  // Guided onboarding wizard fields (stored once 009_vendor_onboarding.sql /
  // 010_vendor_exact_columns.sql run; registerVendor falls back gracefully if
  // the columns are missing).
  latitude?: number | null;
  longitude?: number | null;
  whatsapp_number?: string;
  selected_category?: string;
  selected_subcategories?: string[];
  custom_service_area?: string;
  // Detailed office / business address (migration 011_vendor_office_address).
  office_address_line1?: string;
  office_address_line2?: string;
  office_landmark?: string;
  office_city?: string;
  office_state?: string;
  office_pincode?: string;
  office_latitude?: number | null;
  office_longitude?: number | null;
  location_permission_status?: string;
  business_type?: string;
  years_experience?: string;
  team_size?: string;
  monthly_capacity?: string;
  starting_price?: string;
  paid_status?: string;
  source_url?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

/** Read-only profile summary shown on the vendor dashboard (display fields). */
export interface VendorProfileSummary {
  id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  city: string | null;
  areas_covered: string[] | null;
  service_categories: string[] | null;
  selected_category: string | null;
  business_type: string | null;
  // Office / business address (migration 011_vendor_office_address).
  office_address_line1: string | null;
  office_address_line2: string | null;
  office_landmark: string | null;
  office_city: string | null;
  office_state: string | null;
  office_pincode: string | null;
  office_latitude: number | null;
  office_longitude: number | null;
  status: string;
  verification_status: string | null;
  paid_status: string | null;
  remaining_credits: number;
  total_credits: number;
  public_visibility: boolean;
  is_active: boolean;
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
