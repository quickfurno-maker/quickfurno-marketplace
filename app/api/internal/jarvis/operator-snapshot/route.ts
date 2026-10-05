import { NextResponse } from "next/server";

import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import { parseQfjOperatorSnapshotRequest, QFJ_OPERATOR_SNAPSHOT_PATH } from "@/lib/jarvis/operatorSnapshotContract";
import { qfjScaleHeadersForResult, qfjScaleHttpStatus, verifyQfjScaleWebRequest } from "@/lib/jarvis/scaleRequestGuard";
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER } from "@/lib/jarvis/signedRequestAuth";
import { verifyQfjOperatorSnapshotSignature } from "@/lib/jarvis/operatorSnapshotAuth";
import { readJarvisOperatorSnapshot } from "@/services/jarvisOperatorSnapshotService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
) =>
  NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });

export async function POST(request: Request): Promise<Response> {
  let raw: Uint8Array;
  try { raw = new Uint8Array(await request.arrayBuffer()); }
  catch { return reply(400, { error: "invalid_request" }); }
  if (raw.byteLength < 2 || raw.byteLength > 4096) return reply(413, { error: "invalid_request" });

  let json: unknown;
  try { json = JSON.parse(Buffer.from(raw).toString("utf8")); }
  catch { return reply(400, { error: "invalid_request" }); }

  const parsed = parseQfjOperatorSnapshotRequest(json);
  if (!parsed) return reply(400, { error: "invalid_request" });

  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_OS_READ_VERIFICATION_KEYS_JSON);
  if (!keys) return reply(503, { error: "service_unavailable" });

  const scaleContract = verifyQfjScaleWebRequest({
    request,
    rawBody: raw,
    path: QFJ_OPERATOR_SNAPSHOT_PATH,
    verificationKeys: keys,
    nowMs: Date.now(),
    allowLegacy: true,
  });
  if (!scaleContract.ok) {
    return reply(
      qfjScaleHttpStatus(scaleContract.errorClass),
      { error: "scale_contract_rejected", errorClass: scaleContract.errorClass },
    );
  }

  const verified = verifyQfjOperatorSnapshotSignature({
    rawBody: raw,
    request: parsed,
    keyId: request.headers.get(QFJ_KEY_ID_HEADER),
    signature: request.headers.get(QFJ_SIGNATURE_HEADER),
    keys,
    now: new Date().toISOString(),
  });
  if (!verified) return reply(401, { error: "authentication_failed" });

  try {
    return reply(
      200,
      await readJarvisOperatorSnapshot(),
      qfjScaleHeadersForResult(scaleContract),
    );
  }
  catch { return reply(503, { error: "service_unavailable" }); }
}
