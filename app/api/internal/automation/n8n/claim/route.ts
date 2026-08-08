import {
  buildSignedCoreResponseHeaders,
  verifyN8nToCoreRequest,
} from "@/lib/automation/transportAuth";
import {
  N8N_CLAIM_ROUTE_PATH,
  isClaimableWorkflowFamily,
  type N8nClaimRequestBody,
  type N8nFamilyClaimRequestBody,
} from "@/lib/automation/transportTypes";
import {
  claimAutomationJobForFamilyN8nTransport,
  claimAutomationJobForN8nTransport,
  getAutomationTransportRuntimeConfig,
} from "@/services/automationTransportService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  const runtimeConfig = getAutomationTransportRuntimeConfig();

  if (!runtimeConfig.ok) {
    return json(
      { ok: false, code: runtimeConfig.code },
      503,
    );
  }

  const config = runtimeConfig.config;
  if (
    config.mode === "off" ||
    !config.inboundSecret ||
    !config.responseSecret ||
    !config.workerId
  ) {
    return json(
      { ok: false, code: "AUTOMATION_TRANSPORT_DISABLED" },
      503,
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BODY_BYTES
  ) {
    return json(
      { ok: false, code: "AUTOMATION_TRANSPORT_BODY_TOO_LARGE" },
      413,
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json(
      { ok: false, code: "AUTOMATION_TRANSPORT_BODY_UNREADABLE" },
      400,
    );
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return json(
      { ok: false, code: "AUTOMATION_TRANSPORT_BODY_TOO_LARGE" },
      413,
    );
  }

  const verified = verifyN8nToCoreRequest({
    rawBody,
    method: "POST",
    path: N8N_CLAIM_ROUTE_PATH,
    headers: request.headers,
    secret: config.inboundSecret,
  });

  if (!verified.ok) {
    return json(
      { ok: false, code: verified.code },
      verified.status,
    );
  }

  const parsed = parseClaimBody(rawBody);
  if (!parsed.ok) {
    return signedJson(
      {
        ok: false,
        code: parsed.code,
      },
      parsed.status,
      verified.requestId,
      config.responseSecret,
    );
  }

  if (parsed.body.requestId !== verified.requestId) {
    return signedJson(
      {
        ok: false,
        code: "AUTOMATION_TRANSPORT_REQUEST_ID_MISMATCH",
      },
      400,
      verified.requestId,
      config.responseSecret,
    );
  }

  if (parsed.body.workerId !== config.workerId) {
    return signedJson(
      {
        ok: false,
        code: "AUTOMATION_TRANSPORT_WORKER_NOT_AUTHORIZED",
      },
      403,
      verified.requestId,
      config.responseSecret,
    );
  }

  try {
    // QF-MVP-50.3/50.4 CLAIM TOPOLOGY.
    //
    // Exactly two accepted shapes, and both are family-safe:
    //
    //   legacy 3-key body  -> qf_claim_automation_job_v1, which SQL now fences
    //                         to client_whatsapp. The existing client workflow
    //                         is unchanged and can no longer consume vendor or
    //                         campaign work.
    //   4-key body with
    //   workflowFamily     -> the family-aware claim, exactly one family.
    //
    // There is no third business-authority implementation, no action allowlist
    // input, and no shape that can claim across families.
    const result = "workflowFamily" in parsed.body
      ? await claimAutomationJobForFamilyN8nTransport({
          requestId: verified.requestId,
          workerId: parsed.body.workerId,
          workflowFamily: parsed.body.workflowFamily,
          bodySha256: verified.bodySha256,
        })
      : await claimAutomationJobForN8nTransport({
          requestId: verified.requestId,
          workerId: parsed.body.workerId,
          bodySha256: verified.bodySha256,
        });

    return signedJson(
      result,
      200,
      verified.requestId,
      config.responseSecret,
    );
  } catch {
    // Never expose database, stack, secret, provider or environment detail.
    // If a claim had already become processing before this point, the durable
    // request ID prevents a replay from receiving the executable envelope.
    return signedJson(
      {
        ok: false,
        code: "AUTOMATION_TRANSPORT_INTERNAL_FAILURE",
      },
      500,
      verified.requestId,
      config.responseSecret,
    );
  }
}

function parseClaimBody(
  rawBody: string,
):
  | { ok: true; body: N8nClaimRequestBody | N8nFamilyClaimRequestBody }
  | { ok: false; status: 400; code: string } {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_JSON_INVALID",
    };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_BODY_INVALID",
    };
  }

  // EXACTLY two shapes. The legacy 3-key body is byte-compatible with the
  // shipped client workflow; the 4-key body adds one field and nothing else.
  // Any other key set — including an action allowlist — is refused.
  const keys = Object.keys(value).sort();
  const isLegacyShape =
    keys.length === 3 &&
    keys[0] === "requestId" &&
    keys[1] === "transportVersion" &&
    keys[2] === "workerId";
  const isFamilyShape =
    keys.length === 4 &&
    keys[0] === "requestId" &&
    keys[1] === "transportVersion" &&
    keys[2] === "workerId" &&
    keys[3] === "workflowFamily";

  if (!isLegacyShape && !isFamilyShape) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID",
    };
  }

  if (
    value.transportVersion !== 1 ||
    typeof value.requestId !== "string" ||
    typeof value.workerId !== "string"
  ) {
    return {
      ok: false,
      status: 400,
      code: "AUTOMATION_TRANSPORT_BODY_INVALID",
    };
  }

  if (isFamilyShape) {
    // Exactly one canonical family. A wildcard, an array, a comma list, an
    // empty string and an unknown value all fail closed here.
    if (!isClaimableWorkflowFamily(value.workflowFamily)) {
      return {
        ok: false,
        status: 400,
        code: "AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID",
      };
    }
    return {
      ok: true,
      body: {
        transportVersion: 1,
        requestId: value.requestId,
        workerId: value.workerId,
        workflowFamily: value.workflowFamily,
      },
    };
  }

  return {
    ok: true,
    body: {
      transportVersion: 1,
      requestId: value.requestId,
      workerId: value.workerId,
    },
  };
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
    path: N8N_CLAIM_ROUTE_PATH,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
