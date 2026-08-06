// ============================================================================
// QuickFurno — QF-MVP-50.1C transport types
// ============================================================================

import type { AutomationJobEnvelope } from "./actionContract";

export const N8N_CLAIM_ROUTE_PATH =
  "/api/internal/automation/n8n/claim" as const;

/**
 * QF-MVP-50.2D. A distinct exact path is what binds a signed request to this
 * route: the path is a canonical HMAC field, so a claim signature can never be
 * replayed against completion (and vice versa).
 */
export const N8N_COMPLETE_ROUTE_PATH =
  "/api/internal/automation/n8n/complete" as const;

/** Closed transport route vocabulary. Mirrors the ledger's route_key CHECK. */
export const AUTOMATION_TRANSPORT_ROUTE_KEYS = ["claim_v1", "complete_v1"] as const;
export type AutomationTransportRouteKey =
  (typeof AUTOMATION_TRANSPORT_ROUTE_KEYS)[number];

export interface N8nClaimRequestBody {
  transportVersion: 1;
  requestId: string;
  workerId: string;
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

export interface AutomationTransportRuntimeConfig {
  mode: "off" | "staging" | "production";
  runtimeEnvironment: "staging" | "production" | null;
  inboundSecret: string | null;
  responseSecret: string | null;
  workerId: string | null;
}
