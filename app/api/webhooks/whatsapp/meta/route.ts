// ============================================================================
// POST/GET /api/webhooks/whatsapp/meta
//
// Meta WhatsApp Cloud API webhook endpoint. Server-only, Node runtime, dynamic.
//
// GET  — Meta subscription verification: echo `hub.challenge` ONLY when `hub.mode`
//        is `subscribe` and `hub.verify_token` matches the server-only verify token
//        (constant-time). Independent of outbound sending. Never logs/returns the
//        token. Invalid → 403 generic.
//
// POST — delivery/status webhooks. Phase 8B-1A fail-closed order: bounded raw-BYTE read
//        → signature header → signature config → exact byte grammar + HMAC over the
//        exact bytes → fatal UTF-8 decode → JSON parse → identity config → callback-
//        identity gate → runtime webhook-processing gate → classification → lifecycle
//        (delivery) or safe acknowledge. A foreign/mixed/malformed/unprovable callback
//        stops before any DB call with a generic 200. Never logs the raw body, phone,
//        WhatsApp id, token, signature, App Secret, or message content.
// ============================================================================

import { NextResponse } from "next/server";
import {
  META_MAX_WEBHOOK_BODY_BYTES,
  readMetaWebhookRawBytes,
} from "@/lib/communication/providers/metaWebhookRawBody";
import {
  META_SIGNATURE_HEADER,
  verifyMetaWebhookGetChallenge,
} from "@/lib/communication/providers/metaWhatsAppWebhook";
import {
  getWebhookVerifyToken,
  handleMetaWhatsAppWebhookPostBytes,
} from "@/services/metaWhatsAppWebhookService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORBIDDEN = NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const verifyToken = getWebhookVerifyToken();
    if (!verifyToken) return FORBIDDEN; // not configured — cannot verify

    const result = verifyMetaWebhookGetChallenge(
      {
        mode: url.searchParams.get("hub.mode"),
        verifyToken: url.searchParams.get("hub.verify_token"),
        challenge: url.searchParams.get("hub.challenge"),
      },
      verifyToken
    );
    if (!result.ok) return FORBIDDEN;
    // Meta expects the raw challenge echoed back as text/plain.
    return new NextResponse(result.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return FORBIDDEN;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Step 1 — bounded raw-BYTE read (never buffers past the cap, never decodes).
    const bounded = await readMetaWebhookRawBytes(request, META_MAX_WEBHOOK_BODY_BYTES);
    if (!bounded.ok) {
      return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
    }

    // The identity-gated byte pipeline: signature over the exact bytes → decode → parse
    // → identity gate → runtime gate → downstream. The route stays generic on the way out.
    const outcome = await handleMetaWhatsAppWebhookPostBytes({
      rawBytes: bounded.rawBytes,
      signature: request.headers.get(META_SIGNATURE_HEADER),
    });

    if (outcome.status === 200) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    return NextResponse.json({ ok: false, code: outcome.code }, { status: outcome.status });
  } catch {
    // Never leak an internal error shape, a body, or a header value.
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
