// ============================================================================
// QuickFurno — services/vendorAuthAutomationService.ts   (server-only)
//
// The ONE place that loads a vendor auth automation catalog row and evaluates its
// operational gate against the ACTIVE WhatsApp provider adapter. Both the vendor
// WhatsApp verification flow and the vendor password reset flow consult it, so the
// production kill-switch (`is_operationally_enabled`) is enforced identically on
// every path and there is no second, weaker copy of the gate logic.
//
// Phase 5E ships both automations disabled (`mock_ready`, provider `mock`), so
// this returns a blocked decision in production — no provider is ever invoked by
// this phase alone.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { isMissingRelationError } from "../lib/errors";
import {
  VendorAuthGateBlockReason,
  evaluateVendorAuthGate,
  type VendorAuthAutomationBinding,
  type VendorAuthGateDecision,
} from "../lib/identity/vendorAuthAutomation";
import { getActiveWhatsAppProvider } from "./communicationService";

const AUTOMATION_CATALOG_TABLE = "communication_automation_catalog";

const CATALOG_COLUMNS =
  "automation_key, lane, channel, template_key, readiness_status, provider_required, is_operationally_enabled";

/**
 * Load `binding`'s automation row and decide whether the WhatsApp provider may be
 * invoked right now. Fails CLOSED on a missing row, a lookup error, or a schema
 * that predates Phase 5B. The active provider key comes from the Phase 5B provider
 * registry, never a hardcoded literal.
 */
export async function evaluateVendorAuthAutomationGate(
  binding: VendorAuthAutomationBinding
): Promise<VendorAuthGateDecision> {
  try {
    const { data, error } = await adminClient()
      .from(AUTOMATION_CATALOG_TABLE)
      .select(CATALOG_COLUMNS)
      .eq("automation_key", binding.automationKey)
      .maybeSingle();

    if (error) {
      // Communication core not applied here → fail closed, exactly as a missing row.
      if (isMissingRelationError(error)) {
        return { ok: false, reason: VendorAuthGateBlockReason.MISSING_CATALOG_ROW };
      }
      return { ok: false, reason: VendorAuthGateBlockReason.MISSING_CATALOG_ROW };
    }

    return evaluateVendorAuthGate(
      data as Parameters<typeof evaluateVendorAuthGate>[0],
      getActiveWhatsAppProvider().providerKey,
      binding
    );
  } catch {
    return { ok: false, reason: VendorAuthGateBlockReason.MISSING_CATALOG_ROW };
  }
}
