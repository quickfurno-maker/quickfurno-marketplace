// ============================================================================
// QuickFurno — QF-MVP-50.2C Client Action Variable Contracts
//
// Canonical Core-side variable construction for the six roadmap-50.2 client
// automation actions.
//
// This module is NOT the provider binding registry. It authorizes no send,
// chooses no destination, template or provider, and performs no I/O.
//
// TWO DELIBERATELY SEPARATE PATHS:
//
//   A. Actions whose template has an approved ordinary-business variable
//      contract delegate to `lib/communication/businessTemplateVariables.ts`.
//      Client Journey V2 promotes `clarification_request` into that same
//      authority because its positional binding is now proven end-to-end.
//
//   B. Actions whose template is still a DRAFT or does not yet exist as a
//      provider candidate declare their intended source keys here instead.
//      Knowing what authoritative Core data an action needs is not the same as
//      claiming an approved provider binding — and must never be mistaken for it.
//
// Pure module: no database, network, environment, clock or provider import.
// ============================================================================

import {
  BusinessSourceKey,
  BusinessVariableReason,
  MAX_BUSINESS_VARIABLE_LENGTH,
  buildClarificationRequestVariables as buildCanonicalClarificationRequestVariables,
  buildClientLeadStatusUpdateVariables,
  buildClientMatchingUpdateVariables,
  buildLeadReceivedVariables,
  type BusinessSourceKeyValue,
  type BusinessVariableReasonValue,
  type BusinessVariableResult,
} from "../communication/businessTemplateVariables";
import type { ClientAutomationActionType } from "./clientDispatchRegistry";

/** Meta rejects newlines/tabs inside a positional text parameter (mirrors 40.12). */
const FORBIDDEN_TEXT = /[\r\n\t]/;

/**
 * Connection-assurance-only source keys. These deliberately DO NOT belong to
 * the frozen QF-MVP-40.12 ordinary-business vocabulary.
 */
const ClientDraftOnlySourceKey = Object.freeze({
  VENDOR_NAME: "vendor_name",
  VENDOR_PHONE: "vendor_phone",
} as const);
type ClientDraftSourceKey =
  | BusinessSourceKeyValue
  | (typeof ClientDraftOnlySourceKey)[keyof typeof ClientDraftOnlySourceKey];

/**
 * Intended source keys for client templates that still lack an approved ordinary
 * business binding. Qualification no longer belongs here: both the initial ask
 * and its reminder use the approved `clarification_request` contract.
 */
export const CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS: Readonly<
  Record<string, readonly ClientDraftSourceKey[]>
> = Object.freeze({
  client_vendor_connection_reminder: Object.freeze([
    BusinessSourceKey.CLIENT_NAME,
    ClientDraftOnlySourceKey.VENDOR_NAME,
    ClientDraftOnlySourceKey.VENDOR_PHONE,
  ]),
});

type FieldResult =
  | { ok: true; value: string }
  | { ok: false; reason: BusinessVariableReasonValue; field: string };

/** Same rules as the 40.12 `text` validator: never defaults, never coerces an object. */
function text(value: unknown, field: string): FieldResult {
  if (value === undefined || value === null) {
    return { ok: false, reason: BusinessVariableReason.MISSING, field };
  }
  if (typeof value !== "string") {
    return { ok: false, reason: BusinessVariableReason.NOT_A_STRING, field };
  }
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
 * Assemble only after every field validates, so a partial record can never escape,
 * and prove the emitted key set equals the declared contract exactly — no extra
 * source value can leak through.
 */
function assembleDraft(
  templateKey: string,
  parts: readonly (readonly [ClientDraftSourceKey, FieldResult])[],
): BusinessVariableResult {
  for (const [, r] of parts) {
    if (!r.ok) return { ok: false, reason: r.reason, field: r.field };
  }
  const variables: Record<string, string> = {};
  for (const [key, r] of parts) variables[key] = (r as { ok: true; value: string }).value;

  const declared = (CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS[templateKey] ?? [])
    .slice().sort().join(",");
  if (declared === "" || Object.keys(variables).sort().join(",") !== declared) {
    return { ok: false, reason: BusinessVariableReason.MISSING, field: templateKey };
  }
  return { ok: true, variables };
}

// ---------------------------------------------------------------------------
// B — client qualification wrappers + remaining draft provider template
// ---------------------------------------------------------------------------

export function buildClarificationRequestVariables(
  input: { clientName: unknown; outstandingItem: unknown },
): BusinessVariableResult {
  return buildCanonicalClarificationRequestVariables(input);
}

export function buildClarificationReminderVariables(
  input: { clientName: unknown; outstandingItem: unknown },
): BusinessVariableResult {
  // The reminder intentionally reuses the same approved Utility provider
  // contract; the old clarification_reminder provider candidate was reclassified
  // as Marketing and remains quarantined.
  return buildCanonicalClarificationRequestVariables(input);
}

export function buildClientVendorConnectionReminderVariables(
  input: { clientName: unknown; vendorName: unknown; vendorPhone: unknown },
): BusinessVariableResult {
  return assembleDraft("client_vendor_connection_reminder", [
    [BusinessSourceKey.CLIENT_NAME, text(input?.clientName, "clientName")],
    [ClientDraftOnlySourceKey.VENDOR_NAME, text(input?.vendorName, "vendorName")],
    [ClientDraftOnlySourceKey.VENDOR_PHONE, text(input?.vendorPhone, "vendorPhone")],
  ]);
}

// ---------------------------------------------------------------------------
// C — closed action → builder lookup
// ---------------------------------------------------------------------------

/**
 * Exactly six entries, keyed by action. There is no generic default builder: an
 * unknown action resolves to nothing and fails closed.
 *
 * The first three delegate to the approved QF-MVP-40.12 authority rather than
 * restating its source-key semantics.
 */
export const CLIENT_ACTION_VARIABLE_BUILDERS: Readonly<
  Record<ClientAutomationActionType, (input: never) => BusinessVariableResult>
> = Object.freeze({
  "client.lead_confirmation": buildLeadReceivedVariables as (input: never) => BusinessVariableResult,
  "client.matching_update": buildClientMatchingUpdateVariables as (input: never) => BusinessVariableResult,
  "client.lead_status_update": buildClientLeadStatusUpdateVariables as (input: never) => BusinessVariableResult,
  "client.requirement_collection": buildClarificationRequestVariables as (input: never) => BusinessVariableResult,
  "client.missing_information_reminder": buildClarificationReminderVariables as (input: never) => BusinessVariableResult,
  "client.transactional_followup": buildClientVendorConnectionReminderVariables as (input: never) => BusinessVariableResult,
});

export function getClientActionVariableBuilder(
  actionType: unknown,
): ((input: never) => BusinessVariableResult) | null {
  if (typeof actionType !== "string") return null;
  return (
    (CLIENT_ACTION_VARIABLE_BUILDERS as Record<string, (input: never) => BusinessVariableResult>)[
      actionType
    ] ?? null
  );
}
