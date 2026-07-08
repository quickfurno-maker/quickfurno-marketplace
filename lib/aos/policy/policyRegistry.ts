import {
  AutomationPolicyKey,
  type AutomationPolicyKeyValue,
  type PolicyEvaluator,
} from "./policyTypes";
import { evaluateDistributionAuthorizationPolicySafely } from "./distributionAuthorizationPolicy";

/**
 * QuickFurno Automation Policy Engine — narrow, typed registry (Phase 4A).
 *
 * Maps a policy key to its (fail-closed) evaluator. This is intentionally NOT a
 * plugin framework and performs NO dynamic code execution: it is a fixed,
 * explicit table. Phase 4A registers exactly one policy. An unknown key fails
 * explicitly rather than silently defaulting.
 */

const POLICY_REGISTRY: Readonly<Record<AutomationPolicyKeyValue, PolicyEvaluator>> =
  Object.freeze({
    [AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION]:
      evaluateDistributionAuthorizationPolicySafely,
  });

/** Resolve the evaluator for a policy key. Throws on an unknown key. */
export function resolvePolicyEvaluator(policyKey: string): PolicyEvaluator {
  const evaluator = (POLICY_REGISTRY as Record<string, PolicyEvaluator | undefined>)[
    policyKey
  ];
  if (!evaluator) {
    throw new Error(`UNKNOWN_AUTOMATION_POLICY_KEY:${policyKey}`);
  }
  return evaluator;
}

/** List the registered policy keys (Phase 4A: exactly one). */
export function listRegisteredPolicyKeys(): string[] {
  return Object.keys(POLICY_REGISTRY);
}

/** True when the given key resolves to a registered evaluator. */
export function isRegisteredPolicyKey(policyKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(POLICY_REGISTRY, policyKey);
}
