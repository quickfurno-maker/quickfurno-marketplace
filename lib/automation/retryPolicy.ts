// ============================================================================
// QuickFurno — QF-MVP-50.2D automation-owned retry timing
//
// Pure module: no database, network, environment, provider or clock I/O. The
// caller supplies the canonical `now`; nothing here reads a clock.
//
// WHY THIS IS NOT lib/aos/workflow/retryPolicy.ts
//   The AOS kernel helper answers a different question ("should this workflow
//   event retry, and when") and dead-letters at `attemptCount + 1 >= maxAttempts`.
//   The automation lane's dead-letter boundary lives in
//   qf_complete_automation_attempt_v1 and is `attempt_count >= max_attempts` —
//   one attempt later. Consuming the AOS decision would make Core send
//   next_retry_at = null on the final still-retryable attempt, which the RPC
//   rejects with AUTOMATION_NEXT_RETRY_AT_INVALID. So the automation lane owns
//   its own schedule and never imports an AOS retry decision.
// ============================================================================

/**
 * Delay applied after the attempt whose number is the index + 1. Fixed
 * repository constants: no environment variable, no admin setting, no n8n
 * input, no provider input and no jitter at this MVP boundary.
 */
export const AUTOMATION_RETRY_DELAY_SCHEDULE_SECONDS = Object.freeze([
  60,
  300,
  900,
] as const);

/** Every attempt at or beyond the schedule's length waits this long. */
export const AUTOMATION_RETRY_MAX_DELAY_SECONDS = 3600;

/**
 * attempt_count 1 -> 60s, 2 -> 300s, 3 -> 900s, >= 4 -> 3600s.
 *
 * `attemptCount` is the attempt that was just consumed, matching
 * `automation_jobs.attempt_count`. Pure and total over legal input; an illegal
 * attempt number throws rather than silently returning a default delay.
 */
export function automationRetryDelaySeconds(attemptCount: number): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("AUTOMATION_RETRY_ATTEMPT_COUNT_INVALID");
  }

  const scheduled = AUTOMATION_RETRY_DELAY_SCHEDULE_SECONDS[attemptCount - 1];
  const delay = scheduled ?? AUTOMATION_RETRY_MAX_DELAY_SECONDS;
  return Math.min(delay, AUTOMATION_RETRY_MAX_DELAY_SECONDS);
}

export interface AutomationRetryScheduleInput {
  /** `automation_jobs.attempt_count` — the attempt just consumed. */
  readonly attemptCount: number;
  /** `automation_jobs.max_attempts` — the durable retry budget. */
  readonly maxAttempts: number;
  /** Canonical clock, supplied by the caller. Never read inside this module. */
  readonly now: Date;
}

/**
 * The retry timestamp for a `retryable_failure`, or `null` when the budget is
 * spent.
 *
 * `null` is NOT a decision that the job is dead — it is the exact input
 * qf_complete_automation_attempt_v1 requires in order to apply its OWN
 * dead-letter rule (`attempt_count >= max_attempts` -> dead_letter, and a
 * next_retry_at supplied in that state is rejected outright). The boundary
 * therefore stays in one place: the RPC.
 */
export function buildAutomationNextRetryAt(
  input: AutomationRetryScheduleInput,
): string | null {
  const { attemptCount, maxAttempts, now } = input;

  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("AUTOMATION_RETRY_ATTEMPT_COUNT_INVALID");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("AUTOMATION_RETRY_MAX_ATTEMPTS_INVALID");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("AUTOMATION_RETRY_CLOCK_INVALID");
  }

  if (attemptCount >= maxAttempts) return null;

  const delaySeconds = automationRetryDelaySeconds(attemptCount);
  return new Date(now.getTime() + delaySeconds * 1000).toISOString();
}
