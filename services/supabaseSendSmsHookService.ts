// ============================================================================
// QuickFurno — services/supabaseSendSmsHookService.ts   (server-only)
//
// The Supabase "Send SMS" HTTP Auth Hook adapter: it turns a signed hook request
// into a Phase 5B authentication-lane CommunicationIntent and dispatches it
// through the CommunicationService, so the Supabase-generated OTP is delivered
// over QuickFurno's provider-neutral WhatsApp transport.
//
// SYNCHRONOUS AUTH BOUNDARY
//   This is authentication infrastructure. The OTP is delivered inline, in one
//   CommunicationService attempt — never through n8n, a queue, a cron, a delayed
//   worker, a scheduled send, or a retry. Phase 5B's authentication lane already
//   enforces single-shot, non-schedulable, non-redispatchable behaviour.
//
// HOOK TIME BUDGET (deliberately NOT a Promise.race)
//   Supabase gives an HTTP Auth Hook a bounded time to respond. We do NOT wrap the
//   provider send in a Promise.race timeout: a race REJECTS the waiter but does not
//   CANCEL the underlying request. The provider call would keep running, Supabase
//   would see a timeout and retry, and the original request could still succeed —
//   which is a duplicate-OTP hazard, exactly what the idempotency key exists to
//   prevent. For mock-only Phase 5D readiness the send is effectively instantaneous,
//   so the behaviour stays synchronous.
//   REQUIREMENT FOR A REAL PROVIDER: the adapter itself must enforce an ABORTABLE
//   network timeout (AbortController/AbortSignal on the outbound HTTP call, or the
//   SDK's own cancellation) set comfortably inside the Supabase hook budget, so a
//   timed-out send is genuinely cancelled rather than merely abandoned. Do not
//   activate a real provider before that adapter-level timeout exists.
//
// ORDER OF OPERATIONS (never reordered)
//   size ceiling → headers → secret → SIGNATURE VERIFICATION → parse/validate →
//   operational gate → build intent → single dispatch → map status to outcome.
//   Nothing in the payload is trusted, parsed, or processed before verification.
//
// NEVER LOGGED (never returned, either): raw body, OTP, phone, hook secret,
// signature, access/refresh token.
// ============================================================================

import {
  collectStandardWebhookHeaders,
  getActiveSendSmsHookVerifier,
  isWithinHookBodyCeiling,
  loadSendSmsHookSecrets,
  parseSendSmsHookEvent,
  type SupabaseSendSmsHookEvent,
} from "../lib/auth/supabaseSendSmsHook";
import {
  CLIENT_LOGIN_OTP_ENTITY_TYPE,
  CLIENT_LOGIN_OTP_MESSAGE_TYPE,
  CLIENT_LOGIN_OTP_TEMPLATE_KEY,
} from "../lib/identity/clientOtpAutomation";
import { ephemeralAuthDestination, type CommunicationIntent } from "../lib/communication/types";
import { evaluateClientLoginOtpGate } from "./clientOtpAutomationService";
import { CommunicationService } from "./communicationService";

// ----------------------------------------------------------------------------
// Outcome vocabulary
// ----------------------------------------------------------------------------
export const SendSmsHookRejectReason = {
  OVERSIZED_BODY: "oversized_body",
  /** The bounded reader could not read the request body. */
  READ_FAILED: "read_failed",
  MISSING_HEADERS: "missing_headers",
  SECRET_NOT_CONFIGURED: "secret_not_configured",
  INVALID_SIGNATURE: "invalid_signature",
  MALFORMED_PAYLOAD: "malformed_payload",
} as const;

export type SendSmsHookRejectReasonValue =
  (typeof SendSmsHookRejectReason)[keyof typeof SendSmsHookRejectReason];

export const SendSmsHookOutcomeKind = {
  /** Provider accepted/sent/delivered/read — hook success. */
  DELIVERED: "delivered",
  /** The automation is not operationally enabled (the Phase 5D shipped state). */
  SERVICE_UNAVAILABLE: "service_unavailable",
  /** Provider failed/cancelled/dead_letter — hook failure, no blind resend. */
  DELIVERY_FAILED: "delivery_failed",
  /** Queued/dispatching — temporary/in-progress; must not double-dispatch. */
  IN_PROGRESS: "in_progress",
  /** Rejected before dispatch (size/headers/secret/signature/payload). */
  REJECTED: "rejected",
} as const;

export type SendSmsHookOutcomeKindValue =
  (typeof SendSmsHookOutcomeKind)[keyof typeof SendSmsHookOutcomeKind];

export interface SendSmsHookOutcome {
  readonly kind: SendSmsHookOutcomeKindValue;
  readonly rejectReason?: SendSmsHookRejectReasonValue;
  /** True only when the CommunicationService dispatch was actually attempted. */
  readonly dispatchAttempted: boolean;
  /** Non-secret verified webhook id, once verification succeeded. */
  readonly webhookId?: string;
}

function reject(reason: SendSmsHookRejectReasonValue): SendSmsHookOutcome {
  return { kind: SendSmsHookOutcomeKind.REJECTED, rejectReason: reason, dispatchAttempted: false };
}

/**
 * Build a rejection outcome for a failure detected by the transport adapter BEFORE
 * the service runs (an oversized or unreadable body), so the route maps it through
 * the same single HTTP response contract instead of hand-rolling one.
 */
export function rejectSendSmsHookRequest(reason: SendSmsHookRejectReasonValue): SendSmsHookOutcome {
  return reject(reason);
}

// ----------------------------------------------------------------------------
// HTTP response contract (Supabase Send SMS Hook)
// ----------------------------------------------------------------------------
export const CONTENT_TYPE_HEADER = "Content-Type";
export const RETRY_AFTER_HEADER = "Retry-After";
export const JSON_CONTENT_TYPE = "application/json";

/**
 * Supabase's HTTP Auth Hook client retries a 429/503 ONLY when the response
 * carries a NON-EMPTY `Retry-After` header; it tests the header's presence, not
 * its value. `"true"` is the value Supabase's own hook documentation uses.
 */
export const RETRY_AFTER_VALUE = "true";

/**
 * The deterministic HTTP shape for a hook outcome. `body: null` means an EMPTY
 * response body (success). Every non-success body carries ONLY a safe, generic
 * code — never the OTP, phone, secret, signature, raw provider error, raw
 * payload, or any token. `headers` is always explicit: every JSON body declares
 * `application/json`, and ONLY the retryable in-progress state sets `Retry-After`.
 */
export interface SendSmsHookHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
  readonly headers: Readonly<Record<string, string>>;
}

/** A safe generic JSON error response with an explicit content type. */
function jsonResponse(
  status: number,
  code: string,
  extraHeaders: Record<string, string> = {}
): SendSmsHookHttpResponse {
  return {
    status,
    body: { ok: false, code },
    headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE, ...extraHeaders },
  };
}

export function sendSmsHookHttpResponse(outcome: SendSmsHookOutcome): SendSmsHookHttpResponse {
  switch (outcome.kind) {
    // Delivered / accepted (incl. an accepted idempotent replay) → 200, empty body.
    case SendSmsHookOutcomeKind.DELIVERED:
      return {
        status: 200,
        body: null,
        headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE, "Content-Length": "0" },
      };

    // Automation not operationally enabled (the Phase 5D shipped state). This is a
    // STANDING state, not a transient one: deliberately NO Retry-After, so Supabase
    // does not burn its hook budget retrying a switch only an operator can flip.
    case SendSmsHookOutcomeKind.SERVICE_UNAVAILABLE:
      return jsonResponse(503, "service_unavailable");

    // Provider failed/cancelled/dead_letter — a terminal single-shot auth failure.
    // No Retry-After: a retry must never blindly resend an OTP.
    case SendSmsHookOutcomeKind.DELIVERY_FAILED:
      return jsonResponse(502, "delivery_failed");

    // Queued/dispatching — the FIRST delivery is still in flight and this request is
    // its idempotent duplicate. 503 + a non-empty Retry-After asks Supabase to retry
    // inside its own hook budget; the replay then observes the accepted/sent row and
    // returns 200. Nothing is resent, no new webhook id or message row is created.
    case SendSmsHookOutcomeKind.IN_PROGRESS:
      return jsonResponse(503, "in_progress", { [RETRY_AFTER_HEADER]: RETRY_AFTER_VALUE });

    case SendSmsHookOutcomeKind.REJECTED:
      switch (outcome.rejectReason) {
        case SendSmsHookRejectReason.MISSING_HEADERS:
        case SendSmsHookRejectReason.INVALID_SIGNATURE:
          return jsonResponse(401, "unauthorized");
        case SendSmsHookRejectReason.OVERSIZED_BODY:
          return jsonResponse(413, "oversized_body");
        case SendSmsHookRejectReason.READ_FAILED:
          return jsonResponse(400, "read_failed");
        case SendSmsHookRejectReason.MALFORMED_PAYLOAD:
          return jsonResponse(400, "malformed_payload");
        case SendSmsHookRejectReason.SECRET_NOT_CONFIGURED:
          // Never reveal secret existence/absence in detail — a generic 500.
          return jsonResponse(500, "configuration_error");
        default:
          return jsonResponse(400, "rejected");
      }
    default:
      return jsonResponse(500, "server_error");
  }
}

// ----------------------------------------------------------------------------
// Intent builder
// ----------------------------------------------------------------------------
/**
 * Builds the authentication-lane intent. The OTP travels ONLY in `variables` (the
 * authentication lane persists no variables), the destination is the fenced
 * ephemeral source (no client_accounts row exists for a first-time login), and
 * the idempotency key is derived from the verified webhook id — NEVER the OTP.
 */
export function buildClientLoginOtpIntent(
  event: SupabaseSendSmsHookEvent,
  webhookId: string
): CommunicationIntent {
  return {
    type: CLIENT_LOGIN_OTP_MESSAGE_TYPE,
    lane: "authentication",
    channel: "whatsapp",
    recipient_type: "client",
    recipient_id: null,
    destination_source: ephemeralAuthDestination(event.phoneE164),
    template_key: CLIENT_LOGIN_OTP_TEMPLATE_KEY,
    variables: { otp: event.otp },
    entity_type: CLIENT_LOGIN_OTP_ENTITY_TYPE,
    entity_id: event.authUserId,
    correlation_id: webhookId,
    idempotency_key: `${CLIENT_LOGIN_OTP_MESSAGE_TYPE}:${webhookId}`,
    priority: "critical",
    scheduled_at: null,
    policy_decision_id: null,
    metadata: { transport_origin: "supabase_send_sms_hook" },
  };
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------
export interface SupabaseSendSmsHookRequest {
  /** The exact raw body text the provider signed — read once, never re-serialized. */
  readonly rawBody: string;
  /** Case-insensitive header accessor (e.g. `req.headers.get`). */
  readonly getHeader: (name: string) => string | null | undefined;
}

/**
 * Verify, gate, and dispatch a Supabase Send SMS hook request. Returns a mapped
 * outcome; it never throws sensitive data and never returns the OTP or phone.
 */
export async function handleSupabaseSendSmsHook(
  req: SupabaseSendSmsHookRequest
): Promise<SendSmsHookOutcome> {
  try {
    // 1) Size ceiling — before any parsing or verification work.
    if (!isWithinHookBodyCeiling(req.rawBody)) {
      return reject(SendSmsHookRejectReason.OVERSIZED_BODY);
    }

    // 2) Required Standard Webhooks headers.
    const headers = collectStandardWebhookHeaders(req.getHeader);
    if (!headers) return reject(SendSmsHookRejectReason.MISSING_HEADERS);

    // 3) Server-side hook secret(s).
    const secrets = loadSendSmsHookSecrets();
    if (secrets.length === 0) return reject(SendSmsHookRejectReason.SECRET_NOT_CONFIGURED);

    // 4) SIGNATURE VERIFICATION against the RAW body — before any JSON processing.
    const verification = getActiveSendSmsHookVerifier().verify(req.rawBody, headers, secrets);
    if (!verification.ok) return reject(SendSmsHookRejectReason.INVALID_SIGNATURE);

    // 5) Parse/validate ONLY the verified payload.
    const parsed = parseSendSmsHookEvent(verification.payload);
    if (!parsed.ok) return reject(SendSmsHookRejectReason.MALFORMED_PAYLOAD);
    const event = parsed.event;

    // 6) Operational gate — the production kill-switch. Disabled → do not dispatch.
    const gate = await evaluateClientLoginOtpGate();
    if (!gate.ok) {
      return {
        kind: SendSmsHookOutcomeKind.SERVICE_UNAVAILABLE,
        dispatchAttempted: false,
        webhookId: headers.webhookId,
      };
    }

    // 7) Single, immediate CommunicationService dispatch. Idempotency is keyed on
    // the verified webhook id, so a replay/concurrent duplicate cannot re-send.
    const intent = buildClientLoginOtpIntent(event, headers.webhookId);
    const result = await new CommunicationService().send(intent);

    // 8) Map the message status — NOT merely Result.ok — to a hook outcome.
    if (!result.ok) {
      // The send itself failed (e.g. template gate). Do not resend.
      return {
        kind: SendSmsHookOutcomeKind.DELIVERY_FAILED,
        dispatchAttempted: true,
        webhookId: headers.webhookId,
      };
    }

    const status = result.data.status;
    if (status === "accepted" || status === "sent" || status === "delivered" || status === "read") {
      return {
        kind: SendSmsHookOutcomeKind.DELIVERED,
        dispatchAttempted: true,
        webhookId: headers.webhookId,
      };
    }
    if (status === "failed" || status === "cancelled" || status === "dead_letter") {
      return {
        kind: SendSmsHookOutcomeKind.DELIVERY_FAILED,
        dispatchAttempted: true,
        webhookId: headers.webhookId,
      };
    }
    // queued / dispatching — the auth lane sends immediately, so this is defensive.
    return {
      kind: SendSmsHookOutcomeKind.IN_PROGRESS,
      dispatchAttempted: true,
      webhookId: headers.webhookId,
    };
  } catch {
    // Never surface an internal error shape. A generic rejection is safe: it does
    // not confirm delivery and does not resend.
    return { kind: SendSmsHookOutcomeKind.REJECTED, dispatchAttempted: false };
  }
}
