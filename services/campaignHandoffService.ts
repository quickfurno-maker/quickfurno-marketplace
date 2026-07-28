// ============================================================================
// QF-MVP-30.5C1 — Campaign execution handoff service boundary (SERVER ONLY).
//
// SERVER ONLY: imports `server-only` and the service_role adminClient — it must
// NEVER be imported by a client component.
//
// WHAT THIS IS
//   One thin, authorized wrapper around the ALREADY-COMMITTED database authority
//   `qf_handoff_vendor_campaign_intents_v1` (migration 20260728001500, hardened
//   by 20260728001600). It requests a decision. It does not reproduce one.
//
// WHAT THIS IS NOT
//   Creating a communication intent is NOT sending. This module calls no
//   provider, no Meta, no WhatsApp, no n8n, no SMS, no email and no webhook; it
//   sets no provider message id, claims no delivery, and retries no uncertain
//   provider outcome. QF-MVP-40 owns Meta transport and QF-MVP-50 owns n8n
//   execution.
//
// AUTHORITY STAYS IN CORE
//   Approval, frozen audience, current evidence, current consent/suppression,
//   frequency policy, idempotency and audit are all decided INSIDE the RPC,
//   under its own locks. This service supplies only the campaign identity, the
//   expected revision, a bounded batch size and an idempotency key. It never
//   supplies a destination, an aggregate type, a policy id, a fingerprint, or a
//   pre-computed consent or suppression result — the RPC's signature does not
//   accept them, which is what makes bypass impossible rather than merely
//   discouraged.
//
// A LATER PHASE MUST STILL RE-CHECK
//   Consent and suppression are re-read at handoff time, but they can change
//   afterwards. Whatever eventually dispatches MUST revalidate consent and
//   suppression immediately before contacting a provider. A `pending` intent is
//   permission to EVALUATE, never permission to send.
// ============================================================================

import "server-only";
import { adminClient } from "../lib/supabase";

function db() { return adminClient(); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raised for expected, admin-facing conditions. NEVER carries a DB message. */
export class HandoffServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HandoffServiceError";
  }
}

/**
 * Deterministic RPC codes -> fixed administrator-facing text.
 * Every code below is one the committed RPC can actually return. An unrecognised
 * code maps to generic text rather than leaking a raw database string.
 */
export const HANDOFF_CODE_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "That request was not valid.",
  BATCH_LIMIT_OUT_OF_RANGE: "The batch size must be between 1 and 500.",
  CAMPAIGN_NOT_FOUND: "That campaign could not be found.",
  CAMPAIGN_CANCELLED: "This campaign was cancelled and can no longer hand off.",
  CAMPAIGN_ARCHIVED: "This campaign was archived and can no longer hand off.",
  CAMPAIGN_NOT_APPROVED: "Only an approved campaign can hand off. Prepare and approve it first.",
  REVISION_MISMATCH: "This campaign changed in another window. Reload and try again.",
  PREPARED_EVIDENCE_INCOMPLETE:
    "This campaign's frozen evidence is incomplete. Return it to draft and prepare again.",
  SEGMENT_MISSING: "The source segment no longer exists. Return to draft and prepare again.",
  SEGMENT_ARCHIVED: "The source segment has been archived. Return to draft and prepare again.",
  SEGMENT_EVIDENCE_MISMATCH:
    "The source segment changed after this audience was frozen. Return to draft and prepare again.",
  TEMPLATE_MISSING: "The selected template no longer exists.",
  TEMPLATE_NOT_USABLE: "The selected template is disabled and cannot back a campaign.",
  TEMPLATE_VERSION_MISMATCH:
    "The template version changed after this audience was frozen. Return to draft and prepare again.",
  TEMPLATE_CATEGORY_MISMATCH: "A marketing campaign requires a marketing-category template.",
  TEMPLATE_FINGERPRINT_MISMATCH:
    "The selected template changed after this audience was frozen. Return to draft and prepare again.",
  TEMPLATE_FINGERPRINT_UNAVAILABLE:
    "The selected template could not be fingerprinted, so this campaign cannot be verified.",
  SNAPSHOT_COUNT_MISMATCH:
    "The frozen audience no longer matches its recorded size. Return to draft and prepare again.",
  SNAPSHOT_FINGERPRINT_MISMATCH:
    "The frozen audience no longer matches its recorded fingerprint. Return to draft and prepare again.",
  SNAPSHOT_ORDINAL_INVALID:
    "The frozen audience is not internally consistent and cannot be trusted. Return to draft and prepare again.",
  // -- the fail-closed frequency gate ---------------------------------------
  FREQUENCY_POLICY_NOT_CONFIGURED:
    "No active communication frequency policy exists for this channel and purpose. "
    + "An administrator must publish one before any campaign can hand off.",
  FREQUENCY_POLICY_AMBIGUOUS:
    "More than one active frequency policy matches this channel and purpose. "
    + "Retire the duplicate before handing off.",
  HANDOFF_FAILED: "That handoff could not be completed.",
};

function serviceError(code: string): HandoffServiceError {
  return new HandoffServiceError(
    code, HANDOFF_CODE_MESSAGES[code] ?? "That handoff could not be completed.");
}
function rpcError(code: unknown): HandoffServiceError {
  const key = typeof code === "string"
    && Object.prototype.hasOwnProperty.call(HANDOFF_CODE_MESSAGES, code)
    ? code : "HANDOFF_FAILED";
  return serviceError(key);
}
function requireUuid(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw serviceError("CAMPAIGN_NOT_FOUND");
  return v;
}

/** The RPC itself range-checks 1..500; this keeps an obviously bad value from
 *  ever reaching it and keeps the UI's default explicit rather than implicit. */
export const HANDOFF_BATCH_MIN = 1;
export const HANDOFF_BATCH_MAX = 500;
export const HANDOFF_BATCH_DEFAULT = 100;
function boundedBatch(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < HANDOFF_BATCH_MIN || n > HANDOFF_BATCH_MAX) {
    throw serviceError("BATCH_LIMIT_OUT_OF_RANGE");
  }
  return n;
}

export type HandoffCounts = {
  considered: number;
  created: number;
  existing: number;
  skippedConsent: number;
  skippedSuppressed: number;
  skippedFrequency: number;
  skippedDestination: number;
  batchLimit: number;
};

export type HandoffOutcome = {
  ok: true;
  code: "HANDOFF_COMPLETE";
  counts: HandoffCounts;
  /** created + existing + every exclusion === considered. Proven, not assumed. */
  reconciled: boolean;
  /** True when the bounded batch was filled, so another page may remain. */
  mayHaveMore: boolean;
};

const int = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Ask Core to turn an APPROVED campaign's frozen audience into provider-neutral
 * communication intents. Sends nothing.
 *
 * @param actorId derived from the authorized session by the caller — NEVER from
 *        client input. It is recorded as provenance only; it grants no authority,
 *        because the RPC re-derives every decision itself.
 */
export async function handoffCampaignIntents(
  campaignId: string,
  expectedRevision: number,
  actorId: string,
  options: { batchLimit?: unknown } = {},
): Promise<HandoffOutcome> {
  const id = requireUuid(campaignId);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw serviceError("REVISION_MISMATCH");
  }
  const batchLimit = boundedBatch(options.batchLimit ?? HANDOFF_BATCH_DEFAULT);

  const { data: rpc, error } = await db().rpc("qf_handoff_vendor_campaign_intents_v1", {
    p_campaign_id: id,
    p_expected_revision: expectedRevision,
    p_actor_id: actorId,
    p_batch_limit: batchLimit,
    // Stable per (campaign, revision, batch size): a repeated click is a replay
    // the database recognises, not a second logical operation. Recipient-level
    // uniqueness is enforced independently by uq_communication_intents_idempotency.
    p_idempotency_key: `campaign_handoff:${id}:${expectedRevision}:${batchLimit}`,
  });
  if (error) throw serviceError("HANDOFF_FAILED");

  const r = rpc as Record<string, unknown> | null;
  if (!r || r.ok !== true) throw rpcError(r?.code);

  const counts: HandoffCounts = {
    considered: int(r.considered),
    created: int(r.created),
    existing: int(r.existing),
    skippedConsent: int(r.skipped_consent),
    skippedSuppressed: int(r.skipped_suppressed),
    skippedFrequency: int(r.skipped_frequency),
    skippedDestination: int(r.skipped_destination),
    batchLimit: int(r.batch_limit) || batchLimit,
  };
  const accounted = counts.created + counts.existing + counts.skippedConsent
    + counts.skippedSuppressed + counts.skippedFrequency + counts.skippedDestination;

  return {
    ok: true,
    code: "HANDOFF_COMPLETE",
    counts,
    reconciled: accounted === counts.considered,
    mayHaveMore: counts.considered >= counts.batchLimit,
  };
}

// ---------------------------------------------------------------------------
// Readiness — what the operator sees BEFORE acting
// ---------------------------------------------------------------------------

export type HandoffReadiness = {
  campaignStatus: string | null;
  isApproved: boolean;
  frozenRecipientCount: number | null;
  channel: string | null;
  consentScope: string | null;
  /** Whether an ACTIVE matching frequency policy exists RIGHT NOW. */
  hasActivePolicy: boolean;
  /** Non-secret description of the active policy, for operator confidence. */
  activePolicy: { maxPerWindow: number; windowLength: string; minInterval: string } | null;
  /** Fail-closed: false whenever anything above would refuse the handoff. */
  canHandOff: boolean;
  blockedReason: string | null;
};

export async function getHandoffReadiness(campaignId: string): Promise<HandoffReadiness> {
  const id = requireUuid(campaignId);
  const { data: campaign, error } = await db()
    .from("vendor_campaigns")
    .select("status, channel, consent_scope, prepared_recipient_count")
    .eq("id", id)
    .maybeSingle();
  if (error) throw serviceError("HANDOFF_FAILED");
  if (!campaign) throw serviceError("CAMPAIGN_NOT_FOUND");

  const c = campaign as {
    status: string | null; channel: string | null;
    consent_scope: string | null; prepared_recipient_count: number | null;
  };
  const isApproved = c.status === "approved";

  let hasActivePolicy = false;
  let activePolicy: HandoffReadiness["activePolicy"] = null;
  if (c.channel && c.consent_scope) {
    const { data: pol } = await db()
      .from("communication_frequency_policies")
      .select("max_per_window, window_length, min_interval")
      .eq("channel", c.channel)
      .eq("scope", c.consent_scope)
      .eq("is_active", true);
    // Exactly one active row is representable per (channel, scope) — the partial
    // unique index guarantees it — so more than one here is a fail-closed signal.
    if (Array.isArray(pol) && pol.length === 1) {
      const p = pol[0] as { max_per_window: number; window_length: string; min_interval: string };
      hasActivePolicy = true;
      activePolicy = {
        maxPerWindow: p.max_per_window,
        windowLength: String(p.window_length),
        minInterval: String(p.min_interval),
      };
    }
  }

  const blockedReason = !isApproved
    ? HANDOFF_CODE_MESSAGES.CAMPAIGN_NOT_APPROVED
    : !hasActivePolicy
      ? HANDOFF_CODE_MESSAGES.FREQUENCY_POLICY_NOT_CONFIGURED
      : null;

  return {
    campaignStatus: c.status,
    isApproved,
    frozenRecipientCount: c.prepared_recipient_count,
    channel: c.channel,
    consentScope: c.consent_scope,
    hasActivePolicy,
    activePolicy,
    canHandOff: isApproved && hasActivePolicy,
    blockedReason,
  };
}

// ---------------------------------------------------------------------------
// Intent visibility — the MINIMUM needed to operate the campaign workflow
// ---------------------------------------------------------------------------
//
// Deliberately NOT the QF-MVP-70 operations dashboard. There is no provider
// send/retry control and no status override: `communication_intents.status` is
// owned by the canonical lifecycle, not by this admin surface. `recipient_ref`
// is an opaque sha256 reference, never a destination, and no phone or email is
// selected here at all.

export type CampaignIntentSummary = {
  total: number;
  byStatus: Record<string, number>;
  latestCreatedAt: string | null;
  aggregateType: "vendor_campaign";
};

export async function getCampaignIntentSummary(campaignId: string): Promise<CampaignIntentSummary> {
  const id = requireUuid(campaignId);
  const { data, error } = await db()
    .from("communication_intents")
    .select("status, created_at")
    .eq("aggregate_type", "vendor_campaign")
    .eq("aggregate_id", id);
  if (error) throw serviceError("HANDOFF_FAILED");

  const rows = (data ?? []) as { status: string; created_at: string }[];
  const byStatus: Record<string, number> = {};
  let latest: string | null = null;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (!latest || r.created_at > latest) latest = r.created_at;
  }
  return { total: rows.length, byStatus, latestCreatedAt: latest, aggregateType: "vendor_campaign" };
}
