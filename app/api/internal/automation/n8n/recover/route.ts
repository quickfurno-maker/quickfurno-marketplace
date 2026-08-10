// ============================================================================
// QF-MVP-50.5 — signed due-retry recovery request
//
// n8n asks Core to recover ONE eligible due retry. Core selects the job, opens the
// next attempt and answers with the new attempt identity plus the canonical
// workflow family. n8n chooses nothing except which family execute boundary to
// forward that identity to — and even that choice is Core's answer, not n8n's.
//
// The request carries THREE identity fields. There is no jobId, attemptId,
// workflowFamily, classification, retry timestamp, dead-letter flag, staleness
// threshold, provider, recipient or template field in the schema at all — which is
// stronger than accepting and ignoring them.
//
// THIS ROUTE IS NOT `reconcile`. It may only open a retry attempt; it can never
// finalize, classify or dead-letter one. The exact path below is a canonical
// signing field, so a reconcile signature can never authenticate here.
// ============================================================================

import {
  buildSignedCoreResponseHeaders,
  verifyN8nToCoreRequest,
} from "@/lib/automation/transportAuth";
import { parseRecoveryRequestBody } from "@/lib/automation/recoveryContract";
import { N8N_RECOVER_ROUTE_PATH } from "@/lib/automation/transportTypes";
import { recoverDueAutomationRetryForN8nTransport } from "@/services/automationRecoveryService";
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
    path: N8N_RECOVER_ROUTE_PATH,
    headers: request.headers,
    secret: config.inboundSecret,
  });

  // An unauthenticated failure is answered UNSIGNED. Signing a rejection for an
  // unverified caller would turn this route into a signing oracle.
  if (!verified.ok) {
    return json({ ok: false, code: verified.code }, verified.status);
  }

  const parsed = parseRecoveryRequestBody(rawBody);
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
    const result = await recoverDueAutomationRetryForN8nTransport({
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
    // recovery transaction is all-or-nothing, so a failure here leaves the job in
    // whichever state it already held — either still `retry_scheduled` and due
    // again, or recovered and owned, in which case reconciliation is its safety net.
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
 * mistaken for recovered work.
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
      route: "recover_v1",
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
    path: N8N_RECOVER_ROUTE_PATH,
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
