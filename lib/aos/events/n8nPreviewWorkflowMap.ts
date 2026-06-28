/**
 * Preview-only n8n workflow router map for the n8n Workflow Router Structure phase.
 *
 * This is intentionally SEPARATE from `n8nWorkflowMap.ts`. That file maps the
 * strict `QuickFurnoN8nEventType` set used by the live safe event pipeline and
 * must not be broken or narrowed. This preview map covers the documentation /
 * template event vocabulary used by the QF-n8n preview workflows, including
 * preview-only event types (`lead.quality_preview`, `vendor.match_preview`,
 * `client.followup_preview`, `ops.daily`) that are not part of the live type.
 *
 * Nothing here triggers a workflow, sends WhatsApp, deducts credits, assigns
 * leads, or writes data. It is a routing reference only.
 */

export const QUICKFURNO_N8N_PREVIEW_EVENT_TYPES = [
  "lead.created",
  "lead.qualified",
  "lead.quality_preview",
  "lead.assignment_preview",
  "vendor.match_preview",
  "client.followup_preview",
  "nurture.due",
  "report.daily",
  "ops.daily",
  "aos.failure",
] as const;

export type QuickFurnoN8nPreviewEventType =
  (typeof QUICKFURNO_N8N_PREVIEW_EVENT_TYPES)[number];

export const QUICKFURNO_N8N_PREVIEW_WORKFLOW_MAP: Record<
  QuickFurnoN8nPreviewEventType,
  string
> = {
  "lead.created": "QF-n8n-New-Lead-Intake",
  "lead.qualified": "QF-n8n-Lead-Quality-Check",
  "lead.quality_preview": "QF-n8n-Lead-Quality-Check",
  "lead.assignment_preview": "QF-n8n-Vendor-Match-Preview",
  "vendor.match_preview": "QF-n8n-Vendor-Match-Preview",
  "client.followup_preview": "QF-n8n-Client-Followup-Preview",
  "nurture.due": "QF-n8n-Client-Followup-Preview",
  "report.daily": "QF-n8n-Daily-Founder-Report",
  "ops.daily": "QF-n8n-Daily-Founder-Report",
  "aos.failure": "QF-n8n-Failure-Handler",
};

/** Status shown in display-only admin surfaces. No live trigger exists. */
export type QuickFurnoN8nWorkflowStatus = "template-ready" | "preview-only";

export interface QuickFurnoN8nPreviewRoute {
  eventType: QuickFurnoN8nPreviewEventType;
  workflowName: string;
  status: QuickFurnoN8nWorkflowStatus;
}

export function isQuickFurnoN8nPreviewEventType(
  value: unknown,
): value is QuickFurnoN8nPreviewEventType {
  return (
    typeof value === "string" &&
    QUICKFURNO_N8N_PREVIEW_EVENT_TYPES.includes(
      value as QuickFurnoN8nPreviewEventType,
    )
  );
}

/**
 * Resolve the preview workflow name for an event type. Unknown event types fall
 * back to the failure handler placeholder rather than throwing.
 */
export function getPreviewWorkflowForEvent(eventType: string): string {
  if (isQuickFurnoN8nPreviewEventType(eventType)) {
    return QUICKFURNO_N8N_PREVIEW_WORKFLOW_MAP[eventType];
  }
  return "QF-n8n-Failure-Handler";
}

/** Display-only route list for admin/reference surfaces. */
export function getPreviewWorkflowRoutes(): QuickFurnoN8nPreviewRoute[] {
  return QUICKFURNO_N8N_PREVIEW_EVENT_TYPES.map((eventType) => ({
    eventType,
    workflowName: QUICKFURNO_N8N_PREVIEW_WORKFLOW_MAP[eventType],
    status: eventType === "aos.failure" ? "preview-only" : "template-ready",
  }));
}
