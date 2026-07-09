// ============================================================================
// QuickFurno — services/communicationProviderHealthService.ts  (Phase 5F-B, server-only)
//
// EXPLICITLY-INVOKED provider health check. It runs the real read-only Meta lookup
// ONLY when the runtime policy has `health_check_enabled = true`, then persists ONLY
// safe, non-secret fields on communication_provider_accounts. There is no cron, no
// interval, no n8n workflow, and no background monitor in Phase 5F-B — a health
// check happens only when a server operator invokes this function.
//
// Never persists a token / App Secret / webhook verify token / raw provider response
// / display phone number.
// ============================================================================

import { adminClient } from "../lib/supabase";
import type { MetaCloudWhatsAppProvider } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import { META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";
import type { MetaHealthConfig } from "../lib/communication/providers/metaCloudWhatsAppConfig";
import type { WhatsAppProviderHealth } from "../lib/communication/providers/whatsappProvider";
import { fetchRuntimePolicy } from "./communicationProviderRuntimeService";

const CHANNEL = "whatsapp";

export type ProviderHealthOutcome =
  | { readonly ok: true; readonly health: WhatsAppProviderHealth; readonly persisted: boolean }
  | { readonly ok: false; readonly reason: "health_check_disabled" | "runtime_policy_missing" };

/** Map the provider health verdict onto the account health_status vocabulary. */
export function toAccountHealthStatus(health: WhatsAppProviderHealth): "healthy" | "degraded" | "unhealthy" {
  if (health.status === "healthy") return "healthy";
  if (health.reachable) return "degraded";
  return "unhealthy";
}

/**
 * Run an explicit Meta health check. Fails closed unless the runtime policy enables
 * health checks. Persists only safe fields.
 */
export async function runMetaProviderHealthCheck(input: {
  readonly provider: MetaCloudWhatsAppProvider;
  readonly config: Pick<MetaHealthConfig, "phoneNumberId">;
}): Promise<ProviderHealthOutcome> {
  const providerKey = META_WHATSAPP_CLOUD_PROVIDER_KEY;
  const policy = await fetchRuntimePolicy(providerKey, CHANNEL);
  if (!policy) return { ok: false, reason: "runtime_policy_missing" };
  if (policy.health_check_enabled !== true) return { ok: false, reason: "health_check_disabled" };

  const health = await input.provider.healthCheck();
  const nowIso = new Date().toISOString();

  // Persist ONLY safe, non-secret fields. `detailsSanitized` is already sanitized by
  // the adapter (no display phone, no token, no raw response).
  const { error } = await adminClient()
    .from("communication_provider_accounts")
    .update({
      health_status: toAccountHealthStatus(health),
      last_health_check_at: nowIso,
      last_synced_at: nowIso,
      updated_at: nowIso,
    })
    .eq("provider_key", providerKey)
    .eq("channel", CHANNEL)
    .eq("phone_number_reference", input.config.phoneNumberId);

  return { ok: true, health, persisted: !error };
}
