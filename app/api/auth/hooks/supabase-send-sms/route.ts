// ============================================================================
// POST /api/auth/hooks/supabase-send-sms
//
// The Supabase "Send SMS" HTTP Auth Hook endpoint. Supabase Auth calls this after
// it generates a phone OTP; QuickFurno reroutes that OTP over its provider-neutral
// WhatsApp CommunicationService (Phase 5B) instead of an SMS provider.
//
// AUTHENTICATION: this endpoint is NOT authenticated by a user JWT. It is
// authenticated by the Standard Webhooks signature on the RAW request body,
// verified inside services/supabaseSendSmsHookService.ts using the official
// `standardwebhooks` library and the server-only SEND_SMS_HOOK_SECRETS secret(s).
//
// This route is a thin transport adapter: it reads the body through a BOUNDED
// streaming reader (rejecting an oversized body before unbounded buffering),
// forwards the exact raw bytes + the three webhook-* headers to the service, and
// maps the service outcome to a deterministic HTTP status/body. It never logs —
// and never returns — the raw body, OTP, phone, secret, signature, or any token.
//
// TOTAL DEADLINE STARTS HERE. Supabase's Auth Hook budget covers this ENTIRE HTTP
// execution — including the bounded body read, which for a slow or trickling client
// is real elapsed time. So the monotonic QuickFurno deadline is established at POST
// entry, before the body is read, and threaded all the way down to the provider call,
// where it clamps the auth network timeout to whatever safe budget remains. It is not
// a Promise.race: the adapter still aborts the ACTUAL request with an AbortSignal.
//
// NOTE: deploying this route does NOT make OTP delivery live. The client_login_otp
// automation ships operationally DISABLED, so the service returns
// `service_unavailable` until an operator enables it in a controlled rollout.
// ============================================================================

import { NextResponse } from "next/server";
import { startAuthHookDeadline } from "@/lib/auth/hookDeadline";
import { MAX_HOOK_BODY_BYTES, readBoundedRawBody } from "@/lib/auth/supabaseSendSmsHook";
import {
  handleSupabaseSendSmsHook,
  rejectSendSmsHookRequest,
  SendSmsHookRejectReason,
  sendSmsHookHttpResponse,
  type SendSmsHookHttpResponse,
} from "@/services/supabaseSendSmsHookService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emit the mapped contract verbatim: explicit headers on every response, an EMPTY
 * body on success, and a safe generic JSON code otherwise. The in-progress case
 * carries `Retry-After`, which is what makes Supabase retry the hook (and observe
 * the accepted row) instead of failing the login.
 */
function toResponse(mapped: SendSmsHookHttpResponse): Response {
  const { status, body, headers } = mapped;
  return body === null
    ? new NextResponse(null, { status, headers })
    : NextResponse.json(body, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  // FIRST statement of the handler: the hook budget is already running.
  const deadline = startAuthHookDeadline();
  try {
    // Bounded read: Content-Length pre-check + streaming byte cap. Never buffers
    // more than the ceiling, even without a Content-Length header.
    const bounded = await readBoundedRawBody(request, MAX_HOOK_BODY_BYTES);
    if (!bounded.ok) {
      // Mapped through the SAME response contract, so the content type is explicit.
      const reason =
        bounded.reason === "oversized_body"
          ? SendSmsHookRejectReason.OVERSIZED_BODY
          : SendSmsHookRejectReason.READ_FAILED;
      return toResponse(sendSmsHookHttpResponse(rejectSendSmsHookRequest(reason)));
    }

    // The exact accepted raw body goes to signature verification; JSON is parsed
    // only after verification succeeds (inside the service). The deadline started at
    // POST entry travels with it, so the time already spent reading the body is
    // subtracted from the budget available to the provider request.
    const outcome = await handleSupabaseSendSmsHook({
      rawBody: bounded.rawBody,
      getHeader: (name) => request.headers.get(name),
      deadline,
    });

    return toResponse(sendSmsHookHttpResponse(outcome));
  } catch {
    // Never leak an internal error shape, a body, or a header value.
    return NextResponse.json(
      { ok: false, code: "server_error" },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
