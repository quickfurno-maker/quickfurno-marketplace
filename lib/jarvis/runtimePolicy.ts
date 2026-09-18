import { QFJ_RECOMMENDABLE_ACTIONS } from "./actionRequestContract";

export const QF_JARVIS_MODES = ["off", "shadow", "active"] as const;
export type QfJarvisMode = (typeof QF_JARVIS_MODES)[number];

export interface QfJarvisRuntimePolicy {
  readonly mode: QfJarvisMode;
  readonly coreDecisionEnabled: boolean;
  readonly riyaEnabled: boolean;
  readonly anishaEnabled: boolean;
  readonly riyaWebTurnEnabled: boolean;
  readonly contextReadEnabled: boolean;
  readonly serviceAvailabilityEnabled: boolean;
  readonly recommendationIntakeEnabled: boolean;
  readonly actionProposalEnabled: boolean;
  readonly enabledActionTypes: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;
function enabled(value: string | undefined): boolean { return value?.trim().toLowerCase() === "true"; }
function actionTypes(raw: string | undefined): readonly string[] {
  if (!raw?.trim()) return Object.freeze([]);
  const values = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (values.some((value) => !QFJ_RECOMMENDABLE_ACTIONS.has(value as never))) return Object.freeze([]);
  return Object.freeze(values);
}

export function resolveQfJarvisRuntimePolicy(env: Env = process.env): QfJarvisRuntimePolicy {
  const rawMode = env.QF_JARVIS_MODE?.trim().toLowerCase() ?? "off";
  const mode: QfJarvisMode = QF_JARVIS_MODES.includes(rawMode as QfJarvisMode) ? (rawMode as QfJarvisMode) : "off";
  return Object.freeze({ mode,
    coreDecisionEnabled: enabled(env.QF_JARVIS_CORE_DECISION_ENABLED), riyaEnabled: enabled(env.QF_JARVIS_RIYA_ENABLED),
    anishaEnabled: enabled(env.QF_JARVIS_ANISHA_ENABLED), riyaWebTurnEnabled: enabled(env.QF_JARVIS_RIYA_WEB_TURN_ENABLED),
    contextReadEnabled: enabled(env.QF_JARVIS_CONTEXT_READ_ENABLED), serviceAvailabilityEnabled: enabled(env.QF_JARVIS_SERVICE_AVAILABILITY_ENABLED), recommendationIntakeEnabled: enabled(env.QF_JARVIS_RECOMMENDATION_INTAKE_ENABLED),
    actionProposalEnabled: enabled(env.QF_JARVIS_ACTION_PROPOSALS_ENABLED), enabledActionTypes: actionTypes(env.QF_JARVIS_ENABLED_ACTION_TYPES),
  });
}
export function isQfJarvisAgentEnabled(policy: QfJarvisRuntimePolicy, actor: string): boolean { if (actor==="RIYA") return policy.riyaEnabled; if (actor==="ANISHA") return policy.anishaEnabled; return false; }
export function isQfJarvisActionTypeEnabled(policy: QfJarvisRuntimePolicy, actionType: string): boolean { return policy.mode === "active" && policy.actionProposalEnabled && policy.enabledActionTypes.includes(actionType); }