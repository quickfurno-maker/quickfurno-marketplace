// ============================================================================
// QF-MVP-50.5 — signed stale-attempt reconciliation request
//
// n8n asks Core to examine ONE stale current attempt. Core selects the candidate,
// reads its own durable evidence, and either finalizes the attempt through the
// frozen completion authority or deliberately leaves it alone. n8n chooses
// nothing: not the attempt, the classification, the retry time, the stale
// outcome, the dead-letter decision, the provider, the recipient or the template.
// It is told which of four closed orchestration states happened, and stops.
//
// The request carries THREE identity fields — the same three as `recover` — and
// the schema has no room for anything else.
//
// THIS ROUTE IS NOT `recover`. It may never create an attempt. The exact path
// below is a canonical signing field, so a recover signature can never
// authenticate here and a reconcile signature can never open a retry.
// ============================================================================

import {
  buildSignedCoreResponseHeaders,
  verifyN8nToCoreRequest,
} from "@/lib/automation/transportAuth";
import { parseRecoveryRequestBody } from "@/lib/automation/recoveryContract";
import { N8N_RECONCILE_ROUTE_PATH } from "@/lib/automation/transportTypes";
import { reconcileStaleAutomationAttemptForN8nTransport } from "@/services/automationRecoveryService";
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
    path: N8N_RECONCILE_ROUTE_PATH,
    headers: request.headers,
    secret: config.inboundSecret,
  });

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
    const result = await reconcileStaleAutomationAttemptForN8nTransport({
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
    // Never expose database, stack, secret, provider or environment detail. A
    // failure here mutates nothing: the stale attempt stays exactly as stale as it
    // was and remains eligible for the next examination.
    return rejected(
      "AUTOMATION_TRANSPORT_INTERNAL_FAILURE",
      500,
      verified.requestId,
      config.responseSecret,
    );
  }
}

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
      route: "reconcile_v1",
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
    path: N8N_RECONCILE_ROUTE_PATH,
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
