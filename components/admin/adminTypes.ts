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
  status?: string | null;
  description?: string | null;
  vendor_id?: string | null;
};

export type Setting = {
  key: string;
  value: unknown;
  updated_at?: string | null;
};

export type Snapshot = {
  stats: Record<string, number | string>;
  leads: Lead[];
  vendors: Vendor[];
  packages: PackageRow[];
  payments: Payment[];
  vendorPackages: any[];
  assignments: Assignment[];
  categories: Category[];
  cities: City[];
  badReports: BadReport[];
  settings: Setting[];
  profiles: Profile[];
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
    assignments: [],
    categories: [],
    cities: [],
    badReports: [],
    settings: [],
    profiles: [],
    warnings: [],
  };
}
