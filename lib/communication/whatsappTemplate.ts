// ============================================================================
// QuickFurno — lib/communication/whatsappTemplate.ts  (Phase 5F-B)
//
// The resolved WhatsApp template descriptor + the PURE selection of an approved,
// active provider template mapping. A real Meta send must NEVER rely only on the
// legacy `communication_templates.provider_template_name` single slot — it must
// resolve an APPROVED, ACTIVE row from `communication_provider_template_mappings`.
// The mock path keeps using the internal template key (see resolution mode).
//
// This module is pure: the caller supplies the candidate mapping rows (already
// fetched), so there is no DB or network access here and it is fully testable.
// ============================================================================

import type { WhatsAppTemplateBindingSchema } from "./providers/whatsappTemplateBinding";

/**
 * How a provider resolves the template it will send.
 *   internal_template        — the adapter sends using the internal template key
 *                              (MockWhatsAppProvider — no provider mapping needed).
 *   approved_provider_mapping — the adapter REQUIRES an approved, active provider
 *                              mapping (MetaCloudWhatsAppProvider).
 */
export const TemplateResolutionMode = {
  INTERNAL_TEMPLATE: "internal_template",
  APPROVED_PROVIDER_MAPPING: "approved_provider_mapping",
} as const;

export type TemplateResolutionModeValue =
  (typeof TemplateResolutionMode)[keyof typeof TemplateResolutionMode];

/** A fully-resolved provider template descriptor handed to a real adapter. */
export interface WhatsAppResolvedTemplate {
  readonly internalTemplateKey: string;
  readonly providerTemplateName: string;
  readonly providerTemplateId: string | null;
  readonly language: string;
  readonly version: string;
  readonly variablesSchema: WhatsAppTemplateBindingSchema;
  readonly providerKey: string;
  readonly channel: "whatsapp";
}

/** Projection of a `communication_provider_template_mappings` row (non-secret). */
export interface ProviderTemplateMappingRow {
  readonly template_key: string;
  readonly channel: string;
  readonly provider_key: string;
  readonly language: string;
  readonly version: string;
  readonly provider_template_name: string | null;
  readonly provider_template_id: string | null;
  readonly approval_status: string;
  readonly is_active: boolean;
  readonly variables_schema: unknown;
}

export const MappingResolutionReason = {
  NO_MAPPING_FOUND: "no_mapping_found",
  NOT_APPROVED: "not_approved",
  NOT_ACTIVE: "not_active",
  MISSING_PROVIDER_TEMPLATE_NAME: "missing_provider_template_name",
  AMBIGUOUS_ACTIVE_MAPPING: "ambiguous_active_mapping",
} as const;

export type MappingResolutionReasonValue =
  (typeof MappingResolutionReason)[keyof typeof MappingResolutionReason];

export type MappingResolution =
  | { readonly ok: true; readonly template: WhatsAppResolvedTemplate }
  | { readonly ok: false; readonly reason: MappingResolutionReasonValue };

export interface MappingSelectionCriteria {
  readonly templateKey: string;
  readonly providerKey: string;
  readonly language: string;
}

/**
 * Select the single APPROVED, ACTIVE provider mapping for a Meta send from the
 * supplied candidate rows. Requires an exact match on template_key + channel
 * (whatsapp) + provider_key + language, `approval_status = 'approved'`,
 * `is_active = true`, and a non-empty `provider_template_name`. There is NO fallback
 * to the legacy `communication_templates.provider_template_name` for Meta.
 *
 * Fails closed on: no candidate, a candidate that is not approved / not active /
 * missing a provider template name, or more than one active candidate (ambiguous).
 */
export function selectApprovedProviderMapping(
  rows: readonly ProviderTemplateMappingRow[],
  criteria: MappingSelectionCriteria
): MappingResolution {
  const matching = rows.filter(
    (r) =>
      r.template_key === criteria.templateKey &&
      r.channel === "whatsapp" &&
      r.provider_key === criteria.providerKey &&
      r.language === criteria.language
  );
  if (matching.length === 0) return { ok: false, reason: MappingResolutionReason.NO_MAPPING_FOUND };

  const active = matching.filter((r) => r.is_active === true);
  if (active.length === 0) {
    // There is a candidate but none is active — surface the most informative reason.
    const approved = matching.find((r) => r.approval_status === "approved");
    return { ok: false, reason: approved ? MappingResolutionReason.NOT_ACTIVE : MappingResolutionReason.NOT_APPROVED };
  }
  if (active.length > 1) return { ok: false, reason: MappingResolutionReason.AMBIGUOUS_ACTIVE_MAPPING };

  const row = active[0];
  if (row.approval_status !== "approved") return { ok: false, reason: MappingResolutionReason.NOT_APPROVED };
  if (typeof row.provider_template_name !== "string" || row.provider_template_name.trim() === "") {
    return { ok: false, reason: MappingResolutionReason.MISSING_PROVIDER_TEMPLATE_NAME };
  }

  const schema =
    row.variables_schema && typeof row.variables_schema === "object"
      ? (row.variables_schema as WhatsAppTemplateBindingSchema)
      : { bindingVersion: 1, bindings: [] };

  return {
    ok: true,
    template: {
      internalTemplateKey: row.template_key,
      providerTemplateName: row.provider_template_name.trim(),
      providerTemplateId: row.provider_template_id,
      language: row.language,
      version: row.version,
      variablesSchema: schema,
      providerKey: row.provider_key,
      channel: "whatsapp",
    },
  };
}
