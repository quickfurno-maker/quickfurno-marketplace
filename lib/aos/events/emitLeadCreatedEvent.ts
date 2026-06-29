// ============================================================================
// QuickFurno AOS — Phase 9: Real Lead Form → AOS Event Bridge
//
// Tiny, server-only helper that emits a SAFE `lead.created` AOS event after a
// real client lead has been successfully saved to Supabase.
//
// It reuses the existing safe AOS pipeline (runSafeAgentEventPipeline), which:
//   - Respects N8N_ENABLED / N8N_OUTBOUND_WEBHOOK_ENABLED (env + feature flags).
//   - Masks phone numbers / secrets before any outbound dispatch.
//   - Runs a deterministic, side-effect-free agent PREVIEW.
//   - Performs NO Supabase writes, NO WhatsApp send, NO credit deduction,
//     NO vendor notification, and NO lead auto-assignment.
//
// SAFETY CONTRACT (must hold for every caller):
//   - Never throws. All failures are swallowed and logged (masked).
//   - Never blocks lead submission: bounded by an internal timeout race.
//   - Server-only. Never import this from client components (it pulls in the
//     service-role n8n pipeline). It is only imported by services/leadService.
// ============================================================================
import { runSafeAgentEventPipeline } from "@/lib/aos/events/safeAgentEventPipeline";

const AOS_EMIT_TIMEOUT_MS = 3_000;
const LEAD_CREATED_SOURCE = "quickfurno-real-lead-form";

export interface EmitLeadCreatedInput {
  /** The actual saved lead id from Supabase, when available. */
  leadId?: string | null;
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  area?: string | null;
  category?: string | null;
  budget?: string | null;
  message?: string | null;
  /** Pass-through context (e.g. is_duplicate, website source). Non-sensitive only. */
  isDuplicate?: boolean;
  formSource?: string | null;
}

/**
 * Fire-and-forget safe emit. Resolves to `true` if the pipeline accepted the
 * event (in mock or real mode) and `false` on any handled failure/timeout.
 * Callers SHOULD NOT await this in a way that can block the user response.
 */
export async function emitLeadCreatedEvent(input: EmitLeadCreatedInput): Promise<boolean> {
  try {
    const leadId = nonEmpty(input.leadId) ?? generateFallbackLeadId();

    // Assemble the safe event. The pipeline masks PII before any dispatch and
    // only forwards a safe summary when n8n is explicitly enabled.
    const payload = {
      event: "lead.created" as const,
      eventType: "lead.created" as const,
      lead_id: leadId,
      source: LEAD_CREATED_SOURCE,
      lead: {
        name: nonEmpty(input.name),
        phone: nonEmpty(input.phone),
        city: nonEmpty(input.city),
        area: nonEmpty(input.area),
        category: nonEmpty(input.category),
        budget: nonEmpty(input.budget),
        message: nonEmpty(input.message),
      },
      metadata: {
        mode: "real_lead_form_bridge",
        isDuplicate: Boolean(input.isDuplicate),
        formSource: nonEmpty(input.formSource) ?? "Website",
        sideEffectsDisabled: true,
      },
    };

    const result = await withTimeout(runSafeAgentEventPipeline(payload), AOS_EMIT_TIMEOUT_MS);

    if (!result) {
      console.warn("[aos][lead.created] safe emit timed out — lead submission unaffected", { leadId });
      return false;
    }

    console.info("[aos][lead.created] safe event emitted", {
      leadId,
      status: result.status,
      n8nWebhookCalled: result.n8nWebhookCalled,
      mockMode: result.mockMode,
    });
    return true;
  } catch {
    // The bridge must never break lead capture. Swallow and report safely.
    console.warn("[aos][lead.created] safe emit failed — lead submission unaffected");
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

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function generateFallbackLeadId(): string {
  return `qf_lead_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
