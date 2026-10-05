import {
  QFJ_SCALE_HEADERS,
  qfjScaleResponseHeaders,
  verifyQfjScaleRequest,
  type QfjScaleErrorClass,
  type QfjScaleVerificationKey,
  type QfjScaleVerificationResult,
} from "./scaleContract";

function headerRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of Object.values(QFJ_SCALE_HEADERS)) {
    const value = headers.get(name);
    if (value !== null) result[name] = value;
  }
  return result;
}

export function verifyQfjScaleWebRequest(args: {
  readonly request: Request;
  readonly rawBody: Uint8Array;
  readonly path: string;
  readonly verificationKeys: readonly QfjScaleVerificationKey[];
  readonly nowMs?: number;
  readonly allowLegacy?: boolean;
}): QfjScaleVerificationResult {
  return verifyQfjScaleRequest({
    headers: headerRecord(args.request.headers),
    method: args.request.method,
    path: args.path,
    rawBody: args.rawBody,
    verificationKeys: args.verificationKeys,
    ...(args.nowMs === undefined ? {} : { nowMs: args.nowMs }),
    allowLegacy: args.allowLegacy ?? true,
  });
}

export function qfjScaleHeadersForResult(
  result: QfjScaleVerificationResult,
  errorClass: QfjScaleErrorClass = "QFJ_NONE",
): Readonly<Record<string, string>> {
  return result.ok && result.mode === "v1"
    ? qfjScaleResponseHeaders(result.metadata, errorClass)
    : {};
}

export function qfjScaleHttpStatus(errorClass: QfjScaleErrorClass): number {
  if (errorClass === "QFJ_AUTHENTICATION_FAILED") return 401;
  if (errorClass === "QFJ_DEADLINE_EXCEEDED") return 408;
  if (errorClass === "QFJ_BACKPRESSURE" || errorClass === "QFJ_CIRCUIT_OPEN") return 429;
  if (errorClass === "QFJ_UPSTREAM_UNAVAILABLE" || errorClass === "QFJ_UPSTREAM_TIMEOUT") return 503;
  return 400;
}
