// ============================================================================
// POST /api/vendor/auth/password-reset/complete
//
// PUBLIC. Claim (burn) a single-use reset grant and let Supabase Auth set the new
// password through the server-only Admin API.
//
// This route NEVER signs the vendor in. A successful reset returns
// `loginRequired: true`; the vendor must authenticate again through the ordinary
// Phase 5C vendor password login.
//
// Never returns or logs: the password, the grant token, the grant token hash, or a
// raw Supabase Auth error.
// ============================================================================

import { NextResponse } from "next/server";
import { completeVendorPasswordReset } from "@/services/vendorPasswordResetService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      grantToken?: unknown;
      newPassword?: unknown;
      correlationId?: unknown;
    };

    const result = await completeVendorPasswordReset({
      grantToken: typeof body.grantToken === "string" ? body.grantToken : "",
      newPassword: typeof body.newPassword === "string" ? body.newPassword : "",
      correlationId: typeof body.correlationId === "string" ? body.correlationId : null,
    });

    if (!result.ok) {
      // Malformed token/password, unknown/consumed/revoked/expired grant, and an
      // Auth-update rejection all return exactly the same generic failure.
      return NextResponse.json({ ok: false, code: result.code }, { status: 400 });
    }

    return NextResponse.json({ ok: true, loginRequired: result.data.loginRequired }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
