// ============================================================================
// QuickFurno — lib/communication/leadAssignmentDispatchTrigger.ts
//
// QF-MVP-80.13B — the PURE trigger contract for the lead-assignment worker route.
//
// WHY THIS IS A MODULE AND NOT INLINE ROUTE CODE
//   The Phase 5F-D4-C consent worker inlines its secret check, its limit clamp
//   and its response projection. Copying those three into a second route would
//   put a second copy of SECURITY code in the tree, and the copy that is never
//   executed by a test is the copy that rots. So the same pattern — same header,
//   same env key, same timing-safe comparison, same status codes, same "counts
//   only" response — is stated ONCE here, where a harness can execute it for
//   real rather than assert about its source text.
//
// WHAT THIS IS NOT
//   It is not a dispatcher, a selector, a queue, a scheduler or an authority of
//   any kind. It contains no database access, no provider access, no template,
//   no consent rule and no activation boundary. It decides exactly three things:
//   whether a caller proved the shared secret, how big one bounded batch may be,
//   and which counts are safe to hand back. Everything else belongs to the
//   already-merged QF-MVP-80.13A stack and is re-derived inside Core on every run.
// ============================================================================

import { timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// The cron secret — identical shape to the consent-acknowledgement worker
// ---------------------------------------------------------------------------

export const CRON_SECRET_HEADER = "x-qf-cron-secret";
export const CRON_SECRET_ENV_KEY = "QF_CRON_SECRET";

/**
 * Constant-time comparison. Never short-circuits on the first differing byte.
 *
 * The LENGTH check is not a leak: `timingSafeEqual` throws on unequal lengths,
 * and the length of a shared secret is not the secret. The CONTENT comparison
 * is the part that must not leak, and it does not.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const CronSecretRefusal = Object.freeze({
  SERVER_SECRET_NOT_CONFIGURED: "worker secret not configured",
  MISSING_SECRET: "missing worker secret",
  INVALID_SECRET: "invalid worker secret",
} as const);

export type CronSecretCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * FAIL CLOSED, in all three directions:
 *   * an UNSET server secret is not "allow everyone" — it is a refusal;
 *   * an ABSENT caller secret is a refusal;
 *   * a WRONG caller secret is a refusal.
 *
 * The refusal message names the CLASS of failure and never the secret, never a
 * prefix of it, never its length and never any part of the expected value.
 */
export function evaluateCronSecret(input: {
  readonly expected: string | null | undefined;
  readonly provided: string | null | undefined;
}): CronSecretCheck {
  const expected = (input.expected ?? "").trim();
  const provided = (input.provided ?? "").trim();

  if (expected === "") {
    return { ok: false, message: CronSecretRefusal.SERVER_SECRET_NOT_CONFIGURED };
  }
  if (provided === "") {
    return { ok: false, message: CronSecretRefusal.MISSING_SECRET };
  }
  if (!secretsMatch(provided, expected)) {
    return { ok: false, message: CronSecretRefusal.INVALID_SECRET };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The ONE caller-influenceable value
// ---------------------------------------------------------------------------

export const DISPATCH_BATCH_MIN = 1;
export const DISPATCH_BATCH_MAX = 25;
export const DISPATCH_BATCH_DEFAULT = 25;

/**
 * `limit` is the ONLY thing a caller may influence, and it is clamped.
 *
 * There is deliberately no way to pass an intent id, an assignment id, a lead
 * id, a vendor id, a recipient, a phone number, a destination, a template, a
 * template purpose, a provider, a provider account, an activation boundary, a
 * retry count or a message id — none of those are parameters of this system, and
 * a body that carries them is simply ignored. Anything that is not a finite
 * integer falls back to the default bounded batch rather than failing the run.
 */
export function resolveDispatchLimit(body: unknown): number {
  const raw = (body as { limit?: unknown } | null | undefined)?.limit;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return DISPATCH_BATCH_DEFAULT;
  return Math.min(Math.max(raw, DISPATCH_BATCH_MIN), DISPATCH_BATCH_MAX);
}

// ---------------------------------------------------------------------------
// The response projection
// ---------------------------------------------------------------------------

/**
 * QF-MVP-80.16A — the operator-safe refusal vocabulary.
 *
 * WHY THIS EXISTS. The lane refused every dispatch of a real, already-charged
 * lead for an hour and the reason was computed and then thrown away: the run
 * summary carried `outcomes[]`, and this projection kept only four counters.
 * Production showed `selected=3 dispatched=0 refused=3` with no stderr, so the
 * actual cause was unobservable and had to be reconstructed from source reads.
 *
 * This is a CLOSED vocabulary, not a passthrough. Internal codes are mapped into
 * these buckets and anything unrecognised — including any code added later —
 * collapses to SEND_REFUSED_OTHER. Nothing derived from a lead, vendor,
 * assignment, destination or provider payload can reach an operator through it.
 */
export const DispatchRefusalCategory = Object.freeze({
  PLAN_INVALID: "PLAN_INVALID",
  ASSIGNMENT_LOOKUP_FAILED: "ASSIGNMENT_LOOKUP_FAILED",
  RECIPIENT_UNRESOLVED: "RECIPIENT_UNRESOLVED",
  RECIPIENT_DESTINATION_INVALID: "RECIPIENT_DESTINATION_INVALID",
  TEMPLATE_UNAVAILABLE: "TEMPLATE_UNAVAILABLE",
  TEMPLATE_CONFIGURATION_MISMATCH: "TEMPLATE_CONFIGURATION_MISMATCH",
  RUNTIME_PROVIDER_UNAVAILABLE: "RUNTIME_PROVIDER_UNAVAILABLE",
  OUTBOUND_PREFLIGHT_BLOCKED: "OUTBOUND_PREFLIGHT_BLOCKED",
  CONSENT_BLOCKED_OR_UNAVAILABLE: "CONSENT_BLOCKED_OR_UNAVAILABLE",
  SEND_REFUSED_OTHER: "SEND_REFUSED_OTHER",
} as const);

export type DispatchRefusalCategoryValue =
  (typeof DispatchRefusalCategory)[keyof typeof DispatchRefusalCategory];

/**
 * Internal code -> operator category. Only these exact strings are recognised;
 * the default is deliberately the opaque bucket, so a new internal code can
 * never leak its own text through this surface.
 */
const REFUSAL_CATEGORY_BY_CODE: Readonly<Record<string, DispatchRefusalCategoryValue>> = Object.freeze({
  INTENT_NOT_FOUND: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_IDENTITY_INVALID: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_NOT_LEAD_ASSIGNMENT: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_PURPOSE_UNSUPPORTED: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_CHANNEL_UNSUPPORTED: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_NOT_PENDING: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_CREATED_AT_INVALID: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_BEFORE_ACTIVATION_BOUNDARY: DispatchRefusalCategory.PLAN_INVALID,
  INTENT_EVIDENCE_INVALID: DispatchRefusalCategory.PLAN_INVALID,
  ACTIVATION_BOUNDARY_UNCONFIGURED: DispatchRefusalCategory.PLAN_INVALID,
  ACTIVATION_BOUNDARY_MALFORMED: DispatchRefusalCategory.PLAN_INVALID,
  VARIABLES_UNRESOLVED: DispatchRefusalCategory.PLAN_INVALID,

  ASSIGNMENT_NOT_FOUND: DispatchRefusalCategory.ASSIGNMENT_LOOKUP_FAILED,
  LEAD_REFERENCE_UNRESOLVED: DispatchRefusalCategory.ASSIGNMENT_LOOKUP_FAILED,
  LOOKUP_FAILED: DispatchRefusalCategory.ASSIGNMENT_LOOKUP_FAILED,

  VENDOR_UNRESOLVED: DispatchRefusalCategory.RECIPIENT_UNRESOLVED,
  RECIPIENT_NOT_FOUND: DispatchRefusalCategory.RECIPIENT_UNRESOLVED,
  RECIPIENT_TYPE_UNSUPPORTED: DispatchRefusalCategory.RECIPIENT_UNRESOLVED,
  RECIPIENT_REFERENCE_INVALID: DispatchRefusalCategory.RECIPIENT_UNRESOLVED,
  RECIPIENT_LOOKUP_FAILED: DispatchRefusalCategory.RECIPIENT_UNRESOLVED,
  RECIPIENT_DESTINATION_MISSING: DispatchRefusalCategory.RECIPIENT_DESTINATION_INVALID,
  RECIPIENT_DESTINATION_INVALID: DispatchRefusalCategory.RECIPIENT_DESTINATION_INVALID,

  TEMPLATE_NOT_FOUND_OR_INACTIVE: DispatchRefusalCategory.TEMPLATE_UNAVAILABLE,
  TEMPLATE_NOT_READY: DispatchRefusalCategory.TEMPLATE_UNAVAILABLE,
  TEMPLATE_LANE_MISMATCH: DispatchRefusalCategory.TEMPLATE_CONFIGURATION_MISMATCH,
  TEMPLATE_CHANNEL_MISMATCH: DispatchRefusalCategory.TEMPLATE_CONFIGURATION_MISMATCH,

  PROVIDER_UNAVAILABLE: DispatchRefusalCategory.RUNTIME_PROVIDER_UNAVAILABLE,

  COORDINATOR_UNAVAILABLE: DispatchRefusalCategory.OUTBOUND_PREFLIGHT_BLOCKED,

  SEND_REFUSED: DispatchRefusalCategory.SEND_REFUSED_OTHER,
});

/** Map ONE internal code onto the closed vocabulary. */
export function categorizeDispatchRefusal(code: unknown): DispatchRefusalCategoryValue {
  if (typeof code !== "string") return DispatchRefusalCategory.SEND_REFUSED_OTHER;
  const mapped = REFUSAL_CATEGORY_BY_CODE[code];
  if (mapped) return mapped;
  // Unrecognised codes are bucketed by PREFIX only — never by echoing the code.
  if (code.startsWith("OUTBOUND_") || code.startsWith("MAPPING_") || code.startsWith("CANARY_")) {
    return DispatchRefusalCategory.OUTBOUND_PREFLIGHT_BLOCKED;
  }
  if (code.startsWith("CONSENT_")) return DispatchRefusalCategory.CONSENT_BLOCKED_OR_UNAVAILABLE;
  if (code.startsWith("PHONE_")) return DispatchRefusalCategory.RECIPIENT_DESTINATION_INVALID;
  return DispatchRefusalCategory.SEND_REFUSED_OTHER;
}

/** The exact, closed shape this route may return. */
export interface SanitizedDispatchResponse {
  readonly ok: true;
  readonly selected: number;
  readonly dispatched: number;
  readonly refused: number;
  /** Whether selection produced nothing because it was fenced. NEVER the reason, never the instant. */
  readonly selectionBlocked: boolean;
  /**
   * Refusal COUNTS per operator category. Keys come only from
   * DispatchRefusalCategory; values are non-negative integers. Categories with
   * no refusals are omitted, so an all-clear run carries an empty object.
   */
  readonly refusalReasons: Readonly<Record<string, number>>;
}

/** The run summary shape QF-MVP-80.13A returns. Narrowed here, never widened. */
export interface DispatchRunSummaryLike {
  readonly selected?: unknown;
  readonly dispatched?: unknown;
  readonly refused?: unknown;
  readonly selectionRefusal?: unknown;
  readonly boundaryIso?: unknown;
  readonly outcomes?: unknown;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

/**
 * Project the run summary onto the four safe counters.
 *
 * This CONSTRUCTS a fresh object from named fields; it never spreads the
 * summary. That is the whole point: a future field added to
 * `LeadAssignmentDispatchRunSummary` — an id, a destination hash, a provider
 * name, a diagnostic blob — cannot reach a caller by default. It has to be
 * added here deliberately.
 *
 * `boundaryIso` and `selectionRefusal` are deliberately reduced to a single
 * boolean. An operator learns that selection was fenced; nobody learns WHEN the
 * activation boundary sits or WHY the fence closed.
 */
export function sanitizeDispatchSummary(
  summary: DispatchRunSummaryLike | null | undefined
): SanitizedDispatchResponse {
  return {
    ok: true,
    selected: count(summary?.selected),
    dispatched: count(summary?.dispatched),
    refused: count(summary?.refused),
    selectionBlocked:
      summary?.selectionRefusal !== null && summary?.selectionRefusal !== undefined,
    refusalReasons: summarizeRefusalReasons(summary),
  };
}

/**
 * Aggregate `outcomes[]` into category counts.
 *
 * Reads exactly two fields per outcome — `ok` and `reason` — and never copies
 * the outcome itself, so an intent id, an assignment id or any future
 * diagnostic field added to the outcome cannot travel with the count. A
 * selection-level refusal is counted too, because a fenced selection is a
 * refusal an operator needs categorised, not merely a boolean.
 */
function summarizeRefusalReasons(
  summary: DispatchRunSummaryLike | null | undefined
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  const bump = (category: DispatchRefusalCategoryValue) => {
    counts[category] = (counts[category] ?? 0) + 1;
  };

  const selectionRefusal = summary?.selectionRefusal;
  if (selectionRefusal !== null && selectionRefusal !== undefined) {
    bump(categorizeDispatchRefusal(selectionRefusal));
  }

  const outcomes = summary?.outcomes;
  if (Array.isArray(outcomes)) {
    for (const outcome of outcomes) {
      if (!outcome || typeof outcome !== "object") continue;
      const record = outcome as { ok?: unknown; reason?: unknown };
      if (record.ok === true) continue;
      bump(categorizeDispatchRefusal(record.reason));
    }
  }

  return counts;
}
