// ============================================================================
// QF-MVP-30.1B — Vendor CRM foundation domain contracts (types + closed sets).
//
// Pure, dependency-free constants that mirror the CHECK sets in migration
// 20260723001100_qf_mvp_vendor_crm_foundation.sql. No UI, no API, no DB access,
// no runtime side effects. These lock the closed vocabularies so future CRM
// services and tests share one source of truth with the database.
//
// AUTHORITY BOUNDARY: none of these describe or duplicate authoritative Core
// facts (verification / enabled state / city / service area / categories /
// package / credits / eligibility / consent / suppression). They are CRM
// relationship/organizational vocabularies only.
// ============================================================================

export const VENDOR_CRM_ONBOARDING_STAGES = [
  "new",
  "contacted",
  "onboarding",
  "active",
  "dormant",
  "churned",
] as const;
export type VendorCrmOnboardingStage = (typeof VENDOR_CRM_ONBOARDING_STAGES)[number];

export const VENDOR_CRM_RELATIONSHIP_STATUSES = [
  "prospect",
  "active",
  "at_risk",
  "inactive",
  "blacklisted",
] as const;
export type VendorCrmRelationshipStatus = (typeof VENDOR_CRM_RELATIONSHIP_STATUSES)[number];

export const VENDOR_CRM_RES_COM_SCOPES = ["residential", "commercial", "both"] as const;
export type VendorCrmResComScope = (typeof VENDOR_CRM_RES_COM_SCOPES)[number];

export const VENDOR_CONTACT_CHANNELS = ["phone", "whatsapp", "email"] as const;
export type VendorContactChannel = (typeof VENDOR_CONTACT_CHANNELS)[number];

export const VENDOR_NOTE_CATEGORIES = [
  "general",
  "call",
  "meeting",
  "onboarding",
  "support",
  "payment",
  "complaint",
  "campaign",
] as const;
export type VendorNoteCategory = (typeof VENDOR_NOTE_CATEGORIES)[number];

/** Launch-required task types (matches the DB CHECK; automation may later add
 *  source='suggested' tasks through Core/admin code, never a direct Jarvis write). */
export const VENDOR_TASK_TYPES = [
  "onboarding",
  "documents",
  "verification",
  "package_renewal",
  "low_credit",
  "inactivity",
  "complaint",
  "campaign_response_followup",
  "general",
] as const;
export type VendorTaskType = (typeof VENDOR_TASK_TYPES)[number];

export const VENDOR_TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type VendorTaskPriority = (typeof VENDOR_TASK_PRIORITIES)[number];

export const VENDOR_TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type VendorTaskStatus = (typeof VENDOR_TASK_STATUSES)[number];

export const VENDOR_TASK_SOURCES = ["manual", "suggested", "system"] as const;
export type VendorTaskSource = (typeof VENDOR_TASK_SOURCES)[number];

/** The single canonical Vendor CRM notes authority table (evolved in place). */
export const VENDOR_CRM_NOTES_TABLE = "vendor_internal_notes" as const;

/** The six Vendor CRM foundation tables (QF-MVP-30.1B). */
export const VENDOR_CRM_FOUNDATION_TABLES = [
  "vendor_crm_profiles",
  "vendor_contacts",
  "vendor_tags",
  "vendor_tag_assignments",
  "vendor_internal_notes",
  "vendor_tasks",
] as const;
export type VendorCrmFoundationTable = (typeof VENDOR_CRM_FOUNDATION_TABLES)[number];

/** Authoritative Core facts that CRM extension rows must NEVER own as columns.
 *  Consumed by the offline validator and any future CRM read model as the
 *  non-duplication contract. */
export const VENDOR_CRM_PROHIBITED_CORE_COLUMNS = [
  "is_verified",
  "verification_status",
  "verified",
  "is_enabled",
  "city",
  "service_area",
  "service_areas",
  "areas_covered",
  "service_categories",
  "categories",
  "package",
  "package_name",
  "package_status",
  "package_expires_at",
  "plan",
  "credits",
  "total_credits",
  "remaining_credits",
  "credit_balance",
  "eligibility",
  "is_eligible",
  "assignment_eligibility",
  "consent",
  "consent_status",
  "is_suppressed",
  "suppression",
  "suppressed",
  "communication_authorization",
] as const;

export function isVendorCrmProhibitedCoreColumn(name: string): boolean {
  return (VENDOR_CRM_PROHIBITED_CORE_COLUMNS as readonly string[]).includes(name);
}
