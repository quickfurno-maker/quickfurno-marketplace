export type Lead = {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  area?: string | null;
  locality?: string | null;
  service_required?: string | null;
  category?: string | null;
  subcategory?: string | null;
  budget?: string | null;
  property_type?: string | null;
  project_size?: string | null;
  timeline?: string | null;
  message?: string | null;
  source?: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;
  utm_medium?: string | null;
  page_url?: string | null;
  lead_quality_score?: number | null;
  lead_priority?: string | null;
  status?: string | null;
  verification_status?: string | null;
  internal_notes?: string | null;
  follow_up_date?: string | null;
  is_duplicate?: boolean | null;
  lead_assignments?: Assignment[];
};

export type Vendor = {
  id: string;
  created_at?: string | null;
  business_name?: string | null;
  owner_name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  areas_covered?: string[] | null;
  covers_full_city?: boolean | null;
  service_categories?: string[] | null;
  status?: string | null;
  total_credits?: number | null;
  remaining_credits?: number | null;
  rating?: number | null;
  completed_projects?: number | null;
  is_active?: boolean | null;
  public_visibility?: boolean | null;
  last_assigned_at?: string | null;
  gst_number?: string | null;
  paid_status?: string | null;
  // Phase 13B: denormalized package fields used by preview eligibility.
  package_name?: string | null;
  package_status?: string | null;
  package_expires_at?: string | null;
};

export type PackageRow = {
  id: string;
  name?: string | null;
  lead_count?: number | null;
  price_per_lead?: number | null;
  total_price?: number | null;
  display_price?: number | null;
  validity_days?: number | null;
  is_active?: boolean | null;
};

export type Payment = {
  id: string;
  created_at?: string | null;
  vendor_id?: string | null;
  package_id?: string | null;
  amount?: number | null;
  payment_method?: string | null;
  payment_status?: string | null;
  transaction_id?: string | null;
  admin_notes?: string | null;
};

export type VendorPackageOrder = {
  id: string;
  vendor_id?: string | null;
  package_id?: string | null;
  package_name?: string | null;
  package_price?: number | null;
  package_currency?: string | null;
  credits_included?: number | null;
  validity_days?: number | null;
  order_status?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_provider?: string | null;
  provider_order_id?: string | null;
  provider_payment_id?: string | null;
  paid_at?: string | null;
  activated_at?: string | null;
  activation_status?: string | null;
  failure_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type VendorProfileChangeRequest = {
  id: string;
  vendor_id?: string | null;
  requested_by?: string | null;
  request_type?: string | null;
  proposed_changes?: Record<string, unknown> | null;
  current_snapshot?: Record<string, unknown> | null;
  status?: "pending" | "approved" | "rejected" | "cancelled" | string | null;
  admin_notes?: string | null;
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type VendorNotification = {
  id: string;
  vendor_id?: string | null;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  priority?: string | null;
  is_read?: boolean | null;
  cta_label?: string | null;
  cta_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type VendorSupportThread = {
  id: string;
  vendor_id?: string | null;
  subject?: string | null;
  topic?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type VendorSupportMessage = {
  id: string;
  thread_id?: string | null;
  sender_type?: string | null;
  sender_id?: string | null;
  message?: string | null;
  created_at?: string | null;
};

export type Assignment = {
  id: string;
  lead_id?: string | null;
  vendor_id?: string | null;
  vendor_status?: string | null;
  assignment_type?: string | null;
  assigned_at?: string | null;
  created_at?: string | null;
};

export type Category = {
  id: string;
  name?: string | null;
  slug?: string | null;
  is_active?: boolean | null;
  show_on_homepage?: boolean | null;
  sort_order?: number | null;
  parent_id?: string | null;
};

export type City = {
  id: string;
  name?: string | null;
  slug?: string | null;
  state?: string | null;
  launch_status?: string | null;
  is_active?: boolean | null;
  show_on_homepage?: boolean | null;
  sort_order?: number | null;
};

export type Profile = {
  id: string;
  created_at?: string | null;
  full_name?: string | null;
  phone?: string | null;
  role?: string | null;
  admin_role?: string | null;
  is_active?: boolean | null;
};

export type BadReport = {
  id: string;
  created_at?: string | null;
  reason?: string | null;
  report_type?: string | null;
  report_reason?: string | null;
  vendor_comment?: string | null;
  status?: string | null;
  description?: string | null;
  vendor_id?: string | null;
  lead_assignment_id?: string | null;
  admin_decision?: string | null;
  credit_restored?: boolean | null;
  reviewed_at?: string | null;
  updated_at?: string | null;
};

export type Setting = {
  key: string;
  value: unknown;
  updated_at?: string | null;
};

export type MarketplaceRuntimeSetting = {
  id?: string;
  key: string;
  value: unknown;
  description?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type FreeVendorProfileInterest = {
  id: string;
  vendor_id: string;
  lead_id?: string | null;
  client_name?: string | null;
  client_phone_masked?: string | null;
  client_phone_hash?: string | null;
  city?: string | null;
  area?: string | null;
  category?: string | null;
  subcategory?: string | null;
  interest_type?: string | null;
  status?: string | null;
  vendor_notified?: boolean | null;
  vendor_notified_at?: string | null;
  aos_event_id?: string | null;
  n8n_preview_called?: boolean | null;
  unlocked_after_payment?: boolean | null;
  admin_note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type LeadAssignmentQueueRow = {
  id: string;
  lead_id: string;
  city?: string | null;
  category?: string | null;
  subcategory?: string | null;
  queue_status?: string | null;
  queue_reason?: string | null;
  required_vendor_count?: number | null;
  eligible_vendor_count?: number | null;
  selected_vendor_ids?: string[] | null;
  rejected_vendor_reasons?: Record<string, string[]> | null;
  last_checked_at?: string | null;
  next_retry_at?: string | null;
  matching_attempt_count?: number | null;
  resolved_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type LeadAutoAssignmentLog = {
  id: string;
  lead_id: string;
  mode?: string | null;
  status?: string | null;
  city?: string | null;
  category?: string | null;
  subcategory?: string | null;
  eligible_vendor_count?: number | null;
  selected_vendor_ids?: string[] | null;
  rejected_vendor_reasons?: Record<string, string[]> | null;
  scoring_snapshot?: Record<string, unknown> | null;
  queue_reason?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

export type Snapshot = {
  stats: Record<string, number | string>;
  leads: Lead[];
  vendors: Vendor[];
  packages: PackageRow[];
  payments: Payment[];
  vendorPackages: any[];
  vendorPackageOrders: VendorPackageOrder[];
  vendorProfileChangeRequests: VendorProfileChangeRequest[];
  vendorNotifications: VendorNotification[];
  vendorSupportThreads: VendorSupportThread[];
  vendorSupportMessages: VendorSupportMessage[];
  assignments: Assignment[];
  categories: Category[];
  cities: City[];
  badReports: BadReport[];
  settings: Setting[];
  profiles: Profile[];
  marketplaceSettings?: MarketplaceRuntimeSetting[];
  freeVendorInterests?: FreeVendorProfileInterest[];
  leadAssignmentQueue?: LeadAssignmentQueueRow[];
  autoAssignmentLogs?: LeadAutoAssignmentLog[];
  generatedAt?: string;
  warnings?: string[];
};

export function emptySnapshot(): Snapshot {
  return {
    stats: {},
    leads: [],
    vendors: [],
    packages: [],
    payments: [],
    vendorPackages: [],
    vendorPackageOrders: [],
    vendorProfileChangeRequests: [],
    vendorNotifications: [],
    vendorSupportThreads: [],
    vendorSupportMessages: [],
    assignments: [],
    categories: [],
    cities: [],
    badReports: [],
    settings: [],
    profiles: [],
    marketplaceSettings: [],
    freeVendorInterests: [],
    leadAssignmentQueue: [],
    autoAssignmentLogs: [],
    warnings: [],
  };
}
