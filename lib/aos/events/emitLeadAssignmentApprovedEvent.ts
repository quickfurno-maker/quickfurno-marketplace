// QuickFurno AOS assignment-approval advisory event.
// AOS remains recommendation-only; QuickFurno Core and the native automation
// engine retain all business and communication authority.
import {
  createSafeSideEffectReport,
  type QuickFurnoSafeSideEffectReport,
} from "@/lib/aos/events/automationEventTypes";
import { getWorkflowForAutomationEvent } from "@/lib/aos/events/automationWorkflowMap";

const APPROVED_EVENT_TYPE = "lead.assignment_approved" as const;

export const ASSIGNMENT_APPROVAL_AGENTS = [
  "LeadFlow", "VendorPulse", "ClientCare", "TrustShield",
] as const;

export interface EmitLeadAssignmentApprovedInput {
  leadId: string;
  selectedVendorIds: string[];
  selectedVendorCount: number;
  approvedBy: string;
  approvalMode: "preview";
  assignmentApprovalId?: string | null;
}
export interface LeadAssignmentApprovedEmitResult {
  ok: boolean;
  status: "mocked";
  eventType: typeof APPROVED_EVENT_TYPE;
  workflowName: string;
  automationEventQueued: boolean;
  mockMode: true;
  runtimeAutomationEnabled: false;
  runtimeAutomationMode: "advisory";
  sideEffects: QuickFurnoSafeSideEffectReport;
  reason: string;
  message: string;
}

export async function emitLeadAssignmentApprovedEvent(
  _input: EmitLeadAssignmentApprovedInput,
): Promise<LeadAssignmentApprovedEmitResult> {
  return {
    ok: true,
    status: "mocked",
    eventType: APPROVED_EVENT_TYPE,
    workflowName: getWorkflowForAutomationEvent(APPROVED_EVENT_TYPE),
    automationEventQueued: false,
    mockMode: true,
    runtimeAutomationEnabled: false,
    runtimeAutomationMode: "advisory",
    sideEffects: createSafeSideEffectReport(),
    reason: "AOS is advisory-only; execution is owned by QuickFurno Core and the native engine.",
    message: "Assignment approval preview recorded safely. No external workflow runtime or business side effect was invoked.",
  };
}
