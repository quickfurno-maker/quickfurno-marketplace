import type { LeadDistributionAuthorizationPolicyConfig } from "../policyTypes";

export const AutomationPolicyConfigSource = {
  ACTIVE_CONFIG: "active_config",
  SAFE_DEFAULT_NO_ACTIVE_CONFIG: "safe_default_no_active_config",
} as const;

export type AutomationPolicyConfigSourceValue =
  (typeof AutomationPolicyConfigSource)[keyof typeof AutomationPolicyConfigSource];

export interface AutomationPolicyConfigRow {
  readonly id: string;
  readonly policy_key: string;
  readonly policy_version: string;
  readonly config_json: unknown;
  readonly config_fingerprint: string;
}

export interface AutomationPolicyActiveConfigRow {
  readonly policy_key: string;
  readonly config_id: string;
  readonly config: AutomationPolicyConfigRow | null;
}

export interface AutomationPolicyConfigReadPort {
  readActiveConfig(
    policyKey: string,
  ): Promise<AutomationPolicyActiveConfigRow | null>;
}

export interface LoadedAutomationPolicyConfigSnapshot {
  readonly policyKey: string;
  readonly configId: string | null;
  readonly policyVersion: string;
  readonly config: LeadDistributionAuthorizationPolicyConfig;
  readonly fingerprint: string;
  readonly source: AutomationPolicyConfigSourceValue;
}
