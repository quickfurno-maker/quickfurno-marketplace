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
// NOTE: deploying this route does NOT make OTP delivery live. The client_login_otp
// automation ships operationally DISABLED, so the service returns
// `service_unavailable` until an operator enables it in a controlled rollout.
// ============================================================================

import { NextResponse } from "next/server";
import { MAX_HOOK_BODY_BYTES, readBoundedRawBody } from "@/lib/auth/supabaseSendSmsHook";
import {
  handleSupabaseSendSmsHook,
  sendSmsHookHttpResponse,
} from "@/services/supabaseSendSmsHookService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    // Bounded read: Content-Length pre-check + streaming byte cap. Never buffers
    // more than the ceiling, even without a Content-Length header.
    const bounded = await readBoundedRawBody(request, MAX_HOOK_BODY_BYTES);
    if (!bounded.ok) {
      const status = bounded.reason === "oversized_body" ? 413 : 400;
      return NextResponse.json({ ok: false, code: bounded.reason }, { status });
    }

    // The exact accepted raw body goes to signature verification; JSON is parsed
    // only after verification succeeds (inside the service).
    const outcome = await handleSupabaseSendSmsHook({
      rawBody: bounded.rawBody,
      getHeader: (name) => request.headers.get(name),
    });

    const { status, body } = sendSmsHookHttpResponse(outcome);
    // Success → 200 with an EMPTY body; every other case → a safe generic code.
    return body === null
      ? new NextResponse(null, { status })
      : NextResponse.json(body, { status });
  } catch {
    // Never leak an internal error shape, a body, or a header value.
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
