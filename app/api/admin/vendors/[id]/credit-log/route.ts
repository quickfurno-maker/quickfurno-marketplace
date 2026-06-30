// ============================================================================
// QuickFurno — Phase 13B: GET /api/admin/vendors/[id]/credit-log
// Superadmin-only. Returns the manual credit-change audit trail for a vendor.
// Read-only. A missing log table resolves to an empty list (not an error).
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getVendorCreditLog } from "@/services/vendorAdminService";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const result = await getVendorCreditLog(params.id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, log: result.data }, { status: 200 });
}
