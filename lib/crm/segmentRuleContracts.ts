// ============================================================================
// QF-MVP-30.3 — deterministic vendor segment rule contracts (PURE).
//
// The closed registries the segment AST is allowed to reference. No DB access,
// no server-only import, no secret — this module is safely importable by tests
// and (later) by client code that only needs the vocabulary for dropdowns.
//
// LOCKED PROPERTIES
//  * a predicate field is a KEY from SEGMENT_FIELDS — never a raw column name;
//  * a predicate operator is a KEY from SEGMENT_OPERATORS;
//  * every string value is enum-bound, a uuid, or an integer — there is NO
//    free-text/LIKE/substring operator, so PostgREST pattern grammar can never
//    enter the segment evaluation path (owner decision 5);
//  * package-order / package-expiry predicates are OUT OF SCOPE (owner decision
//    4) and are not registered here;
//  * consent, suppression, communication authorization, campaign eligibility,
//    lead/assignment content and contact/note PII are NOT registered — a segment
//    must never look like a send-authorization.
// ============================================================================

/** The MVP rule contract version. A bump is an explicit migration, never implicit. */
export const SEGMENT_SCHEMA_VERSION = 1 as const;

/** All relative date windows resolve against this zone (see evaluation semantics). */
export const SEGMENT_TIMEZONE = "Asia/Kolkata" as const;

export const SEGMENT_MAX_GROUPS = 3;
export const SEGMENT_MAX_PREDICATES_PER_GROUP = 8;
export const SEGMENT_MAX_PREDICATES_TOTAL = 24;
export const SEGMENT_MAX_ARRAY_VALUES = 25;
export const SEGMENT_MAX_CANONICAL_BYTES = 8192;
export const SEGMENT_MAX_NAME_LENGTH = 120;
export const SEGMENT_MAX_DESCRIPTION_LENGTH = 2000;
export const SEGMENT_MIN_WINDOW_DAYS = 1;
export const SEGMENT_MAX_WINDOW_DAYS = 3650;

/** Value kinds a predicate may carry. */
export type SegmentValueKind =
  | "enum"        // one value from the field's closed vocabulary
  | "enum_array"  // a bounded set from that vocabulary
  | "integer"
  | "integer_pair"
  | "boolean"
  | "uuid"
  | "uuid_array"
  | "days"        // a bounded relative window in days
  | "none";       // is_null / is_not_null / is_true / is_false take no value

export const SEGMENT_OPERATORS = {
  eq: { valueKinds: ["enum", "integer", "uuid"] },
  neq: { valueKinds: ["enum", "integer", "uuid"] },
  in: { valueKinds: ["enum_array", "uuid_array"] },
  not_in: { valueKinds: ["enum_array", "uuid_array"] },
  lt: { valueKinds: ["integer"] },
  lte: { valueKinds: ["integer"] },
  gt: { valueKinds: ["integer"] },
  gte: { valueKinds: ["integer"] },
  between: { valueKinds: ["integer_pair"] },
  is_null: { valueKinds: ["none"] },
  is_not_null: { valueKinds: ["none"] },
  is_true: { valueKinds: ["none"] },
  is_false: { valueKinds: ["none"] },
  array_contains_any: { valueKinds: ["enum_array"] },
  array_contains_all: { valueKinds: ["enum_array"] },
  within_last_days: { valueKinds: ["days"] },
  older_than_days: { valueKinds: ["days"] },
} as const;

export type SegmentOperator = keyof typeof SEGMENT_OPERATORS;
export const SEGMENT_OPERATOR_KEYS = Object.keys(SEGMENT_OPERATORS) as SegmentOperator[];

/** Where a field's truth lives. CRM fields are owned here; core fields are READ-ONLY. */
export type SegmentFieldSource = "core" | "crm";

export interface SegmentFieldSpec {
  /** Which authority owns the fact. `core` is always read-only. */
  readonly source: SegmentFieldSource;
  /** The physical relation + column the compiler may target. Never taken from input. */
  readonly relation: string;
  readonly column: string;
  /** Operators legal for this field. */
  readonly operators: readonly SegmentOperator[];
  /** Closed vocabulary, when the field is enum-bound. */
  readonly values?: readonly string[];
  /**
   * Marks a field whose scalar values are uuids rather than enum members.
   * Explicit rather than inferred from the column name: an inferred rule would
   * silently mis-type any uuid field added later.
   */
  readonly uuidValued?: boolean;
  /** True when the field must be batch pre-resolved to a vendor-id set (no N+1). */
  readonly preResolved?: boolean;
  readonly description: string;
}

const VERIFICATION_STATUSES = ["Pending", "Approved", "Rejected", "Suspended"] as const;
const ONBOARDING_STAGES = ["new", "contacted", "onboarding", "active", "dormant", "churned"] as const;
const RELATIONSHIP_STATUSES = ["prospect", "active", "at_risk", "inactive", "blacklisted"] as const;
const RES_COM_SCOPES = ["residential", "commercial", "both"] as const;
const PUNE_MVP_CITIES = ["Pune"] as const;

/**
 * The closed field registry. A predicate's `field` MUST be a key here.
 *
 * `core.*` entries are read from the `vendors` row the directory read model
 * already selects — no new join, no Core write, no Core copy.
 * `crm.*` entries are CRM-owned.
 */
export const SEGMENT_FIELDS: Readonly<Record<string, SegmentFieldSpec>> = Object.freeze({
  // -- Core, read-only -------------------------------------------------------
  "core.status": {
    source: "core", relation: "vendors", column: "status",
    operators: ["eq", "neq", "in", "not_in"], values: VERIFICATION_STATUSES,
    description: "Core verification state (read-only).",
  },
  "core.is_active": {
    source: "core", relation: "vendors", column: "is_active",
    operators: ["is_true", "is_false"],
    description: "Core enabled/disabled state (read-only).",
  },
  "core.city": {
    source: "core", relation: "vendors", column: "city",
    operators: ["eq", "neq", "in", "not_in"], values: PUNE_MVP_CITIES,
    description: "Core city. Pune MVP vocabulary.",
  },
  "core.service_categories": {
    source: "core", relation: "vendors", column: "service_categories",
    operators: ["array_contains_any", "array_contains_all"],
    description: "Core service categories (read-only array).",
  },
  "core.areas_covered": {
    source: "core", relation: "vendors", column: "areas_covered",
    operators: ["array_contains_any", "array_contains_all"],
    description: "Core covered areas (read-only array).",
  },
  "core.covers_full_city": {
    source: "core", relation: "vendors", column: "covers_full_city",
    operators: ["is_true", "is_false"],
    description: "Core full-city coverage flag (read-only).",
  },
  "core.remaining_credits": {
    source: "core", relation: "vendors", column: "remaining_credits",
    operators: ["eq", "neq", "lt", "lte", "gt", "gte", "between"],
    description: "Core remaining credits, denormalized onto vendors by Core. READ ONLY — never written here.",
  },
  "core.total_credits": {
    source: "core", relation: "vendors", column: "total_credits",
    operators: ["eq", "neq", "lt", "lte", "gt", "gte", "between"],
    description: "Core lifetime credits (read-only).",
  },
  "core.last_assigned_at": {
    source: "core", relation: "vendors", column: "last_assigned_at",
    operators: ["is_null", "is_not_null", "within_last_days", "older_than_days"],
    description: "Core last lead-assignment timestamp (read-only). Inactivity windows only — no assignment content.",
  },
  "core.created_at": {
    source: "core", relation: "vendors", column: "created_at",
    operators: ["within_last_days", "older_than_days"],
    description: "Core vendor join date (read-only).",
  },

  // -- CRM-owned -------------------------------------------------------------
  "crm.onboarding_stage": {
    source: "crm", relation: "vendor_crm_profiles", column: "onboarding_stage",
    operators: ["eq", "neq", "in", "not_in", "is_null", "is_not_null"],
    values: ONBOARDING_STAGES, preResolved: true,
    description: "CRM onboarding stage.",
  },
  "crm.relationship_status": {
    source: "crm", relation: "vendor_crm_profiles", column: "relationship_status",
    operators: ["eq", "neq", "in", "not_in", "is_null", "is_not_null"],
    values: RELATIONSHIP_STATUSES, preResolved: true,
    description: "CRM relationship status.",
  },
  "crm.residential_commercial_scope": {
    source: "crm", relation: "vendor_crm_profiles", column: "residential_commercial_scope",
    operators: ["eq", "neq", "in", "not_in", "is_null", "is_not_null"],
    values: RES_COM_SCOPES, preResolved: true,
    description: "CRM residential/commercial scope (CRM preference, NOT Core eligibility).",
  },
  "crm.travel_radius_km": {
    source: "crm", relation: "vendor_crm_profiles", column: "travel_radius_km",
    operators: ["eq", "lt", "lte", "gt", "gte", "between", "is_null", "is_not_null"],
    preResolved: true,
    description: "CRM travel radius (CRM preference, NOT Core service-area truth).",
  },
  "crm.years_in_business": {
    source: "crm", relation: "vendor_crm_profiles", column: "years_in_business",
    operators: ["eq", "lt", "lte", "gt", "gte", "between", "is_null", "is_not_null"],
    preResolved: true,
    description: "CRM declared years in business (free-form enrichment, NOT verified Core truth).",
  },
  "crm.next_follow_up_at": {
    source: "crm", relation: "vendor_crm_profiles", column: "next_follow_up_at",
    operators: ["is_null", "is_not_null", "within_last_days", "older_than_days"],
    preResolved: true,
    description: "CRM next follow-up timestamp.",
  },
  "crm.last_interaction_at": {
    source: "crm", relation: "vendor_crm_profiles", column: "last_interaction_at",
    operators: ["is_null", "is_not_null", "within_last_days", "older_than_days"],
    preResolved: true,
    description: "CRM last interaction timestamp.",
  },
  "crm.tag_id": {
    source: "crm", relation: "vendor_tag_assignments", column: "tag_id",
    operators: ["eq", "in", "not_in"], preResolved: true, uuidValued: true,
    description: "Active tag assignment (removed_at is null). Referenced by tag id, never tag text.",
  },
  "crm.has_open_task": {
    source: "crm", relation: "vendor_tasks", column: "status",
    operators: ["is_true", "is_false"], preResolved: true,
    description: "Aggregate: the vendor has an open/in_progress task. Never task titles or descriptions.",
  },
  "crm.has_overdue_task": {
    source: "crm", relation: "vendor_tasks", column: "due_at",
    operators: ["is_true", "is_false"], preResolved: true,
    description: "Aggregate: the vendor has an open task past due. Never task content.",
  },
  "crm.has_active_primary_contact": {
    source: "crm", relation: "vendor_contacts", column: "is_primary",
    operators: ["is_true", "is_false"], preResolved: true,
    description: "Existence only. Contact name/phone/email are NEVER segment inputs.",
  },
});

export const SEGMENT_FIELD_KEYS = Object.keys(SEGMENT_FIELDS);

/**
 * Field-shaped names that are PERMANENTLY refused with an explicit reason, so a
 * mistake fails loudly instead of silently degrading to "unknown field".
 * Owner decisions 4 and 6, plus the consent/authorization boundary.
 */
export const SEGMENT_PROHIBITED_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  "core.package_expires_at": "package-expiry predicates are out of scope for the QF-MVP-30.3 MVP",
  "core.package_expiry_days": "package-expiry predicates are out of scope for the QF-MVP-30.3 MVP",
  "core.days_to_expiry": "package-expiry predicates are out of scope for the QF-MVP-30.3 MVP",
  "core.active_package": "there is no agreed 'active package' definition; out of scope for QF-MVP-30.3",
  "core.package_order_status": "package-order predicates are out of scope for the QF-MVP-30.3 MVP",
  "core.package_id": "package-order predicates are out of scope for the QF-MVP-30.3 MVP",
  "core.package_name": "package-order predicates are out of scope for the QF-MVP-30.3 MVP",
  "core.consent_status": "consent is Core authority and is re-checked at campaign approval, never a segment input",
  "core.is_suppressed": "suppression is Core authority and is re-checked at campaign approval, never a segment input",
  "core.suppression": "suppression is Core authority and is re-checked at campaign approval, never a segment input",
  "core.communication_authorization": "a segment must never look like a send-authorization",
  "core.campaign_eligibility": "campaign eligibility is decided by the Core recheck in QF-MVP-30.4",
  "core.is_eligible": "eligibility is Core authority, never a segment input",
  "core.lead_id": "lead content is never a segment input",
  "core.assignment_id": "assignment content is never a segment input",
  "core.gst_number": "KYC fields are never a segment input",
  "crm.contact_phone": "contact PII is never a segment input",
  "crm.contact_email": "contact PII is never a segment input",
  "crm.contact_name": "contact PII is never a segment input",
  "crm.note_body": "note bodies are never a segment input",
  "crm.capability_notes": "unbounded free text is never a segment input",
  "crm.campaign_notes": "unbounded free text is never a segment input",
  "crm.ai_score": "no AI scoring, ranking or prediction may enter a deterministic segment",
});

export const SEGMENT_COMBINATORS = ["AND", "OR"] as const;
export type SegmentCombinator = (typeof SEGMENT_COMBINATORS)[number];

export const SEGMENT_STATUSES = ["draft", "active", "archived"] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

// -- the canonical AST shape --------------------------------------------------
export interface SegmentPredicate {
  readonly field: string;
  readonly op: SegmentOperator;
  readonly value?: string | number | boolean | readonly (string | number)[];
}
export interface SegmentGroup {
  readonly combinator: SegmentCombinator;
  readonly predicates: readonly SegmentPredicate[];
}
export interface SegmentDefinition {
  readonly schema_version: typeof SEGMENT_SCHEMA_VERSION;
  readonly combinator: SegmentCombinator;
  readonly groups: readonly SegmentGroup[];
}
