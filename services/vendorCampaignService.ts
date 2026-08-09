// ============================================================================
// QF-MVP-30.4C — Vendor Campaign service boundary (SERVER ONLY).
//
// SERVER ONLY: imports `server-only` and the service_role adminClient — it must
// NEVER be imported by a client component.
//
// LOCKED INVARIANTS
//  * writes touch ONLY vendor_campaigns / vendor_campaign_events, and the frozen
//    audience is written ONLY by qf_prepare_vendor_campaign_v1 — this service
//    never inserts, updates or deletes an audience row directly;
//  * there is NO delete method anywhere, and the DB grant withholds
//    DELETE/TRUNCATE from service_role regardless;
//  * FREEZE happens at prepare; APPROVAL never resolves or alters recipients;
//  * consent/suppression are read through the existing authority with BATCHED
//    dependencies — never a per-vendor database round trip, and never a second
//    implementation of the consent rules;
//  * NO communication intent is created, NO provider is called, NO template body
//    is rendered and NO frequency authority is consulted — none exists, and
//    until the QF-MVP-30.5 fail-closed frequency gate exists no campaign may
//    send. There is deliberately no send/dispatch/test-send path here;
//  * NO Core table is written: no vendor, package, credit, assignment,
//    eligibility, consent, preference or suppression write of any kind;
//  * no plaintext destination is ever stored or returned. A phone is read only
//    in-memory to compute the canonical destination hash the consent authority
//    requires, and is discarded with the request.
//
// EVENT PROVENANCE — stated honestly.
//  prepare and approve write head AND event atomically inside their SECURITY
//  DEFINER RPCs. The remaining transitions (create / update / return_to_draft /
//  cancel / archive) have no RPC, and PostgREST cannot span two statements in one
//  transaction, so they write the HEAD FIRST — which carries the authoritative
//  status, revision and *_by/*_at provenance — and then append a best-effort
//  event row. No atomicity is claimed that the schema cannot provide. Head-first
//  ordering means a failure can lose a trail line, but can NEVER produce an event
//  asserting a transition that did not happen.
// ============================================================================

import "server-only";
import { adminClient } from "../lib/supabase";
import { hashPhoneE164, normalizePhoneE164 } from "../lib/communication/phone";
import { decideCommunicationConsent } from "./communicationConsentDecisionService";
import { previewVendorSegment } from "./vendorSegmentService";
import {
  validateCampaignDraft, requireEditableCampaign, requireCampaignTransition,
  requireTemplateMatchesConsentScope, validateCampaignRecipients,
  fingerprintCampaignSnapshot, fingerprintCommunicationTemplate,
  normalizeCampaignNameKey,
  type CommunicationTemplateCatalogRow,
} from "../lib/crm/campaignValidation";
import {
  buildBatchConsentDeps, isIncludableDisposition, exclusionReasonFor,
  summarizeExclusions, orderPlannedRecipients, assertAudienceWithinBounds,
  INCLUDED_SUPPRESSION_REASON,
  type BatchPreferenceRow, type BatchSuppressionRow, type PlannedRecipient,
} from "../lib/crm/campaignAudiencePlan";
import {
  CAMPAIGN_MAX_AUDIENCE, CAMPAIGN_STATUSES, CAMPAIGN_CHANNELS,
  TEMPLATE_FINGERPRINT_FIELDS,
} from "../lib/crm/campaignContracts";

const CAMPAIGNS = "vendor_campaigns" as const;
const EVENTS = "vendor_campaign_events" as const;
const AUDIENCE = "vendor_campaign_audience_members" as const;

/** A profiles.id — always derived from the authorized session, never from input. */
type Actor = string;
function db() { return adminClient(); }

/** Raised for expected, admin-facing conditions. NEVER carries a DB message. */
export class CampaignServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CampaignServiceError";
  }
}

/**
 * Stable service/RPC codes -> fixed admin-facing text.
 * A code that is not recognised maps to generic text rather than leaking a raw
 * payload, SQLSTATE, column name or row value into the browser.
 */
export const CAMPAIGN_CODE_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "That request was not valid.",
  CAMPAIGN_NOT_FOUND: "That campaign could not be found.",
  CAMPAIGN_NOT_DRAFT: "This campaign is no longer a draft. Return it to draft first.",
  CAMPAIGN_NOT_READY: "This campaign is not ready for review.",
  CAMPAIGN_INCOMPLETE: "Select a segment and a template before preparing this campaign.",
  REVISION_MISMATCH: "This campaign changed in another window. Reload and try again.",
  SEGMENT_MISSING: "The source segment no longer exists. Return to draft and prepare again.",
  SEGMENT_ARCHIVED: "The source segment has been archived. Return to draft and prepare again.",
  SEGMENT_EVIDENCE_MISMATCH: "The source segment changed after this audience was frozen. Return to draft and prepare again.",
  TEMPLATE_MISSING: "The selected template no longer exists.",
  TEMPLATE_NOT_USABLE: "The selected template is disabled and cannot back a campaign.",
  TEMPLATE_VERSION_MISMATCH: "The template version changed after this audience was frozen. Return to draft and prepare again.",
  TEMPLATE_CATEGORY_MISMATCH: "A marketing campaign requires a marketing-category template.",
  PREPARED_EVIDENCE_INCOMPLETE: "This campaign's prepared evidence is incomplete. Return to draft and prepare again.",
  SNAPSHOT_COUNT_MISMATCH: "The frozen audience no longer matches its recorded size. Return to draft and prepare again.",
  SNAPSHOT_FINGERPRINT_MISMATCH: "The frozen audience no longer matches its recorded fingerprint. Return to draft and prepare again.",
  // -- QF-MVP-30.4C1 approval-evidence hardening -----------------------------
  SNAPSHOT_ORDINAL_INVALID: "The frozen audience is not internally consistent and cannot be trusted. Return to draft and prepare again.",
  SNAPSHOT_OWNERSHIP_MISMATCH: "The frozen audience does not belong to this campaign revision. Return to draft and prepare again.",
  TEMPLATE_FINGERPRINT_MISMATCH: "The selected template changed after this audience was frozen. Return to draft and prepare again.",
  TEMPLATE_FINGERPRINT_UNAVAILABLE: "The selected template could not be fingerprinted, so this campaign cannot be verified.",
  EMPTY_AUDIENCE: "No vendor currently qualifies for this campaign.",
  AUDIENCE_TOO_LARGE: "This audience is too large to freeze. Narrow the segment and try again.",
  DUPLICATE_RECIPIENT: "The resolved audience contained a duplicate vendor.",
  INCOMPLETE_RECIPIENT_EVIDENCE: "The resolved audience was missing consent evidence.",
  INVALID_RECIPIENTS: "The resolved audience was not valid.",
  INVALID_SNAPSHOT_FINGERPRINT: "The audience fingerprint was not valid.",
  INVALID_EXCLUSION_SUMMARY: "The exclusion summary was not valid.",
  ILLEGAL_TRANSITION: "That campaign lifecycle change is not permitted.",
  CAMPAIGN_NAME_TAKEN: "A live campaign with that name already exists.",
  CAMPAIGN_READ_FAILED: "That campaign information could not be loaded.",
  CAMPAIGN_WRITE_FAILED: "The campaign could not be saved.",
  CAMPAIGN_PREPARE_FAILED: "This campaign could not be prepared for review.",
  CAMPAIGN_APPROVE_FAILED: "This campaign could not be approved.",
};

function serviceError(code: string): CampaignServiceError {
  return new CampaignServiceError(
    code, CAMPAIGN_CODE_MESSAGES[code] ?? "That action could not be completed.");
}
/** Map a sanitized RPC failure code. An unknown code never reaches the browser verbatim. */
function rpcError(code: unknown): CampaignServiceError {
  const key = typeof code === "string"
    && Object.prototype.hasOwnProperty.call(CAMPAIGN_CODE_MESSAGES, code)
    ? code : "CAMPAIGN_WRITE_FAILED";
  return serviceError(key);
}

export interface VendorCampaignRow {
  id: string;
  name: string;
  description: string | null;
  purpose: string;
  channel: string;
  consent_scope: string;
  status: "draft" | "ready_for_review" | "approved" | "cancelled" | "archived";
  revision: number;
  segment_id: string | null;
  template_key: string | null;
  template_version: string | null;
  prepared_snapshot_id: string | null;
  prepared_snapshot_revision: number | null;
  prepared_segment_version: number | null;
  prepared_segment_fingerprint: string | null;
  prepared_template_version: string | null;
  prepared_template_fingerprint: string | null;
  prepared_template_category: string | null;
  audience_evaluated_at: string | null;
  prepared_recipient_count: number | null;
  snapshot_fingerprint: string | null;
  exclusion_summary: Record<string, number>;
  created_at: string;
  updated_at: string;
  prepared_at: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  approved_by: string | null;
}

export interface VendorCampaignListResult {
  rows: VendorCampaignRow[];
  page: number;
  pageSize: number;
  total: number;
}

const LIST_MAX_PAGE_SIZE = 100;
const LIST_DEFAULT_PAGE_SIZE = 20; // C-PERF1 locked admin directory page size
const AUDIENCE_PAGE_SIZE = 50;
const EVENT_SCAN_LIMIT = 100;
/** Bound on any helper read, so nothing materializes an unbounded set in memory. */
const HELPER_SCAN_LIMIT = 500;
/** The segment engine clamps a preview page to 100; candidate paging matches it. */
const CANDIDATE_PAGE_SIZE = 100;
/** Hard stop on candidate paging, plus one page to observe the end of the set. */
const CANDIDATE_MAX_PAGES = Math.ceil(CAMPAIGN_MAX_AUDIENCE / CANDIDATE_PAGE_SIZE) + 1;
/**
 * Identifiers per batched `in()` read.
 *
 * PostgREST selects travel as a GET query string, so a single `in()` carrying the
 * full 5000-strong audience would build a ~325 KB URL and be rejected outright.
 * Chunking keeps every evidence read BATCHED — 25 requests for a maximum audience
 * instead of 5000 — while staying far inside any URL limit.
 */
const BATCH_IN_SIZE = 200;
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

function requireUuid(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw serviceError("CAMPAIGN_NOT_FOUND");
  return v;
}
function boundedPage(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Best-effort provenance trail for the transitions that have no RPC.
 * The head is already written and is authoritative; a failure here loses a trail
 * line and must never be reported as a failure of the transition itself.
 */
async function appendEvent(input: {
  campaignId: string; eventType: string; campaignRevision: number;
  actorId: string; reasonCode: string; metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().from(EVENTS).insert({
      campaign_id: input.campaignId,
      event_type: input.eventType,
      campaign_revision: input.campaignRevision,
      actor_id: input.actorId,
      reason_code: input.reasonCode,
      metadata: input.metadata ?? {},
      // deterministic: a retried transition never double-writes the trail.
      event_idempotency_key: `${input.eventType}:${input.campaignId}:${input.campaignRevision}`,
    });
  } catch {
    // swallowed by design — see the header note on event provenance.
  }
}

// -- reads --------------------------------------------------------------------

/** Bounded, deterministically ordered campaign directory. */
export async function listVendorCampaigns(
  rawQuery: Record<string, unknown> = {},
): Promise<VendorCampaignListResult> {
  const page = boundedPage(rawQuery.page);
  const sizeRaw = Number(rawQuery.pageSize);
  const pageSize = Number.isInteger(sizeRaw) && sizeRaw >= 1
    ? Math.min(sizeRaw, LIST_MAX_PAGE_SIZE) : LIST_DEFAULT_PAGE_SIZE;

  let q = db().from(CAMPAIGNS).select("*", { count: "exact" });
  const status = rawQuery.status;
  // closed vocabulary only — a filter value never reaches PostgREST unchecked.
  if (typeof status === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(status)) {
    q = q.eq("status", status);
  }
  const from = (page - 1) * pageSize;
  // deterministic order with an id tie-breaker so paging is stable.
  q = q.order("updated_at", { ascending: false }).order("id", { ascending: true })
       .range(from, from + pageSize - 1);

  const { data, count, error } = await q;
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");
  return { rows: (data ?? []) as VendorCampaignRow[], page, pageSize, total: count ?? 0 };
}

export async function getVendorCampaign(campaignId: string): Promise<VendorCampaignRow | null> {
  const id = requireUuid(campaignId);
  const { data, error } = await db().from(CAMPAIGNS).select("*").eq("id", id).maybeSingle();
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");
  return (data as VendorCampaignRow) ?? null;
}

export interface CampaignAudienceMember {
  vendor_id: string;
  ordinal: number;
  business_name: string | null;
  consent_disposition: string;
  consent_reason_code: string;
  consent_policy_version: string;
  suppression_reason: string;
}

/**
 * The FROZEN audience for review. Returns vendor identity plus enum-coded consent
 * evidence and a business name for recognition — never a destination of any kind.
 * Reads one stored snapshot; it never re-resolves the segment.
 */
export async function getCampaignAudience(
  campaignId: string, snapshotId: string, paging: { page?: unknown } = {},
): Promise<{ rows: CampaignAudienceMember[]; total: number; page: number; pageSize: number }> {
  const id = requireUuid(campaignId);
  const snap = requireUuid(snapshotId);
  const page = boundedPage(paging.page);
  const from = (page - 1) * AUDIENCE_PAGE_SIZE;

  const { data, count, error } = await db().from(AUDIENCE)
    .select("vendor_id, ordinal, consent_disposition, consent_reason_code, consent_policy_version, suppression_reason",
      { count: "exact" })
    // both predicates: a snapshot id alone must never read across campaigns.
    .eq("campaign_id", id).eq("snapshot_id", snap)
    .order("ordinal", { ascending: true })
    .range(from, from + AUDIENCE_PAGE_SIZE - 1);
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");

  const rows = (data ?? []) as Record<string, unknown>[];
  // ONE batched name lookup for the page — never one query per member.
  const nameById = new Map<string, string | null>();
  const ids = rows.map((r) => r.vendor_id as string);
  if (ids.length > 0) {
    const { data: vendors } = await db().from("vendors").select("id, business_name").in("id", ids);
    for (const v of (vendors ?? []) as { id: string; business_name: string | null }[]) {
      nameById.set(v.id, v.business_name ?? null);
    }
  }

  return {
    rows: rows.map((r) => ({
      vendor_id: r.vendor_id as string,
      ordinal: r.ordinal as number,
      business_name: nameById.get(r.vendor_id as string) ?? null,
      consent_disposition: r.consent_disposition as string,
      consent_reason_code: r.consent_reason_code as string,
      consent_policy_version: r.consent_policy_version as string,
      suppression_reason: r.suppression_reason as string,
    })),
    total: count ?? 0,
    page,
    pageSize: AUDIENCE_PAGE_SIZE,
  };
}

/** The append-only provenance trail for one campaign, newest first. */
export async function listCampaignEvents(campaignId: string) {
  const id = requireUuid(campaignId);
  const { data, error } = await db().from(EVENTS)
    .select("id, event_type, campaign_revision, snapshot_revision, reason_code, metadata, occurred_at")
    .eq("campaign_id", id)
    .order("occurred_at", { ascending: false }).order("id", { ascending: true })
    .limit(EVENT_SCAN_LIMIT);
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");
  return data ?? [];
}

/** Templates an admin may pin, from the existing communication_templates authority. */
export async function listUsableTemplates() {
  const { data, error } = await db().from("communication_templates")
    .select("template_key, version, category, readiness_status, channel")
    .eq("is_active", true).neq("readiness_status", "disabled")
    .order("template_key", { ascending: true }).limit(HELPER_SCAN_LIMIT);
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");
  return data ?? [];
}

/** Segments an admin may target. An archived segment can never back a campaign. */
export async function listUsableSegments() {
  const { data, error } = await db().from("vendor_segments")
    .select("id, name, status, definition_version, definition_fingerprint")
    .neq("status", "archived")
    .order("name", { ascending: true }).limit(HELPER_SCAN_LIMIT);
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");
  return data ?? [];
}

// -- draft lifecycle ----------------------------------------------------------

/**
 * Friendly pre-check for a duplicate live name. ADVISORY ONLY —
 * uq_vendor_campaigns_live_name is the real guard, so every write path also maps
 * a 23505 unique violation to the same admin-facing message.
 */
async function liveNameTaken(name: string, exceptId?: string): Promise<boolean> {
  const { data, error } = await db().from(CAMPAIGNS)
    .select("id, name").neq("status", "archived").limit(HELPER_SCAN_LIMIT);
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");
  const key = normalizeCampaignNameKey(name);
  return (data ?? []).some((r: { id: string; name: string }) =>
    normalizeCampaignNameKey(r.name) === key && r.id !== exceptId);
}

export async function createVendorCampaign(input: Record<string, unknown>, actor: Actor) {
  const draft = validateCampaignDraft(input);
  if (await liveNameTaken(draft.name)) throw serviceError("CAMPAIGN_NAME_TAKEN");

  const { data, error } = await db().from(CAMPAIGNS).insert({
    name: draft.name,
    description: draft.description,
    purpose: draft.purpose,
    channel: draft.channel,
    consent_scope: draft.consent_scope,
    segment_id: draft.segment_id,
    template_key: draft.template_key,
    template_version: draft.template_version,
    status: "draft",
    revision: 1,
    created_by: actor,
    updated_by: actor,
  }).select("id, revision").single();
  if (isUniqueViolation(error)) throw serviceError("CAMPAIGN_NAME_TAKEN");
  if (error || !data) throw serviceError("CAMPAIGN_WRITE_FAILED");

  await appendEvent({
    campaignId: data.id, eventType: "created", campaignRevision: data.revision,
    actorId: actor, reasonCode: "created",
  });
  return { ok: true as const, id: data.id as string, revision: data.revision as number };
}

/**
 * Edit a DRAFT campaign under optimistic concurrency.
 *
 * A ready_for_review campaign must be explicitly returned to draft first; that
 * rule is enforced here, by the DB transition trigger, and by the prepare RPC.
 */
export async function updateVendorCampaign(
  campaignId: string, input: Record<string, unknown>, expectedRevision: number, actor: Actor,
) {
  const id = requireUuid(campaignId);
  const current = await getVendorCampaign(id);
  if (!current) throw serviceError("CAMPAIGN_NOT_FOUND");
  requireEditableCampaign(current.status);
  if (current.revision !== expectedRevision) throw serviceError("REVISION_MISMATCH");

  // An OMITTED field keeps its stored value; an EXPLICIT null clears it. Using
  // `??` for both would make a null indistinguishable from an omission, so a
  // segment or template could never be de-selected once chosen.
  const patched = <T>(next: unknown, stored: T) => (next === undefined ? stored : next);
  const draft = validateCampaignDraft({
    name: patched(input.name, current.name),
    description: patched(input.description, current.description),
    purpose: patched(input.purpose, current.purpose),
    channel: patched(input.channel, current.channel),
    consent_scope: patched(input.consent_scope, current.consent_scope),
    segment_id: patched(input.segment_id, current.segment_id),
    template_key: patched(input.template_key, current.template_key),
    template_version: patched(input.template_version, current.template_version),
  });
  if (draft.name !== current.name && await liveNameTaken(draft.name, id)) {
    throw serviceError("CAMPAIGN_NAME_TAKEN");
  }

  const nextRevision = current.revision + 1;
  const patch: Record<string, unknown> = {
    name: draft.name,
    description: draft.description,
    purpose: draft.purpose,
    channel: draft.channel,
    consent_scope: draft.consent_scope,
    segment_id: draft.segment_id,
    template_key: draft.template_key,
    template_version: draft.template_version,
    revision: nextRevision,
    updated_by: actor,
  };
  // A retained prepared_template_category describes the PREVIOUS definition. If
  // the scope or template just changed it no longer does, and leaving it in place
  // would trip vcm_marketing_requires_marketing_template on an otherwise legal
  // edit. The monotonic prepared_snapshot_revision is deliberately NOT cleared:
  // the prepare RPC derives the next snapshot revision from it, so clearing it
  // would let a later prepare reuse a revision number that already exists.
  if (draft.consent_scope !== current.consent_scope || draft.template_key !== current.template_key) {
    patch.prepared_template_category = null;
  }

  const { error } = await db().from(CAMPAIGNS).update(patch)
    // the revision predicate makes the update itself the concurrency guard.
    .eq("id", id).eq("revision", current.revision);
  if (isUniqueViolation(error)) throw serviceError("CAMPAIGN_NAME_TAKEN");
  if (error) throw serviceError("CAMPAIGN_WRITE_FAILED");

  await appendEvent({
    campaignId: id, eventType: "updated", campaignRevision: nextRevision,
    actorId: actor, reasonCode: "updated",
  });
  return { ok: true as const, revision: nextRevision };
}

/**
 * Explicit return to draft.
 *
 * Prepared evidence pointers are RETAINED: the prepare RPC computes the next
 * snapshot revision as coalesce(prepared_snapshot_revision, 0) + 1, so clearing
 * them would reset the numbering and let a new snapshot reuse an existing
 * revision. Prior audience rows and events are never touched — both tables are
 * append-only and immutable at the database layer.
 */
export async function returnCampaignToDraft(campaignId: string, expectedRevision: number, actor: Actor) {
  const id = requireUuid(campaignId);
  const current = await getVendorCampaign(id);
  if (!current) throw serviceError("CAMPAIGN_NOT_FOUND");
  requireCampaignTransition(current.status, "draft");
  if (current.revision !== expectedRevision) throw serviceError("REVISION_MISMATCH");

  const nextRevision = current.revision + 1;
  const { error } = await db().from(CAMPAIGNS)
    .update({ status: "draft", revision: nextRevision, updated_by: actor })
    .eq("id", id).eq("revision", current.revision);
  if (error) throw serviceError("CAMPAIGN_WRITE_FAILED");

  await appendEvent({
    campaignId: id, eventType: "returned_to_draft", campaignRevision: nextRevision,
    actorId: actor, reasonCode: "returned_to_draft",
  });
  return { ok: true as const, revision: nextRevision };
}

export async function cancelVendorCampaign(campaignId: string, expectedRevision: number, actor: Actor) {
  const id = requireUuid(campaignId);
  const current = await getVendorCampaign(id);
  if (!current) throw serviceError("CAMPAIGN_NOT_FOUND");
  requireCampaignTransition(current.status, "cancelled");
  if (current.revision !== expectedRevision) throw serviceError("REVISION_MISMATCH");

  const nextRevision = current.revision + 1;
  const { error } = await db().from(CAMPAIGNS).update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancelled_by: actor,
    revision: nextRevision,
    updated_by: actor,
  }).eq("id", id).eq("revision", current.revision);
  if (error) throw serviceError("CAMPAIGN_WRITE_FAILED");

  await appendEvent({
    campaignId: id, eventType: "cancelled", campaignRevision: nextRevision,
    actorId: actor, reasonCode: "cancelled",
  });
  return { ok: true as const, revision: nextRevision };
}

/** ARCHIVE — a lifecycle change. There is intentionally NO delete method. */
export async function archiveVendorCampaign(campaignId: string, expectedRevision: number, actor: Actor) {
  const id = requireUuid(campaignId);
  const current = await getVendorCampaign(id);
  if (!current) throw serviceError("CAMPAIGN_NOT_FOUND");
  requireCampaignTransition(current.status, "archived");
  if (current.revision !== expectedRevision) throw serviceError("REVISION_MISMATCH");

  const nextRevision = current.revision + 1;
  const { error } = await db().from(CAMPAIGNS).update({
    status: "archived",
    archived_at: new Date().toISOString(),
    archived_by: actor,
    revision: nextRevision,
    updated_by: actor,
  }).eq("id", id).eq("revision", current.revision);
  if (error) throw serviceError("CAMPAIGN_WRITE_FAILED");

  await appendEvent({
    campaignId: id, eventType: "archived", campaignRevision: nextRevision,
    actorId: actor, reasonCode: "archived",
  });
  return { ok: true as const, revision: nextRevision };
}

// -- dynamic preview (nothing is persisted) -----------------------------------

interface LiveSegment {
  id: string;
  status: string;
  definition: unknown;
  definition_version: number;
  definition_fingerprint: string;
}
async function loadLiveSegment(segmentId: string): Promise<LiveSegment> {
  const { data, error } = await db().from("vendor_segments")
    .select("id, status, definition, definition_version, definition_fingerprint")
    .eq("id", segmentId).maybeSingle();
  if (error) throw serviceError("CAMPAIGN_READ_FAILED");
  if (!data) throw serviceError("SEGMENT_MISSING");
  if (data.status === "archived") throw serviceError("SEGMENT_ARCHIVED");
  return data as LiveSegment;
}

/**
 * Who matches the source segment RIGHT NOW.
 *
 * This is the segment engine's CANDIDATE set — it is not the campaign audience.
 * No consent decision is applied here and nothing about it authorizes contacting
 * anyone. The audience only exists once prepare freezes it.
 */
export async function previewCampaignCandidates(campaignId: string, paging: { page?: unknown } = {}) {
  const id = requireUuid(campaignId);
  const campaign = await getVendorCampaign(id);
  if (!campaign) throw serviceError("CAMPAIGN_NOT_FOUND");
  if (!campaign.segment_id) throw serviceError("CAMPAIGN_INCOMPLETE");

  const segment = await loadLiveSegment(campaign.segment_id);
  const preview = await previewVendorSegment(segment.definition, { page: paging.page, pageSize: 20 }, {
    fingerprint: segment.definition_fingerprint,
    definitionVersion: segment.definition_version,
  });
  return {
    ...preview,
    segmentVersion: segment.definition_version,
    segmentFingerprint: segment.definition_fingerprint,
  };
}

/**
 * Page through the segment engine to collect the FULL bounded candidate set.
 *
 * Query count is ceil(candidates / 100), bounded by CANDIDATE_MAX_PAGES — never
 * one query per vendor. Paging is stable because the engine orders by
 * (created_at desc, id asc) over immutable columns; a vendor created mid-walk can
 * still surface twice, so ids are de-duplicated here and counted as a `duplicate`
 * exclusion rather than reaching the RPC, where a duplicate is a hard
 * DUPLICATE_RECIPIENT refusal of the whole freeze.
 */
async function resolveAllCandidates(definition: unknown): Promise<{
  vendorIds: string[]; duplicates: number;
}> {
  const seen = new Set<string>();
  let duplicates = 0;
  let fetched = 0;

  for (let page = 1; page <= CANDIDATE_MAX_PAGES; page += 1) {
    const res = await previewVendorSegment(definition, { page, pageSize: CANDIDATE_PAGE_SIZE }, {});
    for (const row of res.rows) {
      if (seen.has(row.vendor_id)) duplicates += 1;
      else seen.add(row.vendor_id);
    }
    fetched += res.rows.length;
    // fail closed on overflow — never silently truncate an audience.
    if (seen.size > CAMPAIGN_MAX_AUDIENCE) throw serviceError("AUDIENCE_TOO_LARGE");
    if (res.rows.length === 0 || fetched >= res.total) {
      return { vendorIds: [...seen], duplicates };
    }
  }
  // more pages remain than the bound permits: that is an oversized audience.
  throw serviceError("AUDIENCE_TOO_LARGE");
}

// -- prepare / freeze ---------------------------------------------------------

export interface PrepareResult {
  ok: true;
  replayed: boolean;
  snapshotId: string | null;
  snapshotRevision: number | null;
  recipientCount: number | null;
  revision: number | null;
  exclusionSummary: Record<string, number>;
}

/**
 * Resolve the audience against current facts and FREEZE it (draft ->
 * ready_for_review), atomically, through qf_prepare_vendor_campaign_v1.
 *
 * Query budget: 1 campaign + 1 segment + 1 template + ceil(candidates/100)
 * segment pages + 1 vendor batch + 2 consent-evidence batches + 1 RPC. The
 * per-vendor consent decision performs ZERO database I/O.
 */
export async function prepareCampaignForReview(
  campaignId: string, expectedRevision: number, actor: Actor,
): Promise<PrepareResult> {
  const id = requireUuid(campaignId);
  const campaign = await getVendorCampaign(id);
  if (!campaign) throw serviceError("CAMPAIGN_NOT_FOUND");
  if (campaign.status !== "draft") throw serviceError("CAMPAIGN_NOT_DRAFT");
  if (campaign.revision !== expectedRevision) throw serviceError("REVISION_MISMATCH");
  if (!campaign.segment_id || !campaign.template_key) throw serviceError("CAMPAIGN_INCOMPLETE");

  // 1. the live segment, pinned by version + fingerprint.
  const segment = await loadLiveSegment(campaign.segment_id);

  // 2. the template. The marketing rule is enforced here AND in the RPC.
  //    QF-MVP-30.4C1: every dispatch-critical catalog field is read, because the
  //    canonical template fingerprint is computed over all of them.
  const { data: template, error: templateError } = await db().from("communication_templates")
    .select(TEMPLATE_FINGERPRINT_FIELDS.join(", "))
    .eq("template_key", campaign.template_key).maybeSingle<CommunicationTemplateCatalogRow>();
  if (templateError) throw serviceError("CAMPAIGN_READ_FAILED");
  if (!template) throw serviceError("TEMPLATE_MISSING");
  if (template.is_active !== true || template.readiness_status === "disabled") {
    throw serviceError("TEMPLATE_NOT_USABLE");
  }
  requireTemplateMatchesConsentScope(campaign.consent_scope, template.category);

  // QF-MVP-30.4C1: the EXPECTED canonical template fingerprint. The database
  // recomputes its own from the authoritative row and refuses on divergence, so
  // this value is a cross-check — never the authority.
  const expectedTemplateFingerprint = fingerprintCommunicationTemplate(template);

  // 3. candidates from the deterministic segment engine (bounded, paged).
  const { vendorIds, duplicates } = await resolveAllCandidates(segment.definition);
  if (vendorIds.length === 0) throw serviceError("EMPTY_AUDIENCE");
  assertAudienceWithinBounds(vendorIds.length);

  // The channel drives BOTH the evidence batches and the consent decision; one
  // variable so the two can never diverge if the vocabulary widens later.
  const channel = campaign.channel;
  if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(channel)) throw serviceError("INVALID_INPUT");

  // 4. Core facts + canonical destination hashes. The phone is read ONLY to
  //    derive the hash the consent authority requires; it is never stored,
  //    returned or logged.
  interface VendorFacts { hash: string | null; enabled: boolean; verified: boolean }
  const facts = new Map<string, VendorFacts>();
  const hashes: string[] = [];
  for (const ids of chunk(vendorIds, BATCH_IN_SIZE)) {
    const { data: vendorRows, error: vendorError } = await db().from("vendors")
      .select("id, phone, is_active, status").in("id", ids);
    if (vendorError) throw serviceError("CAMPAIGN_READ_FAILED");
    for (const v of (vendorRows ?? []) as {
      id: string; phone: string | null; is_active: boolean | null; status: string | null;
    }[]) {
      // hashPhoneE164 is the ONE canonical hasher. A second implementation would
      // silently fail to match stored suppression rows, making a suppressed vendor
      // look eligible — so normalization is probed first and the same hasher reused.
      const normalized = normalizePhoneE164(v.phone);
      const hash = normalized.ok ? hashPhoneE164(v.phone as string) : null;
      if (hash) hashes.push(hash);
      facts.set(v.id, { hash, enabled: v.is_active === true, verified: v.status === "Approved" });
    }
  }

  // 5. The batched evidence reads — this is the whole N+1 boundary. Both are
  //    chunked by BATCH_IN_SIZE, so the request count scales with the audience
  //    divided by 200, never with the audience itself.
  const suppressionRows: BatchSuppressionRow[] = [];
  for (const batch of chunk(hashes, BATCH_IN_SIZE)) {
    const { data, error } = await db().from("communication_suppressions")
      .select("id, destination_hash, channel, scope, reason, policy_version, is_active, expires_at, deactivated_at")
      .in("destination_hash", batch)
      .eq("channel", channel).eq("is_active", true);
    if (error) throw serviceError("CAMPAIGN_READ_FAILED");
    suppressionRows.push(...((data ?? []) as BatchSuppressionRow[]));
  }

  const preferenceRows: BatchPreferenceRow[] = [];
  for (const batch of chunk(vendorIds, BATCH_IN_SIZE)) {
    const { data, error } = await db().from("communication_preferences")
      .select("id, principal_type, principal_id, channel, scope, state, policy_version, consented_at, withdrawn_at")
      .eq("principal_type", "vendor").in("principal_id", batch).eq("channel", channel);
    if (error) throw serviceError("CAMPAIGN_READ_FAILED");
    preferenceRows.push(...((data ?? []) as BatchPreferenceRow[]));
  }

  // ONE evaluation instant for the whole freeze — never a per-vendor now().
  const evaluatedAt = new Date();
  const deps = buildBatchConsentDeps(suppressionRows, preferenceRows, evaluatedAt);

  // 6. per-vendor decision through the SOLE consent authority, with zero I/O.
  const included: PlannedRecipient[] = [];
  const exclusions: string[] = [];
  for (let i = 0; i < duplicates; i += 1) exclusions.push("duplicate");

  const scope = campaign.consent_scope as "transactional" | "marketing";
  for (const vendorId of vendorIds) {
    const f = facts.get(vendorId);
    // a candidate with no readable vendor row is treated as unreachable, not as
    // a silent pass — the audience is only ever narrowed by missing evidence.
    if (!f || !f.hash) { exclusions.push("missing_contact_channel"); continue; }
    if (!f.enabled) { exclusions.push("vendor_disabled"); continue; }
    if (!f.verified) { exclusions.push("vendor_unverified"); continue; }

    const outcome = await decideCommunicationConsent({
      channel: channel as "whatsapp",
      scope,
      destinationHash: f.hash,
      identityConfidence: "exact",
      principal: { type: "vendor", id: vendorId },
      evaluatedAt,
    }, deps);

    // an authority lookup/integrity failure is NEVER a success: exclude.
    if (!outcome.ok) { exclusions.push("consent_blocked"); continue; }

    if (!isIncludableDisposition(outcome.disposition, scope)) {
      exclusions.push(exclusionReasonFor({
        hasUsableDestination: true, vendorEnabled: true, vendorVerified: true,
        disposition: outcome.disposition,
        suppressed: outcome.matchedSuppressionId !== null,
      }));
      continue;
    }
    included.push({
      vendor_id: vendorId,
      consent_disposition: outcome.disposition,
      consent_reason_code: outcome.reasonCode,
      consent_policy_version: String(outcome.policyVersion),
      // an included principal is, by construction, not suppressed.
      suppression_reason: INCLUDED_SUPPRESSION_REASON,
    });
  }

  if (included.length === 0) throw serviceError("EMPTY_AUDIENCE");
  assertAudienceWithinBounds(included.length);

  // 7. deterministic order, then the fingerprint over that exact order.
  const recipients = validateCampaignRecipients(orderPlannedRecipients(included));
  const snapshotFingerprint = fingerprintCampaignSnapshot(recipients);
  const exclusionSummary = summarizeExclusions(exclusions);

  // 8. FREEZE — atomically, and only through the locked RPC. The head, the
  //    audience rows and the 'prepared' event are written in ONE transaction.
  const { data: rpc, error } = await db().rpc("qf_prepare_vendor_campaign_v1", {
    p_campaign_id: id,
    p_expected_revision: expectedRevision,
    p_actor_id: actor,
    p_segment_version: segment.definition_version,
    p_segment_fingerprint: segment.definition_fingerprint,
    p_template_version: template.version,
    // QF-MVP-30.4C1: both fingerprints are EXPECTATIONS. The RPC recomputes each
    // one inside the database — from the inserted audience rows and from the
    // authoritative template row — stores only its own values, and rolls the
    // freeze back on any divergence.
    p_template_fingerprint: expectedTemplateFingerprint,
    p_recipients: recipients,
    p_snapshot_fingerprint: snapshotFingerprint,
    p_exclusion_summary: exclusionSummary,
    p_idempotency_key: `prepare:${id}:${expectedRevision}`,
  });
  if (error) throw serviceError("CAMPAIGN_PREPARE_FAILED");

  const result = rpc as {
    ok?: boolean; code?: string; replayed?: boolean; snapshot_id?: string;
    snapshot_revision?: number; recipient_count?: number; revision?: number;
  } | null;
  if (!result?.ok) throw rpcError(result?.code);

  return {
    ok: true,
    replayed: Boolean(result.replayed),
    snapshotId: result.snapshot_id ?? null,
    snapshotRevision: result.snapshot_revision ?? null,
    recipientCount: result.recipient_count ?? null,
    revision: result.revision ?? null,
    exclusionSummary,
  };
}

// -- approval -----------------------------------------------------------------

/**
 * Authorise an ALREADY-FROZEN audience (ready_for_review -> approved).
 *
 * Delegates entirely to qf_approve_vendor_campaign_v1, which re-checks the
 * segment, the template and the snapshot count under a row lock and fails closed
 * on any divergence. Approval never resolves or alters recipients, creates no
 * communication intent, renders no template and calls no provider — and there is
 * no frequency authority to consult. APPROVAL IS NOT A SEND.
 */
export async function approveVendorCampaign(campaignId: string, expectedRevision: number, actor: Actor) {
  const id = requireUuid(campaignId);
  const { data: rpc, error } = await db().rpc("qf_approve_vendor_campaign_v1", {
    p_campaign_id: id,
    p_expected_revision: expectedRevision,
    p_actor_id: actor,
    p_idempotency_key: `approve:${id}:${expectedRevision}`,
  });
  if (error) throw serviceError("CAMPAIGN_APPROVE_FAILED");

  const result = rpc as { ok?: boolean; code?: string; replayed?: boolean; revision?: number } | null;
  if (!result?.ok) throw rpcError(result?.code);
  return {
    ok: true as const,
    replayed: Boolean(result.replayed),
    revision: result.revision ?? null,
  };
}
