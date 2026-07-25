// ============================================================================
// QF-MVP-30.4 — campaign management contracts (PURE).
//
// Closed vocabularies and shapes for the campaign foundation. No DB access, no
// `server-only` import, no secret — safely importable by tests and (later) by
// client code that only needs the vocabulary for dropdowns.
//
// LOCKED PROPERTIES
//  * a campaign APPROVAL authorises an audience; it never sends;
//  * the audience is FROZEN at prepare, not at approval (owner decision 1);
//  * there is NO destination field of any kind — no phone, email, msisdn or
//    recipient_ref (owner decision 8). Destination resolution is a later
//    communication-execution concern;
//  * NO execution/send/delivery state exists here — those belong to 30.5;
//  * NO frequency-policy vocabulary exists: no frequency authority exists in
//    this codebase and 30.4 makes no such claim (owner decision 6).
// ============================================================================

/** The MVP campaign contract version. A bump is an explicit migration. */
export const CAMPAIGN_SCHEMA_VERSION = 1 as const;

/**
 * Locked lifecycle. The five execution states from blueprint §9
 * (EXECUTION_REQUESTED / RUNNING / PAUSED / COMPLETED / FAILED) are deliberately
 * ABSENT — QF-MVP-30.4 performs no execution.
 */
export const CAMPAIGN_STATUSES = [
  "draft",
  "ready_for_review",
  "approved",
  "cancelled",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** The only legal transitions. Anything absent here is refused. */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> =
  Object.freeze({
    draft: ["ready_for_review", "cancelled", "archived"],
    // an explicit RETURN TO DRAFT is required before a ready campaign may be edited.
    ready_for_review: ["draft", "approved", "cancelled"],
    approved: ["cancelled", "archived"],
    cancelled: ["archived"],
    archived: [],
  });

export const CAMPAIGN_PURPOSES = [
  "onboarding",
  "reactivation",
  "announcement",
  "retention",
  "support_followup",
] as const;
export type CampaignPurpose = (typeof CAMPAIGN_PURPOSES)[number];

/** MVP channel vocabulary. Widening is a later, separately reviewed decision. */
export const CAMPAIGN_CHANNELS = ["whatsapp"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const CAMPAIGN_CONSENT_SCOPES = ["transactional", "marketing"] as const;
export type CampaignConsentScope = (typeof CAMPAIGN_CONSENT_SCOPES)[number];

/** Mirrors the applied communication_templates category authority (30.4A widened). */
export const TEMPLATE_CATEGORIES = ["authentication", "business", "marketing"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Mirrors the applied communication_templates readiness authority. */
export const TEMPLATE_READINESS = [
  "draft", "mock_ready", "provider_mapping_required", "provider_ready", "disabled",
] as const;
export type TemplateReadiness = (typeof TEMPLATE_READINESS)[number];

/** Consent dispositions that MAY appear on a frozen (included) recipient. A
 *  blocked principal is never included — it is counted as an exclusion. */
export const INCLUDABLE_CONSENT_DISPOSITIONS = [
  "marketing_opted_in", "no_consent_objection", "unknown",
] as const;
export type IncludableConsentDisposition = (typeof INCLUDABLE_CONSENT_DISPOSITIONS)[number];

export const SUPPRESSION_REASONS = [
  "none", "global", "channel", "category", "vendor_request", "compliance",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** Closed exclusion reason vocabulary — the ONLY keys an exclusion summary may use. */
export const CAMPAIGN_EXCLUSION_REASONS = [
  "consent_blocked",
  "suppressed",
  "vendor_disabled",
  "vendor_unverified",
  "missing_contact_channel",
  "duplicate",
] as const;
export type CampaignExclusionReason = (typeof CAMPAIGN_EXCLUSION_REASONS)[number];

export const CAMPAIGN_EVENT_TYPES = [
  "created", "updated", "prepared", "returned_to_draft", "approved", "cancelled", "archived",
] as const;
export type CampaignEventType = (typeof CAMPAIGN_EVENT_TYPES)[number];

/** Stable, sanitized failure codes. Mirrors the RPC return codes exactly. */
export const CAMPAIGN_FAILURE_CODES = [
  "INVALID_INPUT",
  "CAMPAIGN_NOT_FOUND",
  "CAMPAIGN_NOT_DRAFT",
  "CAMPAIGN_NOT_READY",
  "CAMPAIGN_INCOMPLETE",
  "REVISION_MISMATCH",
  "SEGMENT_MISSING",
  "SEGMENT_ARCHIVED",
  "SEGMENT_EVIDENCE_MISMATCH",
  "TEMPLATE_MISSING",
  "TEMPLATE_NOT_USABLE",
  "TEMPLATE_VERSION_MISMATCH",
  "TEMPLATE_CATEGORY_MISMATCH",
  "PREPARED_EVIDENCE_INCOMPLETE",
  "SNAPSHOT_COUNT_MISMATCH",
  "SNAPSHOT_FINGERPRINT_MISMATCH",
  "EMPTY_AUDIENCE",
  "AUDIENCE_TOO_LARGE",
  "DUPLICATE_RECIPIENT",
  "INCOMPLETE_RECIPIENT_EVIDENCE",
  "INVALID_RECIPIENTS",
  "INVALID_SNAPSHOT_FINGERPRINT",
  "INVALID_EXCLUSION_SUMMARY",
  "ILLEGAL_TRANSITION",
] as const;
export type CampaignFailureCode = (typeof CAMPAIGN_FAILURE_CODES)[number];

// -- bounds -------------------------------------------------------------------
export const CAMPAIGN_MAX_NAME_LENGTH = 120;
export const CAMPAIGN_MAX_DESCRIPTION_LENGTH = 2000;
export const CAMPAIGN_MAX_AUDIENCE = 5000;
export const CAMPAIGN_MAX_EXCLUSION_SUMMARY_BYTES = 4096;
export const CAMPAIGN_MAX_EVENT_METADATA_BYTES = 2048;
export const CAMPAIGN_MAX_TEMPLATE_KEY_LENGTH = 120;
export const CAMPAIGN_MAX_TEMPLATE_VERSION_LENGTH = 40;

/**
 * Field names that are PERMANENTLY refused on any campaign or audience shape,
 * each with an explicit reason so a mistake fails loudly rather than silently
 * degrading to "unknown field".
 */
export const CAMPAIGN_PROHIBITED_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  phone: "a destination is never stored on the campaign foundation",
  email: "a destination is never stored on the campaign foundation",
  whatsapp_number: "a destination is never stored on the campaign foundation",
  msisdn: "a destination is never stored on the campaign foundation",
  destination: "a destination is never stored on the campaign foundation",
  recipient_ref: "destination resolution is a QF-MVP-30.5 execution concern",
  to_address: "a destination is never stored on the campaign foundation",
  provider_payload: "a provider payload never enters the campaign foundation",
  provider_account_id: "provider activation is out of QF-MVP-30.4 scope",
  access_token: "a secret never enters the campaign foundation",
  api_key: "a secret never enters the campaign foundation",
  send_status: "QF-MVP-30.4 has no execution state",
  dispatched_at: "QF-MVP-30.4 has no execution state",
  delivery_status: "QF-MVP-30.4 has no delivery state",
  communication_intent_id: "intent creation is a QF-MVP-30.5 concern",
  frequency_cap: "no frequency authority exists; QF-MVP-30.5 must define one before dispatch",
  frequency_policy_id: "no frequency authority exists; QF-MVP-30.5 must define one before dispatch",
  ai_score: "no AI ranking or scoring may enter a deterministic campaign",
});
