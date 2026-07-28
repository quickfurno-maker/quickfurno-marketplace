// ============================================================================
// QF-MVP-30.5C1 — Communication frequency policy operator boundary (SERVER ONLY).
//
// SERVER ONLY: imports `server-only` and the service_role adminClient — it must
// NEVER be imported by a client component. The browser never writes to this
// table directly; anon and authenticated hold no privilege on it at all.
//
// THE DATABASE IS THE AUTHORITY, NOT THIS FILE
//   Migration 20260728001600 makes policy history durable:
//     * DELETE and TRUNCATE are refused by trigger AND revoked from every role,
//       including service_role — so this module HAS no delete path to write;
//     * identity, channel, scope, thresholds, window and effective_from are
//       frozen by trg_cfp_history_immutable, so a "correction" is impossible and
//       a changed rule must be a NEW row;
//     * retirement is one-way and effective_to is write-once;
//     * a partial unique index allows at most ONE active policy per
//       (channel, scope).
//   This service therefore relies on those guarantees rather than re-checking
//   them in application code, and surfaces their refusals as typed results.
//
// NO DEFAULT IS EVER CHOSEN HERE
//   The threshold and window are a business decision. Nothing in this file
//   supplies, suggests or falls back to a value; every field must arrive from
//   explicit operator input. While no active policy exists, campaign handoff
//   returns FREQUENCY_POLICY_NOT_CONFIGURED and no campaign can send.
// ============================================================================

import "server-only";
import { adminClient } from "../lib/supabase";

function db() { return adminClient(); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FrequencyPolicyServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "FrequencyPolicyServiceError";
  }
}

export const POLICY_CODE_MESSAGES: Record<string, string> = {
  POLICY_NOT_FOUND: "That frequency policy could not be found.",
  POLICY_INVALID_INPUT: "Every field is required and must be within the allowed range.",
  POLICY_CHANNEL_INVALID: "Choose a supported channel.",
  POLICY_SCOPE_INVALID: "Choose a supported purpose.",
  POLICY_THRESHOLD_INVALID: "The maximum per window must be a whole number between 0 and 1000.",
  POLICY_WINDOW_INVALID: "The window must be a whole number of hours between 1 and 8760 (365 days).",
  POLICY_INTERVAL_INVALID: "The minimum gap must be a whole number of hours between 0 and 8760.",
  POLICY_REFERENCE_INVALID: "Provide a reference between 3 and 200 characters recording who approved this rule.",
  POLICY_EFFECTIVE_RANGE_INVALID: "The end of the effective period must be after its start.",
  POLICY_DUPLICATE_ACTIVE:
    "An active policy already exists for that channel and purpose. Retire it before publishing a new one.",
  POLICY_ALREADY_RETIRED: "That policy is already retired.",
  POLICY_HISTORY_IMMUTABLE:
    "A published policy cannot be edited. Retire it and publish a new version instead.",
  POLICY_WRITE_FAILED: "That policy change could not be completed.",
};

function policyError(code: string): FrequencyPolicyServiceError {
  return new FrequencyPolicyServiceError(
    code, POLICY_CODE_MESSAGES[code] ?? "That policy change could not be completed.");
}

/** Mirrors the committed CHECK vocabularies — this service never widens them. */
export const POLICY_CHANNELS = ["whatsapp", "sms", "email", "dashboard"] as const;
export const POLICY_SCOPES = ["transactional", "marketing"] as const;
export const POLICY_MAX_PER_WINDOW_LIMIT = 1000;
export const POLICY_MAX_HOURS = 8760; // 365 days, matching cfp_window_length_check

export type FrequencyPolicyRow = {
  id: string;
  channel: string;
  scope: string;
  minInterval: string;
  maxPerWindow: number;
  windowLength: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  policyReference: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function toRow(r: Record<string, unknown>): FrequencyPolicyRow {
  return {
    id: String(r.id),
    channel: String(r.channel),
    scope: String(r.scope),
    minInterval: String(r.min_interval),
    maxPerWindow: Number(r.max_per_window),
    windowLength: String(r.window_length),
    isActive: r.is_active === true,
    effectiveFrom: String(r.effective_from),
    effectiveTo: r.effective_to ? String(r.effective_to) : null,
    policyReference: String(r.policy_reference),
    createdBy: r.created_by ? String(r.created_by) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const SELECT_COLS =
  "id, channel, scope, min_interval, max_per_window, window_length, is_active,"
  + " effective_from, effective_to, policy_reference, created_by, created_at, updated_at";

/** Full history, newest first. Retired rows are RETAINED and shown, never hidden. */
export async function listFrequencyPolicies(): Promise<FrequencyPolicyRow[]> {
  const { data, error } = await db()
    .from("communication_frequency_policies")
    .select(SELECT_COLS)
    .order("is_active", { ascending: false })
    .order("effective_from", { ascending: false })
    .limit(200);
  if (error) throw policyError("POLICY_WRITE_FAILED");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toRow);
}

// -- input validation --------------------------------------------------------
// Bounds mirror the committed CHECK constraints. Nothing here defaults: an
// absent or non-numeric field is an error, never a substituted value.

function requireWholeNumber(v: unknown, min: number, max: number, code: string): number {
  if (v === null || v === undefined || v === "") throw policyError(code);
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw policyError(code);
  return n;
}

export type CreateFrequencyPolicyInput = {
  channel: unknown;
  scope: unknown;
  maxPerWindow: unknown;
  windowHours: unknown;
  minIntervalHours: unknown;
  policyReference: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
};

/**
 * Publish a NEW explicit policy version.
 *
 * There is no "update" counterpart by design: migration 1600 freezes the meaning
 * of a published row, so a changed rule is always a new row after the current one
 * is retired.
 */
export async function createFrequencyPolicy(
  input: CreateFrequencyPolicyInput,
  actorId: string,
): Promise<FrequencyPolicyRow> {
  const channel = String(input.channel ?? "");
  const scope = String(input.scope ?? "");
  if (!(POLICY_CHANNELS as readonly string[]).includes(channel)) throw policyError("POLICY_CHANNEL_INVALID");
  if (!(POLICY_SCOPES as readonly string[]).includes(scope)) throw policyError("POLICY_SCOPE_INVALID");

  const maxPerWindow = requireWholeNumber(input.maxPerWindow, 0, POLICY_MAX_PER_WINDOW_LIMIT,
    "POLICY_THRESHOLD_INVALID");
  const windowHours = requireWholeNumber(input.windowHours, 1, POLICY_MAX_HOURS, "POLICY_WINDOW_INVALID");
  const minIntervalHours = requireWholeNumber(input.minIntervalHours, 0, POLICY_MAX_HOURS,
    "POLICY_INTERVAL_INVALID");

  const policyReference = String(input.policyReference ?? "").trim();
  if (policyReference.length < 3 || policyReference.length > 200) {
    throw policyError("POLICY_REFERENCE_INVALID");
  }

  const effectiveFrom = input.effectiveFrom ? String(input.effectiveFrom) : null;
  const effectiveTo = input.effectiveTo ? String(input.effectiveTo) : null;
  if (effectiveFrom && effectiveTo && !(new Date(effectiveTo) > new Date(effectiveFrom))) {
    throw policyError("POLICY_EFFECTIVE_RANGE_INVALID");
  }

  const payload: Record<string, unknown> = {
    channel,
    scope,
    max_per_window: maxPerWindow,
    window_length: `${windowHours} hours`,
    min_interval: `${minIntervalHours} hours`,
    is_active: true,
    policy_reference: policyReference,
    created_by: actorId,
  };
  if (effectiveFrom) payload.effective_from = effectiveFrom;
  if (effectiveTo) payload.effective_to = effectiveTo;

  const { data, error } = await db()
    .from("communication_frequency_policies")
    .insert(payload)
    .select(SELECT_COLS)
    .single();

  if (error) {
    // 23505 on the partial unique index is the canonical "one active per
    // (channel, scope)" refusal — surfaced as guidance, never as a raw error.
    if ((error as { code?: string }).code === "23505") throw policyError("POLICY_DUPLICATE_ACTIVE");
    throw policyError("POLICY_WRITE_FAILED");
  }
  return toRow(data as unknown as Record<string, unknown>);
}

/**
 * Retire an active policy through the ONLY transition the database permits:
 * is_active true -> false with effective_to stamped once. There is deliberately
 * no reactivate and no delete — 1600 refuses both.
 */
export async function retireFrequencyPolicy(policyId: string): Promise<FrequencyPolicyRow> {
  if (typeof policyId !== "string" || !UUID_RE.test(policyId)) throw policyError("POLICY_NOT_FOUND");

  const { data: current, error: readErr } = await db()
    .from("communication_frequency_policies")
    .select("id, is_active, effective_to")
    .eq("id", policyId)
    .maybeSingle();
  if (readErr) throw policyError("POLICY_WRITE_FAILED");
  if (!current) throw policyError("POLICY_NOT_FOUND");
  if ((current as { is_active: boolean }).is_active !== true) throw policyError("POLICY_ALREADY_RETIRED");

  const existingTo = (current as { effective_to: string | null }).effective_to;
  const patch: Record<string, unknown> = { is_active: false, updated_at: new Date().toISOString() };
  // effective_to is write-once: only stamp it when it is not already set.
  if (!existingTo) patch.effective_to = new Date().toISOString();

  const { data, error } = await db()
    .from("communication_frequency_policies")
    .update(patch)
    .eq("id", policyId)
    .eq("is_active", true)
    .select(SELECT_COLS)
    .single();

  if (error) {
    // The immutability trigger raises check_violation (23514) for anything that
    // would rewrite history.
    if ((error as { code?: string }).code === "23514") throw policyError("POLICY_HISTORY_IMMUTABLE");
    throw policyError("POLICY_WRITE_FAILED");
  }
  return toRow(data as unknown as Record<string, unknown>);
}
