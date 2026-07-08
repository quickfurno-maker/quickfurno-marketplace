import {
  AutomationPolicyKey,
  type AutomationPolicyKeyValue,
  type LeadDistributionAuthorizationPolicyConfig,
} from "../policyTypes";
import {
  LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION,
  SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG,
} from "../policyConfig";
import { computePolicyConfigFingerprint } from "../policyFingerprint";
import { validateLeadDistributionAuthorizationConfig } from "../policyValidation";
import {
  AutomationPolicyConfigSource,
  type AutomationPolicyActiveConfigRow,
  type LoadedAutomationPolicyConfigSnapshot,
} from "./policyConfigStoreTypes";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class PolicyConfigIntegrityError extends Error {
  constructor(
    readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "PolicyConfigIntegrityError";
  }
}

export function assertSupportedPolicyKey(policyKey: string): AutomationPolicyKeyValue {
  if (policyKey !== AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_KEY_UNSUPPORTED");
  }
  return AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION;
}

export function buildSafeDefaultAutomationPolicyConfigSnapshot(
  policyKey: string,
): LoadedAutomationPolicyConfigSnapshot {
  const supportedKey = assertSupportedPolicyKey(policyKey);
  const config = validateConfigOrThrow(
    SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG,
  );
  return freezeSnapshot({
    policyKey: supportedKey,
    configId: null,
    policyVersion: LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION,
    config,
    fingerprint: computePolicyConfigFingerprint(config),
    source: AutomationPolicyConfigSource.SAFE_DEFAULT_NO_ACTIVE_CONFIG,
  });
}

export function validateActiveAutomationPolicyConfigSnapshot(
  policyKey: string,
  active: AutomationPolicyActiveConfigRow,
): LoadedAutomationPolicyConfigSnapshot {
  const supportedKey = assertSupportedPolicyKey(policyKey);
  if (active.policy_key !== supportedKey) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_ACTIVE_POLICY_KEY_MISMATCH");
  }
  if (!isNonEmptyString(active.config_id)) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_ACTIVE_CONFIG_ID_INVALID");
  }
  if (!active.config) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_ROW_MISSING");
  }

  const row = active.config;
  if (row.id !== active.config_id) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_ACTIVE_CONFIG_ID_MISMATCH");
  }
  if (row.policy_key !== supportedKey) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_ROW_POLICY_KEY_MISMATCH");
  }
  if (row.policy_version !== LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_VERSION_UNSUPPORTED");
  }
  if (!SHA256_HEX.test(row.config_fingerprint)) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_STORED_FINGERPRINT_INVALID");
  }

  const config = validateConfigOrThrow(row.config_json);
  const computed = computePolicyConfigFingerprint(config);
  if (computed !== row.config_fingerprint) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_FINGERPRINT_MISMATCH");
  }

  return freezeSnapshot({
    policyKey: supportedKey,
    configId: row.id,
    policyVersion: row.policy_version,
    config,
    fingerprint: computed,
    source: AutomationPolicyConfigSource.ACTIVE_CONFIG,
  });
}

function validateConfigOrThrow(
  raw: unknown,
): LeadDistributionAuthorizationPolicyConfig {
  const result = validateLeadDistributionAuthorizationConfig(raw);
  if (!result.ok) {
    throw new PolicyConfigIntegrityError("POLICY_CONFIG_SCHEMA_INVALID", result.message);
  }
  return deepFreezeConfig(result.value);
}

function freezeSnapshot(
  snapshot: LoadedAutomationPolicyConfigSnapshot,
): LoadedAutomationPolicyConfigSnapshot {
  return Object.freeze({
    ...snapshot,
    config: deepFreezeConfig(snapshot.config),
  });
}

function deepFreezeConfig(
  config: LeadDistributionAuthorizationPolicyConfig,
): LeadDistributionAuthorizationPolicyConfig {
  return Object.freeze({
    ...config,
    allowedAutoAuthorizeScoreClasses: Object.freeze([
      ...config.allowedAutoAuthorizeScoreClasses,
    ]),
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
