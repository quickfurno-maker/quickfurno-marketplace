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

// ============================================================================
// QF-MVP-40.6-R2 — PROVIDER COMPONENT PROFILES (binding schema v2)
//
// v1 could express ONLY `{ type, parameters:[{type:"text"}] }`. Verified against
// current official Meta documentation, that cannot send:
//   * a quick-reply button — needs `sub_type:"quick_reply"`, an `index`, and a
//     `{type:"payload", payload:...}` parameter, with ONE component PER button;
//   * a copy-code authentication template — its send shape is
//     `{type:"button", sub_type:"url", index:"0", parameters:[{type:"text"}]}`
//     and Meta requires the OTP value to appear TWICE (body + button).
// v1's DUPLICATE_SOURCE_BINDING rule made that second occurrence impossible.
//
// v1 remains supported and UNCHANGED for existing STANDARD_TEXT mappings.
// v2 adds an explicit, closed `profile` — never an arbitrary JSON passthrough, and
// a provider mapping can never inject a component shape of its own choosing.
// ============================================================================

export const TEMPLATE_BINDING_VERSION = 1;
export const TEMPLATE_BINDING_VERSION_2 = 2;
export const SUPPORTED_BINDING_VERSIONS: readonly number[] = Object.freeze([1, 2]);

/** Closed set of provider component profiles. */
export const ComponentProfile = Object.freeze({
  STANDARD_TEXT: "STANDARD_TEXT",
  QUICK_REPLY: "QUICK_REPLY",
  AUTH_OTP_COPY_CODE: "AUTH_OTP_COPY_CODE",
} as const);
export type ComponentProfileValue = (typeof ComponentProfile)[keyof typeof ComponentProfile];
export const COMPONENT_PROFILES: readonly ComponentProfileValue[] =
  Object.freeze([ComponentProfile.STANDARD_TEXT, ComponentProfile.QUICK_REPLY, ComponentProfile.AUTH_OTP_COPY_CODE]);

/** Button sub-types Meta accepts on a SEND. `url` is what a copy-code OTP uses. */
export const SUPPORTED_BUTTON_SUB_TYPES: readonly string[] = Object.freeze(["quick_reply", "url"]);

/** Quick-reply payloads are opaque action tokens. Bounded, lowercase, no PII. */
export const QUICK_REPLY_PAYLOAD_PATTERN = /^[a-z0-9_:-]{1,64}$/;
export const MAX_BUTTON_INDEX = 9;   // Meta allows up to 10 buttons (indices 0..9)

export type WhatsAppTemplateComponent = "body" | "header" | "button";
export type WhatsAppTemplateParameterType = "text" | "payload";

export const SUPPORTED_TEMPLATE_COMPONENTS: readonly WhatsAppTemplateComponent[] =
  Object.freeze(["body", "header", "button"]);
export const SUPPORTED_TEMPLATE_PARAMETER_TYPES: readonly WhatsAppTemplateParameterType[] =
  Object.freeze(["text", "payload"]);

/** One declared binding: a component + 1-based position ← a named source key. */
export interface WhatsAppTemplateBinding {
  readonly component: WhatsAppTemplateComponent;
  readonly position: number;
  readonly sourceKey: string;
  readonly parameterType: WhatsAppTemplateParameterType;
  /** v2, button only: EXPLICIT zero-based index. Never inferred from ordering. */
  readonly buttonIndex?: number;
  /** v2, button only: exact sub-type. Never caller-chosen free text. */
  readonly buttonSubType?: string;
}

/** The versioned binding schema stored on a provider template mapping. */
export interface WhatsAppTemplateBindingSchema {
  readonly bindingVersion: number;
  readonly bindings: readonly WhatsAppTemplateBinding[];
  /** v2 only. Absent ⇒ STANDARD_TEXT. */
  readonly profile?: ComponentProfileValue;
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
  UNSUPPORTED_PROFILE: "unsupported_profile",
  PROFILE_COMPONENT_NOT_ALLOWED: "profile_component_not_allowed",
  INVALID_BUTTON_INDEX: "invalid_button_index",
  DUPLICATE_BUTTON_INDEX: "duplicate_button_index",
  INVALID_BUTTON_SUB_TYPE: "invalid_button_sub_type",
  INVALID_PAYLOAD_VALUE: "invalid_payload_value",
  PROFILE_SHAPE_VIOLATION: "profile_shape_violation",
} as const;

export type TemplateRenderReasonValue =
  (typeof TemplateRenderReason)[keyof typeof TemplateRenderReason];

/** A single Meta component parameter (text only in Phase 5F-B). */
export type MetaTemplateParameter =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "payload"; readonly payload: string };

export interface MetaTemplateComponent {
  readonly type: WhatsAppTemplateComponent;
  /** Emitted for button components only. */
  readonly sub_type?: string;
  /** Meta's own examples send this as a STRING ("0"), so it is serialised as one. */
  readonly index?: string;
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
  if (!SUPPORTED_BINDING_VERSIONS.includes(schema.bindingVersion)) {
    return { ok: false, reason: TemplateRenderReason.UNSUPPORTED_BINDING_VERSION };
  }

  // v1 schemas are STANDARD_TEXT by definition; v2 must name a known profile.
  const profile: ComponentProfileValue =
    schema.bindingVersion === TEMPLATE_BINDING_VERSION
      ? ComponentProfile.STANDARD_TEXT
      : (schema.profile ?? ComponentProfile.STANDARD_TEXT);
  if (!COMPONENT_PROFILES.includes(profile)) {
    return { ok: false, reason: TemplateRenderReason.UNSUPPORTED_PROFILE };
  }
  // A v1 schema may not smuggle in a button profile.
  if (schema.bindingVersion === TEMPLATE_BINDING_VERSION && schema.profile !== undefined
      && schema.profile !== ComponentProfile.STANDARD_TEXT) {
    return { ok: false, reason: TemplateRenderReason.UNSUPPORTED_PROFILE };
  }

  const seenPositions = new Set<string>();
  const boundSourceKeys = new Set<string>();
  const seenButtonIndices = new Set<number>();
  const byKey = new Map<string, { component: WhatsAppTemplateComponent; subType?: string;
                                  index?: number; params: Map<number, MetaTemplateParameter> }>();
  let bodyOtpKey: string | null = null;
  let buttonOtpKey: string | null = null;

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

    const isButton = b.component === "button";

    // ---- PROFILE RULES -----------------------------------------------------
    if (profile === ComponentProfile.STANDARD_TEXT) {
      // Exactly v1 semantics: text only, and no button metadata may appear.
      if (b.parameterType !== "text") return { ok: false, reason: TemplateRenderReason.UNSUPPORTED_PARAMETER_TYPE };
      if (b.buttonIndex !== undefined || b.buttonSubType !== undefined) {
        return { ok: false, reason: TemplateRenderReason.PROFILE_SHAPE_VIOLATION };
      }
    } else if (profile === ComponentProfile.QUICK_REPLY) {
      if (isButton) {
        if (b.buttonSubType !== "quick_reply") return { ok: false, reason: TemplateRenderReason.INVALID_BUTTON_SUB_TYPE };
        if (b.parameterType !== "payload") return { ok: false, reason: TemplateRenderReason.PROFILE_SHAPE_VIOLATION };
      } else if (b.parameterType !== "text" || b.buttonIndex !== undefined || b.buttonSubType !== undefined) {
        return { ok: false, reason: TemplateRenderReason.PROFILE_SHAPE_VIOLATION };
      }
    } else {
      // AUTH_OTP_COPY_CODE — the ONLY profile where one source key may appear twice.
      if (b.component === "header") return { ok: false, reason: TemplateRenderReason.PROFILE_COMPONENT_NOT_ALLOWED };
      if (b.parameterType !== "text") return { ok: false, reason: TemplateRenderReason.PROFILE_SHAPE_VIOLATION };
      if (isButton) {
        if (b.buttonSubType !== "url") return { ok: false, reason: TemplateRenderReason.INVALID_BUTTON_SUB_TYPE };
        if (b.buttonIndex !== 0) return { ok: false, reason: TemplateRenderReason.INVALID_BUTTON_INDEX };
        buttonOtpKey = b.sourceKey;
      } else {
        if (b.position !== 1) return { ok: false, reason: TemplateRenderReason.PROFILE_SHAPE_VIOLATION };
        bodyOtpKey = b.sourceKey;
      }
    }

    // ---- EXPLICIT BUTTON INDEX (never inferred from ordering) --------------
    let idx: number | undefined;
    if (isButton && profile !== ComponentProfile.STANDARD_TEXT) {
      idx = b.buttonIndex;
      if (!Number.isInteger(idx) || (idx as number) < 0 || (idx as number) > MAX_BUTTON_INDEX) {
        return { ok: false, reason: TemplateRenderReason.INVALID_BUTTON_INDEX };
      }
      if (!SUPPORTED_BUTTON_SUB_TYPES.includes(b.buttonSubType as string)) {
        return { ok: false, reason: TemplateRenderReason.INVALID_BUTTON_SUB_TYPE };
      }
      if (seenButtonIndices.has(idx as number)) {
        return { ok: false, reason: TemplateRenderReason.DUPLICATE_BUTTON_INDEX };
      }
      seenButtonIndices.add(idx as number);
    }

    const groupKey = idx === undefined ? b.component : "button#" + String(idx);
    const posKey = groupKey + "#" + String(b.position);
    if (seenPositions.has(posKey)) return { ok: false, reason: TemplateRenderReason.DUPLICATE_POSITION };
    seenPositions.add(posKey);

    // Duplicate-source protection stays ON for every profile. AUTH_OTP_COPY_CODE
    // does not remove it globally: it permits exactly ONE reuse, and only the
    // body-and-button OTP pair Meta requires, verified after the loop.
    if (boundSourceKeys.has(b.sourceKey) && profile !== ComponentProfile.AUTH_OTP_COPY_CODE) {
      return { ok: false, reason: TemplateRenderReason.DUPLICATE_SOURCE_BINDING };
    }
    boundSourceKeys.add(b.sourceKey);

    if (!Object.prototype.hasOwnProperty.call(sourceVariables, b.sourceKey)) {
      return { ok: false, reason: TemplateRenderReason.MISSING_SOURCE_KEY };
    }
    const value = sourceVariables[b.sourceKey];
    if (typeof value !== "string") return { ok: false, reason: TemplateRenderReason.MISSING_SOURCE_KEY };

    let param: MetaTemplateParameter;
    if (b.parameterType === "payload") {
      // Opaque, bounded action token: a destination, a name or free text can never
      // reach Meta through a quick-reply payload.
      if (!QUICK_REPLY_PAYLOAD_PATTERN.test(value)) {
        return { ok: false, reason: TemplateRenderReason.INVALID_PAYLOAD_VALUE };
      }
      param = { type: "payload", payload: value };
    } else {
      param = { type: "text", text: value };
    }

    let group = byKey.get(groupKey);
    if (!group) {
      group = { component: b.component, subType: b.buttonSubType, index: idx, params: new Map() };
      byKey.set(groupKey, group);
    }
    group.params.set(b.position, param);
  }

  // AUTH_OTP_COPY_CODE must be EXACTLY Meta's required pair: the same OTP source in
  // the body and in button index 0, and nothing else.
  if (profile === ComponentProfile.AUTH_OTP_COPY_CODE) {
    if (!bodyOtpKey || !buttonOtpKey || bodyOtpKey !== buttonOtpKey) {
      return { ok: false, reason: TemplateRenderReason.PROFILE_SHAPE_VIOLATION };
    }
    if (boundSourceKeys.size !== 1 || schema.bindings.length !== 2) {
      return { ok: false, reason: TemplateRenderReason.PROFILE_SHAPE_VIOLATION };
    }
  }

  for (const key of Object.keys(sourceVariables)) {
    if (!boundSourceKeys.has(key)) {
      return { ok: false, reason: TemplateRenderReason.UNDECLARED_SOURCE_VARIABLE };
    }
  }

  // Stable emission: body, header, then one component PER button, ascending index.
  const components: MetaTemplateComponent[] = [];
  for (const component of SUPPORTED_TEMPLATE_COMPONENTS) {
    if (component === "button") continue;
    const group = byKey.get(component);
    if (!group) continue;
    const positions = [...group.params.keys()].sort((a, b) => a - b);
    components.push({ type: component, parameters: positions.map((x) => group.params.get(x) as MetaTemplateParameter) });
  }
  const buttonGroups = [...byKey.values()].filter((g) => g.component === "button")
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const g of buttonGroups) {
    const positions = [...g.params.keys()].sort((a, b) => a - b);
    const params = positions.map((x) => g.params.get(x) as MetaTemplateParameter);
    components.push(g.index === undefined
      ? { type: "button", parameters: params }
      : { type: "button", sub_type: g.subType, index: String(g.index), parameters: params });
  }

  return { ok: true, components };
}
