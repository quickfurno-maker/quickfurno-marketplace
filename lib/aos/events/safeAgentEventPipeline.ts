import { createSafeSideEffectReport, isQuickFurnoAutomationEventType, type QuickFurnoSafeSideEffectReport } from "@/lib/aos/events/automationEventTypes";
import { getWorkflowForAutomationEvent } from "@/lib/aos/events/automationWorkflowMap";

type SafeAgentEventType =
  | "lead.created"
  | "lead.scored"
  | "lead.qualified"
  | "lead.clarification_required"
  | "lead.rejected_quality"
  | "lead.assignment_preview"
  | "lead.assignment_approved"
  | "lead.assignment_queued"
  | "lead.assignment_queue_rechecked"
  | "vendor.profile_interest_captured"
  | "vendor.recharge_prompt_preview"
  | "aos.failure";

export interface SafeAgentPreviewResult {
  trustShield: {
    status: "preview";
    result: "accepted";
    spamRisk: "low";
    duplicateRisk: "unknown";
    notes: string[];
  };
  leadLens: {
    status: "preview";
    leadQuality: "warm";
    score: 70;
    reasons: string[];
  };
  matchForge: {
    status: "preview";
    matchedVendorLimit: 3;
    suggestedVendorCount: 0;
    notes: string[];
  };
  leadFlow: {
    status: "preview";
    assignmentStatus: "not_assigned";
    notes: string[];
  };
  opsBrief: {
    status: "placeholder";
    notes: string[];
  };
}

export interface SafeAgentEventResponse {
  ok: true;
  status: "accepted" | "mocked";
  eventType: SafeAgentEventType;
  workflowName: string;
  leadId: string | null;
  source: string;
  timestamp: string;
  agents: SafeAgentPreviewResult;
  automationEventQueued: boolean;
  mockMode: boolean;
  runtimeAutomationEnabled: boolean;
  runtimeAutomationMode: "advisory";
  sideEffects: QuickFurnoSafeSideEffectReport;
  message: string;
  automation: {
    status: string;
    message: string;
    mockMode: boolean;
  };
}

const supportedSafeAgentEvents: SafeAgentEventType[] = [
  "lead.created",
  "lead.scored",
  "lead.qualified",
  "lead.clarification_required",
  "lead.rejected_quality",
  "lead.assignment_preview",
  "lead.assignment_approved",
  "lead.assignment_queued",
  "lead.assignment_queue_rechecked",
  "vendor.profile_interest_captured",
  "vendor.recharge_prompt_preview",
  "aos.failure",
];

export function getSafeAgentTestEvents(): SafeAgentEventType[] {
  return [...supportedSafeAgentEvents];
}

export async function runSafeAgentEventPipeline(payload: unknown): Promise<SafeAgentEventResponse> {
  try {
    const normalized = normalizeSafeAgentEventPayload(payload);
    const agents = buildSafeAgentPreview(normalized.eventType);
    const workflowName = getWorkflowForAutomationEvent(normalized.eventType);
    const sideEffects = createSafeSideEffectReport();
    return {
      ok: true,
      status: "mocked",
      eventType: normalized.eventType,
      workflowName,
      leadId: normalized.leadId,
      source: normalized.source,
      timestamp: normalized.timestamp,
      agents,
      automationEventQueued: false,
      mockMode: true,
      runtimeAutomationEnabled: false,
      runtimeAutomationMode: "advisory",
      sideEffects,
      message: "Safe AOS advisory preview completed. Core and the native automation engine retain all execution authority.",
      automation: {
        status: "advisory",
        message: "No external workflow runtime was called and no business side effect was executed.",
        mockMode: true,
      },
    };
  } catch {
    const timestamp = new Date().toISOString();
    const agents = buildSafeAgentPreview("aos.failure");
    return {
      ok: true,
      status: "mocked",
      eventType: "aos.failure",
      workflowName: getWorkflowForAutomationEvent("aos.failure"),
      leadId: null,
      source: "safe-agent-pipeline-fallback",
      timestamp,
      agents,
      automationEventQueued: false,
      mockMode: true,
      runtimeAutomationEnabled: false,
      runtimeAutomationMode: "advisory",
      sideEffects: createSafeSideEffectReport(),
      message: "Malformed AOS event handled safely. No side effects executed.",
      automation: { status: "advisory", message: "Recovered safely.", mockMode: true },
    };
  }
}

function normalizeSafeAgentEventPayload(payload: unknown) {
  const record = isRecord(payload) ? payload : {};
  const rawEventType = firstString(record.event, record.eventType, record.event_type, record.type);
  const eventType = normalizeSafeEventType(rawEventType);
  const leadId = firstString(record.lead_id, record.leadId, record.id);
  const source = firstString(record.source) ?? "quickfurno-aos";
  const timestamp = firstString(record.timestamp, record.occurredAt, record.createdAt) ?? new Date().toISOString();
  const safeData = normalizeClarificationSafeData(record);

  return {
    eventType,
    leadId,
    source,
    timestamp,
    safeData,
  };
}

function normalizeSafeEventType(value: string | null): SafeAgentEventType {
  if (value === "lead.assignment_preview") return "lead.assignment_preview";
  if (value === "lead.scored") return "lead.scored";
  if (value === "lead.qualified") return "lead.qualified";
  if (value === "lead.clarification_required") return "lead.clarification_required";
  if (value === "lead.rejected_quality") return "lead.rejected_quality";
  if (value === "lead.assignment_approved") return "lead.assignment_approved";
  if (value === "lead.assignment_queued") return "lead.assignment_queued";
  if (value === "lead.assignment_queue_rechecked") return "lead.assignment_queue_rechecked";
  if (value === "vendor.profile_interest_captured") return "vendor.profile_interest_captured";
  if (value === "vendor.recharge_prompt_preview") return "vendor.recharge_prompt_preview";
  if (value && supportedSafeAgentEvents.includes(value as SafeAgentEventType) && isQuickFurnoAutomationEventType(value)) {
    return value as SafeAgentEventType;
  }
  return "aos.failure";
}

function buildSafeAgentPreview(eventType: SafeAgentEventType): SafeAgentPreviewResult {
  const leadCreatedNote = eventType === "lead.created"
    ? "lead.created accepted for safe preview."
    : `${eventType} accepted in safe preview mode.`;

  return {
    trustShield: {
      status: "preview",
      result: "accepted",
      spamRisk: "low",
      duplicateRisk: "unknown",
      notes: [
        leadCreatedNote,
        "Spam and duplicate checks are preview-only. No lead status was changed.",
      ],
    },
    leadLens: {
      status: "preview",
      leadQuality: "warm",
      score: 70,
      reasons: [
        "LeadLens preview uses safe default scoring in this phase.",
        "No AI provider was called.",
      ],
    },
    matchForge: {
      status: "preview",
      matchedVendorLimit: 3,
      suggestedVendorCount: eventType === "lead.assignment_queued" || eventType === "lead.assignment_queue_rechecked" ? 0 : 0,
      notes: [`${eventType} is preview-only. No assignment executed.`],
    },
    leadFlow: {
      status: "preview",
      assignmentStatus: "not_assigned",
      notes: ["No credits deducted. No vendor notified. No WhatsApp sent."],
    },
    opsBrief: {
      status: "placeholder",
      notes: ["Ops summary will be generated in later phase."],
    },
  };
}

function summarizeAgents(agents: SafeAgentPreviewResult) {
  return {
    trustShield: agents.trustShield.result,
    leadLens: `${agents.leadLens.leadQuality}:${agents.leadLens.score}`,
    matchForge: `suggestions:${agents.matchForge.suggestedVendorCount}`,
    leadFlow: agents.leadFlow.assignmentStatus,
    opsBrief: agents.opsBrief.status,
  };
}

function normalizeClarificationSafeData(record: Record<string, unknown>): Record<string, unknown> {
  const eventType = firstString(record.event, record.eventType, record.event_type, record.type);
  if (eventType !== "lead.clarification_required") return {};
  const missingFields = Array.isArray(record.missingFields)
    ? record.missingFields.map(String).slice(0, 10)
    : Array.isArray(record.missing_fields)
      ? record.missing_fields.map(String).slice(0, 10)
      : [];
  return {
    scoreClass: firstString(record.scoreClass, record.score_class),
    score: numberOrNull(record.score),
    missingFields,
    parentCategoryGroup: firstString(record.parentCategoryGroup, record.parent_category_group),
    marketplaceCategory: firstString(record.marketplaceCategory, record.marketplace_category),
    serviceRequired: firstString(record.serviceRequired, record.service_required),
    previewMessage: firstString(record.previewMessage, record.preview_message),
    questionsCount: numberOrNull(record.questionsCount, record.questions_count),
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function numberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
