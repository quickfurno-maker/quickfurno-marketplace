// ============================================================================
// QuickFurno — Phase 13B: GET /api/admin/vendors
// Superadmin-only. Returns vendors with computed eligibility (shared helper).
// Read-only. NEVER exposes the service-role key or any secret.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getVendorsWithEligibility } from "@/services/vendorAdminService";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const result = await getVendorsWithEligibility();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, vendors: result.data }, { status: 200 });
}
