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

// ----------------------------------------------------------------------------
// HTTP response contract (Supabase Send SMS Hook)
// ----------------------------------------------------------------------------
/**
 * The deterministic HTTP shape for a hook outcome. `body: null` means an EMPTY
 * response body (success). Every non-success body carries ONLY a safe, generic
 * code — never the OTP, phone, secret, signature, raw provider error, raw
 * payload, or any token.
 */
export interface SendSmsHookHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

export function sendSmsHookHttpResponse(outcome: SendSmsHookOutcome): SendSmsHookHttpResponse {
  switch (outcome.kind) {
    // Delivered / accepted (incl. an accepted idempotent replay) → 200, empty body.
    case SendSmsHookOutcomeKind.DELIVERED:
      return { status: 200, body: null };
    // Automation not operationally enabled (the Phase 5D shipped state).
    case SendSmsHookOutcomeKind.SERVICE_UNAVAILABLE:
      return { status: 503, body: { ok: false, code: "service_unavailable" } };
    // Provider failed/cancelled/dead_letter — no blind resend.
    case SendSmsHookOutcomeKind.DELIVERY_FAILED:
      return { status: 502, body: { ok: false, code: "delivery_failed" } };
    // Queued/dispatching — not confirmed delivered, never a 2xx, never a resend.
    case SendSmsHookOutcomeKind.IN_PROGRESS:
      return { status: 503, body: { ok: false, code: "in_progress" } };
    case SendSmsHookOutcomeKind.REJECTED:
      switch (outcome.rejectReason) {
        case SendSmsHookRejectReason.MISSING_HEADERS:
        case SendSmsHookRejectReason.INVALID_SIGNATURE:
          return { status: 401, body: { ok: false, code: "unauthorized" } };
        case SendSmsHookRejectReason.OVERSIZED_BODY:
          return { status: 413, body: { ok: false, code: "oversized_body" } };
        case SendSmsHookRejectReason.MALFORMED_PAYLOAD:
          return { status: 400, body: { ok: false, code: "malformed_payload" } };
        case SendSmsHookRejectReason.SECRET_NOT_CONFIGURED:
          // Never reveal secret existence/absence in detail — a generic 500.
          return { status: 500, body: { ok: false, code: "configuration_error" } };
        default:
          return { status: 400, body: { ok: false, code: "rejected" } };
      }
    default:
      return { status: 500, body: { ok: false, code: "server_error" } };
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
