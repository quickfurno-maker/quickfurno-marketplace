// ============================================================================
// QuickFurno — QF-MVP-50.1C transport types
// ============================================================================

import type { AutomationJobEnvelope } from "./actionContract";
import type { AutomationWorkflowFamily } from "./actionRegistry";

export const N8N_CLAIM_ROUTE_PATH =
  "/api/internal/automation/n8n/claim" as const;

/**
 * QF-MVP-50.2D. A distinct exact path is what binds a signed request to this
 * route: the path is a canonical HMAC field, so a claim signature can never be
 * replayed against completion (and vice versa).
 */
export const N8N_COMPLETE_ROUTE_PATH =
  "/api/internal/automation/n8n/complete" as const;

/**
 * QF-MVP-50.2E. The third and final signed n8n -> Core route. Like the other two,
 * the exact path is a canonical HMAC field, so a claim or completion signature can
 * never authenticate an execution request and vice versa.
 */
export const N8N_EXECUTE_CLIENT_ROUTE_PATH =
  "/api/internal/automation/n8n/execute-client" as const;

/** Closed transport route vocabulary. Mirrors the ledger's route_key CHECK. */
export const AUTOMATION_TRANSPORT_ROUTE_KEYS = [
  "claim_v1",
  "complete_v1",
  "execute_v1",
] as const;
export type AutomationTransportRouteKey =
  (typeof AUTOMATION_TRANSPORT_ROUTE_KEYS)[number];

export interface N8nClaimRequestBody {
  transportVersion: 1;
  requestId: string;
  workerId: string;
}

/**
 * QF-MVP-50.3/50.4 family-aware claim body.
 *
 * The legacy three-key body is kept verbatim above and remains valid; it now
 * resolves to a CLIENT-ONLY claim in SQL, so the existing client workflow needs
 * no change and can no longer consume vendor or campaign work.
 *
 * This body adds EXACTLY ONE field. `workflowFamily` is a single canonical
 * family — never an array, a comma list, a wildcard or "all" — and there is no
 * caller-supplied action allowlist: Core matches the declared family against
 * durable action truth.
 *
 * Because the field is part of the request body, it is covered by the canonical
 * body hash that already binds the signed transport identity. A replay of the
 * same requestId under a DIFFERENT family therefore conflicts rather than
 * inheriting the original claim.
 */
export interface N8nFamilyClaimRequestBody {
  transportVersion: 1;
  requestId: string;
  workerId: string;
  workflowFamily: AutomationWorkflowFamily;
}

/** The closed family vocabulary a claim request may declare. */
export const N8N_CLAIMABLE_WORKFLOW_FAMILIES = [
  "client_whatsapp",
  "vendor_whatsapp",
  "campaign_execution",
] as const satisfies readonly AutomationWorkflowFamily[];

export function isClaimableWorkflowFamily(
  value: unknown,
): value is AutomationWorkflowFamily {
  return (
    typeof value === "string" &&
    (N8N_CLAIMABLE_WORKFLOW_FAMILIES as readonly string[]).includes(value)
  );
}

export type AutomationTransportClaimState =
  | "claimed"
  | "empty";

export interface AutomationTransportClaimRow {
  request_id: string;
  state: AutomationTransportClaimState;
  is_replay: boolean;
  job_id: string | null;
  action_request_id: string | null;
  attempt_id: string | null;
  attempt_number: number | null;
  max_attempts: number | null;
}

export interface FreshClaimEvidence {
  job_id: string;
  action_request_id: string;
  attempt_id: string;
  attempt_number: number;
  max_attempts: number;
}

export type N8nClaimResponseBody =
  | {
      ok: true;
      transportVersion: 1;
      requestId: string;
      state: "empty";
      replayed: boolean;
      executable: false;
    }
  | {
      ok: true;
      transportVersion: 1;
      requestId: string;
      state: "claimed";
      replayed: true;
      executable: false;
      message: "CLAIM_REPLAY_EXECUTION_SUPPRESSED";
    }
  | {
      ok: true;
      transportVersion: 1;
      requestId: string;
      state: "claimed";
      replayed: false;
      executable: true;
      claim: FreshClaimEvidence;
      job: AutomationJobEnvelope;
    };

// ---------------------------------------------------------------------------
// QF-MVP-50.2D — completion route
// ---------------------------------------------------------------------------

/** Exactly what the completion transport RPC returns. */
export interface AutomationTransportCompletionRow {
  request_id: string;
  route_key: AutomationTransportRouteKey;
  state: "completed";
  is_replay: boolean;
  job_id: string;
  action_request_id: string;
  attempt_id: string;
  attempt_number: number;
  max_attempts: number;
  job_status: string;
  attempt_status: string;
  classification: string | null;
  safe_code: string | null;
  executor_reference: string | null;
}

/**
 * Sanitized completion result. Deliberately absent: recipient, destination,
 * phone/email, template key, provider account, provider message id, raw
 * provider status/body/error, consent state, lead data, variables, SQL, stack.
 */
export interface N8nCompleteResponseBody {
  ok: true;
  transportVersion: 1;
  requestId: string;
  route: "complete_v1";
  state: "completed";
  replayed: boolean;
  jobStatus: string;
  attemptStatus: string;
  classification: string;
  safeCode: string;
  executorReference: string;
}

// ---------------------------------------------------------------------------
// QF-MVP-50.2E — client execution route
// ---------------------------------------------------------------------------

/**
 * Exactly what the execution transport RPC returns.
 *
 * IDENTITY ONLY. There is deliberately no classification, no safe code, no
 * communication status, no executor reference and no business payload here: the
 * execute ledger records ONLY that a signed execution request identity was
 * durably reserved for this exact attempt. Every replay re-reads Core truth from
 * the communication and attempt ledgers instead of trusting a stored outcome, so
 * a replay can never disagree with what actually happened.
 */
export interface AutomationTransportExecutionRow {
  request_id: string;
  route_key: AutomationTransportRouteKey;
  state: "recorded";
  is_replay: boolean;
  job_id: string;
  action_request_id: string;
  attempt_id: string;
  attempt_number: number;
  max_attempts: number;
}

/**
 * The public orchestration branch key. n8n branches on THIS and on nothing else —
 * never on the HTTP status code, and never on the presence of a field.
 */
export type N8nExecuteClientOrchestrationState =
  | "execution_recorded"
  | "communication_pending"
  | "attempt_finalized"
  | "rejected";

/**
 * Sanitized execution result. Deliberately absent: recipient, destination,
 * phone/email, destination hash/mask, template key, variables, provider key,
 * provider account, provider message id, raw provider status/body/error, consent
 * state, lead data, SQL, stack, secret, environment value.
 *
 * `executorReference` appears ONLY on `execution_recorded`, and is ONLY ever a
 * real `communication_messages.id`.
 */
export interface N8nExecuteClientSuccessBody {
  ok: true;
  transportVersion: 1;
  requestId: string;
  route: "execute_v1";
  orchestrationState: Exclude<N8nExecuteClientOrchestrationState, "rejected">;
  replayed: boolean;
  executorReference?: string;
}

/**
 * An authenticated refusal. It carries the same closed branch key so a single
 * n8n switch covers every outcome, and it never finalizes or consumes the attempt.
 */
export interface N8nExecuteClientRejectionBody {
  ok: false;
  transportVersion: 1;
  requestId: string;
  route: "execute_v1";
  orchestrationState: "rejected";
  code: string;
}

export type N8nExecuteClientResponseBody =
  | N8nExecuteClientSuccessBody
  | N8nExecuteClientRejectionBody;

export interface AutomationTransportRuntimeConfig {
  mode: "off" | "staging" | "production";
  runtimeEnvironment: "staging" | "production" | null;
  inboundSecret: string | null;
  responseSecret: string | null;
  workerId: string | null;
}
