// ============================================================================
// QuickFurno — Phase 14: GET /api/admin/lead-assignments/[id]
// Superadmin-only. Full detail for one preview approval ledger record,
// including the safe AOS event_response summary. Read-only.
// NEVER exposes the service-role key or any secret.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getAssignmentById } from "@/lib/aos/runtime/assignmentLedgerService";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const assignment = await getAssignmentById(params.id);
  if (!assignment) {
    return NextResponse.json({ ok: false, error: "Assignment record not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, assignment }, { status: 200 });
}
