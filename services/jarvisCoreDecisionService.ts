import {
  buildQfjCoreDecisionResponse,
  type QfjCoreDecisionCommandV2,
  type QfjCoreDecisionOutcome,
  type QfjCoreDecisionResponseV2,
} from "../lib/jarvis/coreDecisionContract";
import { isQfJarvisAgentEnabled, type QfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";

export interface JarvisCoreAuthorizerDecision { readonly outcome: QfjCoreDecisionOutcome; readonly reason: string; }
export type JarvisCoreAuthorizer = (command: QfjCoreDecisionCommandV2) => Promise<JarvisCoreAuthorizerDecision>;

export async function decideJarvisCoreCommand(args: {
  readonly command: QfjCoreDecisionCommandV2;
  readonly policy: QfJarvisRuntimePolicy;
  readonly decidedAt: string;
  readonly authorizer?: JarvisCoreAuthorizer;
}): Promise<QfjCoreDecisionResponseV2> {
  const { command, policy, decidedAt } = args;
  const respond = (outcome: QfjCoreDecisionOutcome, reason: string) =>
    buildQfjCoreDecisionResponse(command, outcome, reason, decidedAt);

  if (policy.mode === "off" || !policy.coreDecisionEnabled) return respond("CORE_UNAVAILABLE", "jarvis_integration_off");
  if (!isQfJarvisAgentEnabled(policy, command.assignedActor)) return respond("HUMAN_REVIEW_REQUIRED", "jarvis_agent_paused");
  if (command.assignedActor !== "RIYA" && command.assignedActor !== "ANISHA") return respond("REJECTED", "jarvis_actor_not_enabled");
  if (command.proposalKind === "ESCALATE_TO_HUMAN") return respond("HUMAN_REVIEW_REQUIRED", "human_escalation_requested");
  if (policy.mode === "shadow") return respond("HUMAN_REVIEW_REQUIRED", "jarvis_shadow_mode");
  if (!args.authorizer) return respond("CORE_UNAVAILABLE", "core_authorizer_unavailable");

  try {
    const decision = await args.authorizer(command);
    return respond(decision.outcome, decision.reason);
  } catch {
    return respond("CORE_UNAVAILABLE", "core_authorizer_unavailable");
  }
}
