// ============================================================================
// QuickFurno — services/clientOtpAutomationService.ts   (server-only)
//
// The ONE place that loads the `client_login_otp` automation catalog row and
// evaluates its operational gate against the active WhatsApp provider. Both the
// OTP request/verify service and the Send SMS hook adapter consult it, so the
// production kill-switch (`is_operationally_enabled`) is enforced identically on
// every path and there is no second, weaker copy of the gate logic.
//
// Phase 5D ships the automation disabled, so this returns a blocked decision in
// production — no provider is ever invoked by this phase alone.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { isMissingRelationError } from "../lib/errors";
import {
  CLIENT_LOGIN_OTP_AUTOMATION_KEY,
  ClientOtpGateBlockReason,
  evaluateClientOtpOperationalGate,
  type ClientOtpGateDecision,
} from "../lib/identity/clientOtpAutomation";
import { resolveRuntimeWhatsAppProvider } from "./runtimeCommunicationService";

const AUTOMATION_CATALOG_TABLE = "communication_automation_catalog";

const CATALOG_COLUMNS =
  "automation_key, lane, channel, template_key, readiness_status, provider_required, is_operationally_enabled";

/**
 * Load the client_login_otp automation row and evaluate whether the WhatsApp
 * provider may be invoked right now. Fails CLOSED on a missing row, a lookup
 * error, or a schema that predates Phase 5B. The active provider key is read from
 * the Phase 5B provider registry, never hardcoded.
 */
export async function evaluateClientLoginOtpGate(): Promise<ClientOtpGateDecision> {
  try {
    const { data, error } = await adminClient()
      .from(AUTOMATION_CATALOG_TABLE)
      .select(CATALOG_COLUMNS)
      .eq("automation_key", CLIENT_LOGIN_OTP_AUTOMATION_KEY)
      .maybeSingle();

    if (error) {
      // Communication core not applied here → fail closed, exactly as a missing row.
      if (isMissingRelationError(error)) {
        return { ok: false, reason: ClientOtpGateBlockReason.MISSING_CATALOG_ROW };
      }
      return { ok: false, reason: ClientOtpGateBlockReason.MISSING_CATALOG_ROW };
    }

    // The catalog's required provider must match the RUNTIME-selected adapter. An
    // unresolvable provider (e.g. production without a provider mode) fails closed.
    const provider = resolveRuntimeWhatsAppProvider();
    if (!provider.ok) {
      return { ok: false, reason: ClientOtpGateBlockReason.PROVIDER_MISMATCH };
    }
    return evaluateClientOtpOperationalGate(
      data as Parameters<typeof evaluateClientOtpOperationalGate>[0],
      provider.data.providerKey
    );
  } catch {
    return { ok: false, reason: ClientOtpGateBlockReason.MISSING_CATALOG_ROW };
  }
}
