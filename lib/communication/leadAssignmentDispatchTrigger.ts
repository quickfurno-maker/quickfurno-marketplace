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

/** The exact, closed shape this route may return. */
export interface SanitizedDispatchResponse {
  readonly ok: true;
  readonly selected: number;
  readonly dispatched: number;
  readonly refused: number;
  /** Whether selection produced nothing because it was fenced. NEVER the reason, never the instant. */
  readonly selectionBlocked: boolean;
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
  };
}
