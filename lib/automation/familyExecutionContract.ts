// ============================================================================
// QuickFurno — QF-MVP-50.3/50.4 family execution transport contract
//
// The vendor and campaign execute routes speak the EXACT SAME five-key request
// as the frozen QF-MVP-50.2E client route. This module restates that shape for
// the two new routes; it deliberately does not touch
// `clientExecutionContract.ts`, which is pinned by the 50.2 gates.
//
// There is no recipient, destination, template, variable, provider, account,
// consent, idempotency, classification, safe-code, executor-reference, retry or
// workflowFamily field in the schema at all — which is stronger than accepting
// and ignoring them. The workflow family is re-proven from durable Core job and
// action truth, never taken from the request.
//
// Pure module: no database, network, environment, clock or provider import.
// ============================================================================

import type { AutomationExecutionOrchestrationState } from "./clientExecutionContract";

/** Byte-identical to the frozen client execute request. Exactly five keys. */
export const N8N_FAMILY_EXECUTE_REQUEST_KEYS = Object.freeze([
  "attemptId",
  "jobId",
  "requestId",
  "transportVersion",
  "workerId",
] as const);

export interface N8nFamilyExecuteRequestBody {
  transportVersion: 1;
  requestId: string;
  workerId: string;
  jobId: string;
  attemptId: string;
}

export type FamilyExecuteRequestParseResult =
  | { ok: true; body: N8nFamilyExecuteRequestBody }
  | { ok: false; status: 400; code: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse and fully validate an execute request. The key set must be EXACTLY the
 * five above — an extra field is a hard refusal, not something to ignore, so a
 * caller can never smuggle business authority alongside the identity fields.
 */
export function parseFamilyExecuteRequestBody(
  rawBody: string,
): FamilyExecuteRequestParseResult {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_JSON_INVALID" };
  }

  if (!isRecord(value)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_INVALID" };
  }

  const keys = Object.keys(value).sort();
  if (
    keys.length !== N8N_FAMILY_EXECUTE_REQUEST_KEYS.length ||
    keys.some((key, index) => key !== N8N_FAMILY_EXECUTE_REQUEST_KEYS[index])
  ) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID",
    };
  }

  if (value.transportVersion !== 1) {
    return { ok: false, status: 400, code: "TRANSPORT_VERSION_INVALID" };
  }
  if (typeof value.workerId !== "string" || !SAFE_WORKER_RE.test(value.workerId)) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_WORKER_ID_INVALID",
    };
  }
  for (const key of ["requestId", "jobId", "attemptId"] as const) {
    const candidate = value[key];
    if (typeof candidate !== "string" || !UUID_RE.test(candidate)) {
      return {
        ok: false,
        status: 400,
        code: "AUTOMATION_TRANSPORT_EXECUTION_IDENTITY_INVALID",
      };
    }
  }

  return {
    ok: true,
    body: {
      transportVersion: 1,
      requestId: value.requestId as string,
      workerId: value.workerId as string,
      jobId: value.jobId as string,
      attemptId: value.attemptId as string,
    },
  };
}

/** The frozen orchestration answer shape, shared by both new routes. */
export interface N8nFamilyExecuteSuccessBody {
  readonly ok: true;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "execute_v1";
  readonly orchestrationState: AutomationExecutionOrchestrationState;
  readonly replayed?: boolean;
  readonly executorReference?: string;
}

export type FamilyExecutionResult =
  | { ok: true; body: N8nFamilyExecuteSuccessBody }
  | { ok: false; status: number; code: string };
