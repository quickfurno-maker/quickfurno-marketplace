// ============================================================================
// QuickFurno — lib/communication/providers/mockWhatsAppProvider.ts
//
// Mock WhatsApp Provider implementation for tests and the dev sandbox.
// Bounded strictly to mock execution: zero network calls, zero WhatsApp sends.
//
// DETERMINISM CONTRACT (Phase 5B review fixes #5 and #6)
//   • Message ids come from a per-instance monotonic counter plus a stable hash
//     of the send input — never Math.random(), never Date.now().
//   • normalizeWebhook() and deriveWebhookEventId() are PURE functions of the
//     payload. Same payload in, same events out, forever.
//   • verifyWebhookSignature() applies one exact rule — an HMAC-SHA256 of the
//     raw body under the shared secret. There is no permissive prefix check.
//
// THIS ADAPTER IS TEST/DEV ONLY. It must never be registered as the active
// provider in production; a real adapter implements the same interface.
// ============================================================================

import crypto from "crypto";
import type {
  WhatsAppNormalizedEventType,
  WhatsAppProvider,
  WhatsAppProviderHealth,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from "./whatsappProvider";
import { definitivePermanentProviderError, definitiveRetryableProviderError } from "./providerError";
import {
  isForbiddenSecurityMetadataKey,
  sanitizeAuthSecurityMetadata,
} from "../../identity/authSecurityEvent";

/** The one provider identity this adapter ever reports. */
export const MOCK_PROVIDER_KEY = "mock";

/**
 * Reserved E.164 destinations that steer the simulation. Real numbers are never
 * used, and the triggers are valid E.164 so they survive phone normalization.
 */
export const MOCK_DESTINATIONS = {
  /** Returns a retryable failure RESULT (adapter does not throw). */
  RETRYABLE_FAILURE: "+15550000001",
  /** Returns a permanent failure RESULT (adapter does not throw). */
  PERMANENT_FAILURE: "+15550000002",
  /** THROWS a typed DEFINITIVE, safely-retryable ProviderDispatchError. */
  THROW_TRANSIENT: "+15550000003",
  /** THROWS a typed DEFINITIVE, permanent ProviderDispatchError. */
  THROW_PERMANENT: "+15550000004",
  /** THROWS a raw Error carrying an AMBIGUOUS transport `code` (ECONNRESET). */
  THROW_TRANSPORT: "+15550000005",
  /** THROWS an unclassified Error whose message is stuffed with secrets. */
  THROW_LEAKY: "+15550000006",
} as const;

/**
 * The secret-bearing exception text used by THROW_LEAKY. Exported so the harness
 * can assert that not one character of it ever reaches the ledger.
 */
const MOCK_STRIPE_SHAPED_SECRET = ["sk", "live", "9f3ac2b81de44c07a5e6"].join("_");
const MOCK_AWS_SHAPED_ACCESS_KEY = ["AK", "IA", "7QF2MOCKKEY0001"].join("");

export const MOCK_LEAKY_EXCEPTION_MESSAGE =
  `POST /v1/messages failed. Authorization: Bearer ${MOCK_STRIPE_SHAPED_SECRET} — api_key=${MOCK_AWS_SHAPED_ACCESS_KEY}, raw_payload={"otp":"123456","to":"+919876543210"}`;

const ALLOWED_WEBHOOK_STATUSES: readonly WhatsAppNormalizedEventType[] = Object.freeze([
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
]);

function isNormalizedEventType(value: unknown): value is WhatsAppNormalizedEventType {
  return typeof value === "string" && (ALLOWED_WEBHOOK_STATUSES as readonly string[]).includes(value);
}

/** Stable, order-independent hash of an arbitrary JSON-ish value. */
function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(",")}}`;
}

/** Reads the first present key, coercing only strings/numbers. */
function readField(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * The exact signature the mock accepts: `sha256=<hmac-sha256(secret, rawBody)>`.
 * Exported so harnesses can build a valid signature instead of a magic string.
 */
export function computeMockWebhookSignature(rawBody: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Constant-time comparison that tolerates unequal lengths. */
function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** What the mock retained about a send. Never holds a plaintext secret. */
export interface MockSendRecord {
  readonly lane: "authentication" | "business";
  readonly to: string;
  readonly templateKey: string;
  /** Variable NAMES only — enough to assert templating, no values leaked. */
  readonly variableKeys: readonly string[];
  /** Business-lane variables with secret-looking keys redacted. Empty for auth. */
  readonly variables: Record<string, string>;
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly providerKey = MOCK_PROVIDER_KEY;
  /** This adapter serves the WhatsApp channel only. */
  readonly channel = "whatsapp" as const;
  /** The mock sends by internal template key — no approved provider mapping needed. */
  readonly templateResolutionMode = "internal_template" as const;

  private sendSequence = 0;
  private lastSentPayloads: MockSendRecord[] = [];

  getLastSentPayloads(): readonly MockSendRecord[] {
    return this.lastSentPayloads;
  }

  clearLastSentPayloads(): void {
    this.lastSentPayloads = [];