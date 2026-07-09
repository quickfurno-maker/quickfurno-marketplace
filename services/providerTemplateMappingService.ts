// ============================================================================
// QuickFurno — services/providerTemplateMappingService.ts  (Phase 5F-B, server-only)
//
// Resolves the APPROVED, ACTIVE provider template mapping for a Meta send from
// `communication_provider_template_mappings`. Thin DB wrapper over the pure
// `selectApprovedProviderMapping`. There is NO fallback to the legacy
// `communication_templates.provider_template_name` for Meta. It fabricates nothing:
// no mapping row, provider template name/id, or approval is ever created here.
// ============================================================================

import { adminClient } from "../lib/supabase";
import {
  selectApprovedProviderMapping,
  type MappingResolution,
  type ProviderTemplateMappingRow,
} from "../lib/communication/whatsappTemplate";
import { META_WHATSAPP_CLOUD_PROVIDER_KEY } from "../lib/communication/providers/metaCloudWhatsAppProvider";

const CHANNEL = "whatsapp";

/**
 * Resolve the Meta provider template for an internal template key + language. Reads
 * the candidate mapping rows and delegates the (strict) selection to the pure
 * resolver. Fails closed when no approved active mapping exists.
 */
export async function resolveApprovedMetaMapping(input: {
  readonly templateKey: string;
  readonly language: string;
  readonly providerKey?: string;
}): Promise<MappingResolution> {
  const providerKey = input.providerKey ?? META_WHATSAPP_CLOUD_PROVIDER_KEY;
  const { data, error } = await adminClient()
    .from("communication_provider_template_mappings")
    .select("*")
    .eq("template_key", input.templateKey)
    .eq("channel", CHANNEL)
    .eq("provider_key", providerKey)
    .eq("language", input.language);
  if (error) return { ok: false, reason: "no_mapping_found" };
  const rows = (data ?? []) as ProviderTemplateMappingRow[];
  return selectApprovedProviderMapping(rows, {
    templateKey: input.templateKey,
    providerKey,
    language: input.language,
  });
}
