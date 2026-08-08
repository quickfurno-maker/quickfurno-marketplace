// ============================================================================
// QF-MVP-50.3 — signed vendor-execution request
//
// n8n asks Core to execute the vendor work for the exact attempt it already
// owns. Core re-proves every business fact from its own ledgers, executes
// through its OWN communication subsystem, and answers with a sanitized
// orchestration state. n8n chooses nothing.
//
// The request carries FIVE identity fields. There is no recipient, destination,
// template, variable, provider, account, consent, idempotency, classification,
// safe-code, executor-reference or retry field in the schema at all — which is
// stronger than accepting and ignoring them.
// ============================================================================

import {
  buildSignedCoreResponseHeaders,
  verifyN8nToCoreRequest,
} from "@/lib/automation/transportAuth";
import { parseFamilyExecuteRequestBody } from "@/lib/automation/familyExecutionContract";
import { N8N_EXECUTE_VENDOR_ROUTE_PATH } from "@/lib/automation/transportTypes";
import { executeVendorAutomationForN8nTransport } from "@/services/automationVendorExecutionService";
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

  // The exact execution path is a canonical signing field, so a signature minted
  // for the claim, completion or another family's execute route can never
  // authenticate here. The workflow family itself is NOT taken from the request:
  // the service re-proves it as exactly `vendor_whatsapp` from durable job truth.
  const verified = verifyN8nToCoreRequest({
    rawBody,
    method: "POST",
    path: N8N_EXECUTE_VENDOR_ROUTE_PATH,
    headers: request.headers,
    secret: config.inboundSecret,
  });

  // An unauthenticated failure is answered UNSIGNED. Signing a rejection for an
  // unverified caller would turn this route into a signing oracle.
  if (!verified.ok) {
    return json({ ok: false, code: verified.code }, verified.status);
  }

  const parsed = parseFamilyExecuteRequestBody(rawBody);
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
    const result = await executeVendorAutomationForN8nTransport({
      requestId: verified.requestId,
      workerId: parsed.body.workerId,
      bodySha256: verified.bodySha256,
      jobId: parsed.body.jobId,
      attemptId: parsed.body.attemptId,
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
    // attempt is NOT finalized on this path: it stays owned and open, which is
    // QF-MVP-50.5's recovery surface, not a silent consumption.
    return rejected(
      "AUTOMATION_TRANSPORT_INTERNAL_FAILURE",
      500,
      verified.requestId,
      config.responseSecret,
    );
  }
}

/**
 * An authenticated refusal. It carries the same closed `orchestrationState` key
 * as every success, so one n8n switch covers every outcome and a non-200 can
 * never be mistaken for a completable result.
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
      route: "execute_v1",
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
    path: N8N_EXECUTE_VENDOR_ROUTE_PATH,
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
