// ============================================================================
// QuickFurno — QF-MVP-50.1C signed Core <-> n8n transport contract
//
// Pure cryptographic module. No database, network, provider or environment I/O.
// ============================================================================

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const AUTOMATION_TRANSPORT_VERSION = 1 as const;
export const AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS = 300;

export const N8N_TO_CORE_TRANSPORT_HEADERS = {
  version: "x-qf-transport-version",
  requestId: "x-qf-request-id",
  timestamp: "x-qf-timestamp",
  bodySha256: "x-qf-body-sha256",
  signature: "x-qf-signature",
} as const;

export const CORE_TO_N8N_RESPONSE_HEADERS = {
  version: "x-qf-response-version",
  requestId: "x-qf-response-request-id",
  timestamp: "x-qf-response-timestamp",
  bodySha256: "x-qf-response-body-sha256",
  signature: "x-qf-response-signature",
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/;

export interface SignedTransportMaterial {
  version: typeof AUTOMATION_TRANSPORT_VERSION;
  requestId: string;
  timestamp: number;
  bodySha256: string;
  signature: string;
}

export type TransportVerificationResult =
  | {
      ok: true;
      requestId: string;
      timestamp: number;
      bodySha256: string;
    }
  | {
      ok: false;
      status: 400 | 401;
      code:
        | "TRANSPORT_VERSION_INVALID"
        | "TRANSPORT_REQUEST_ID_INVALID"
        | "TRANSPORT_TIMESTAMP_INVALID"
        | "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW"
        | "TRANSPORT_BODY_HASH_INVALID"
        | "TRANSPORT_BODY_HASH_MISMATCH"
        | "TRANSPORT_SIGNATURE_INVALID"
        | "TRANSPORT_SECRET_INVALID";
    };

export function sha256Hex(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function createN8nToCoreSignature(input: {
  secret: string;
  method: string;
  path: string;
  requestId: string;
  timestamp: number;
  bodySha256: string;
}): string {
  assertSecret(input.secret);
  const canonical = canonicalN8nToCore({
    method: input.method,
    path: input.path,
    requestId: input.requestId,
    timestamp: input.timestamp,
    bodySha256: input.bodySha256,
  });
  return `v1=${createHmac("sha256", input.secret)
    .update(canonical, "utf8")
    .digest("hex")}`;
}

export function createCoreToN8nResponseSignature(input: {
  secret: string;
  path: string;
  requestId: string;
  timestamp: number;
  bodySha256: string;
}): string {
  assertSecret(input.secret);
  const canonical = canonicalCoreResponse({
    path: input.path,
    requestId: input.requestId,
    timestamp: input.timestamp,
    bodySha256: input.bodySha256,
  });
  return `v1=${createHmac("sha256", input.secret)
    .update(canonical, "utf8")
    .digest("hex")}`;
}

export function verifyN8nToCoreRequest(input: {
  rawBody: string;
  method: string;
  path: string;
  headers: Headers;
  secret: string;
  nowSeconds?: number;
}): TransportVerificationResult {
  const secretValidation = validateSecret(input.secret);
  if (!secretValidation) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_SECRET_INVALID",
    };
  }

  const version = input.headers.get(N8N_TO_CORE_TRANSPORT_HEADERS.version);
  if (version !== String(AUTOMATION_TRANSPORT_VERSION)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_VERSION_INVALID",
    };
  }

  const requestId =
    input.headers.get(N8N_TO_CORE_TRANSPORT_HEADERS.requestId)?.trim() ?? "";
  if (!UUID_RE.test(requestId)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_REQUEST_ID_INVALID",
    };
  }

  const timestampRaw =
    input.headers.get(N8N_TO_CORE_TRANSPORT_HEADERS.timestamp)?.trim() ?? "";
  if (!/^\d{10}$/.test(timestampRaw)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_TIMESTAMP_INVALID",
    };
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isSafeInteger(timestamp)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_TIMESTAMP_INVALID",
    };
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    Math.abs(nowSeconds - timestamp) >
    AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS
  ) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW",
    };
  }

  const bodySha256 =
    input.headers.get(N8N_TO_CORE_TRANSPORT_HEADERS.bodySha256)?.trim() ?? "";
  if (!SHA256_RE.test(bodySha256)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_BODY_HASH_INVALID",
    };
  }

  const actualBodySha256 = sha256Hex(input.rawBody);
  if (!timingSafeHexEqual(bodySha256, actualBodySha256)) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_BODY_HASH_MISMATCH",
    };
  }

  const providedSignature =
    input.headers.get(N8N_TO_CORE_TRANSPORT_HEADERS.signature)?.trim() ?? "";
  const expectedSignature = createN8nToCoreSignature({
    secret: input.secret,
    method: input.method,
    path: input.path,
    requestId,
    timestamp,
    bodySha256,
  });

  if (!timingSafeSignatureEqual(providedSignature, expectedSignature)) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_SIGNATURE_INVALID",
    };
  }

  return {
    ok: true,
    requestId,
    timestamp,
    bodySha256,
  };
}

export function verifyCoreToN8nResponse(input: {
  rawBody: string;
  path: string;
  headers: Headers;
  secret: string;
  nowSeconds?: number;
}): TransportVerificationResult {
  const secretValidation = validateSecret(input.secret);
  if (!secretValidation) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_SECRET_INVALID",
    };
  }

  const version = input.headers.get(CORE_TO_N8N_RESPONSE_HEADERS.version);
  if (version !== String(AUTOMATION_TRANSPORT_VERSION)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_VERSION_INVALID",
    };
  }

  const requestId =
    input.headers.get(CORE_TO_N8N_RESPONSE_HEADERS.requestId)?.trim() ?? "";
  if (!UUID_RE.test(requestId)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_REQUEST_ID_INVALID",
    };
  }

  const timestampRaw =
    input.headers.get(CORE_TO_N8N_RESPONSE_HEADERS.timestamp)?.trim() ?? "";
  if (!/^\d{10}$/.test(timestampRaw)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_TIMESTAMP_INVALID",
    };
  }
  const timestamp = Number(timestampRaw);

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) >
      AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS
  ) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW",
    };
  }

  const bodySha256 =
    input.headers.get(CORE_TO_N8N_RESPONSE_HEADERS.bodySha256)?.trim() ?? "";
  if (!SHA256_RE.test(bodySha256)) {
    return {
      ok: false,
      status: 400,
      code: "TRANSPORT_BODY_HASH_INVALID",
    };
  }

  if (!timingSafeHexEqual(bodySha256, sha256Hex(input.rawBody))) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_BODY_HASH_MISMATCH",
    };
  }

  const providedSignature =
    input.headers.get(CORE_TO_N8N_RESPONSE_HEADERS.signature)?.trim() ?? "";
  const expectedSignature = createCoreToN8nResponseSignature({
    secret: input.secret,
    path: input.path,
    requestId,
    timestamp,
    bodySha256,
  });

  if (!timingSafeSignatureEqual(providedSignature, expectedSignature)) {
    return {
      ok: false,
      status: 401,
      code: "TRANSPORT_SIGNATURE_INVALID",
    };
  }

  return {
    ok: true,
    requestId,
    timestamp,
    bodySha256,
  };
}

export function buildSignedCoreResponseHeaders(input: {
  rawBody: string;
  path: string;
  requestId: string;
  secret: string;
  timestamp?: number;
}): Record<string, string> {
  assertSecret(input.secret);
  if (!UUID_RE.test(input.requestId)) {
    throw new Error("TRANSPORT_REQUEST_ID_INVALID");
  }

  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const bodySha256 = sha256Hex(input.rawBody);
  const signature = createCoreToN8nResponseSignature({
    secret: input.secret,
    path: input.path,
    requestId: input.requestId,
    timestamp,
    bodySha256,
  });

  return {
    [CORE_TO_N8N_RESPONSE_HEADERS.version]: String(
      AUTOMATION_TRANSPORT_VERSION,
    ),
    [CORE_TO_N8N_RESPONSE_HEADERS.requestId]: input.requestId,
    [CORE_TO_N8N_RESPONSE_HEADERS.timestamp]: String(timestamp),
    [CORE_TO_N8N_RESPONSE_HEADERS.bodySha256]: bodySha256,
    [CORE_TO_N8N_RESPONSE_HEADERS.signature]: signature,
  };
}

function canonicalN8nToCore(input: {
  method: string;
  path: string;
  requestId: string;
  timestamp: number;
  bodySha256: string;
}): string {
  return [
    "QF-AUTOMATION-TRANSPORT-V1",
    "N8N_TO_CORE",
    input.method.toUpperCase(),
    normalizePath(input.path),
    input.requestId,
    String(input.timestamp),
    input.bodySha256,
  ].join("\n");
}

function canonicalCoreResponse(input: {
  path: string;
  requestId: string;
  timestamp: number;
  bodySha256: string;
}): string {
  return [
    "QF-AUTOMATION-TRANSPORT-V1",
    "CORE_TO_N8N_RESPONSE",
    normalizePath(input.path),
    input.requestId,
    String(input.timestamp),
    input.bodySha256,
  ].join("\n");
}

function normalizePath(path: string): string {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("TRANSPORT_PATH_INVALID");
  }
  return path;
}

function validateSecret(secret: string): boolean {
  return typeof secret === "string" && secret.length >= 32;
}

function assertSecret(secret: string): void {
  if (!validateSecret(secret)) {
    throw new Error("TRANSPORT_SECRET_INVALID");
  }
}

function timingSafeSignatureEqual(
  provided: string,
  expected: string,
): boolean {
  const providedMatch = SIGNATURE_RE.exec(provided);
  const expectedMatch = SIGNATURE_RE.exec(expected);
  if (!providedMatch?.[1] || !expectedMatch?.[1]) return false;
  return timingSafeHexEqual(providedMatch[1], expectedMatch[1]);
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!SHA256_RE.test(left) || !SHA256_RE.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
