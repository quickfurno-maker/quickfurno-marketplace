// ============================================================================
// QuickFurno — lib/communication/providers/metaWhatsAppWebhook.ts  (Phase 5F-B)
//
// PURE Meta WhatsApp Cloud webhook helpers: constant-time signature verification,
// payload CLASSIFICATION (delivery vs known non-delivery vs unknown), conservative
// delivery-status NORMALIZATION, and a deterministic, PII-free event id.
//
// Security: no clock or randomness in derived ids; no phone / WhatsApp id / message
// content in any derived id or sanitized metadata. Delivery statuses are normalized
// conservatively — anything unmappable or incomplete is DROPPED, never coerced.
// Phase 5F-B does NOT process inbound/template/account payloads (later phases own
// them); it only classifies them so the route can acknowledge safely.
// ============================================================================

import crypto from "crypto";
import type { WhatsAppNormalizedEventType, WhatsAppWebhookEvent } from "./whatsappProvider";

/** The Meta webhook signature header (lower-cased). */
export const META_SIGNATURE_HEADER = "x-hub-signature-256";

export const MetaWebhookClassification = {
  DELIVERY_STATUS: "delivery_status",
  INBOUND_MESSAGE: "inbound_message",
  TEMPLATE_STATUS: "template_status",
  ACCOUNT_STATUS: "account_status",
  UNKNOWN: "unknown",
} as const;

export type MetaWebhookClassificationValue =
  (typeof MetaWebhookClassification)[keyof typeof MetaWebhookClassification];

/** Meta delivery statuses we map to the QuickFurno lifecycle (never "accepted"). */
const META_STATUS_MAP: Readonly<Record<string, WhatsAppNormalizedEventType>> = Object.freeze({
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
});

const ACCOUNT_FIELDS: ReadonlySet<string> = new Set([
  "account_update",
  "account_review_update",
  "account_alerts",
  "phone_number_name_update",
  "phone_number_quality_update",
  "business_capability_update",
]);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the Meta `X-Hub-Signature-256` header against the RAW body using the app
 * secret. Expects `sha256=<hex>`; compares in constant time. Never logs either value.
 */
export function verifyMetaWebhookSignature(rawBody: string, signature: string, appSecret: string): boolean {
  if (typeof rawBody !== "string" || !signature || !appSecret) return false;
  if (!signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return secureEquals(signature, expected);
}

/** Build the header value a valid Meta signature would carry (test helper). */
export function computeMetaWebhookSignature(rawBody: string, appSecret: string): string {
  return "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

export type MetaWebhookGetResult =
  | { readonly ok: true; readonly challenge: string }
  | { readonly ok: false };

/**
 * GET webhook verification. Echoes `hub.challenge` ONLY when `hub.mode` is
 * `subscribe` AND `hub.verify_token` matches the server-only verify token (constant
 * time). This is independent of outbound sending — it must work before any send is
 * enabled. Never logs or returns the token.
 */
export function verifyMetaWebhookGetChallenge(
  params: { readonly mode: string | null; readonly verifyToken: string | null; readonly challenge: string | null },
  expectedVerifyToken: string
): MetaWebhookGetResult {
  if (params.mode !== "subscribe") return { ok: false };
  if (typeof params.verifyToken !== "string" || typeof expectedVerifyToken !== "string" || expectedVerifyToken === "") {
    return { ok: false };
  }
  if (!secureEquals(params.verifyToken, expectedVerifyToken)) return { ok: false };
  if (typeof params.challenge !== "string" || params.challenge === "") return { ok: false };
  return { ok: true, challenge: params.challenge };
}

/** Stable payload hash for receipt de-duplication (matches the service's usage). */
export function metaWebhookPayloadHash(rawBody: string): string {
  return sha256Hex(rawBody ?? "");
}

type ChangeValue = Record<string, unknown>;

function forEachChange(payload: Record<string, unknown>, fn: (field: string, value: ChangeValue) => void): void {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown })?.changes)
      ? (entry as { changes: unknown[] }).changes
      : [];
    for (const change of changes) {
      const field = (change as { field?: unknown })?.field;
      const value = (change as { value?: unknown })?.value;
      if (typeof field === "string" && value && typeof value === "object") {
        fn(field, value as ChangeValue);
      }
    }
  }
}

/**
 * Classify a verified Meta payload. Returns the FIRST meaningful classification, or
 * `unknown` for an unrecognised/unparseable structure. Never guesses.
 */
export function classifyMetaWebhook(payload: unknown): MetaWebhookClassificationValue {
  if (!payload || typeof payload !== "object") return MetaWebhookClassification.UNKNOWN;
  const p = payload as Record<string, unknown>;
  if (p.object !== "whatsapp_business_account") return MetaWebhookClassification.UNKNOWN;

  let result: MetaWebhookClassificationValue = MetaWebhookClassification.UNKNOWN;
  forEachChange(p, (field, value) => {
    if (result !== MetaWebhookClassification.UNKNOWN) return; // keep the first
    if (field === "messages" && Array.isArray(value.statuses) && value.statuses.length > 0) {
      result = MetaWebhookClassification.DELIVERY_STATUS;
    } else if (field === "messages" && Array.isArray(value.messages) && value.messages.length > 0) {
      result = MetaWebhookClassification.INBOUND_MESSAGE;
    } else if (field === "message_template_status_update") {
      result = MetaWebhookClassification.TEMPLATE_STATUS;
    } else if (ACCOUNT_FIELDS.has(field)) {
      result = MetaWebhookClassification.ACCOUNT_STATUS;
    }
  });
  return result;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Deterministic, PII-free per-event id: message id + status + timestamp, hashed. */
export function deriveMetaDeliveryEventId(messageId: string, status: string, timestamp: string): string {
  return `meta-evt-${sha256Hex(`${messageId}|${status}|${timestamp}`).slice(0, 32)}`;
}

/**
 * Deterministic receipt-level event id for a whole payload — a stable hash of the
 * payload. Identical payloads collapse onto one receipt (desired de-duplication).
 * No clock, no randomness.
 */
export function deriveMetaWebhookEventId(payload: Record<string, unknown>): string {
  return `meta-wh-${sha256Hex(stableStringify(payload)).slice(0, 32)}`;
}

/**
 * Normalize Meta delivery statuses to QuickFurno webhook events. Only sent/delivered/
 * read/failed are emitted; anything with an unknown status, a missing message id, or
 * an invalid timestamp is DROPPED (never coerced). Supports multiple statuses in one
 * payload. Metadata carries only a safe error code — never a phone/WhatsApp id.
 */
export function normalizeMetaDeliveryWebhook(payload: unknown): WhatsAppWebhookEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  if (p.object !== "whatsapp_business_account") return [];

  const events: WhatsAppWebhookEvent[] = [];
  forEachChange(p, (field, value) => {
    if (field !== "messages" || !Array.isArray(value.statuses)) return;
    for (const raw of value.statuses) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const messageId = readString(s, "id");
      const status = typeof s.status === "string" ? s.status : null;
      const timestamp = readString(s, "timestamp");
      if (!messageId || !status || !timestamp) continue;
      const normalized = META_STATUS_MAP[status];
      if (!normalized) continue;
      const tsSeconds = Number(timestamp);
      if (!Number.isFinite(tsSeconds) || tsSeconds <= 0) continue;
      const occurredAt = new Date(tsSeconds * 1000).toISOString();

      const sanitizedMetadata: Record<string, unknown> = {};
      if (Array.isArray(s.errors) && s.errors.length > 0) {
        const first = s.errors[0] as Record<string, unknown>;
        const errorCode = readString(first, "code");
        if (errorCode) sanitizedMetadata.error_code = errorCode;
      }

      events.push({
        providerEventId: deriveMetaDeliveryEventId(messageId, normalized, timestamp),
        providerMessageId: messageId,
        normalizedEventType: normalized,
        occurredAt,
        sanitizedMetadata,
      });
    }
  });
  return events;
}
