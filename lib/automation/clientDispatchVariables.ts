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
//   A. Actions whose template is one of the five APPROVED ordinary business
//      templates delegate to the QF-MVP-40.12-R1 authority in
//      `lib/communication/businessTemplateVariables.ts`. Their source-key
//      semantics are owned there and are not restated here.
//
//   B. Actions whose template is still a DRAFT or does not yet exist as a
//      provider candidate declare their intended source keys here instead.
//      Knowing what authoritative Core data an action needs is not the same as
//      claiming an approved provider binding — and must never be mistaken for
//      it. BUSINESS_TEMPLATE_CONTRACTS stays at five; promoting a draft into
//      provider binding authority is a separately governed 40.x act.
//
// Pure module: no database, network, environment, clock or provider import.
// ============================================================================

import {
  BusinessSourceKey,
  BusinessVariableReason,
  MAX_BUSINESS_VARIABLE_LENGTH,
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
 * The intended source keys for the three client actions whose provider template is
 * NOT an approved QF-MVP-40.12 binding.
 *
 * `clarification_request` and `clarification_reminder` exist in the provider manifest
 * as DRAFT candidates. `client_transactional_followup` has no provider candidate at
 * all — it is Core dispatch intent only, and a separately governed provider-contract
 * task must create, review, submit and map it before any real send can succeed.
 */
export const CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS: Readonly<
  Record<string, readonly BusinessSourceKeyValue[]>
> = Object.freeze({
  clarification_request: Object.freeze([
    BusinessSourceKey.CLIENT_NAME,
    BusinessSourceKey.OUTSTANDING_ITEM,
  ]),
  clarification_reminder: Object.freeze([
    BusinessSourceKey.CLIENT_NAME,
    BusinessSourceKey.OUTSTANDING_ITEM,
  ]),
  client_transactional_followup: Object.freeze([
    BusinessSourceKey.CLIENT_NAME,
    BusinessSourceKey.LEAD_REFERENCE,
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
  parts: readonly (readonly [BusinessSourceKeyValue, FieldResult])[],
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
// B — draft / not-yet-existing provider templates
// ---------------------------------------------------------------------------

export function buildClarificationRequestVariables(
  input: { clientName: unknown; outstandingItem: unknown },
): BusinessVariableResult {
  return assembleDraft("clarification_request", [
    [BusinessSourceKey.CLIENT_NAME, text(input?.clientName, "clientName")],
    [BusinessSourceKey.OUTSTANDING_ITEM, text(input?.outstandingItem, "outstandingItem")],
  ]);
}

export function buildClarificationReminderVariables(
  input: { clientName: unknown; outstandingItem: unknown },
): BusinessVariableResult {
  return assembleDraft("clarification_reminder", [
    [BusinessSourceKey.CLIENT_NAME, text(input?.clientName, "clientName")],
    [BusinessSourceKey.OUTSTANDING_ITEM, text(input?.outstandingItem, "outstandingItem")],
  ]);
}

export function buildClientTransactionalFollowupVariables(
  input: { clientName: unknown; leadReference: unknown },
): BusinessVariableResult {
  return assembleDraft("client_transactional_followup", [
    [BusinessSourceKey.CLIENT_NAME, text(input?.clientName, "clientName")],
    [BusinessSourceKey.LEAD_REFERENCE, text(input?.leadReference, "leadReference")],
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
  "client.transactional_followup": buildClientTransactionalFollowupVariables as (input: never) => BusinessVariableResult,
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
