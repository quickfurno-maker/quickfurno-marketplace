import type { RetryDecision } from "./workflowTypes";

export interface RetryPolicyConfig {
  maxAttempts: number;
  backoffSeconds: number[];
  maxDelaySeconds: number;
}

export const DEFAULT_WORKFLOW_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 5,
  backoffSeconds: [60, 5 * 60, 15 * 60, 60 * 60],
  maxDelaySeconds: 60 * 60,
};

export function createRetryPolicyConfig(maxAttempts: number): RetryPolicyConfig {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("RETRY_MAX_ATTEMPTS_INVALID");
  }

  return {
    ...DEFAULT_WORKFLOW_RETRY_POLICY,
    maxAttempts,
  };
}

export function calculateRetryDecision(
  attemptCount: number,
  retryable: boolean,
  now = new Date(),
  config: RetryPolicyConfig = DEFAULT_WORKFLOW_RETRY_POLICY,
): RetryDecision {
  const nextAttemptNumber = attemptCount + 1;

  if (!retryable) {
    return {
      shouldRetry: false,
      shouldDeadLetter: true,
      attemptNumber: nextAttemptNumber,
      nextRetryAt: null,
      reason: "non_retryable",
    };
  }

  if (nextAttemptNumber >= config.maxAttempts) {
    return {
      shouldRetry: false,
      shouldDeadLetter: true,
      attemptNumber: nextAttemptNumber,
      nextRetryAt: null,
      reason: "max_attempts_exhausted",
    };
  }

  const rawDelay = config.backoffSeconds[Math.max(0, nextAttemptNumber - 1)] ?? config.maxDelaySeconds;
  const delaySeconds = Math.min(rawDelay, config.maxDelaySeconds);
  const nextRetry = new Date(now.getTime() + delaySeconds * 1000);

  return {
    shouldRetry: true,
    shouldDeadLetter: false,
    attemptNumber: nextAttemptNumber,
    nextRetryAt: nextRetry.toISOString(),
    reason: `retry_in_${delaySeconds}_seconds`,
  };
}
