// ============================================================================
// QuickFurno AOS — Phase 13: Lead Assignment Approval Workflow (Preview Only)
//
//   GET /api/admin/lead-assignment-preview?leadId=<id>
//     → lead details + suggested vendors with admin match context.
//
// SAFETY:
//   - Superadmin only (reuses the project admin session guard).
//   - Read-only. Performs NO assignment, NO vendor notification, NO WhatsApp,
//     NO credit deduction, and NO database writes.
//   - Returns masked phone only. NEVER exposes the service-role key, the n8n
//     webhook URL, or any secret.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getLeadAssignmentPreview } from "@/lib/aos/runtime/leadAssignmentApprovalService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const leadId = (searchParams.get("leadId") ?? "").trim();
  if (!leadId) {
    return NextResponse.json({ ok: false, error: "A leadId query parameter is required." }, { status: 400 });
  }

  const result = await getLeadAssignmentPreview(leadId);
  if (!result.ok) {
    const status = result.code === "LEAD_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, ...result.preview }, { status: 200 });
}
