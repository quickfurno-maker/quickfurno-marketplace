// ============================================================================
// QuickFurno — QF-MVP-50.1C secure n8n transport service
//
// Server-only Core boundary. No n8n URL, Meta token, provider call or direct
// table mutation exists here.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import {
  getClaimedAutomationJobEnvelope,
} from "@/services/automationPersistenceService";
import type {
  AutomationTransportClaimRow,
  AutomationTransportRuntimeConfig,
  FreshClaimEvidence,
  N8nClaimResponseBody,
} from "@/lib/automation/transportTypes";

const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function getAutomationTransportRuntimeConfig():
  | { ok: true; config: AutomationTransportRuntimeConfig }
  | { ok: false; code: string } {
  const modeRaw = process.env.QF_N8N_TRANSPORT_MODE?.trim().toLowerCase() ?? "off";

  if (modeRaw === "off") {
    return {
      ok: true,
      config: {
        mode: "off",
        runtimeEnvironment: null,
        inboundSecret: null,
        responseSecret: null,
        workerId: null,
      },
    };
  }

  if (modeRaw !== "staging" && modeRaw !== "production") {
    return { ok: false, code: "AUTOMATION_TRANSPORT_MODE_INVALID" };
  }

  const runtimeEnvironment =
    process.env.QF_AUTOMATION_RUNTIME_ENV?.trim().toLowerCase() ?? "";
  if (runtimeEnvironment !== modeRaw) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_ENVIRONMENT_MISMATCH" };
  }

  const inboundSecret =
    process.env.QF_N8N_TO_CORE_HMAC_SECRET?.trim() ?? "";
  const responseSecret =
    process.env.QF_CORE_TO_N8N_HMAC_SECRET?.trim() ?? "";
  const workerId = process.env.QF_N8N_WORKER_ID?.trim() ?? "";

  if (inboundSecret.length < 32 || responseSecret.length < 32) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_SECRET_MISSING" };
  }
  if (inboundSecret === responseSecret) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_DIRECTIONAL_SECRETS_REQUIRED" };
  }
  if (!SAFE_WORKER_RE.test(workerId)) {
    return { ok: false, code: "AUTOMATION_TRANSPORT_WORKER_ID_INVALID" };
  }

  return {
    ok: true,
    config: {
      mode: modeRaw,
      runtimeEnvironment: modeRaw,
      inboundSecret,
      responseSecret,
      workerId,
    },
  };
}

export async function claimAutomationJobForN8nTransport(input: {
  requestId: string;
  workerId: string;
  bodySha256: string;
}): Promise<N8nClaimResponseBody> {
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_ID_INVALID");
  }
  if (!SAFE_WORKER_RE.test(input.workerId)) {
    throw new Error("AUTOMATION_TRANSPORT_WORKER_ID_INVALID");
  }
  if (!SHA256_RE.test(input.bodySha256)) {
    throw new Error("AUTOMATION_TRANSPORT_BODY_HASH_INVALID");
  }

  const { data, error } = await adminClient()
    .rpc("qf_claim_automation_job_transport_v1", {
      p_request_id: input.requestId,
      p_worker_id: input.workerId,
      p_body_sha256: input.bodySha256,
    })
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("AUTOMATION_TRANSPORT_CLAIM_FAILED");
  }

  const row = data as AutomationTransportClaimRow;

  if (row.request_id !== input.requestId) {
    throw new Error("AUTOMATION_TRANSPORT_REQUEST_EVIDENCE_MISMATCH");
  }

  if (row.is_replay) {
    if (row.state === "empty") {
      return {
        ok: true,
        transportVersion: 1,
        requestId: input.requestId,
        state: "empty",
        replayed: true,
        executable: false,
      };
    }

    if (row.state !== "claimed") {
      throw new Error("AUTOMATION_TRANSPORT_REPLAY_STATE_INVALID");
    }

    // This is the critical no-blind-resend rule. Even if the original HTTP
    // response was lost, a replay never receives the executable envelope.
    return {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      state: "claimed",
      replayed: true,
      executable: false,
      message: "CLAIM_REPLAY_EXECUTION_SUPPRESSED",
    };
  }

  if (row.state === "empty") {
    return {
      ok: true,
      transportVersion: 1,
      requestId: input.requestId,
      state: "empty",
      replayed: false,
      executable: false,
    };
  }

  if (row.state !== "claimed") {
    throw new Error("AUTOMATION_TRANSPORT_CLAIM_STATE_INVALID");
  }

  const claim = requireFreshClaimEvidence(row);

  const job = await getClaimedAutomationJobEnvelope(
    claim,
    input.workerId,
  );

  return {
    ok: true,
    transportVersion: 1,
    requestId: input.requestId,
    state: "claimed",
    replayed: false,
    executable: true,
    claim,
    job,
  };
}

function requireFreshClaimEvidence(
  row: AutomationTransportClaimRow,
): FreshClaimEvidence {
  if (
    !row.job_id ||
    !row.action_request_id ||
    !row.attempt_id ||
    row.attempt_number == null ||
    row.max_attempts == null
  ) {
    throw new Error("AUTOMATION_TRANSPORT_CLAIM_EVIDENCE_INCOMPLETE");
  }

  return {
    job_id: row.job_id,
    action_request_id: row.action_request_id,
    attempt_id: row.attempt_id,
    attempt_number: row.attempt_number,
    max_attempts: row.max_attempts,
  };
}
