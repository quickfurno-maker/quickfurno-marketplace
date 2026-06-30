// ============================================================================
// QuickFurno — Phase 14: GET /api/admin/lead-assignments/logs
// Superadmin-only. Read-only distribution logs: assignment approval log lines
// plus any preview-related vendor credit logs (never a deduction).
// NEVER exposes the service-role key or any secret.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getAssignmentLogs } from "@/lib/aos/runtime/assignmentLedgerService";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const { logs, creditLogs } = await getAssignmentLogs();
  return NextResponse.json({ ok: true, logs, creditLogs }, { status: 200 });
}
