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
import { permanentProviderError, transientProviderError } from "./providerError";
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
  /** THROWS a transient ProviderDispatchError. */
  THROW_TRANSIENT: "+15550000003",
  /** THROWS a permanent ProviderDispatchError. */
  THROW_PERMANENT: "+15550000004",
  /** THROWS a raw Error carrying a Node transport `code` (ECONNRESET). */
  THROW_TRANSPORT: "+15550000005",
  /** THROWS an unclassified Error whose message is stuffed with secrets. */
  THROW_LEAKY: "+15550000006",
} as const;

/**
 * The secret-bearing exception text used by THROW_LEAKY. Exported so the harness
 * can assert that not one character of it ever reaches the ledger.
 */
export const MOCK_LEAKY_EXCEPTION_MESSAGE =
  'POST /v1/messages failed. Authorization: Bearer sk_live_9f3ac2b81de44c07a5e6 — api_key=AKIA7QF2MOCKKEY0001, raw_payload={"otp":"123456","to":"+919876543210"}';

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

  private sendSequence = 0;
  private lastSentPayloads: MockSendRecord[] = [];

  getLastSentPayloads(): readonly MockSendRecord[] {
    return this.lastSentPayloads;
  }

  clearLastSentPayloads(): void {
    this.lastSentPayloads = [];
  }

  /** Resets the deterministic id counter. Tests call this for a clean slate. */
  reset(): void {
    this.sendSequence = 0;
    this.lastSentPayloads = [];
  }

  async sendAuthenticationMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<WhatsAppSendResult> {
    // SECURITY: the authentication lane carries the plaintext OTP to the
    // provider call and nowhere else. The mock retains variable NAMES only, so
    // a test double can never become an OTP sink.
    this.lastSentPayloads.push({
      lane: "authentication",
      to,
      templateKey,
      variableKeys: Object.keys(variables),
      variables: {},
    });

    return this.simulateSend(to, templateKey, variables);
  }

  async sendTemplateMessage(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): Promise<WhatsAppSendResult> {
    // Reuses the Phase 5A sanitization vocabulary rather than a weaker local
    // regex, so "forbidden key" means exactly one thing across the codebase.
    const sanitizedVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      sanitizedVars[key] = isForbiddenSecurityMetadataKey(key) ? "[REDACTED]" : value;
    }

    this.lastSentPayloads.push({
      lane: "business",
      to,
      templateKey,
      variableKeys: Object.keys(variables),
      variables: sanitizedVars,
    });

    return this.simulateSend(to, templateKey, variables);
  }

  private simulateSend(
    to: string,
    templateKey: string,
    variables: Record<string, string>
  ): WhatsAppSendResult {
    // --- adapters that THROW ---------------------------------------------
    // CommunicationService must normalize each of these into a safe delivery
    // failure and never strand the message in `dispatching`.
    if (to === MOCK_DESTINATIONS.THROW_TRANSIENT) {
      throw transientProviderError("MOCK_TRANSIENT_TRANSPORT", "Simulated mock provider socket hang up");
    }

    if (to === MOCK_DESTINATIONS.THROW_PERMANENT) {
      throw permanentProviderError("MOCK_PERMANENT_REJECTION", "Simulated mock provider permanent rejection");
    }

    if (to === MOCK_DESTINATIONS.THROW_TRANSPORT) {
      const transport = new Error("socket hang up") as Error & { code: string };
      transport.code = "ECONNRESET";
      throw transport;
    }

    if (to === MOCK_DESTINATIONS.THROW_LEAKY) {
      // An unclassified adapter bug whose message is full of things that must
      // never be persisted. The service must withhold this text entirely.
      throw new Error(MOCK_LEAKY_EXCEPTION_MESSAGE);
    }

    // --- adapters that RETURN a failure result ----------------------------
    if (to === MOCK_DESTINATIONS.RETRYABLE_FAILURE) {
      return {
        accepted: false,
        provider: this.providerKey,
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: "RATE_LIMIT_EXCEEDED",
        errorMessage: "Simulated mock provider rate limit exceeded",
        retryable: true,
      };
    }

    if (to === MOCK_DESTINATIONS.PERMANENT_FAILURE) {
      return {
        accepted: false,
        provider: this.providerKey,
        providerMessageId: null,
        normalizedStatus: "failed",
        errorCode: "INVALID_DESTINATION_NUMBER",
        errorMessage: "Simulated mock provider invalid recipient destination",
        retryable: false,
      };
    }

    // Deterministic id: monotonic counter + stable hash of the send input.
    this.sendSequence += 1;
    const sequence = String(this.sendSequence).padStart(6, "0");
    const inputDigest = stableHash({ to, templateKey, variables }).slice(0, 12);

    return {
      accepted: true,
      provider: this.providerKey,
      providerMessageId: `mock-msg-${sequence}-${inputDigest}`,
      normalizedStatus: "accepted",
      errorCode: null,
      errorMessage: null,
      retryable: false,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
    if (typeof rawBody !== "string" || !signature || !secret) return false;
    return secureEquals(signature, computeMockWebhookSignature(rawBody, secret));
  }

  deriveWebhookEventId(payload: Record<string, unknown>): string {
    const explicit = readField(payload, "event_id", "eventId");
    if (explicit) return explicit;
    // Deterministic fallback — never random. Identical payloads collapse onto
    // the same receipt, which is exactly the de-duplication behaviour we want.
    return `mock-evt-${stableHash(payload).slice(0, 24)}`;
  }

  normalizeWebhook(payload: Record<string, unknown>): WhatsAppWebhookEvent[] {
    const providerMessageId = readField(payload, "message_id", "messageId");
    const occurredAt = readField(payload, "timestamp", "occurred_at", "occurredAt");
    const status = readField(payload, "status");

    // Required identifiers absent, or a lifecycle state we do not understand:
    // drop the event. It must never be coerced onto "delivered".
    if (!providerMessageId || !occurredAt) return [];
    if (!isNormalizedEventType(status)) return [];

    const rawMeta = (payload.metadata as Record<string, unknown>) || {};
    const sanitizedMetadata = sanitizeAuthSecurityMetadata(rawMeta);

    return [
      {
        providerEventId: this.deriveWebhookEventId(payload),
        providerMessageId,
        normalizedEventType: status,
        occurredAt,
        sanitizedMetadata,
      },
    ];
  }

  async healthCheck(): Promise<WhatsAppProviderHealth> {
    return {
      provider: this.providerKey,
      configured: true,
      reachable: true,
      status: "healthy",
      // A health probe is inherently a point-in-time observation; this is the
      // one clock read the mock keeps.
      checkedAt: new Date().toISOString(),
      latencyMs: 12,
      detailsSanitized: { info: "Mock provider online", mode: "test-dev-only" },
    };
  }
}
