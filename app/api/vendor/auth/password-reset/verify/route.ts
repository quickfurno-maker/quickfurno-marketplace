// ============================================================================
// POST /api/vendor/auth/password-reset/verify
//
// PUBLIC. Verify the reset OTP and receive a single-use reset grant token.
//
// This is NOT a login: no Supabase session is established, no cookie is written,
// and the grant is not a credential for anything except one password update.
//
// The grant token is returned EXACTLY ONCE, in this response body. It is never
// logged, audited, placed in metadata, or persisted in plaintext.
// ============================================================================

import { NextResponse } from "next/server";
import { verifyVendorPasswordResetOtp } from "@/services/vendorPasswordResetService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      challengeId?: unknown;
      otp?: unknown;
      correlationId?: unknown;
    };

    const result = await verifyVendorPasswordResetOtp({
      challengeId: typeof body.challengeId === "string" ? body.challengeId : "",
      otp: typeof body.otp === "string" ? body.otp : "",
      correlationId: typeof body.correlationId === "string" ? body.correlationId : null,
    });

    if (!result.ok) {
      // Unknown reference, wrong OTP, expired, locked, wrong purpose, missing
      // attestation — one indistinguishable failure.
      return NextResponse.json({ ok: false, code: result.code }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, grantToken: result.data.grantToken, expiresAt: result.data.expiresAt },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
