import type { QuickFurnoAutomationEventType } from "./automationEventTypes";

export const QUICKFURNO_AUTOMATION_WORKFLOW_MAP: Record<QuickFurnoAutomationEventType, string> = {
  "lead.created": "Lead Intake",
  "lead.scored": "Lead Scoring Preview",
  "lead.qualified": "Client Confirmation",
  "lead.clarification_required": "Lead Clarification Preview",
  "lead.rejected_quality": "Lead Quality Rejection Preview",
  "lead.assignment_preview": "Assignment Preview",
  "lead.assignment_approved": "Assignment Approval Preview",
  "lead.assignment_queued": "Assignment Queue",
  "lead.assignment_queue_rechecked": "Assignment Queue Recheck",
  "lead.assigned": "Client Follow-up",
  "vendor.profile_interest_captured": "Vendor Interest Preview",
  "vendor.recharge_prompt_preview": "Vendor Recharge Preview",
  "vendor.replied": "Vendor Response",
  "client.followup_due": "Client Follow-up Due",
  "client.rating_due": "Client Rating Due",
  "nurture.due": "Nurture Follow-up",
  "report.daily": "Daily Founder Report",
  "vendor.low_credit": "Vendor Low Credit",
  "complaint.created": "Complaint Escalation",
  "aos.failure": "AOS Safe Failure",
  "whatsapp.status_updated": "WhatsApp Status Update",
};

export function getWorkflowForAutomationEvent(eventType: QuickFurnoAutomationEventType): string {
  return QUICKFURNO_AUTOMATION_WORKFLOW_MAP[eventType];
}
