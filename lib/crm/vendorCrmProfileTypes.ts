// ============================================================================
// Admin Dashboard V2 C4 — Vendor CRM profile read-model contracts.
//
// These types describe the server-rendered account workspace only. Core-owned
// fields remain read-only projections; the CRM types mirror existing columns
// and do not introduce a new persistence contract.
// ============================================================================

import type { DirectoryPage } from "@/lib/adminPaging";
import type {
  VendorContactChannel,
  VendorCrmOnboardingStage,
  VendorCrmRelationshipStatus,
  VendorCrmResComScope,
  VendorNoteCategory,
  VendorTaskPriority,
  VendorTaskSource,
  VendorTaskStatus,
  VendorTaskType,
} from "@/lib/crm/vendorCrmContracts";

export type PagedResult<T> = DirectoryPage<T>;

export type VendorCrmProfileTab =
  | "overview"
  | "contacts"
  | "tags"
  | "notes"
  | "tasks"
  | "core-context";

export interface VendorCoreFacts {
  id: string;
  business_name: string | null;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  areas_covered: string[] | null;
  covers_full_city: boolean | null;
  service_categories: string[] | null;
  status: string | null;
  is_active: boolean | null;
  accepting_leads: boolean | null;
  total_credits: number | null;
  remaining_credits: number | null;
  last_assigned_at: string | null;
  created_at: string | null;
}

export interface VendorCrmProfileRecord {
  vendor_id: string;
  onboarding_stage: VendorCrmOnboardingStage;
  relationship_status: VendorCrmRelationshipStatus;
  account_manager_profile_id: string | null;
  next_follow_up_at: string | null;
  last_interaction_at: string | null;
  inactive_reason: string | null;
  company_type: string | null;
  years_in_business: number | null;
  team_size: string | null;
  capability_notes: string | null;
  residential_commercial_scope: VendorCrmResComScope | null;
  budget_band: string | null;
  monthly_capacity_notes: string | null;
  material_notes: string | null;
  warranty_notes: string | null;
  preferred_localities: string[];
  excluded_localities: string[];
  travel_radius_km: number | null;
  campaign_notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface VendorContact {
  id: string;
  vendor_id: string;
  name: string;
  role_title: string | null;
  phone: string | null;
  email: string | null;
  preferred_channel: VendorContactChannel | null;
  is_primary: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface VendorTag {
  id: string;
  name: string;
  normalized_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface VendorTagAssignment {
  id: string;
  tag_id: string;
  assigned_at: string;
  removed_at: string | null;
  vendor_tags: Pick<VendorTag, "id" | "name" | "is_active"> | null;
}

export interface VendorNote {
  id: string;
  note: string;
  category: VendorNoteCategory | null;
  created_at: string;
  created_by: string | null;
  supersedes_note_id: string | null;
  author_name: string | null;
}

export interface VendorTask {
  id: string;
  vendor_id: string;
  task_type: VendorTaskType;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: VendorTaskPriority;
  status: VendorTaskStatus;
  completion_result: string | null;
  source: VendorTaskSource;
  created_at: string;
  completed_at: string | null;
}

export interface VendorCrmProfileSummary {
  contacts_total: number;
  notes_total: number;
  open_tasks: number;
  overdue_tasks: number;
  primary_contact: VendorContact | null;
  latest_note: VendorNote | null;
}

