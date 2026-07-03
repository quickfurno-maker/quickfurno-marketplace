import { runSafeAgentEventPipeline } from "@/lib/aos/events/safeAgentEventPipeline";

const AOS_EMIT_TIMEOUT_MS = 3_000;

export type EmitLeadClarificationRequiredInput = {
  leadId: string;
  score?: number | null;
  scoreClass?: string | null;
  missingFields?: string[];
  parentCategoryGroup?: string | null;
  marketplaceCategory?: string | null;
  serviceRequired?: string | null;
  previewMessage?: string | null;
  questionsCount?: number;
  source?: string | null;
};

export async function emitLeadClarificationRequiredEvent(input: EmitLeadClarificationRequiredInput): Promise<boolean> {
  try {
    const payload = {
      event: "lead.clarification_required" as const,
      eventType: "lead.clarification_required" as const,
      lead_id: input.leadId,
      source: input.source ?? "quickfurno-b-lead-clarification-preview",
      scoreClass: input.scoreClass ?? null,
      score: input.score ?? null,
      missingFields: input.missingFields ?? [],
      parentCategoryGroup: input.parentCategoryGroup ?? null,
      marketplaceCategory: input.marketplaceCategory ?? null,
      serviceRequired: input.serviceRequired ?? null,
      previewMessage: input.previewMessage ?? null,
      questionsCount: input.questionsCount ?? 0,
      metadata: {
        mode: "b_lead_clarification_preview",
        safePreviewOnly: true,
        whatsappSent: false,
        databaseWrittenByN8n: false,
        creditsDeducted: false,
        leadAutoAssigned: false,
        vendorNotified: false,
      },
    };

    const result = await withTimeout(runSafeAgentEventPipeline(payload), AOS_EMIT_TIMEOUT_MS);
    if (!result) return false;
    console.info("[aos][lead.clarification_required] safe event emitted", {
      leadId: input.leadId,
      status: result.status,
      n8nWebhookCalled: result.n8nWebhookCalled,
      mockMode: result.mockMode,
    });
    return true;
  } catch {
    console.warn("[aos][lead.clarification_required] safe emit failed; lead submission unaffected");
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}
