// ============================================================================
// QuickFurno AOS — Phase 13: Lead Assignment Approval Workflow (Preview Only)
//
// Server-only helper that emits a SAFE `lead.assignment_approved` AOS event
// after a Superadmin saves a PREVIEW assignment approval record.
//
// It reuses the existing AOS event infrastructure:
//   - resolveAosN8nActivation()  → the Phase 12 two-lock safety gate.
//   - queueEventForN8n()         → the existing safe n8n sync service.
//   - getWorkflowForN8nEvent()   → the canonical event → workflow map.
//
// SAFETY CONTRACT (must hold for every caller):
//   - Never throws. Any failure resolves to a safe mock result.
//   - SERVER ONLY. Never import from a client component.
//   - The n8n webhook is attempted ONLY when BOTH locks are ON (env + runtime
//     switch in preview mode). Otherwise n8nWebhookCalled stays false and
//     mockMode stays true.
//   - Performs NO WhatsApp send, NO vendor notification, NO credit deduction,
//     NO lead auto-assignment, and NO n8n-driven database writes. The only DB
//     write in this phase is the preview approval record, made by the caller.
// ============================================================================
import {
  createSafeSideEffectReport,
  type QuickFurnoSafeSideEffectReport,
} from "@/lib/aos/events/n8nEventTypes";
import { getWorkflowForN8nEvent } from "@/lib/aos/events/n8nWorkflowMap";
import { queueEventForN8n } from "@/lib/aos/sync/n8nSyncService";
import { resolveAosN8nActivation, type AosRuntimeMode } from "@/lib/aos/runtime/aosRuntimeSettings";

const APPROVED_EVENT_TYPE = "lead.assignment_approved" as const;
const APPROVED_EVENT_SOURCE = "quickfurno-admin-assignment-approval";

/** Fixed AOS agent roster previewed for an assignment approval. */
export const ASSIGNMENT_APPROVAL_AGENTS = ["LeadFlow", "VendorPulse", "ClientCare", "TrustShield"] as const;

export interface EmitLeadAssignmentApprovedInput {
  leadId: string;
  selectedVendorIds: string[];
  selectedVendorCount: number;
  approvedBy: string;
  /** Only "preview" is supported in this phase. */
  approvalMode: "preview";
  /** The preview approval record id, when already saved. */
  assignmentApprovalId?: string | null;
}

export interface LeadAssignmentApprovedEmitResult {
  ok: boolean;
  status: "accepted" | "mocked";
  eventType: typeof APPROVED_EVENT_TYPE;
  workflowName: string;
  n8nWebhookCalled: boolean;
  mockMode: boolean;
  runtimeAutomationEnabled: boolean;
  runtimeAutomationMode: AosRuntimeMode;
  sideEffects: QuickFurnoSafeSideEffectReport;
  reason: string;
  message: string;
}

/**
 * Emit the safe `lead.assignment_approved` event. Resolves to a structured
 * result describing whether n8n was actually called. Never throws.
 */
export async function emitLeadAssignmentApprovedEvent(
  input: EmitLeadAssignmentApprovedInput,
): Promise<LeadAssignmentApprovedEmitResult> {
  const workflowName = getWorkflowForN8nEvent(APPROVED_EVENT_TYPE);
  const timestamp = new Date().toISOString();
  const agents = ASSIGNMENT_APPROVAL_AGENTS.map((name) => ({ agent: name, status: "preview" as const }));

  // The side effects that are HARD-disabled in this phase. Only the preview
  // approval record is ever written, and that happens in the caller — not here.
  const baseSideEffects: QuickFurnoSafeSideEffectReport = createSafeSideEffectReport();

  try {
    // Two-lock safety gate (Lock 1 = server env, Lock 2 = admin runtime switch).
    const activation = await resolveAosN8nActivation();

    if (!activation.shouldCallN8n) {
      return {
        ok: true,
        status: "mocked",
        eventType: APPROVED_EVENT_TYPE,
        workflowName,
        n8nWebhookCalled: false,
        mockMode: true,
        runtimeAutomationEnabled: activation.runtime.enabled,
        runtimeAutomationMode: activation.runtime.mode,
        sideEffects: baseSideEffects,
        reason: activation.reason,
        message:
          "Assignment approval saved in preview mode. n8n was not called because the two-lock safety gate is not fully ON.",
      };
    }

    const n8nResult = await queueEventForN8n({
      eventType: APPROVED_EVENT_TYPE,
      leadId: input.leadId,
      source: APPROVED_EVENT_SOURCE,
      occurredAt: timestamp,
      data: {
        eventType: APPROVED_EVENT_TYPE,
        workflowName,
        lead_id: input.leadId,
        selected_vendor_ids: input.selectedVendorIds,
        selected_vendor_count: input.selectedVendorCount,
        approval_mode: input.approvalMode,
        approved_by: input.approvedBy,
        assignment_approval_id: input.assignmentApprovalId ?? null,
        agents,
        // Mirror the safe side-effect contract into the forwarded payload so the
        // n8n preview router cannot misread this as a live assignment.
        sideEffects: {
          whatsappSent: false,
          vendorNotified: false,
          creditsDeducted: false,
          leadAutoAssigned: false,
          databaseWritten: "preview_approval_record_only",
        },
      },
      metadata: {
        mode: "assignment_approval_preview",
        sideEffectsDisabled: true,
      },
    });

    const n8nWebhookCalled = Boolean(n8nResult.sideEffects?.n8nWebhookCalled);

    return {
      ok: true,
      status: n8nWebhookCalled ? "accepted" : "mocked",
      eventType: APPROVED_EVENT_TYPE,
      workflowName,
      n8nWebhookCalled,
      mockMode: !n8nWebhookCalled,
      runtimeAutomationEnabled: activation.runtime.enabled,
      runtimeAutomationMode: activation.runtime.mode,
      sideEffects: { ...baseSideEffects, n8nWebhookCalled },
      reason: activation.reason,
      message: n8nWebhookCalled
        ? "Assignment approval saved in preview mode and the n8n Master Preview Router accepted the event. No vendor notification, WhatsApp, credit deduction, or auto-assignment was performed."
        : "Assignment approval saved in preview mode. n8n was not called or failed safely.",
    };
  } catch {
    // The approval record already saved (or will be saved) by the caller; the
    // emit must never break the approval flow.
    return {
      ok: true,
      status: "mocked",
      eventType: APPROVED_EVENT_TYPE,
      workflowName,
      n8nWebhookCalled: false,
      mockMode: true,
      runtimeAutomationEnabled: false,
      runtimeAutomationMode: "off",
      sideEffects: baseSideEffects,
      reason: "AOS emit recovered safely. No side effects executed.",
      message: "Assignment approval saved in preview mode. AOS emit recovered safely and n8n was not called.",
    };
  }
}
