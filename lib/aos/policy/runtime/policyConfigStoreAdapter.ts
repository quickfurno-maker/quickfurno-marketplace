import { adminClient } from "../../../supabase";
import {
  AutomationPolicyConfigSource,
  type AutomationPolicyActiveConfigRow,
  type AutomationPolicyConfigReadPort,
  type LoadedAutomationPolicyConfigSnapshot,
} from "./policyConfigStoreTypes";
import {
  buildSafeDefaultAutomationPolicyConfigSnapshot,
  validateActiveAutomationPolicyConfigSnapshot,
} from "./policyConfigStoreValidation";

export class SupabaseAutomationPolicyConfigReadPort
  implements AutomationPolicyConfigReadPort
{
  async readActiveConfig(
    policyKey: string,
  ): Promise<AutomationPolicyActiveConfigRow | null> {
    const { data: active, error: activeError } = await adminClient()
      .from("automation_policy_active_configs")
      .select("policy_key, config_id")
      .eq("policy_key", policyKey)
      .maybeSingle();

    if (activeError) throw activeError;
    if (!active) return null;

    const activeRow = active as { policy_key: string; config_id: string };
    const { data: config, error: configError } = await adminClient()
      .from("automation_policy_configs")
      .select("id, policy_key, policy_version, config_json, config_fingerprint")
      .eq("policy_key", activeRow.policy_key)
      .eq("id", activeRow.config_id)
      .maybeSingle();

    if (configError) throw configError;
    return {
      policy_key: activeRow.policy_key,
      config_id: activeRow.config_id,
      config: config
        ? {
            id: String((config as { id: unknown }).id),
            policy_key: String((config as { policy_key: unknown }).policy_key),
            policy_version: String((config as { policy_version: unknown }).policy_version),
            config_json: (config as { config_json: unknown }).config_json,
            config_fingerprint: String(
              (config as { config_fingerprint: unknown }).config_fingerprint,
            ),
          }
        : null,
    };
  }
}

export async function loadAutomationPolicyConfigSnapshot(
  policyKey: string,
  port: AutomationPolicyConfigReadPort = new SupabaseAutomationPolicyConfigReadPort(),
): Promise<LoadedAutomationPolicyConfigSnapshot> {
  const active = await port.readActiveConfig(policyKey);
  if (!active) {
    return buildSafeDefaultAutomationPolicyConfigSnapshot(policyKey);
  }
  return validateActiveAutomationPolicyConfigSnapshot(policyKey, active);
}

export { AutomationPolicyConfigSource };
