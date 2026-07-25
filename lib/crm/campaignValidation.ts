// ============================================================================
// QF-MVP-30.4 — campaign validation and evidence canonicalization (PURE).
//
// PURE and offline: no DB, no `server-only`, no secret, no network — so the
// campaign rules are executed directly by the offline validator, exactly as the
// segment rule engine is.
//
// LOCKED PROPERTIES
//  * lifecycle transitions come from the closed CAMPAIGN_TRANSITIONS table;
//  * a marketing campaign may only pin a marketing-category template;
//  * prepared/approval evidence is complete-or-refused (fail closed);
//  * the snapshot fingerprint is computed over the ORDERED recipient set, so a
//    reordered or altered audience yields a different fingerprint;
//  * every prohibited field (destination, provider, execution state, frequency
//    policy, AI score) is refused with an explicit reason;
//  * exclusion summaries are closed-vocabulary code -> count maps: no vendor
//    ids, no free text, no PII.
// ============================================================================

import { createHash } from "node:crypto";
import {
  CAMPAIGN_STATUSES, CAMPAIGN_TRANSITIONS, CAMPAIGN_PURPOSES, CAMPAIGN_CHANNELS,
  CAMPAIGN_CONSENT_SCOPES, TEMPLATE_CATEGORIES, TEMPLATE_READINESS,
  INCLUDABLE_CONSENT_DISPOSITIONS, SUPPRESSION_REASONS, CAMPAIGN_EXCLUSION_REASONS,
  CAMPAIGN_PROHIBITED_FIELDS, CAMPAIGN_MAX_NAME_LENGTH, CAMPAIGN_MAX_DESCRIPTION_LENGTH,
  CAMPAIGN_MAX_AUDIENCE, CAMPAIGN_MAX_EXCLUSION_SUMMARY_BYTES,
  CAMPAIGN_MAX_TEMPLATE_KEY_LENGTH, CAMPAIGN_MAX_TEMPLATE_VERSION_LENGTH,
  type CampaignStatus, type CampaignPurpose, type CampaignChannel,
  type CampaignConsentScope, type TemplateCategory,
} from "./campaignContracts";

export class CampaignValidationError extends Error {
  readonly code = "CAMPAIGN_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "CampaignValidationError";
  }
}
const bad = (m: string): never => {
  throw new CampaignValidationError(m);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Refuse a prohibited field by NAME with its reason, before any other check. */
function rejectProhibited(input: Record<string, unknown>, label: string): void {
  for (const k of Object.keys(input)) {
    const why = CAMPAIGN_PROHIBITED_FIELDS[k];
    if (why) bad(`${label}: field "${k}" is not permitted — ${why}`);
  }
}
function requireKnownKeys(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  rejectProhibited(input, label);
  for (const k of Object.keys(input)) {
    if (!allowed.includes(k)) bad(`${label}: unknown field "${k}"`);
  }
}
function reqText(v: unknown, label: string, max: number): string {
  if (typeof v !== "string") return bad(`${label} is required`);
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length === 0) return bad(`${label} is required`);
  if (t.length > max) return bad(`${label} is too long (max ${max})`);
  return t;
}
function inSet<T extends readonly string[]>(v: unknown, set: T, label: string): T[number] {
  return typeof v === "string" && (set as readonly string[]).includes(v)
    ? (v as T[number]) : bad(`${label} is invalid`);
}

// -- draft campaign -----------------------------------------------------------
export interface CampaignDraftInput {
  readonly name: string;
  readonly description: string | null;
  readonly purpose: CampaignPurpose;
  readonly channel: CampaignChannel;
  readonly consent_scope: CampaignConsentScope;
  readonly segment_id: string | null;
  readonly template_key: string | null;
  readonly template_version: string | null;
}
const DRAFT_KEYS = ["name", "description", "purpose", "channel", "consent_scope",
  "segment_id", "template_key", "template_version"];

/** Validate a draft campaign. Actor, status, revision and evidence are NEVER
 *  taken from here — they are server/RPC-owned. */
export function validateCampaignDraft(input: Record<string, unknown>): CampaignDraftInput {
  if (!isPlainObject(input)) return bad("campaign must be an object");
  requireKnownKeys(input, DRAFT_KEYS, "campaign");
  return {
    name: reqText(input.name, "name", CAMPAIGN_MAX_NAME_LENGTH),
    description: input.description === undefined || input.description === null || input.description === ""
      ? null : reqText(input.description, "description", CAMPAIGN_MAX_DESCRIPTION_LENGTH),
    purpose: inSet(input.purpose, CAMPAIGN_PURPOSES, "purpose"),
    channel: input.channel === undefined ? "whatsapp" : inSet(input.channel, CAMPAIGN_CHANNELS, "channel"),
    consent_scope: inSet(input.consent_scope, CAMPAIGN_CONSENT_SCOPES, "consent_scope"),
    segment_id: input.segment_id === undefined || input.segment_id === null ? null
      : (typeof input.segment_id === "string" && UUID_RE.test(input.segment_id)
        ? input.segment_id.toLowerCase() : bad("segment_id must be a uuid")),
    template_key: input.template_key === undefined || input.template_key === null ? null
      : reqText(input.template_key, "template_key", CAMPAIGN_MAX_TEMPLATE_KEY_LENGTH),
    template_version: input.template_version === undefined || input.template_version === null ? null
      : reqText(input.template_version, "template_version", CAMPAIGN_MAX_TEMPLATE_VERSION_LENGTH),
  };
}

/** Case/whitespace-insensitive live-name key, mirroring uq_vendor_campaigns_live_name. */
export function normalizeCampaignNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// -- lifecycle ----------------------------------------------------------------
export function isLegalCampaignTransition(from: unknown, to: unknown): boolean {
  if (typeof from !== "string" || typeof to !== "string") return false;
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(from)) return false;
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(to)) return false;
  return CAMPAIGN_TRANSITIONS[from as CampaignStatus].includes(to as CampaignStatus);
}
export function requireCampaignTransition(from: unknown, to: unknown): void {
  if (!isLegalCampaignTransition(from, to)) {
    bad(`illegal campaign lifecycle transition ${String(from)} -> ${String(to)}`);
  }
}
/** A ready_for_review campaign must be explicitly returned to draft before edit. */
export function requireEditableCampaign(status: unknown): void {
  if (status !== "draft") {
    bad(`a campaign may only be edited while draft (current: ${String(status)}); return it to draft first`);
  }
}

// -- template evidence --------------------------------------------------------
export interface TemplateEvidence {
  readonly template_key: string;
  readonly template_version: string;
  readonly template_category: TemplateCategory;
  readonly readiness_status: (typeof TEMPLATE_READINESS)[number];
}
const TEMPLATE_KEYS = ["template_key", "template_version", "template_category", "readiness_status"];

export function validateTemplateEvidence(input: Record<string, unknown>): TemplateEvidence {
  if (!isPlainObject(input)) return bad("template evidence must be an object");
  requireKnownKeys(input, TEMPLATE_KEYS, "template");
  const readiness = inSet(input.readiness_status, TEMPLATE_READINESS, "readiness_status");
  if (readiness === "disabled") bad("a disabled template may not back a campaign");
  return {
    template_key: reqText(input.template_key, "template_key", CAMPAIGN_MAX_TEMPLATE_KEY_LENGTH),
    template_version: reqText(input.template_version, "template_version", CAMPAIGN_MAX_TEMPLATE_VERSION_LENGTH),
    template_category: inSet(input.template_category, TEMPLATE_CATEGORIES, "template_category"),
    readiness_status: readiness,
  };
}

/** A marketing campaign may only pin a marketing-category template. */
export function requireTemplateMatchesConsentScope(
  consentScope: unknown, templateCategory: unknown,
): void {
  const scope = inSet(consentScope, CAMPAIGN_CONSENT_SCOPES, "consent_scope");
  const category = inSet(templateCategory, TEMPLATE_CATEGORIES, "template_category");
  if (scope === "marketing" && category !== "marketing") {
    bad("a marketing campaign requires a marketing-category template");
  }
}

// -- frozen audience evidence --------------------------------------------------
export interface CampaignRecipient {
  readonly vendor_id: string;
  readonly consent_disposition: (typeof INCLUDABLE_CONSENT_DISPOSITIONS)[number];
  readonly consent_reason_code: string;
  readonly consent_policy_version: string;
  readonly suppression_reason: (typeof SUPPRESSION_REASONS)[number];
}
const RECIPIENT_KEYS = ["vendor_id", "consent_disposition", "consent_reason_code",
  "consent_policy_version", "suppression_reason"];

/** Validate and normalize the ORDERED recipient set frozen at prepare. */
export function validateCampaignRecipients(input: unknown): CampaignRecipient[] {
  if (!Array.isArray(input)) return bad("recipients must be a list");
  if (input.length === 0) bad("a prepared audience must contain at least one recipient");
  if (input.length > CAMPAIGN_MAX_AUDIENCE) {
    bad(`a prepared audience accepts at most ${CAMPAIGN_MAX_AUDIENCE} recipients`);
  }
  const seen = new Set<string>();
  return input.map((raw, i) => {
    if (!isPlainObject(raw)) return bad(`recipients[${i}] must be an object`);
    requireKnownKeys(raw, RECIPIENT_KEYS, `recipients[${i}]`);
    const vendorId = typeof raw.vendor_id === "string" && UUID_RE.test(raw.vendor_id)
      ? raw.vendor_id.toLowerCase() : bad(`recipients[${i}].vendor_id must be a uuid`);
    if (seen.has(vendorId)) bad(`recipients[${i}]: duplicate vendor in a single snapshot`);
    seen.add(vendorId);
    return {
      vendor_id: vendorId,
      consent_disposition: inSet(raw.consent_disposition, INCLUDABLE_CONSENT_DISPOSITIONS, `recipients[${i}].consent_disposition`),
      consent_reason_code: reqText(raw.consent_reason_code, `recipients[${i}].consent_reason_code`, 64),
      consent_policy_version: reqText(raw.consent_policy_version, `recipients[${i}].consent_policy_version`, 40),
      suppression_reason: raw.suppression_reason === undefined
        ? "none" : inSet(raw.suppression_reason, SUPPRESSION_REASONS, `recipients[${i}].suppression_reason`),
    };
  });
}

/**
 * Snapshot fingerprint over the ORDERED recipient set.
 * Order is part of the identity: the frozen audience has a fixed ordinal, so a
 * reordering is a different snapshot and must produce a different fingerprint.
 */
export function fingerprintCampaignSnapshot(recipients: readonly CampaignRecipient[]): string {
  const canonical = JSON.stringify(recipients.map((r, i) => ({
    ordinal: i,
    vendor_id: r.vendor_id,
    consent_disposition: r.consent_disposition,
    consent_reason_code: r.consent_reason_code,
    consent_policy_version: r.consent_policy_version,
    suppression_reason: r.suppression_reason,
  })));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Sanitized exclusion summary: closed reason codes -> non-negative counts. */
export function validateExclusionSummary(input: unknown): Record<string, number> {
  if (input === undefined || input === null) return {};
  if (!isPlainObject(input)) return bad("exclusion_summary must be an object");
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!(CAMPAIGN_EXCLUSION_REASONS as readonly string[]).includes(k)) {
      bad(`exclusion_summary: unknown reason code "${k}"`);
    }
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 0) bad(`exclusion_summary.${k} must be a non-negative integer`);
    out[k] = n;
  }
  // deterministic key order so the stored JSON is stable.
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  if (Buffer.byteLength(JSON.stringify(sorted), "utf8") > CAMPAIGN_MAX_EXCLUSION_SUMMARY_BYTES) {
    bad("exclusion_summary is too large");
  }
  return sorted;
}

// -- prepare / approve evidence ------------------------------------------------
export interface PreparedEvidence {
  readonly segment_id: string;
  readonly segment_definition_version: number;
  readonly segment_definition_fingerprint: string;
  readonly template: TemplateEvidence;
  readonly recipients: CampaignRecipient[];
  readonly snapshot_fingerprint: string;
  readonly recipient_count: number;
  readonly exclusion_summary: Record<string, number>;
}

/** Build the complete, fail-closed evidence bundle a prepare must supply. */
export function buildPreparedEvidence(input: Record<string, unknown>): PreparedEvidence {
  if (!isPlainObject(input)) return bad("prepared evidence must be an object");
  requireKnownKeys(input, ["segment_id", "segment_definition_version",
    "segment_definition_fingerprint", "template", "recipients", "exclusion_summary",
    "consent_scope"], "prepared");

  const segmentId = typeof input.segment_id === "string" && UUID_RE.test(input.segment_id)
    ? input.segment_id.toLowerCase() : bad("segment_id must be a uuid");
  const version = Number(input.segment_definition_version);
  if (!Number.isInteger(version) || version < 1) bad("segment_definition_version must be >= 1");
  const fingerprint = typeof input.segment_definition_fingerprint === "string"
    && SHA256_RE.test(input.segment_definition_fingerprint)
    ? input.segment_definition_fingerprint : bad("segment_definition_fingerprint must be sha256 hex");

  const template = validateTemplateEvidence((input.template ?? {}) as Record<string, unknown>);
  if (input.consent_scope !== undefined) {
    requireTemplateMatchesConsentScope(input.consent_scope, template.template_category);
  }
  const recipients = validateCampaignRecipients(input.recipients);
  return {
    segment_id: segmentId,
    segment_definition_version: version,
    segment_definition_fingerprint: fingerprint,
    template,
    recipients,
    snapshot_fingerprint: fingerprintCampaignSnapshot(recipients),
    recipient_count: recipients.length,
    exclusion_summary: validateExclusionSummary(input.exclusion_summary),
  };
}

export interface ApprovalCheckInput {
  readonly prepared_segment_version: number;
  readonly prepared_segment_fingerprint: string;
  readonly prepared_template_version: string;
  readonly prepared_template_category: string;
  readonly prepared_recipient_count: number;
  readonly snapshot_fingerprint: string;
  readonly current_segment_status: string | null;
  readonly current_segment_version: number | null;
  readonly current_segment_fingerprint: string | null;
  readonly current_template_version: string | null;
  readonly current_template_category: string | null;
  readonly current_template_readiness: string | null;
  readonly actual_member_count: number;
  readonly actual_snapshot_fingerprint: string;
}

/**
 * The locked fail-closed approval matrix. Returns a stable failure code, or null
 * when approval may proceed. Every divergence REFUSES — never "approve the best
 * available set".
 */
export function checkCampaignApproval(input: ApprovalCheckInput): string | null {
  if (input.current_segment_status === null || input.current_segment_version === null
      || input.current_segment_fingerprint === null) return "SEGMENT_MISSING";
  if (input.current_segment_status === "archived") return "SEGMENT_ARCHIVED";
  if (input.current_segment_version !== input.prepared_segment_version) return "SEGMENT_EVIDENCE_MISMATCH";
  if (input.current_segment_fingerprint !== input.prepared_segment_fingerprint) return "SEGMENT_EVIDENCE_MISMATCH";

  if (input.current_template_version === null || input.current_template_category === null
      || input.current_template_readiness === null) return "TEMPLATE_MISSING";
  if (input.current_template_readiness === "disabled") return "TEMPLATE_NOT_USABLE";
  if (input.current_template_version !== input.prepared_template_version) return "TEMPLATE_VERSION_MISMATCH";
  if (input.current_template_category !== input.prepared_template_category) return "TEMPLATE_CATEGORY_MISMATCH";

  if (input.actual_member_count !== input.prepared_recipient_count) return "SNAPSHOT_COUNT_MISMATCH";
  if (input.actual_snapshot_fingerprint !== input.snapshot_fingerprint) return "SNAPSHOT_FINGERPRINT_MISMATCH";
  return null;
}
