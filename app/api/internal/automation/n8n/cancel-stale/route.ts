// ============================================================================
// QF-MVP-50.7 — signed stale-business terminalization request
//
// n8n asks Core to sweep ONE stale-business automation job. Core selects the
// job, proves the entity still EXISTS but the current business truth no longer
// justifies the action, and moves it to the existing terminal state `cancelled`.
// n8n chooses nothing at all — not even a family to forward to, because there is
// nothing to forward: every outcome of this route ends the orchestration.
//
// The request carries THREE identity fields. There is no jobId, actionRequestId,
// entityId, entityType, actionType, workflowFamily, stale, eligible,
// businessState, reason, safeCode, status, force, limit, batchSize,
// sourceEventKey or expectedState field in the schema at all — which is stronger
// than accepting and ignoring them, because it makes "the orchestrator cannot
// nominate work" a property a reader can verify from the parser rather than a
// claim in a comment.
//
// THIS ROUTE IS NOT `cancel-orphan`. That lane requires the entity to be GONE;
// this one requires it to still be PRESENT. They rest on opposite premises, so
// they get separate signing paths and a signature minted for one can never
// authenticate the other. It can never open an attempt, classify one, finalize
// one or dead-letter one. The exact path below is a canonical signing field.
//
// NOTHING IS EVER SENT FROM THIS PATH. No provider call, no Meta token, no
// message, no attempt.
// ============================================================================

import {
  buildSignedCoreResponseHeaders,
  verifyN8nToCoreRequest,
} from "@/lib/automation/transportAuth";
import { parseCancelStaleRequestBody } from "@/lib/automation/staleBusinessContract";
import { N8N_CANCEL_STALE_ROUTE_PATH } from "@/lib/automation/transportTypes";
import { cancelStaleBusinessAutomationJobForN8nTransport } from "@/services/automationStaleBusinessCancellationService";
import { getAutomationTransportRuntimeConfig } from "@/services/automationTransportService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  const runtimeConfig = getAutomationTransportRuntimeConfig();

  if (!runtimeConfig.ok) {
    return json({ ok: false, code: runtimeConfig.code }, 503);
  }

  const config = runtimeConfig.config;
  if (
    config.mode === "off" ||
    !config.inboundSecret ||
    !config.responseSecret ||
    !config.workerId
  ) {
    return json({ ok: false, code: "AUTOMATION_TRANSPORT_DISABLED" }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, code: "AUTOMATION_TRANSPORT_BODY_TOO_LARGE" }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, code: "AUTOMATION_TRANSPORT_BODY_UNREADABLE" }, 400);
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return json({ ok: false, code: "AUTOMATION_TRANSPORT_BODY_TOO_LARGE" }, 413);
  }

  const verified = verifyN8nToCoreRequest({
    rawBody,
    method: "POST",
    path: N8N_CANCEL_STALE_ROUTE_PATH,
    headers: request.headers,
    secret: config.inboundSecret,
  });

  // An unauthenticated failure is answered UNSIGNED. Signing a rejection for an
  // unverified caller would turn this route into a signing oracle.
  if (!verified.ok) {
    return json({ ok: false, code: verified.code }, verified.status);
  }

  const parsed = parseCancelStaleRequestBody(rawBody);
  if (!parsed.ok) {
    return rejected(parsed.code, parsed.status, verified.requestId, config.responseSecret);
  }

  if (parsed.body.requestId !== verified.requestId) {
    return rejected(
      "AUTOMATION_TRANSPORT_REQUEST_ID_MISMATCH",
      400,
      verified.requestId,
      config.responseSecret,
    );
  }

  if (parsed.body.workerId !== config.workerId) {
    return rejected(
      "AUTOMATION_TRANSPORT_WORKER_NOT_AUTHORIZED",
      403,
      verified.requestId,
      config.responseSecret,
    );
  }

  try {
    const result = await cancelStaleBusinessAutomationJobForN8nTransport({
      requestId: verified.requestId,
      workerId: parsed.body.workerId,
      bodySha256: verified.bodySha256,
    });

    if (!result.ok) {
      return rejected(
        result.code,
        result.status,
        verified.requestId,
        config.responseSecret,
      );
    }

    return signedJson(result.body, 200, verified.requestId, config.responseSecret);
  } catch {
    // Never expose database, stack, secret, provider or environment detail. The
    // cancellation transaction is all-or-nothing, so a failure here leaves the job
    // exactly where it was — still queued, still stale, and still eligible for the
    // next sweep. Failing to terminalize is always safe; the dangerous direction is
    // terminalizing something that should still run, and that direction is guarded
    // by the RPC itself: it re-proves entity presence and business staleness UNDER
    // the action-specific row locks BEFORE it writes, and raises
    // AUTOMATION_STALE_BUSINESS_STATE_CHANGED (rolling back) if either has moved.
    return rejected(
      "AUTOMATION_TRANSPORT_INTERNAL_FAILURE",
      500,
      verified.requestId,
      config.responseSecret,
    );
  }
}

/**
 * An authenticated refusal. It carries the same closed `orchestrationState` key as
 * every success, so one n8n switch covers every outcome and a non-200 can never be
 * mistaken for a completed cancellation.
 */
function rejected(
  code: string,
  status: number,
  requestId: string,
  responseSecret: string,
): Response {
  return signedJson(
    {
      ok: false,
      transportVersion: 1,
      requestId,
      route: "cancel_stale_v1",
      orchestrationState: "rejected",
      code,
    },
    status,
    requestId,
    responseSecret,
  );
}

function signedJson(
  payload: unknown,
  status: number,
  requestId: string,
  responseSecret: string,
): Response {
  const rawBody = JSON.stringify(payload);
  const headers = buildSignedCoreResponseHeaders({
    rawBody,
    path: N8N_CANCEL_STALE_ROUTE_PATH,
    requestId,
    secret: responseSecret,
  });

  return new Response(rawBody, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
