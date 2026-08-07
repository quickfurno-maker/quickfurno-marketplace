// ============================================================================
// QF-MVP-50.2D — signed attempt-completion callback
//
// The closing boundary of the automation lifecycle. n8n asks Core to finalize
// the exact attempt it owns; Core re-proves every fact from its own ledgers and
// then finalizes. No provider call, no communication send, no Meta/WhatsApp and
// no n8n workflow execution happens here.
// ============================================================================

import {
  buildSignedCoreResponseHeaders,
  verifyN8nToCoreRequest,
} from "@/lib/automation/transportAuth";
import { parseCompletionRequestBody } from "@/lib/automation/completionContract";
import { N8N_COMPLETE_ROUTE_PATH } from "@/lib/automation/transportTypes";
import {
  completeAutomationAttemptForN8nTransport,
  getAutomationTransportRuntimeConfig,
} from "@/services/automationTransportService";

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

  // The exact completion path is a canonical signing field, so a signature
  // minted for the claim route can never authenticate here.
  const verified = verifyN8nToCoreRequest({
    rawBody,
    method: "POST",
    path: N8N_COMPLETE_ROUTE_PATH,
    headers: request.headers,
    secret: config.inboundSecret,
  });

  // An unauthenticated failure is answered UNSIGNED. Signing a rejection for an
  // unverified caller would turn this route into a signing oracle.
  if (!verified.ok) {
    return json({ ok: false, code: verified.code }, verified.status);
  }

  const parsed = parseCompletionRequestBody(rawBody);
  if (!parsed.ok) {
    return signedJson(
      { ok: false, code: parsed.code },
      parsed.status,
      verified.requestId,
      config.responseSecret,
    );
  }

  if (parsed.body.requestId !== verified.requestId) {
    return signedJson(
      { ok: false, code: "AUTOMATION_TRANSPORT_REQUEST_ID_MISMATCH" },
      400,
      verified.requestId,
      config.responseSecret,
    );
  }

  if (parsed.body.workerId !== config.workerId) {
    return signedJson(
      { ok: false, code: "AUTOMATION_TRANSPORT_WORKER_NOT_AUTHORIZED" },
      403,
      verified.requestId,
      config.responseSecret,
    );
  }

  try {
    const result = await completeAutomationAttemptForN8nTransport({
      requestId: verified.requestId,
      workerId: parsed.body.workerId,
      bodySha256: verified.bodySha256,
      jobId: parsed.body.jobId,
      attemptId: parsed.body.attemptId,
      executorReference: parsed.body.executorReference,
    });

    if (!result.ok) {
      return signedJson(
        { ok: false, code: result.code },
        result.status,
        verified.requestId,
        config.responseSecret,
      );
    }

    return signedJson(
      result.body,
      200,
      verified.requestId,
      config.responseSecret,
    );
  } catch {
    // Never expose database, stack, secret, provider or environment detail. A
    // failed completion left no attempt side effect: the transport RPC performs
    // the attempt completion and the ledger write in one transaction, so a
    // refusal rolls the pristine request row back with it.
    return signedJson(
      { ok: false, code: "AUTOMATION_TRANSPORT_INTERNAL_FAILURE" },
      500,
      verified.requestId,
      config.responseSecret,
    );
  }
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
    path: N8N_COMPLETE_ROUTE_PATH,
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
