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
import {
  classifyOwnership,
  isValidOwnershipInput,
  OWNING_PROVIDER_ACCOUNT_COLUMNS,
  type OwningProviderAccountRow,
  type OwnershipResolutionInput,
  type ProviderAccountOwnership,
} from "../lib/communication/providers/providerAccountOwnership";

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

// ----------------------------------------------------------------------------
// OWNERSHIP RESOLUTION (Phase 8B-1B-A)
//
// Deliberately SEPARATE from every send-eligibility path above. It answers ONLY
// "which durable communication_provider_accounts row OWNS this identity" — never
// "may we send". It is READINESS-AGNOSTIC: a disabled / unhealthy / historical
// account still owns its own identity, so this NEVER consults readiness/health.
//
// Unlike fetchProviderAccount() (which uses .maybeSingle() and collapses zero / many
// / error into a single null for the send gate), the resolver fails closed with a
// DISTINCT typed outcome for each case: >1 rows → ambiguous (never a silent first-row
// pick), a DB error or thrown exception → query_error (never not_found / owned), and
// blank/malformed input → invalid_input. It projects only NON-SECRET columns and never
// falls back to environment configuration to invent an owner.
// ----------------------------------------------------------------------------
export async function resolveOwningProviderAccount(
  input: OwnershipResolutionInput
): Promise<ProviderAccountOwnership> {
  if (!isValidOwnershipInput(input)) return { kind: "invalid_input" };
  try {
    // `.limit(2)` is a deliberate defence-in-depth: the (provider_key, channel,
    // phone_number_reference) unique index makes >1 impossible in a healthy schema,
    // but the resolver still detects and rejects a second row as ambiguous rather
    // than trusting the constraint and selecting a first row.
    const { data, error } = await adminClient()
      .from("communication_provider_accounts")
      .select(OWNING_PROVIDER_ACCOUNT_COLUMNS)
      .eq("provider_key", input.providerKey)
      .eq("channel", input.channel)
      .eq("phone_number_reference", input.phoneNumberReference)
      .limit(2);
    if (error) return { kind: "query_error" };
    // A MALFORMED result is not an empty result. `data` that is not an array — including null with
    // no reported error — means the query did not return a result set we can reason about, so it
    // fails closed as query_error. Coalescing it (e.g. `data ?? []`) would silently forge a
    // confident "not_found" out of a broken response.
    if (!Array.isArray(data)) return { kind: "query_error" };

    return classifyOwnership(
      data as OwningProviderAccountRow[],
      input.expectedWabaId
    );
  } catch {
    return { kind: "query_error" };
  }
}
