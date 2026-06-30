// ============================================================================
// QuickFurno — Phase 14: GET /api/admin/lead-assignments/failed
// Superadmin-only. Preview approval records that recorded a safe failure
// (status cancelled, a failure_reason, or an un-emitted AOS event).
// Read-only. NEVER exposes the service-role key or any secret.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getFailedAssignments } from "@/lib/aos/runtime/assignmentLedgerService";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const assignments = await getFailedAssignments();
  return NextResponse.json({ ok: true, assignments }, { status: 200 });
}
