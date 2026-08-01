// ============================================================================
// QuickFurno — lib/communication/businessTemplateVariables.ts
// QF-MVP-40.12-R1 — canonical transport-variable contract for the five approved
// ORDINARY BUSINESS templates.  PURE.  OFFLINE.
//
// WHY THIS EXISTS
// A provider mapping's `variables_schema` binds each Meta positional parameter to a
// NAMED source key, and `renderWhatsAppTemplateComponents` resolves those names against
// the intent's `variables`. Positions are therefore meaningless without an authoritative
// name: a description like "client name" or an example like "Asha" proves nothing, and
// object insertion order is not a contract. Until this module existed there was no
// proven source key for these templates, so the QF-MVP-40.12 seed operator correctly
// refused to fabricate one (BINDING_SCHEMA_UNPROVEN).
//
// This module IS that authority. It is the ONLY accepted construction path for these
// five templates' variables, and the mapping `variables_schema` is derived from the same
// contract — so the names in the database and the names a caller supplies cannot drift.
//
// WHAT THIS IS NOT
// These builders authorize nothing. They do not choose a recipient, do not enqueue,
// send, or read env/database/network/clock. Consent, suppression, runtime policy, an
// enabled provider account and an ACTIVE exact mapping are all still required before any
// message can leave. The business triggers that will eventually call these builders are
// NOT wired yet — this establishes the contract, not the automation.
// ============================================================================

import {
  ComponentProfile,
  TEMPLATE_BINDING_VERSION,
  type ComponentProfileValue,
  type WhatsAppTemplateBindingSchema,
} from "./providers/whatsappTemplateBinding";

/** Bounded so a runaway field can never become an unbounded provider payload. */
export const MAX_BUSINESS_VARIABLE_LENGTH = 200;
/** Meta rejects newlines/tabs inside a positional text parameter. */
const FORBIDDEN_TEXT = /[\r\n\t]/;

export const BusinessVariableReason = {
  MISSING: "missing_variable",
  NOT_A_STRING: "not_a_string",
  EMPTY: "empty_variable",
  TOO_LONG: "variable_too_long",
  FORBIDDEN_CHARACTER: "forbidden_character",
  NOT_AN_INTEGER: "not_an_integer",
  NEGATIVE: "negative_value",
} as const;
export type BusinessVariableReasonValue =
  (typeof BusinessVariableReason)[keyof typeof BusinessVariableReason];

export type BusinessVariableResult =
  | { readonly ok: true; readonly variables: Record<string, string> }
  | { readonly ok: false; readonly reason: BusinessVariableReasonValue; readonly field: string };

/**
 * The closed source-key vocabulary. These are TRANSPORT variable names — not database
 * columns — and adding to this list is a deliberate governance act, not an refactor.
 */
export const BusinessSourceKey = Object.freeze({
  CLIENT_NAME: "client_name",
  LEAD_STATUS_LABEL: "lead_status_label",
  MATCHED_VENDOR_COUNT: "matched_vendor_count",
  LEAD_REFERENCE: "lead_reference",
  OUTSTANDING_ITEM: "outstanding_item",
} as const);
export type BusinessSourceKeyValue = (typeof BusinessSourceKey)[keyof typeof BusinessSourceKey];

/** One declared positional binding, in the exact shape the renderer consumes. */
export interface BusinessTemplateBinding {
  readonly component: "body";
  readonly position: number;
  readonly sourceKey: BusinessSourceKeyValue;
  readonly parameterType: "text";
}

export interface BusinessTemplateContract {
  readonly templateKey: string;
  readonly bindingVersion: number;
  readonly profile: ComponentProfileValue;
  readonly bindings: readonly BusinessTemplateBinding[];
}

const body = (position: number, sourceKey: BusinessSourceKeyValue): BusinessTemplateBinding =>
  ({ component: "body", position, sourceKey, parameterType: "text" });

/**
 * THE AUTHORITY. Position is declared explicitly on every binding — it is never inferred
 * from array index, object order or alphabetical order.
 */
export const BUSINESS_TEMPLATE_CONTRACTS: Readonly<Record<string, BusinessTemplateContract>> =
  Object.freeze({
    lead_received: Object.freeze({
      templateKey: "lead_received",
      bindingVersion: TEMPLATE_BINDING_VERSION,
      profile: ComponentProfile.STANDARD_TEXT,
      bindings: Object.freeze([body(1, BusinessSourceKey.CLIENT_NAME)]),
    }),
    client_lead_status_update: Object.freeze({
      templateKey: "client_lead_status_update",
      bindingVersion: TEMPLATE_BINDING_VERSION,
      profile: ComponentProfile.STANDARD_TEXT,
      bindings: Object.freeze([
        body(1, BusinessSourceKey.CLIENT_NAME),
        body(2, BusinessSourceKey.LEAD_STATUS_LABEL),
      ]),
    }),
    client_matching_update: Object.freeze({
      templateKey: "client_matching_update",
      bindingVersion: TEMPLATE_BINDING_VERSION,
      profile: ComponentProfile.STANDARD_TEXT,
      bindings: Object.freeze([
        body(1, BusinessSourceKey.CLIENT_NAME),
        body(2, BusinessSourceKey.MATCHED_VENDOR_COUNT),
      ]),
    }),
    lead_assignment_alert: Object.freeze({
      templateKey: "lead_assignment_alert",
      bindingVersion: TEMPLATE_BINDING_VERSION,
      profile: ComponentProfile.STANDARD_TEXT,
      bindings: Object.freeze([body(1, BusinessSourceKey.LEAD_REFERENCE)]),
    }),
    vendor_onboarding_reminder: Object.freeze({
      templateKey: "vendor_onboarding_reminder",
      bindingVersion: TEMPLATE_BINDING_VERSION,
      profile: ComponentProfile.STANDARD_TEXT,
      bindings: Object.freeze([body(1, BusinessSourceKey.OUTSTANDING_ITEM)]),
    }),
  });

export const BUSINESS_TEMPLATE_KEYS: readonly string[] =
  Object.freeze(Object.keys(BUSINESS_TEMPLATE_CONTRACTS));

/** The exact source keys a template accepts, ordered by declared position. */
export function sourceKeysFor(templateKey: string): readonly string[] {
  const c = BUSINESS_TEMPLATE_CONTRACTS[templateKey];
  if (!c) return [];
  return c.bindings.slice().sort((a, b) => a.position - b.position).map((b) => b.sourceKey);
}

/** The mapping `variables_schema` for a template — the SAME contract the builders use. */
export function bindingSchemaFor(templateKey: string): WhatsAppTemplateBindingSchema | null {
  const c = BUSINESS_TEMPLATE_CONTRACTS[templateKey];
  if (!c) return null;
  return {
    bindingVersion: c.bindingVersion,
    bindings: c.bindings.slice().sort((a, b) => a.position - b.position)
      .map((b) => ({ component: b.component, position: b.position, sourceKey: b.sourceKey,
                     parameterType: b.parameterType })),
  };
}

// ---------------------------------------------------------------------------
// Validation — never silently defaults, never coerces an object.
// ---------------------------------------------------------------------------

function text(value: unknown, field: string): { ok: true; value: string } | { ok: false; reason: BusinessVariableReasonValue; field: string } {
  if (value === undefined || value === null) return { ok: false, reason: BusinessVariableReason.MISSING, field };
  // A non-primitive must never be stringified into "[object Object]".
  if (typeof value !== "string") return { ok: false, reason: BusinessVariableReason.NOT_A_STRING, field };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: BusinessVariableReason.EMPTY, field };
  if (trimmed.length > MAX_BUSINESS_VARIABLE_LENGTH) {
    return { ok: false, reason: BusinessVariableReason.TOO_LONG, field };
  }
  if (FORBIDDEN_TEXT.test(trimmed)) {
    return { ok: false, reason: BusinessVariableReason.FORBIDDEN_CHARACTER, field };
  }
  return { ok: true, value: trimmed };
}

/**
 * A count is rendered as a deterministic decimal string. A number must be a non-negative
 * safe integer; a string must already be plain decimal digits. Arrays, floats, NaN,
 * negatives and comma-separated identity lists are all refused.
 */
function decimalCount(value: unknown, field: string): { ok: true; value: string } | { ok: false; reason: BusinessVariableReasonValue; field: string } {
  if (value === undefined || value === null) return { ok: false, reason: BusinessVariableReason.MISSING, field };
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return { ok: false, reason: BusinessVariableReason.NOT_AN_INTEGER, field };
    if (value < 0) return { ok: false, reason: BusinessVariableReason.NEGATIVE, field };
    return { ok: true, value: String(value) };
  }
  if (typeof value !== "string") return { ok: false, reason: BusinessVariableReason.NOT_A_STRING, field };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: BusinessVariableReason.EMPTY, field };
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: BusinessVariableReason.NOT_AN_INTEGER, field };
  return { ok: true, value: String(Number(trimmed)) };
}

/** Assemble only after every field validates, so a partial record can never escape. */
function assemble(
  templateKey: string,
  parts: readonly (readonly [BusinessSourceKeyValue, { ok: true; value: string } | { ok: false; reason: BusinessVariableReasonValue; field: string }])[]
): BusinessVariableResult {
  for (const [, r] of parts) {
    if (!r.ok) return { ok: false, reason: r.reason, field: r.field };
  }
  const variables: Record<string, string> = {};
  for (const [key, r] of parts) variables[key] = (r as { ok: true; value: string }).value;
  // Belt and braces: the emitted key set must equal the declared contract exactly.
  const declared = sourceKeysFor(templateKey).slice().sort().join(",");
  if (Object.keys(variables).sort().join(",") !== declared) {
    return { ok: false, reason: BusinessVariableReason.MISSING, field: templateKey };
  }
  return { ok: true, variables };
}

// ---------------------------------------------------------------------------
// Builders — the canonical construction path.
// ---------------------------------------------------------------------------

export function buildLeadReceivedVariables(input: { clientName: unknown }): BusinessVariableResult {
  return assemble("lead_received", [
    [BusinessSourceKey.CLIENT_NAME, text(input?.clientName, "clientName")],
  ]);
}

export function buildClientLeadStatusUpdateVariables(
  input: { clientName: unknown; leadStatusLabel: unknown }
): BusinessVariableResult {
  return assemble("client_lead_status_update", [
    [BusinessSourceKey.CLIENT_NAME, text(input?.clientName, "clientName")],
    [BusinessSourceKey.LEAD_STATUS_LABEL, text(input?.leadStatusLabel, "leadStatusLabel")],
  ]);
}

export function buildClientMatchingUpdateVariables(
  input: { clientName: unknown; matchedVendorCount: unknown }
): BusinessVariableResult {
  return assemble("client_matching_update", [
    [BusinessSourceKey.CLIENT_NAME, text(input?.clientName, "clientName")],
    [BusinessSourceKey.MATCHED_VENDOR_COUNT, decimalCount(input?.matchedVendorCount, "matchedVendorCount")],
  ]);
}

export function buildLeadAssignmentAlertVariables(
  input: { leadReference: unknown }
): BusinessVariableResult {
  return assemble("lead_assignment_alert", [
    [BusinessSourceKey.LEAD_REFERENCE, text(input?.leadReference, "leadReference")],
  ]);
}

export function buildVendorOnboardingReminderVariables(
  input: { outstandingItem: unknown }
): BusinessVariableResult {
  return assemble("vendor_onboarding_reminder", [
    [BusinessSourceKey.OUTSTANDING_ITEM, text(input?.outstandingItem, "outstandingItem")],
  ]);
}

/** Builder lookup by template key, so callers cannot hand-roll a variable record. */
export const BUSINESS_VARIABLE_BUILDERS: Readonly<Record<string, (input: never) => BusinessVariableResult>> =
  Object.freeze({
    lead_received: buildLeadReceivedVariables as (input: never) => BusinessVariableResult,
    client_lead_status_update: buildClientLeadStatusUpdateVariables as (input: never) => BusinessVariableResult,
    client_matching_update: buildClientMatchingUpdateVariables as (input: never) => BusinessVariableResult,
    lead_assignment_alert: buildLeadAssignmentAlertVariables as (input: never) => BusinessVariableResult,
    vendor_onboarding_reminder: buildVendorOnboardingReminderVariables as (input: never) => BusinessVariableResult,
  });
