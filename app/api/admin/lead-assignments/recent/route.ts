// ============================================================================
// QuickFurno — Phase 14: GET /api/admin/lead-assignments/recent
// Superadmin-only. Recent preview approval records from the assignment ledger.
// Read-only. NEVER exposes the service-role key or any secret.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getRecentAssignments } from "@/lib/aos/runtime/assignmentLedgerService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = clampLimit(searchParams.get("limit"));
  const assignments = await getRecentAssignments(limit);
  return NextResponse.json({ ok: true, assignments }, { status: 200 });
}

function clampLimit(value: string | null): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 25;
  return Math.min(100, Math.max(1, Math.round(num)));
}
