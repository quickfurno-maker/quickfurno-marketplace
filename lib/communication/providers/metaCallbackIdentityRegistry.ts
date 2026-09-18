import {
  decideCallbackIdentity,
  type CallbackIdentityDecision,
  type ExpectedCallbackIdentity,
} from "./metaCallbackIdentity";

export interface CallbackIdentityRegistry {
  readonly identities: readonly ExpectedCallbackIdentity[];
}

export function decideCallbackIdentityRegistry(
  payload: unknown,
  registry: CallbackIdentityRegistry,
): CallbackIdentityDecision {
  if (!registry || !Array.isArray(registry.identities) || registry.identities.length < 1) {
    return { kind: "rejected", reason: "malformed_expected_identity" };
  }

  const decisions = registry.identities.map((expected) => decideCallbackIdentity(payload, expected));
  const authorized = decisions.find((decision) => decision.kind === "authorized");
  if (authorized) return authorized;

  if (decisions.every((decision) => decision.kind === "unsupported")) {
    return { kind: "unsupported" };
  }

  const rejected = decisions.find((decision) => decision.kind === "rejected");
  return rejected ?? { kind: "rejected", reason: "malformed_expected_identity" };
}
