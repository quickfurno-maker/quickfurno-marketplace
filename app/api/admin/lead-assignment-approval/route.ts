// ============================================================================
// QuickFurno AOS — Phase 13: Lead Assignment Approval Workflow (Preview Only)
//
//   POST /api/admin/lead-assignment-approval
//     body: { leadId, selectedVendorIds: string[], approvalNote?: string }
//     → saves a PREVIEW approval record and emits the safe
//       `lead.assignment_approved` AOS event through the two-lock gate.
//
// SAFETY:
//   - Superadmin only (reuses the project admin session guard).
//   - Validates a hard cap of 3 vendors (also enforced by a DB CHECK).
//   - PREVIEW ONLY: NO real assignment, NO vendor notification, NO WhatsApp,
//     NO credit deduction. The only DB write is the preview approval record.
//   - n8n is called ONLY when Phase 12's two locks are both ON (preview mode).
//   - NEVER exposes the service-role key, webhook URL, or any secret.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import {
  ASSIGNMENT_APPROVAL_AGENTS,
} from "@/lib/aos/events/emitLeadAssignmentApprovedEvent";
import { createLeadAssignmentApprovalPreview } from "@/lib/aos/runtime/leadAssignmentApprovalService";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const record = isRecord(body) ? body : {};
  const leadId = typeof record.leadId === "string" ? record.leadId : "";
  const selectedVendorIds = Array.isArray(record.selectedVendorIds)
    ? record.selectedVendorIds.filter((id): id is string => typeof id === "string")
    : [];
  const approvalNote = typeof record.approvalNote === "string" ? record.approvalNote : null;

  const result = await createLeadAssignmentApprovalPreview({
    leadId,
    selectedVendorIds,
    approvalNote,
    approvedBy: session.adminRole ?? "Superadmin",
  });

  if (!result.ok) {
    const status = result.code === "LEAD_NOT_FOUND" ? 404 : result.code === "SAVE_FAILED" ? 500 : 400;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(
    {
      ok: true,
      status: result.status,
      assignmentApprovalId: result.assignmentApprovalId,
      eventType: "lead.assignment_approved",
      approvalMode: "preview",
      approvedBy: session.adminRole ?? "Superadmin",
      selectedVendorCount: result.selectedVendorCount,
      agents: [...ASSIGNMENT_APPROVAL_AGENTS],
      aosEventEmitted: result.aosEventEmitted,
      n8nWebhookCalled: result.n8nWebhookCalled,
      mockMode: result.mockMode,
      runtimeAutomationEnabled: result.runtimeAutomationEnabled,
      runtimeAutomationMode: result.runtimeAutomationMode,
      sideEffects: result.sideEffects,
      reason: result.reason,
      message: result.message,
    },
    { status: 200 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
