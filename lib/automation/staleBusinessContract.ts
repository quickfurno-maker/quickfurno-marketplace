// ============================================================================
// QuickFurno — lib/automation/staleBusinessContract.ts   (PURE)
//
// QF-MVP-50.7 — the transport half of stale-business terminalization.
//
// The DECISION rules live in `vendorBusinessEligibility.ts`, shared with the
// executor. THIS module owns only the wire contract: what a caller may say, what
// Core may say back, and the fixed reason it writes.
//
// THE POINT OF THE EXACT-KEY PARSE
//   A maintenance lane that could be told WHICH job to terminalize would be a
//   remote job-cancellation API wearing a maintenance costume. So the body is an
//   exact three-key set and a fourth key is REJECTED rather than ignored — a
//   reader of `parseCancelStaleRequestBody` can see that Core could not have been
//   told which job to cancel, instead of having to trust a comment saying so.
//
// PURE. No database, no network, no provider, no send.
// ============================================================================

import {
  STALE_BUSINESS_ACTIONS,
  STALE_BUSINESS_SAFE_CODE,
  isStaleBusinessAction,
  type StaleBusinessAction,
} from "./vendorBusinessEligibility";

export { STALE_BUSINESS_ACTIONS, STALE_BUSINESS_SAFE_CODE, isStaleBusinessAction };
export type { StaleBusinessAction };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The COMPLETE set of body keys, sorted. There is deliberately no jobId,
 * actionRequestId, entityId, entityType, actionType, workflowFamily, stale,
 * eligible, businessState, reason, safeCode, status, force, limit, batchSize,
 * sourceEventKey or expectedState field.
 */
export const N8N_CANCEL_STALE_REQUEST_KEYS = Object.freeze([
  "requestId",
  "transportVersion",
  "workerId",
] as const);

/**
 * Named purely so the gate can execute the refusal for each one. Every entry
 * here must be rejected with AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID.
 */
export const N8N_CANCEL_STALE_FORBIDDEN_BODY_KEYS = Object.freeze([
  "actionRequestId", "actionType", "batchSize", "businessState", "eligible",
  "entityId", "entityType", "expectedState", "force", "jobId", "limit",
  "reason", "safeCode", "sourceEventKey", "stale", "status", "workflowFamily",
] as const);

export interface AutomationCancelStaleRequestBody {
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly workerId: string;
}

export type AutomationCancelStaleParseResult =
  | { readonly ok: true; readonly body: AutomationCancelStaleRequestBody }
  | { readonly ok: false; readonly status: number; readonly code: string };

export function parseCancelStaleRequestBody(rawBody: string): AutomationCancelStaleParseResult {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_JSON_INVALID" };
  }

  if (!isRecord(value)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_INVALID" };
  }

  // EXACT key set. Any extra field is a rejection — that is what makes "n8n
  // cannot nominate work" a structural fact rather than a convention.
  const keys = Object.keys(value).sort();
  if (
    keys.length !== N8N_CANCEL_STALE_REQUEST_KEYS.length ||
    keys.some((key, index) => key !== N8N_CANCEL_STALE_REQUEST_KEYS[index])
  ) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID" };
  }

  if (value.transportVersion !== 1) {
    return { ok: false, status: 400, code: "TRANSPORT_VERSION_INVALID" };
  }
  if (typeof value.requestId !== "string" || !UUID_RE.test(value.requestId)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_REQUEST_ID_INVALID" };
  }
  if (typeof value.workerId !== "string" || !SAFE_WORKER_RE.test(value.workerId)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_WORKER_ID_INVALID" };
  }

  return {
    ok: true,
    body: { transportVersion: 1, requestId: value.requestId, workerId: value.workerId },
  };
}

/**
 * The COMPLETE, closed set of Core-authored `cancel_stale_v1` states.
 *
 *   cancel_stale_empty      nothing provably stale. n8n stops.
 *   cancel_stale_cancelled  exactly one stale job moved to the terminal cancelled
 *                           state. No attempt, no message, nothing handed onward.
 *   rejected                authentication or an invariant was not proven.
 *
 * Every outcome terminates the orchestration. As on the orphan lane there is no
 * state that hands work to an executor: this lane exists to REMOVE work from the
 * executable set, never to introduce any.
 */
export const AUTOMATION_CANCEL_STALE_ORCHESTRATION_STATES = Object.freeze([
  "cancel_stale_empty",
  "cancel_stale_cancelled",
  "rejected",
] as const);

export type AutomationCancelStaleOrchestrationState =
  (typeof AUTOMATION_CANCEL_STALE_ORCHESTRATION_STATES)[number];

/**
 * Sanitized `cancel_stale_v1` answer.
 *
 * `actionType` is a CLOSED vocabulary word from the four supported actions —
 * never an id, never a value. Deliberately absent everywhere: job id, action
 * request id, entity id, vendor id, lead or assignment id, recipient,
 * destination, phone, template variables, provider message id, raw database
 * error, secret or environment value. The exact job identity is durable audit
 * evidence in the ledger, not orchestration payload.
 */
export interface N8nCancelStaleSuccessBody {
  readonly ok: true;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "cancel_stale_v1";
  readonly orchestrationState: Exclude<AutomationCancelStaleOrchestrationState, "rejected">;
  readonly replayed: boolean;
  /** Present ONLY on `cancel_stale_cancelled`. */
  readonly actionType?: StaleBusinessAction;
  /** Present ONLY on `cancel_stale_cancelled`. Always the fixed constant. */
  readonly safeCode?: typeof STALE_BUSINESS_SAFE_CODE;
}

export interface N8nCancelStaleRejectionBody {
  readonly ok: false;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "cancel_stale_v1";
  readonly orchestrationState: "rejected";
  readonly code: string;
}

export type CancelStaleResult =
  | { ok: true; body: N8nCancelStaleSuccessBody }
  | { ok: false; status: number; code: string };

/** Raised when the authoritative business state moved between select and write. */
export const STALE_BUSINESS_STATE_CHANGED = "AUTOMATION_STALE_BUSINESS_STATE_CHANGED" as const;
