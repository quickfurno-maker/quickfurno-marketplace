// ============================================================================
// QuickFurno — lib/communication/providers/whatsappTemplateBinding.ts  (Phase 5F-B)
//
// STRICT, deterministic variable binding for WhatsApp Cloud template sends.
//
// Meta positional parameters MUST come from an EXPLICIT versioned binding schema —
// never from JavaScript object insertion order, alphabetical sorting, Object.values,
// or accidental key order. The renderer validates the schema and the supplied source
// variables and fails closed on any ambiguity; a render failure means NO provider
// call. It carries no QuickFurno business logic — it only maps declared source keys
// onto Meta template component parameters.
// ============================================================================

export const TEMPLATE_BINDING_VERSION = 1;

export type WhatsAppTemplateComponent = "body" | "header" | "button";
export type WhatsAppTemplateParameterType = "text";

export const SUPPORTED_TEMPLATE_COMPONENTS: readonly WhatsAppTemplateComponent[] =
  Object.freeze(["body", "header", "button"]);
export const SUPPORTED_TEMPLATE_PARAMETER_TYPES: readonly WhatsAppTemplateParameterType[] =
  Object.freeze(["text"]);

/** One declared binding: a component + 1-based position ← a named source key. */
export interface WhatsAppTemplateBinding {
  readonly component: WhatsAppTemplateComponent;
  readonly position: number;
  readonly sourceKey: string;
  readonly parameterType: WhatsAppTemplateParameterType;
}

/** The versioned binding schema stored on a provider template mapping. */
export interface WhatsAppTemplateBindingSchema {
  readonly bindingVersion: number;
  readonly bindings: readonly WhatsAppTemplateBinding[];
}

export const TemplateRenderReason = {
  UNSUPPORTED_BINDING_VERSION: "unsupported_binding_version",
  MALFORMED_SCHEMA: "malformed_schema",
  UNSUPPORTED_COMPONENT: "unsupported_component",
  UNSUPPORTED_PARAMETER_TYPE: "unsupported_parameter_type",
  INVALID_POSITION: "invalid_position",
  DUPLICATE_POSITION: "duplicate_position",
  DUPLICATE_SOURCE_BINDING: "duplicate_source_binding",
  MISSING_SOURCE_KEY: "missing_source_key",
  UNDECLARED_SOURCE_VARIABLE: "undeclared_source_variable",
} as const;

export type TemplateRenderReasonValue =
  (typeof TemplateRenderReason)[keyof typeof TemplateRenderReason];

/** A single Meta component parameter (text only in Phase 5F-B). */
export interface MetaTemplateParameter {
  readonly type: "text";
  readonly text: string;
}

export interface MetaTemplateComponent {
  readonly type: WhatsAppTemplateComponent;
  readonly parameters: readonly MetaTemplateParameter[];
}

export type TemplateRenderResult =
  | { readonly ok: true; readonly components: readonly MetaTemplateComponent[] }
  | { readonly ok: false; readonly reason: TemplateRenderReasonValue };

function isPlainSchema(value: unknown): value is WhatsAppTemplateBindingSchema {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { bindings?: unknown }).bindings) &&
    typeof (value as { bindingVersion?: unknown }).bindingVersion === "number"
  );
}

/**
 * Render a template's Meta components STRICTLY from its binding schema + source
 * variables. Deterministic: parameters are ordered by their declared `position`,
 * never by object key order. Fails closed on any of: unsupported version/component/
 * parameter-type, malformed schema, invalid/duplicate position, duplicate source
 * binding, a missing required source key, or an undeclared (extra) source variable.
 */
export function renderWhatsAppTemplateComponents(
  schema: unknown,
  sourceVariables: Record<string, string>
): TemplateRenderResult {
  if (!isPlainSchema(schema)) return { ok: false, reason: TemplateRenderReason.MALFORMED_SCHEMA };
  if (schema.bindingVersion !== TEMPLATE_BINDING_VERSION) {
    return { ok: false, reason: TemplateRenderReason.UNSUPPORTED_BINDING_VERSION };
  }

  const seenPositions = new Set<string>();
  const boundSourceKeys = new Set<string>();
  // component -> position -> parameter
  const byComponent = new Map<WhatsAppTemplateComponent, Map<number, MetaTemplateParameter>>();

  for (const b of schema.bindings) {
    if (!b || typeof b !== "object") return { ok: false, reason: TemplateRenderReason.MALFORMED_SCHEMA };
    if (!SUPPORTED_TEMPLATE_COMPONENTS.includes(b.component)) {
      return { ok: false, reason: TemplateRenderReason.UNSUPPORTED_COMPONENT };
    }
    if (!SUPPORTED_TEMPLATE_PARAMETER_TYPES.includes(b.parameterType)) {
      return { ok: false, reason: TemplateRenderReason.UNSUPPORTED_PARAMETER_TYPE };
    }
    if (!Number.isInteger(b.position) || b.position < 1) {
      return { ok: false, reason: TemplateRenderReason.INVALID_POSITION };
    }
    if (typeof b.sourceKey !== "string" || b.sourceKey.length === 0) {
      return { ok: false, reason: TemplateRenderReason.MALFORMED_SCHEMA };
    }
    const posKey = `${b.component}#${b.position}`;
    if (seenPositions.has(posKey)) return { ok: false, reason: TemplateRenderReason.DUPLICATE_POSITION };
    seenPositions.add(posKey);
    if (boundSourceKeys.has(b.sourceKey)) {
      return { ok: false, reason: TemplateRenderReason.DUPLICATE_SOURCE_BINDING };
    }
    boundSourceKeys.add(b.sourceKey);

    if (!Object.prototype.hasOwnProperty.call(sourceVariables, b.sourceKey)) {
      return { ok: false, reason: TemplateRenderReason.MISSING_SOURCE_KEY };
    }
    const value = sourceVariables[b.sourceKey];
    if (typeof value !== "string") return { ok: false, reason: TemplateRenderReason.MISSING_SOURCE_KEY };

    let compMap = byComponent.get(b.component);
    if (!compMap) {
      compMap = new Map<number, MetaTemplateParameter>();
      byComponent.set(b.component, compMap);
    }
    compMap.set(b.position, { type: "text", text: value });
  }

  // Every supplied source variable MUST be consumed by a declared binding — no
  // silent unbound data reaches the provider.
  for (const key of Object.keys(sourceVariables)) {
    if (!boundSourceKeys.has(key)) {
      return { ok: false, reason: TemplateRenderReason.UNDECLARED_SOURCE_VARIABLE };
    }
  }

  // Emit components in a stable component order, parameters strictly by position.
  const components: MetaTemplateComponent[] = [];
  for (const component of SUPPORTED_TEMPLATE_COMPONENTS) {
    const compMap = byComponent.get(component);
    if (!compMap) continue;
    const positions = [...compMap.keys()].sort((a, b) => a - b);
    components.push({
      type: component,
      parameters: positions.map((p) => compMap.get(p) as MetaTemplateParameter),
    });
  }

  return { ok: true, components };
}
