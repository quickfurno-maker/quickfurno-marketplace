// ============================================================================
// QuickFurno — lib/communication/providers/exotelSmsProvider.ts   (Phase 5F-C3-A)
//
// The first REAL SMS provider adapter: Exotel. SERVER-ONLY. PERMANENTLY INACTIVE until a
// later phase activates it.
//
// NOTHING CONSTRUCTS THIS CLASS IN PRODUCTION CODE. Phase 5F-C3-A adds no factory, no
// dispatch, no fallback wiring, no webhook route, and no CommunicationService change. The
// only instantiation lives in the harness, against a fake transport. Even a fully
// configured Exotel account could not send: the C2 runtime gate has no Exotel policy,
// account, template-mapping or canary row, and Phase 5F-C1 ships zero active failure rules.
//
// NO RETRY, NO LOOP, NO QUEUE. The adapter performs at most ONE HTTP request per call.
// Phase 5F-C1's attempt ledger remains the only attempt authority (two transport attempts
// per authentication action, ever).
//
// TIMEOUT: the abortable `HttpTransport` cancels the ACTUAL request via AbortController.
// A `Promise.race` pseudo-timeout is forbidden — it rejects the waiter while the request
// keeps running, which is a duplicate-OTP hazard.
//
// OUTCOME CERTAINTY is ALWAYS present and conservative, and is derived from the ONE generic
// model in `providerOutcome.ts` — never re-invented here:
//   2xx WITH a usable SMS Sid   → accepted
//   2xx WITHOUT a usable Sid    → unknown_outcome  (Exotel may still deliver)
//   4xx explicit rejection      → definitive_failure, sanitized Exotel code
//   5xx                         → unknown_outcome  (the request may have been processed)
//   timeout / abort             → unknown_outcome
//   ambiguous network failure   → unknown_outcome
//   PROVEN pre-connect failure  → definitive_failure, safely retryable
//
// SECURITY / PRIVACY: the API key and token travel only inside the Basic `Authorization`
// header; they never appear in a URL, a result, an error, a log, or a database field. The
// OTP, the rendered message body, and the plaintext destination are never logged, retained,
// or echoed. The raw provider response body is parsed transiently and never persisted —
// only an allowlisted, identifier-shaped failure code survives.
//
// DLT: India DLT registration is EXTERNAL and PENDING (Phase 5F-C3-C). This adapter never
// invents a template: it forwards an already-approved, caller-resolved content descriptor.
// ============================================================================

import {
  DEFAULT_MAX_RESPONSE_BYTES,
  type HttpTransport,
  type HttpTransportResult,
} from "../httpTransport";
import { classifyTransportCertainty } from "./providerOutcome";
import type { ProviderOutcomeCertainty } from "./providerOutcome";
import {
  resolveSmsNetworkTimeoutMs,
  type SmsAuthenticationSendOptions,
  type SmsProvider,
  type SmsProviderHealth,
  type SmsSendResult,
} from "./smsProvider";
import { EXOTEL_SMS_PROVIDER_KEY, type ExotelConfig } from "./exotelConfig";

export { EXOTEL_SMS_PROVIDER_KEY };

/** Only an identifier-shaped string may ever reach a result field or the ledger. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;

/** E.164, as normalized upstream. The adapter re-checks rather than trusting a caller. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function buildExotelSendSmsUrl(cfg: Pick<ExotelConfig, "subdomain" | "accountSid">): string {
  return `https://${cfg.subdomain}/v1/Accounts/${cfg.accountSid}/Sms/send.json`;
}

export function buildExotelAccountUrl(cfg: Pick<ExotelConfig, "subdomain" | "accountSid">): string {
  return `https://${cfg.subdomain}/v1/Accounts/${cfg.accountSid}`;
}

/**
 * The Basic credential. Built at the moment of the request and never retained, never
 * returned, never logged. `exotelConfig.ts` guarantees neither half contains a `:`.
 */
function basicAuthorizationHeader(apiKey: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiToken}`, "utf8").toString("base64")}`;
}

/**
 * An APPROVED, DLT-registered content descriptor resolved by the CALLER (from the C2 runtime
 * gate's `ResolvedSmsTemplateMapping`). The adapter never renders, fabricates, or guesses a
 * template — exactly as the Meta adapter refuses a bare template key.
 */
export interface ExotelResolvedSms {
  /** The registered DLT content template name the mapping approved. */
  readonly providerTemplateName: string;
  /** Already rendered by the caller from that approved template. Never logged or retained. */
  readonly messageBody: string;
  /** Per-mapping DLT ids; fall back to the account-level config values when absent. */
  readonly dltEntityId?: string | null;
  readonly dltTemplateId?: string | null;
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Extract Exotel's SMS Sid from a 2xx body: `{ "SMSMessage": { "Sid": "...", ... } }`.
 * A missing or unusable Sid is NOT an acceptance — it is an `unknown_outcome`.
 */
export function extractExotelSmsSid(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const message = body.SMSMessage;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const sid = (message as { Sid?: unknown }).Sid;
  return typeof sid === "string" && sid.trim() !== "" ? sid.trim() : null;
}

/**
 * Sanitized failure code for an explicit 4xx rejection. Exotel replies with
 * `{ "RestException": { "Status": 400, "Code": 1001, "Message": "..." } }`.
 *
 * The `Message` text is deliberately DISCARDED: an arbitrary provider message routinely
 * embeds credentials, the destination, or the message body. Only the numeric code/status —
 * and, failing both, the HTTP status — survive.
 */
export function classifyExotelError(status: number, body: Record<string, unknown> | null): string {
  const exception = body?.RestException;
  if (exception && typeof exception === "object" && !Array.isArray(exception)) {
    const { Code, Status } = exception as { Code?: unknown; Status?: unknown };
    const code = normalizeNumericId(Code);
    if (code !== null) return `EXOTEL_ERROR_${code}`;
    const providerStatus = normalizeNumericId(Status);
    if (providerStatus !== null) return `EXOTEL_STATUS_${providerStatus}`;
  }
  return `EXOTEL_HTTP_${status}`;
}

function normalizeNumericId(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999_999_999) {
    return String(value);
  }
  if (typeof value === "string" && /^[0-9]{1,9}$/.test(value)) return value;
  return null;
}

function result(
  providerKey: string,
  fields: {
    accepted: boolean;
    providerMessageId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    retryable: boolean;
    outcomeCertainty: ProviderOutcomeCertainty;
  }
): SmsSendResult {
  return {
    accepted: fields.accepted,
    provider: providerKey,
    channel: "sms",
    providerMessageId: fields.providerMessageId,
    normalizedStatus: fields.accepted ? "accepted" : "failed",
    errorCode: fields.errorCode,
    errorMessage: fields.errorMessage,
    retryable: fields.retryable,
    outcomeCertainty: fields.outcomeCertainty,
  };
}

/**
 * A preflight `definitive_failure` — a config, destination, or usage fault detected BEFORE
 * any request is made, so the message provably never reached Exotel. Not retryable: a
 * retry would fail identically.
 */
function preflightFailure(providerKey: string, code: string, message: string): SmsSendResult {
  return result(providerKey, {
    accepted: false,
    providerMessageId: null,
    errorCode: code,
    errorMessage: message,
    retryable: false,
    outcomeCertainty: "definitive_failure",
  });
}

/**
 * Map a transport result to an `SmsSendResult` with an ALWAYS-present, conservative
 * certainty. Certainty comes from the generic `classifyTransportCertainty`; only the
 * provider-specific facts (is there a Sid? what is the Exotel error code?) are decided here,
 * because generic code cannot guess a provider's payload.
 */
export function interpretExotelSendResult(
  transport: HttpTransportResult,
  providerKey: string
): SmsSendResult {
  if (transport.kind === "aborted") {
    const certainty = classifyTransportCertainty({ kind: "aborted" });
    return result(providerKey, {
      accepted: false,
      providerMessageId: null,
      errorCode: "EXOTEL_TIMEOUT",
      errorMessage: "Exotel request aborted by timeout; delivery outcome unknown.",
      retryable: certainty.retryable,
      outcomeCertainty: certainty.outcomeCertainty,
    });
  }

  if (transport.kind === "network_error") {
    const certainty = classifyTransportCertainty({ kind: "network_error", code: transport.code });
    // ONLY a proven pre-connect failure is definitive, and only then may the raw transport
    // code be surfaced — it is an allowlisted identifier by construction, re-checked here.
    const proven = certainty.outcomeCertainty === "definitive_failure";
    const code = proven && transport.code && SAFE_IDENTIFIER.test(transport.code)
      ? `EXOTEL_${transport.code}`
      : "EXOTEL_NETWORK_ERROR";
    return result(providerKey, {
      accepted: false,
      providerMessageId: null,
      errorCode: code,
      errorMessage: proven
        ? "Exotel request provably never reached the provider; nothing was delivered."
        : "Exotel request failed before a response; delivery outcome unknown.",
      retryable: certainty.retryable,
      outcomeCertainty: certainty.outcomeCertainty,
    });
  }

  const { status, bodyText } = transport;
  const body = safeParseJson(bodyText);
  const sid = status >= 200 && status < 300 ? extractExotelSmsSid(body) : null;
  const certainty = classifyTransportCertainty({ kind: "response", status, hasProviderMessageId: sid !== null });

  if (certainty.outcomeCertainty === "accepted") {
    return result(providerKey, {
      accepted: true,
      providerMessageId: sid,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      outcomeCertainty: "accepted",
    });
  }

  if (status >= 200 && status < 300) {
    return result(providerKey, {
      accepted: false,
      providerMessageId: null,
      errorCode: "EXOTEL_NO_MESSAGE_SID",
      errorMessage: "Exotel returned success without a usable SMS Sid; delivery outcome unknown.",
      retryable: false,
      outcomeCertainty: certainty.outcomeCertainty,
    });
  }

  if (certainty.outcomeCertainty === "definitive_failure") {
    return result(providerKey, {
      accepted: false,
      providerMessageId: null,
      errorCode: classifyExotelError(status, body),
      errorMessage: `Exotel rejected the request (HTTP ${status}).`,
      retryable: certainty.retryable,
      outcomeCertainty: "definitive_failure",
    });
  }

  return result(providerKey, {
    accepted: false,
    providerMessageId: null,
    errorCode: `EXOTEL_HTTP_${status}`,
    errorMessage: `Exotel returned an ambiguous response (HTTP ${status}); delivery outcome unknown.`,
    retryable: false,
    outcomeCertainty: certainty.outcomeCertainty,
  });
}

export class ExotelSmsProvider implements SmsProvider {
  /** IDENTITY FENCE: selection verifies `adapter.providerKey === candidate.providerKey`. */
  readonly providerKey = EXOTEL_SMS_PROVIDER_KEY;
  readonly channel = "sms" as const;

  constructor(
    private readonly config: ExotelConfig,
    private readonly transport: HttpTransport
  ) {}

  /**
   * Interface method. Exotel needs an approved, DLT-registered content descriptor, so a bare
   * template key is REFUSED before any network call — the same fence the Meta adapter
   * applies. This is the only `sendAuthenticationMessage` the SmsProvider contract exposes,
   * and it can never put a message on the wire.
   */
  async sendAuthenticationMessage(): Promise<SmsSendResult> {
    return preflightFailure(
      this.providerKey,
      "EXOTEL_RESOLVED_TEMPLATE_REQUIRED",
      "The Exotel adapter requires an approved, DLT-registered resolved template descriptor; a bare template key is refused."
    );
  }

  /**
   * The real Exotel send. Exactly ONE request, cancelled by AbortController on timeout.
   *
   * `options.maxNetworkTimeoutMs` is a CEILING from an enclosing request deadline: it may
   * only SHORTEN the configured authentication timeout, never extend it, and the shortened
   * value still drives the AbortController — the request is cancelled, not merely abandoned.
   *
   * Calling this is still not authorization. It is unreachable in production: no code path
   * constructs this adapter, and the C2 runtime gate blocks Exotel on every row it checks.
   */
  async sendResolvedAuthenticationSms(
    toE164: string,
    resolved: ExotelResolvedSms,
    options: SmsAuthenticationSendOptions = {}
  ): Promise<SmsSendResult> {
    if (typeof toE164 !== "string" || !E164_PATTERN.test(toE164)) {
      return preflightFailure(this.providerKey, "EXOTEL_DESTINATION_INVALID",
        "The destination is not a valid E.164 number; no request was sent.");
    }
    if (typeof resolved?.providerTemplateName !== "string" || resolved.providerTemplateName.trim() === "") {
      return preflightFailure(this.providerKey, "EXOTEL_TEMPLATE_NAME_MISSING",
        "No approved provider template name was resolved; no request was sent.");
    }
    if (typeof resolved.messageBody !== "string" || resolved.messageBody.trim() === "") {
      return preflightFailure(this.providerKey, "EXOTEL_TEMPLATE_BODY_MISSING",
        "The approved template rendered no message body; no request was sent.");
    }

    const timeoutMs = resolveSmsNetworkTimeoutMs(this.config.authHttpTimeoutMs, options);

    // `URLSearchParams` percent-encodes every value, so neither the body nor the destination
    // can break out of the form encoding.
    const form = new URLSearchParams({
      From: this.config.senderId,
      To: toE164,
      Body: resolved.messageBody,
    });
    const dltEntityId = resolved.dltEntityId ?? this.config.dltEntityId;
    const dltTemplateId = resolved.dltTemplateId ?? this.config.dltTemplateId;
    if (dltEntityId) form.set("DltEntityId", dltEntityId);
    if (dltTemplateId) form.set("DltTemplateId", dltTemplateId);

    const transportResult = await this.transport.request({
      url: buildExotelSendSmsUrl(this.config),
      method: "POST",
      headers: {
        Authorization: basicAuthorizationHeader(this.config.apiKey, this.config.apiToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      timeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });

    return interpretExotelSendResult(transportResult, this.providerKey);
  }

  /** Read-only account probe. Sends no SMS and returns only sanitized details. */
  async healthCheck(): Promise<SmsProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    const transportResult = await this.transport.request({
      url: buildExotelAccountUrl(this.config),
      method: "GET",
      headers: { Authorization: basicAuthorizationHeader(this.config.apiKey, this.config.apiToken) },
      timeoutMs: this.config.healthHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    const latencyMs = Date.now() - started;

    if (transportResult.kind !== "response") {
      return {
        provider: this.providerKey,
        channel: "sms",
        configured: true,
        reachable: false,
        status: "unhealthy",
        checkedAt,
        latencyMs,
        detailsSanitized: { outcome: transportResult.kind === "aborted" ? "timeout" : "network_error" },
      };
    }
    const reachable = transportResult.status >= 200 && transportResult.status < 500;
    const healthy = transportResult.status >= 200 && transportResult.status < 300;
    return {
      provider: this.providerKey,
      channel: "sms",
      configured: true,
      reachable,
      status: healthy ? "healthy" : "unhealthy",
      checkedAt,
      latencyMs,
      // The account SID, key, token and any response field are all withheld deliberately.
      detailsSanitized: { httpStatus: transportResult.status, channel: this.channel },
    };
  }
}
