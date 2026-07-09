// ============================================================================
// POST /api/vendor/auth/whatsapp/verify
//
// Verify a vendor WhatsApp OTP challenge and bind the verified phone identity.
// The challenge's stored lineage must match the authenticated session on all three
// axes (dashboard identity, Auth user, vendor) — a challenge id from the browser is
// untrusted input, never an authority.
//
// Never returns or logs: the OTP, the OTP hash, the pepper, or a raw phone number.
// ============================================================================

import { NextResponse } from "next/server";
import { verifyVendorWhatsappChallenge } from "@/services/vendorVerificationService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      challengeId?: unknown;
      phone?: unknown;
      otp?: unknown;
      correlationId?: unknown;
    };

    const result = await verifyVendorWhatsappChallenge({
      challengeId: typeof body.challengeId === "string" ? body.challengeId : "",
      phone: typeof body.phone === "string" ? body.phone : "",
      otp: typeof body.otp === "string" ? body.otp : "",
      correlationId: typeof body.correlationId === "string" ? body.correlationId : null,
    });

    if (!result.ok) {
      // One indistinguishable failure: wrong OTP, expired, locked, not owned,
      // wrong purpose, missing attestation, and phone conflict all look the same.
      return NextResponse.json({ ok: false, code: result.code }, { status: 400 });
    }

    return NextResponse.json(
      {
        ok: true,
        vendorId: result.data.vendorId,
        phoneMasked: result.data.phoneMasked,
        phoneVerified: result.data.phoneVerified,
        whatsappOtpEnabled: result.data.whatsappOtpEnabled,
        whatsappVerifiedAt: result.data.whatsappVerifiedAt,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
