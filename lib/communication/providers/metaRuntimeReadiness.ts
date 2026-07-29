// ============================================================================
// QuickFurno — lib/communication/providers/metaRuntimeReadiness.ts (QF-MVP-40.3)
//
// The PURE, operation-scoped Meta readiness evaluator.
//
// WHAT IT IS. A read-only reporter that answers one question per operation:
// "is this operation configured well enough to be *possible*?" It composes the
// EXISTING loaders in metaCloudWhatsAppConfig.ts and the EXISTING gate helpers in
// metaRuntimeGate.ts. It introduces no second configuration system, no new
// environment variable, and no parallel validation grammar.
//
// WHAT IT IS NOT — and this distinction is the whole point:
//   configuration readiness  ≠  provider-account readiness
//   provider-account readiness ≠  runtime activation
//   runtime activation       ≠  BUSINESS AUTHORISATION
// A READY verdict means "not blocked by configuration". It never authorises a
// send. Consent, suppression, frequency, template approval and the Phase 4 policy
// engine remain separate authorities that must ALSO pass.
//
// PURITY. Evaluation performs no I/O: no database query, no network call, no
// process.env read unless the caller passes process.env in explicitly. Runtime
// rows (policy / account / canary / mapping) are OPTIONAL INJECTED SNAPSHOTS —
// this module never fetches them, so it cannot be the thing that accidentally
// contacts a provider or a database.
//
// SECRECY. No secret value is read, stored, returned or logged. Every result
// carries variable NAMES and states only. `missing` and `invalid` are name lists.
// ============================================================================

import {
  resolveHealthConfig,
  resolveOutboundMetaConfig,
  resolveProviderModeDecision,
  resolveWebhookIdentityConfig,
  resolveWebhookSignatureConfig,
  resolveWebhookVerifyConfig,
} from "./metaCloudWhatsAppConfig";
import {
  evaluateProviderAccountReadiness,
  evaluateRuntimeActivation,
  type ProviderAccountRow,
  type ProviderRuntimePolicyRow,
} from "./metaRuntimeGate";

export const CRON_SECRET_ENV_KEY = "QF_CRON_SECRET";

/** The operations QF-MVP-40 can evaluate independently. */
export const MetaOperation = Object.freeze({
  WEBHOOK_GET: "webhook_get",
  WEBHOOK_POST: "webhook_post",
  CALLBACK_IDENTITY: "callback_identity",
  OUTBOUND: "outbound",
  HEALTH: "health",
  CONSENT_ACK_WORKER: "consent_ack_worker",
} as const);
export type MetaOperationValue = (typeof MetaOperation)[keyof typeof MetaOperation];

export const META_OPERATIONS: readonly MetaOperationValue[] = Object.freeze([
  MetaOperation.WEBHOOK_GET,
  MetaOperation.WEBHOOK_POST,
  MetaOperation.CALLBACK_IDENTITY,
  MetaOperation.OUTBOUND,
  MetaOperation.HEALTH,
  MetaOperation.CONSENT_ACK_WORKER,
]);

/** Closed readiness vocabulary. An unrecognised state is impossible by construction. */
export const ReadinessState = Object.freeze({
  READY: "READY",
  MISSING: "MISSING",
  INVALID: "INVALID",
  DISABLED_BY_RUNTIME_POLICY: "DISABLED_BY_RUNTIME_POLICY",
  ACCOUNT_NOT_READY: "ACCOUNT_NOT_READY",
  MAPPING_NOT_READY: "MAPPING_NOT_READY",
  CANARY_NOT_READY: "CANARY_NOT_READY",
} as const);
export type ReadinessStateValue = (typeof ReadinessState)[keyof typeof ReadinessState];

export interface OperationReadiness {
  readonly operation: MetaOperationValue;
  readonly state: ReadinessStateValue;
  /** Environment variable NAMES only — never values. */
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
  /** A short, non-secret explanation. */
  readonly detail: string;
}

/** OPTIONAL injected runtime snapshot. Nothing here is fetched by this module. */
export interface RuntimeSnapshot {
  readonly policy?: ProviderRuntimePolicyRow | null;
  readonly account?: ProviderAccountRow | null;
  /** Count of approved+active provider template mappings the operator has seeded. */
  readonly approvedActiveMappingCount?: number;
  /** Count of active, unexpired canary destination rows. */
  readonly activeCanaryDestinationCount?: number;
}

type EnvSource = Record<string, string | undefined>;

function fromConfig(
  operation: MetaOperationValue,
  res: { ok: true } | { ok: false; missing?: readonly string[]; invalid?: readonly string[] },
  readyDetail: string
): OperationReadiness {
  if (res.ok) {
    return { operation, state: ReadinessState.READY, missing: [], invalid: [], detail: readyDetail };
  }
  const missing = res.missing ?? [];
  const invalid = res.invalid ?? [];
  // INVALID outranks MISSING: a malformed value is a configuration error an
  // operator must correct, not merely an absent one they have yet to supply.
  return {
    operation,
    state: invalid.length > 0 ? ReadinessState.INVALID : ReadinessState.MISSING,
    missing,
    invalid,
    detail: invalid.length > 0
      ? "One or more variables are present but malformed."
      : "One or more required variables are absent.",
  };
}

/**
 * Provider mode must be explicitly resolvable before ANY Meta operation can be
 * considered. In production an absent or invalid mode FAILS CLOSED and never
 * silently falls back to the mock provider.
 */
function modeBlock(env: EnvSource, operation: MetaOperationValue): OperationReadiness | null {
  const decision = resolveProviderModeDecision(env);
  if (decision.ok) {
    if (decision.mode === "meta_cloud") return null;
    return {
      operation, state: ReadinessState.DISABLED_BY_RUNTIME_POLICY,
      missing: [], invalid: [],
      detail: "Provider mode is mock; the Meta adapter is not selected.",
    };
  }
  if (decision.reason === "invalid_mode") {
    return {
      operation, state: ReadinessState.INVALID, missing: [], invalid: [decision.variable],
      detail: "Provider mode is set to an unrecognised value.",
    };
  }
  // mode_required_in_production — production with no mode set. Never defaults to mock.
  return {
    operation, state: ReadinessState.MISSING, missing: [decision.variable], invalid: [],
    detail: "Provider mode is absent in production; failing closed rather than defaulting to mock.",
  };
}

/** Runtime/account/mapping/canary gating, applied only to operations that need it. */
function runtimeBlock(
  operation: MetaOperationValue,
  snapshot: RuntimeSnapshot | undefined,
  opts: {
    requireAccount: boolean;
    requireMapping: boolean;
    requireCanary: boolean;
    /** Required when requireAccount is true — the account must match THIS identity. */
    expectedIdentity?: { readonly phoneNumberId: string; readonly wabaId: string };
  }
): OperationReadiness | null {
  if (!snapshot) return null; // pure config-only evaluation — nothing claimed about runtime

  const activation = evaluateRuntimeActivation(snapshot.policy ?? null);
  if (!activation.ok) {
    return {
      operation, state: ReadinessState.DISABLED_BY_RUNTIME_POLICY, missing: [], invalid: [],
      detail: `Runtime policy blocks this operation (${activation.reason}).`,
    };
  }

  if (opts.requireAccount && opts.expectedIdentity) {
    // The account is checked AGAINST the configured identity, so a ready account
    // belonging to a different WABA or phone number can never satisfy this gate.
    const account = evaluateProviderAccountReadiness(snapshot.account ?? null, opts.expectedIdentity);
    if (!account.ok) {
      return {
        operation, state: ReadinessState.ACCOUNT_NOT_READY, missing: [], invalid: [],
        detail: `Provider account is not production-ready (${account.reason}).`,
      };
    }
  }

  if (opts.requireMapping && (snapshot.approvedActiveMappingCount ?? 0) < 1) {
    return {
      operation, state: ReadinessState.MAPPING_NOT_READY, missing: [], invalid: [],
      detail: "No approved, active provider template mapping exists.",
    };
  }

  if (opts.requireCanary && (snapshot.activeCanaryDestinationCount ?? 0) < 1) {
    return {
      operation, state: ReadinessState.CANARY_NOT_READY, missing: [], invalid: [],
      detail: "Canary activation requires at least one active, unexpired canary destination.",
    };
  }

  return null;
}

/**
 * Evaluate ONE operation. Order is deliberate: provider mode, then the operation's
 * own configuration, then runtime gating. Configuration is reported before runtime
 * so an operator sees what to fix first rather than a blanket "disabled".
 */
export function evaluateOperationReadiness(
  operation: MetaOperationValue,
  env: EnvSource,
  snapshot?: RuntimeSnapshot
): OperationReadiness {
  // The acknowledgement worker is transport-agnostic: it is gated by the cron
  // shared secret, not by Meta credentials. It still cannot send without the
  // outbound path, but its own readiness is exactly "is the trigger protected".
  if (operation === MetaOperation.CONSENT_ACK_WORKER) {
    const secret = env[CRON_SECRET_ENV_KEY];
    if (secret === undefined || secret === "") {
      return {
        operation, state: ReadinessState.MISSING, missing: [CRON_SECRET_ENV_KEY], invalid: [],
        detail: "The acknowledgement worker trigger is unprotected without a cron shared secret.",
      };
    }
    const blocked = runtimeBlock(operation, snapshot,
      { requireAccount: false, requireMapping: false, requireCanary: false });
    if (blocked) return blocked;
    return {
      operation, state: ReadinessState.READY, missing: [], invalid: [],
      detail: "Cron shared secret is configured. Triggering is not authorisation.",
    };
  }

  const modeIssue = modeBlock(env, operation);
  if (modeIssue) return modeIssue;

  switch (operation) {
    case MetaOperation.WEBHOOK_GET:
      return fromConfig(operation, resolveWebhookVerifyConfig(env),
        "Verify token configured; subscription verification is possible.");

    case MetaOperation.WEBHOOK_POST: {
      const cfg = fromConfig(operation, resolveWebhookSignatureConfig(env),
        "App secret configured; signature verification is possible.");
      if (cfg.state !== ReadinessState.READY) return cfg;
      const blocked = runtimeBlock(operation, snapshot,
        { requireAccount: false, requireMapping: false, requireCanary: false });
      return blocked ?? cfg;
    }

    case MetaOperation.CALLBACK_IDENTITY:
      return fromConfig(operation, resolveWebhookIdentityConfig(env),
        "WABA and phone-number identity configured; callback identity can be proved.");

    case MetaOperation.OUTBOUND: {
      const resolved = resolveOutboundMetaConfig(env);
      const cfg = fromConfig(operation, resolved,
        "Outbound configuration complete. This is NOT permission to send.");
      if (cfg.state !== ReadinessState.READY || !resolved.ok) return cfg;
      const blocked = runtimeBlock(operation, snapshot, {
        requireAccount: true,
        requireMapping: true,
        requireCanary: false,
        expectedIdentity: {
          phoneNumberId: resolved.config.phoneNumberId,
          wabaId: resolved.config.wabaId,
        },
      });
      return blocked ?? cfg;
    }

    case MetaOperation.HEALTH: {
      const cfg = fromConfig(operation, resolveHealthConfig(env),
        "Health configuration complete.");
      if (cfg.state !== ReadinessState.READY) return cfg;
      const blocked = runtimeBlock(operation, snapshot,
        { requireAccount: false, requireMapping: false, requireCanary: false });
      return blocked ?? cfg;
    }

    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

/** Evaluate every operation. Deterministic order, names only, no secret values. */
export function evaluateMetaReadiness(
  env: EnvSource,
  snapshot?: RuntimeSnapshot
): readonly OperationReadiness[] {
  return META_OPERATIONS.map((op) => evaluateOperationReadiness(op, env, snapshot));
}

/**
 * A compact, printable summary. Contains operation names, states and variable
 * NAMES only — safe to show an operator or paste into an issue.
 */
export function summariseReadiness(results: readonly OperationReadiness[]): string {
  return results
    .map((r) => {
      const names = [
        r.missing.length > 0 ? `missing=[${r.missing.join(", ")}]` : "",
        r.invalid.length > 0 ? `invalid=[${r.invalid.join(", ")}]` : "",
      ].filter(Boolean).join(" ");
      return `${r.operation.padEnd(20)} ${r.state}${names ? "  " + names : ""}`;
    })
    .join("\n");
}
