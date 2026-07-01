import type { QuickFurnoN8nEventType } from "./n8nEventTypes";

export const QUICKFURNO_N8N_WORKFLOW_MAP: Record<QuickFurnoN8nEventType, string> = {
  "lead.created": "QF-n8n-New-Lead-Intake",
  "lead.qualified": "QF-n8n-Client-Confirmation",
  "lead.assignment_preview": "QF-n8n-Event-Router",
  "lead.assignment_approved": "QF-n8n-Vendor-Lead-Alert",
  "lead.assignment_queued": "QF-n8n-Lead-Assignment-Queued",
  "lead.assignment_queue_rechecked": "QF-n8n-Lead-Queue-Rechecked",
  "lead.assigned": "QF-n8n-Client-Followup-Timer",
  "vendor.profile_interest_captured": "QF-n8n-Free-Vendor-Interest-Preview",
  "vendor.recharge_prompt_preview": "QF-n8n-Vendor-Recharge-Prompt-Preview",
  "vendor.replied": "QF-n8n-Vendor-Response",
  "client.followup_due": "QF-n8n-Client-2-Hour-Followup",
  "client.rating_due": "QF-n8n-Client-24-Hour-Rating",
  "nurture.due": "QF-n8n-Nurture-Followup",
  "report.daily": "QF-n8n-Daily-Founder-Report",
  "vendor.low_credit": "QF-n8n-Vendor-Renewal",
  "complaint.created": "QF-n8n-Complaint-Escalation",
  "aos.failure": "QF-n8n-Failure-Handler",
  "whatsapp.status_updated": "QF-n8n-WhatsApp-Status-Update",
};

export function getWorkflowForN8nEvent(eventType: QuickFurnoN8nEventType): string {
  return QUICKFURNO_N8N_WORKFLOW_MAP[eventType];
}
