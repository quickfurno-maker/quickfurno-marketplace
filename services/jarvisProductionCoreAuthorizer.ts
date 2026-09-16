import type { QfjCoreDecisionCommandV2 } from "@/lib/jarvis/coreDecisionContract";
import type { JarvisCoreAuthorizer, JarvisCoreAuthorizerDecision } from "./jarvisCoreDecisionService";

/**
 * Initial production Core authorizer for the Jarvis handshake boundary.
 * It deliberately authorizes only NO_ACTION because that produces no reply,
 * automation request, provider send, or business-state mutation.
 *
 * REPLY/FOLLOW_UP remain human-review until a separate conversation authority
 * proves revision, policy, consent and reply ownership. This is a real injected
 * authorizer, but it is intentionally non-permissive.
 */
export const authorizeJarvisCoreCommand: JarvisCoreAuthorizer = async (
  command: QfjCoreDecisionCommandV2,
): Promise<JarvisCoreAuthorizerDecision> => {
  if (command.proposalKind === "NO_ACTION") {
    return { outcome: "ACCEPTED", reason: "core_no_action_accepted" };
  }
  if (command.proposalKind === "REQUEST_CLARIFICATION") {
    return { outcome: "HUMAN_REVIEW_REQUIRED", reason: "clarification_requires_core_workflow" };
  }
  return { outcome: "HUMAN_REVIEW_REQUIRED", reason: "reply_authority_not_activated" };
};
