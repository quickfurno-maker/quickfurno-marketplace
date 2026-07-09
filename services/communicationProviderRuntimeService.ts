// ============================================================================
// QuickFurno — services/communicationProviderRuntimeService.ts  (Phase 5F-B, server-only)
//
// Thin DB wrapper around the PURE outbound gate in metaRuntimeGate.ts. It FETCHES
// the runtime policy, provider account, and active canary rows and delegates the
// decision to the pure functions. It never creates a provider-account row, never
// advances readiness, and never mutates state during a send — it only reads.
// ============================================================================

import { adminClient } from "../lib/supabase";
import {
  evaluateMetaOutboundGate,
  type CanaryDestinationRow,
  type GateResult,
  type ProviderAccountRow,
  type ProviderActivationStatus,
  type ProviderRuntimePolicyRow,
} from "../lib/communication/providers/metaRuntimeGate";
import { META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";

const CHANNEL = "whatsapp";

export async function fetchRuntimePolicy(
  providerKey: string,
  channel: string
): Promise<ProviderRuntimePolicyRow | null> {
  const { data, error } = await adminClient()
    .from("communication_provider_runtime_policies")
    .select("*")
    .eq("provider_key", providerKey)
    .eq("channel", channel)
    .maybeSingle();
  if (error || !data) return null;
  return data as ProviderRuntimePolicyRow;
}

export async function fetchProviderAccount(
  providerKey: string,
  channel: string,
  phoneNumberReference: string
): Promise<ProviderAccountRow | null> {
  const { data, error } = await adminClient()
    .from("communication_provider_accounts")
    .select("*")
    .eq("provider_key", providerKey)
    .eq("channel", channel)
    .eq("phone_number_reference", phoneNumberReference)
    .maybeSingle();
  if (error || !data) return null;
  return data as ProviderAccountRow;
}

export async function fetchActiveCanaryDestinations(
  providerKey: string,
  channel: string,
  destinationHash: string
): Promise<CanaryDestinationRow[]> {
  const { data, error } = await adminClient()
    .from("communication_provider_canary_destinations")
    .select("*")
    .eq("provider_key", providerKey)
    .eq("channel", channel)
    .eq("destination_hash", destinationHash)
    .eq("is_active", true);
  if (error || !data) return [];
  return data as CanaryDestinationRow[];
}

export async function isWebhookProcessingEnabled(providerKey: string, channel: string): Promise<boolean> {
  const policy = await fetchRuntimePolicy(providerKey, channel);
  return policy?.webhook_processing_enabled === true;
}

/**
 * Evaluate the full Meta outbound gate for a specific destination hash by fetching
 * the relevant rows and delegating to the pure {@link evaluateMetaOutboundGate}.
 * Fails closed on any missing/mismatched/not-ready condition.
 */
export async function evaluateMetaOutboundGateForMessage(input: {
  readonly config: { readonly phoneNumberId: string; readonly wabaId: string };
  readonly destinationHash: string;
  readonly now?: Date | string | number;
}): Promise<GateResult<{ readonly activation: ProviderActivationStatus }>> {
  const providerKey = META_WHATSAPP_CLOUD_PROVIDER_KEY;
  const policy = await fetchRuntimePolicy(providerKey, CHANNEL);
  const account = await fetchProviderAccount(providerKey, CHANNEL, input.config.phoneNumberId);
  const canaryRows = await fetchActiveCanaryDestinations(providerKey, CHANNEL, input.destinationHash);
  return evaluateMetaOutboundGate({
    policy,
    account,
    canaryRows,
    destinationHash: input.destinationHash,
    expected: { phoneNumberId: input.config.phoneNumberId, wabaId: input.config.wabaId },
    now: input.now,
  });
}
