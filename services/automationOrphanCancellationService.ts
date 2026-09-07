// ============================================================================
// QF-MVP-50.6 — orphan automation-job cancellation service
//
// Server-only Core boundary. No n8n URL, no Meta token, no provider call, no
// direct table mutation, no attempt of any kind.
//
// WHAT THIS LANE IS FOR
//   Automation jobs accumulate whose business entity has been deleted. They stay
//   `pending` or `retry_scheduled` forever: claim keeps offering them, recovery
//   keeps rescheduling them, and every executor that picks one up fails to
//   resolve a recipient. This lane removes them from the executable set by moving
//   them to the EXISTING terminal state `cancelled` — one job per signed request,
//   only when Core has proven the entity is gone.
//
// WHY THERE IS NO NEW TERMINAL STATE
//   `cancelled` already exists in the automation_jobs vocabulary, the job update
//   guard already permits `pending -> cancelled` and `retry_scheduled ->
//   cancelled`, and the result-shape constraint already places it in the group
//   that requires no classification. Inventing a second terminal name would have
//   added a state every existing reader would have had to learn.
//
// THE ONE THING THIS SERVICE DOES NOT DECIDE
//   It does not decide WHICH job. The RPC selects, re-proves and mutates inside a
//   single transaction; this service supplies the signed transport identity and
//   then checks that what came back is internally consistent. A caller cannot
//   name a job, and neither can this module.
//
// NOTHING IS EVER SENT. No message, no attempt, no execute envelope, no
// forwarding instruction. Every outcome terminates the orchestration.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  AUTOMATION_ORPHAN_SAFE_CODE,
  isAutomationOrphanEntityType,
  type CancelOrphanResult,
} from "@/lib/automation/orphanCancellationContract";
import type { AutomationTransportCancelOrphanRow } from "@/lib/automation/transportTypes";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface AutomationCancelOrphanTransportInput {
  readonly requestId: string;
  readonly workerId: string;
  readonly bodySha256: string;
}

function assertTransportIdentity(input: AutomationCancelOrphanTransportInput): void {
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
 * Cancel AT MOST ONE orphan automation job.
 *
 * The entire operation — durable transport identity, orphan selection under
 * `for update skip locked`, the entity re-proof and the single job UPDATE — is
 * one SQL transaction. There is therefore no window in which a job is half
 * cancelled, and no window in which two workers cancel the same job.
 *
 * A REPLAY RE-EXECUTES NOTHING. A duplicate request UUID finds its own durable
 * transport row and is answered from it. Unlike `claim_v1` and `recover_v1`,
 * a replay here is safe to answer in full rather than suppress: the response
 * carries no executable work and no attempt to double-execute — the honest
 * answer to "what did my earlier request do?" is simply what it did.
 */
export async function cancelOrphanAutomationJobForN8nTransport(
  input: AutomationCancelOrphanTransportInput,
): Promise<CancelOrphanResult> {
  assertTransportIdentity(input);

  const { data, error } = await adminClient()
    .rpc("qf_cancel_orphan_automation_job_transport_v1", {
      p_request_id: input.requestId,
      p_worker_id: input.workerId,
      p_body_sha256: input.bodySha256,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_CANCEL_ORPHAN_FAILED");
  }

  const row = data as AutomationTransportCancelOrphanRow;

  if (row.request_id !== input.requestId || row.route_key !== "cancel_orphan_v1") {
    throw new Error("AUTOMATION_TRANSPORT_CANCEL_ORPHAN_EVIDENCE_MISMATCH");
  }

  if (row.state === "empty") {
    // Nothing was eligible. This is the ordinary steady-state answer once the
    // backlog is drained, and it must stay cheap and silent — an empty sweep is
    // not an incident.
    return {
      ok: true,
      body: {
        ok: true,
        transportVersion: 1,
        requestId: input.requestId,
        route: "cancel_orphan_v1",
        orchestrationState: "cancel_orphan_empty",
        replayed: row.is_replay,
      },
    };
  }

  if (row.state !== "cancelled") {
    throw new Error("AUTOMATION_TRANSPORT_CANCEL_ORPHAN_STATE_INVALID");
  }

  // A `cancelled` transport row without its job and action identity would mean
  // the ledger and the shape constraint disagree. Fail closed rather than report
  // a cancellation Core cannot evidence.
  if (!row.job_id || !row.action_request_id) {
    throw new Error("AUTOMATION_TRANSPORT_CANCEL_ORPHAN_EVIDENCE_INCOMPLETE");
  }

  // The entity type is Core's own answer, derived in SQL from durable action
  // truth. It is re-checked against the closed vocabulary here so a value outside
  // the mapped set can never reach an orchestrator that might treat an unknown
  // string as meaningful.
  if (!isAutomationOrphanEntityType(row.entity_type)) {
    throw new Error("AUTOMATION_CANCEL_ORPHAN_ENTITY_TYPE_INVALID");
  }

  // The reason is a repository constant, not a value in flight. If the durable
  // row says anything else, something other than this lane wrote it.
  if (row.safe_code !== AUTOMATION_ORPHAN_SAFE_CODE) {
    throw new Error("AUTOMATION_CANCEL_ORPHAN_SAFE_CODE_INVALID");
  }

  return {
    ok: true,
    body: {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      route: "cancel_orphan_v1",
      orchestrationState: "cancel_orphan_cancelled",
      replayed: row.is_replay,
      entityType: row.entity_type,
      safeCode: AUTOMATION_ORPHAN_SAFE_CODE,
    },
  };
}
