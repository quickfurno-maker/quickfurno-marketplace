// ============================================================================
// POST /api/vendor/auth/whatsapp/request
//
// Start vendor WhatsApp identity verification for the CURRENTLY AUTHENTICATED
// vendor. Identity comes from the Supabase session inside the service — this route
// accepts no vendor_id and would ignore one.
//
// Deploying this route does NOT make OTP delivery live: the vendor_whatsapp_verify
// automation ships operationally DISABLED, so the service refuses to dispatch.
//
// Never returns or logs: the OTP, the OTP hash, the pepper, or a raw phone number.
// ============================================================================

import { NextResponse } from "next/server";
import { requestVendorWhatsappVerification } from "@/services/vendorVerificationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      phone?: unknown;
      correlationId?: unknown;
    };

    const result = await requestVendorWhatsappVerification({
      phone: typeof body.phone === "string" ? body.phone : "",
      correlationId: typeof body.correlationId === "string" ? body.correlationId : null,
    });

    if (!result.ok) {
      // One generic failure for every rejection path (unauthenticated, bad phone,
      // gate closed, rate limited, dispatch failed).
      return NextResponse.json({ ok: false, code: result.code }, { status: 400 });
    }

    return NextResponse.json(
      {
        ok: true,
        challengeId: result.data.challengeId,
        expiresAt: result.data.expiresAt,
        phoneMasked: result.data.phoneMasked,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
