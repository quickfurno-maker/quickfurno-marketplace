// ============================================================================
// POST /api/vendor/auth/password-reset/request
//
// PUBLIC, unauthenticated. Deliberately NON-ENUMERATING: the response is byte-shape
// identical for an unknown identifier, an inactive membership, an unverified
// WhatsApp phone, a rate-limited identity, a closed automation gate, and a fully
// successful dispatch. It always returns HTTP 200.
//
// The reset OTP is only ever sent to the vendor's STORED, previously verified
// phone_e164. A caller cannot supply or redirect the destination.
//
// Never returns or logs: the OTP, whether an account exists, or a raw phone number.
// ============================================================================

import { NextResponse } from "next/server";
import { requestVendorPasswordReset } from "@/services/vendorPasswordResetService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      identifier?: unknown;
      correlationId?: unknown;
    };

    // The service NEVER throws a distinguishing error and never returns `ok: false`.
    const response = await requestVendorPasswordReset({
      identifier: typeof body.identifier === "string" ? body.identifier : "",
      correlationId: typeof body.correlationId === "string" ? body.correlationId : null,
    });

    return NextResponse.json(response, { status: 200 });
  } catch {
    // Even an internal failure must be indistinguishable from an unknown account.
    return NextResponse.json(
      { ok: true, status: "request_received", reference: crypto.randomUUID() },
      { status: 200 }
    );
  }
}
