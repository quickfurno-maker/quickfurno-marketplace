// ============================================================================
// QuickFurno — lib/auth/hookDeadline.ts   (Phase 5F-B, server-only)
//
// TOTAL DEADLINE PROTECTION for a Supabase HTTP Auth Hook execution.
//
// A verified hook now does real work before it can even reach the network: signature
// verification → payload parsing → runtime provider selection → automation
// operational gate → runtime policy lookup → provider account lookup → canary lookup
// → mapping lookup → ledger insert → dispatch claim → FINAL runtime gate → binding →
// provider HTTP call → ledger result update → hook response.
//
// A FIXED provider timeout sized close to the whole hook window is therefore unsafe:
// by the time the network call starts, most of the window is already spent, and an
// adapter that then waits its full configured timeout blows the hook budget. Supabase
// gives up, the user sees a failed login, and — worst of all — the outcome of the
// in-flight OTP send is unknown.
//
// So the verified path establishes a MONOTONIC total deadline up front, reserves time
// to finalize the response, and the dispatcher shortens the auth network timeout to
// whatever safe budget actually remains:
//
//     remaining = totalBudget − (now − startedAt) − responseReserve
//     effective = min(configured WHATSAPP_AUTH_HTTP_TIMEOUT_MS, remaining)
//
// If `remaining` is already below the minimum viable network budget, the dispatcher
// FAILS LOCALLY before any provider request: zero provider calls, a deterministic
// `failed` message, and never `outcome_unknown` (no request was ever initiated).
//
// This is NOT a Promise.race. A race rejects the waiter but leaves the request
// running; the shortened timeout is handed to the adapter, which aborts the ACTUAL
// request with an AbortController/AbortSignal.
// ============================================================================

import { effectiveRequestTimeoutMs } from "../communication/httpTransport";

/**
 * The conservative total window we assume a Supabase HTTP Auth Hook has. It is
 * deliberately smaller than Supabase's own ceiling: overrunning it is a user-visible
 * auth failure, while finishing early costs nothing.
 */
export const AUTH_HOOK_TOTAL_BUDGET_MS = 5000;

/**
 * Reserved for everything that must still happen AFTER the provider returns: the
 * ledger result update, outcome mapping, and writing the HTTP response.
 */
export const AUTH_HOOK_RESPONSE_RESERVE_MS = 750;

/**
 * Below this, a network attempt is not worth starting: it would almost certainly be
 * aborted mid-flight, producing an `outcome_unknown` message (a possible silent OTP
 * delivery) instead of a clean local failure. Matches AUTH_TIMEOUT_MIN_MS.
 */
export const MIN_VIABLE_AUTH_NETWORK_BUDGET_MS = 500;

/** Ledger-safe failure code for a deadline that is spent before the network call. */
export const AUTH_NETWORK_DEADLINE_EXHAUSTED = "AUTH_NETWORK_DEADLINE_EXHAUSTED";

export const AUTH_NETWORK_DEADLINE_MESSAGE =
  "The authentication hook budget was exhausted before a provider request could be started; no provider request was made.";

/** A monotonic clock: unaffected by wall-clock jumps, NTP steps, or DST. */
export type MonotonicClock = () => number;

export function monotonicNowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * The remaining budget a caller may spend on the network, established once at the
 * start of the verified hook path and re-read immediately before the provider call.
 */
export interface AuthNetworkDeadline {
  readonly totalBudgetMs: number;
  readonly responseReserveMs: number;
  /** Re-evaluated on every call against the monotonic clock. May be ≤ 0. */
  remainingNetworkBudgetMs(): number;
}

/** PURE: the budget arithmetic, isolated from any clock. */
export function computeRemainingNetworkBudgetMs(input: {
  readonly startedAtMs: number;
  readonly nowMs: number;
  readonly totalBudgetMs: number;
  readonly responseReserveMs: number;
}): number {
  const elapsedMs = Math.max(0, input.nowMs - input.startedAtMs);
  return input.totalBudgetMs - elapsedMs - input.responseReserveMs;
}

/** PURE: is there enough left to be worth opening a socket? */
export function isViableAuthNetworkBudget(remainingMs: number): boolean {
  return Number.isFinite(remainingMs) && remainingMs >= MIN_VIABLE_AUTH_NETWORK_BUDGET_MS;
}

export type AuthNetworkTimeoutResolution =
  | { readonly ok: true; readonly timeoutMs: number }
  | { readonly ok: false; readonly reason: typeof AUTH_NETWORK_DEADLINE_EXHAUSTED };

/**
 * PURE: the effective auth network timeout — never above the configured value, never
 * above the remaining safe budget. Fails closed when the budget is already spent.
 */
export function resolveAuthNetworkTimeoutMs(
  configuredTimeoutMs: number,
  remainingBudgetMs: number
): AuthNetworkTimeoutResolution {
  if (!isViableAuthNetworkBudget(remainingBudgetMs)) {
    return { ok: false, reason: AUTH_NETWORK_DEADLINE_EXHAUSTED };
  }
  return { ok: true, timeoutMs: effectiveRequestTimeoutMs(configuredTimeoutMs, remainingBudgetMs) };
}

export interface AuthHookDeadlineOptions {
  readonly totalBudgetMs?: number;
  readonly responseReserveMs?: number;
  /** Injectable monotonic clock (tests only); production uses {@link monotonicNowMs}. */
  readonly now?: MonotonicClock;
}

/**
 * Start the total deadline. Call this ONCE, at the beginning of the verified hook
 * execution path, and thread the result through the dispatch.
 */
export function startAuthHookDeadline(options: AuthHookDeadlineOptions = {}): AuthNetworkDeadline {
  const totalBudgetMs = options.totalBudgetMs ?? AUTH_HOOK_TOTAL_BUDGET_MS;
  const responseReserveMs = options.responseReserveMs ?? AUTH_HOOK_RESPONSE_RESERVE_MS;
  const now = options.now ?? monotonicNowMs;
  const startedAtMs = now();
  return {
    totalBudgetMs,
    responseReserveMs,
    remainingNetworkBudgetMs: () =>
      computeRemainingNetworkBudgetMs({
        startedAtMs,
        nowMs: now(),
        totalBudgetMs,
        responseReserveMs,
      }),
  };
}
