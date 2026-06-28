import { createSafeSideEffectReport, isQuickFurnoN8nEventType, type QuickFurnoSafeSideEffectReport } from "@/lib/aos/events/n8nEventTypes";
import { getWorkflowForN8nEvent } from "@/lib/aos/events/n8nWorkflowMap";
import { queueEventForN8n } from "@/lib/aos/sync/n8nSyncService";

type SafeAgentEventType = "lead.created" | "lead.qualified" | "lead.assignment_preview" | "aos.failure";

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
  n8nWebhookCalled: boolean;
  mockMode: boolean;
  sideEffects: QuickFurnoSafeSideEffectReport;
  message: string;
  n8n: {
    status: string;
    message: string;
    mockMode: boolean;
  };
}

const supportedSafeAgentEvents: SafeAgentEventType[] = [
  "lead.created",
  "lead.qualified",
  "lead.assignment_preview",
  "aos.failure",
];

export function getSafeAgentTestEvents(): SafeAgentEventType[] {
  return [...supportedSafeAgentEvents];
}

export async function runSafeAgentEventPipeline(payload: unknown): Promise<SafeAgentEventResponse> {
  try {
    const normalized = normalizeSafeAgentEventPayload(payload);
    const agents = buildSafeAgentPreview(normalized.eventType);
    const workflowName = getWorkflowForN8nEvent(normalized.eventType);

    const n8nResult = await queueEventForN8n({
      eventType: normalized.eventType,
      leadId: normalized.leadId,
      source: normalized.source,
      occurredAt: normalized.timestamp,
      data: {
        eventType: normalized.eventType,
        workflowName,
        leadId: normalized.leadId,
        source: normalized.source,
        timestamp: normalized.timestamp,
        agentPreviewSummary: summarizeAgents(agents),
        agents,
      },
      metadata: {
        mode: "safe_agent_preview",
        sideEffectsDisabled: true,
      },
    });

    const sideEffects: QuickFurnoSafeSideEffectReport = {
      ...createSafeSideEffectReport(),
      n8nWebhookCalled: Boolean(n8nResult.sideEffects?.n8nWebhookCalled),
    };

    return {
      ok: true,
      status: n8nResult.sideEffects?.n8nWebhookCalled ? "accepted" : "mocked",
      eventType: normalized.eventType,
      workflowName,
      leadId: normalized.leadId,
      source: normalized.source,
      timestamp: normalized.timestamp,
      agents,
      n8nWebhookCalled: sideEffects.n8nWebhookCalled,
      mockMode: !sideEffects.n8nWebhookCalled,
      sideEffects,
      message: sideEffects.n8nWebhookCalled
        ? "Safe AOS agent preview completed and n8n accepted the event. All other side effects remain disabled."
        : "Safe AOS agent preview completed in mock mode. n8n was not called or failed safely.",
      n8n: {
        status: n8nResult.status,
        message: n8nResult.message,
        mockMode: n8nResult.mockMode,
      },
    };
  } catch {
    const timestamp = new Date().toISOString();
    const agents = buildSafeAgentPreview("aos.failure");
    const sideEffects = createSafeSideEffectReport();
    return {
      ok: true,
      status: "mocked",
      eventType: "aos.failure",
      workflowName: getWorkflowForN8nEvent("aos.failure"),
      leadId: null,
      source: "safe-agent-pipeline-fallback",
      timestamp,
      agents,
      n8nWebhookCalled: false,
      mockMode: true,
      sideEffects,
      message: "Malformed AOS event handled safely. No side effects executed.",
      n8n: {
        status: "mocked",
        message: "n8n was not called because the event pipeline recovered safely.",
        mockMode: true,
      },
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

  return {
    eventType,
    leadId,
    source,
    timestamp,
  };
}

function normalizeSafeEventType(value: string | null): SafeAgentEventType {
  if (value === "lead.assignment_preview") return "lead.assignment_preview";
  if (value && supportedSafeAgentEvents.includes(value as SafeAgentEventType) && isQuickFurnoN8nEventType(value)) {
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
      suggestedVendorCount: 0,
      notes: ["Vendor matching preview only. No assignment executed."],
    },
    leadFlow: {
      status: "preview",
      assignmentStatus: "not_assigned",
      notes: ["No credits deducted. No vendor notified."],
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

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
