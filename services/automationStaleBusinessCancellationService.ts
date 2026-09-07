// ============================================================================
// QF-MVP-50.7 — stale-business job terminalization service
//
// Server-only Core boundary. No n8n URL, no Meta token, no provider call, no
// direct table mutation, no attempt of any kind.
//
// WHAT THIS LANE IS FOR
//   A job whose business ENTITY is healthy but whose business TRUTH has moved
//   on: the vendor's onboarding progressed past `new`, the assignment was
//   already responded to, the package was cancelled, the credit balance
//   recovered. The executor correctly refuses every one of these — and the retry
//   policy immediately requeues them. This lane gives them an exit.
//
// NOT THE ORPHAN LANE
//   QF-MVP-50.6 requires the entity to be GONE. This requires it to still be
//   PRESENT, proven through the SAME entity authority. A job is a candidate for
//   exactly one of the two lanes, never both.
//
// ONE PREDICATE, TWO CONSUMERS
//   The rules are not restated here. `lib/automation/vendorBusinessEligibility`
//   holds them, the vendor executor consumes them, and the SQL authority
//   re-proves the same predicates transactionally at the mutation boundary. This
//   service supplies the signed transport identity and then checks that what
//   came back is internally consistent.
//
// NOTHING IS EVER SENT. No message, no attempt, no execute envelope.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  STALE_BUSINESS_SAFE_CODE,
  isStaleBusinessAction,
  type CancelStaleResult,
} from "@/lib/automation/staleBusinessContract";
import type { AutomationTransportCancelStaleRow } from "@/lib/automation/transportTypes";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface AutomationCancelStaleTransportInput {
  readonly requestId: string;
  readonly workerId: string;
  readonly bodySha256: string;
}

function assertTransportIdentity(input: AutomationCancelStaleTransportInput): void {
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_ID_INVALID");
  }
  if (!SAFE_WORKER_RE.test(input.workerId)) {
    throw new Error("AUTOMATION_TRANSPORT_WORKER_ID_INVALID");
  }
  if (!SHA256_RE.test(input.bodySha256)) {
    throw new Error("AUTOMATION_TRANSPORT_BODY_HASH_INVALID");
  }
}

/**
 * Terminalize AT MOST ONE stale-business job.
 *
 * The entire operation — durable transport identity, candidate selection under
 * `for update skip locked`, the post-write business re-proof and the single job
 * UPDATE — is one SQL transaction. So there is no window in which a job is half
 * terminalized, and none in which two workers terminalize the same job.
 *
 * A REPLAY RE-EXECUTES NOTHING. A duplicate request UUID finds its own durable
 * transport row and is answered from it. As on the orphan route a replay is safe
 * to answer in full rather than suppress: the response carries no executable
 * work, so the honest answer to "what did my earlier request do?" is what it did.
 */
export async function cancelStaleBusinessAutomationJobForN8nTransport(
  input: AutomationCancelStaleTransportInput,
): Promise<CancelStaleResult> {
  assertTransportIdentity(input);

  const { data, error } = await adminClient()
    .rpc("qf_cancel_stale_automation_job_transport_v1", {
      p_request_id: input.requestId,
      p_worker_id: input.workerId,
      p_body_sha256: input.bodySha256,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_CANCEL_STALE_FAILED");
  }

  const row = data as AutomationTransportCancelStaleRow;

  if (row.request_id !== input.requestId || row.route_key !== "cancel_stale_v1") {
    throw new Error("AUTOMATION_TRANSPORT_CANCEL_STALE_EVIDENCE_MISMATCH");
  }

  if (row.state === "empty") {
    // Nothing was provably stale. This is the ordinary steady-state answer once
    // the backlog is drained, and it must stay cheap and silent.
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId: input.requestId,
        route: "cancel_stale_v1",
        orchestrationState: "cancel_stale_empty",
        replayed: row.is_replay,
      },
    };
  }

  if (row.state !== "cancelled") {
    throw new Error("AUTOMATION_TRANSPORT_CANCEL_STALE_STATE_INVALID");
  }

  // A `cancelled` transport row without its job and action identity would mean
  // the ledger and the shape constraint disagree. Fail closed rather than report
  // a terminalization Core cannot evidence.
  if (!row.job_id || !row.action_request_id) {
    throw new Error("AUTOMATION_TRANSPORT_CANCEL_STALE_EVIDENCE_INCOMPLETE");
  }

  // The action type is Core's own answer, derived in SQL from durable action
  // truth. It is re-checked against the CLOSED v1 stale vocabulary here so a
  // value outside those four can never reach an orchestrator — and so a future
  // widening of the SQL vocabulary without widening the contract fails loudly.
  if (!isStaleBusinessAction(row.action_type)) {
    throw new Error("AUTOMATION_CANCEL_STALE_ACTION_TYPE_INVALID");
  }

  // The reason is a repository constant, not a value in flight. If the durable
  // row says anything else, something other than this lane wrote it.
  if (row.safe_code !== STALE_BUSINESS_SAFE_CODE) {
    throw new Error("AUTOMATION_CANCEL_STALE_SAFE_CODE_INVALID");
  }

  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      route: "cancel_stale_v1",
      orchestrationState: "cancel_stale_cancelled",
      replayed: row.is_replay,
      actionType: row.action_type,
      safeCode: STALE_BUSINESS_SAFE_CODE,
    },
  };
}
