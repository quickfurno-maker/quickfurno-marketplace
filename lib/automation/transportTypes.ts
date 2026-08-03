// ============================================================================
// QuickFurno — QF-MVP-50.1C transport types
// ============================================================================

import type { AutomationJobEnvelope } from "./actionContract";

export const N8N_CLAIM_ROUTE_PATH =
  "/api/internal/automation/n8n/claim" as const;

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

export interface AutomationTransportRuntimeConfig {
  mode: "off" | "staging" | "production";
  runtimeEnvironment: "staging" | "production" | null;
  inboundSecret: string | null;
  responseSecret: string | null;
  workerId: string | null;
}
