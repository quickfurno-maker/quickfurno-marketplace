// ============================================================================
// QuickFurno — services/leadDraftService.ts
//
// PARTIAL LEAD CAPTURE (launch): the homepage enquiry modal saves an anonymous
// draft row as the visitor completes each step, so drop-offs become visible
// (which services/areas people wanted but never submitted).
//
// DESIGN RULES:
//   • NO PII. A draft never carries name, phone, WhatsApp or GPS — only the
//     project facts (service, city, area, budget band, timeline, property
//     type) plus the CTA source. Contact details exist only in the real lead.
//   • FAIL-SILENT. Draft capture must never break or slow the enquiry flow.
//     Any error — including the `lead_drafts` table not existing yet because
//     the migration has not been applied — is swallowed after one console
//     line. The UI never sees it.
//   • One row per modal open. The browser generates a UUID when the modal
//     opens and every stage upsert reuses it, so a visitor stepping back and
//     forth updates one row instead of spamming inserts.
//   • Service-role only. The table has RLS enabled with NO anon policies
//     (see supabase/migrations/20260921100000_qf_lead_drafts.sql); rows are
//     written exclusively through this server-side module.
// ============================================================================
import { adminClient } from "../lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = ["project", "details", "converted"] as const;
export type LeadDraftStage = (typeof STAGES)[number];

export type LeadDraftInput = {
  draft_id: string;
  stage: LeadDraftStage;
  service_category?: string;
  subcategory?: string;
  city?: string;
  area?: string;
  budget_range?: string;
  timeline?: string;
  property_type?: string;
  source?: string;
};

/** Clamp free text so a hostile caller cannot store megabytes per field. */
function clamp(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Insert or update one draft row. Never throws; returns { ok } only so the
 * server action has a serializable result. Callers fire-and-forget.
 */
export async function upsertLeadDraft(input: LeadDraftInput): Promise<{ ok: boolean }> {
  try {
    if (!input || typeof input !== "object") return { ok: false };
    if (!UUID_RE.test(input.draft_id ?? "")) return { ok: false };
    if (!STAGES.includes(input.stage)) return { ok: false };

    const row = {
      id: input.draft_id.toLowerCase(),
      stage: input.stage,
      service_category: clamp(input.service_category),
      subcategory: clamp(input.subcategory),
      city: clamp(input.city, 80),
      area: clamp(input.area, 160),
      budget_range: clamp(input.budget_range, 80),
      timeline: clamp(input.timeline, 80),
      property_type: clamp(input.property_type, 80),
      source: clamp(input.source, 160),
      updated_at: new Date().toISOString(),
    };

    const { error } = await adminClient().from("lead_drafts").upsert(row, { onConflict: "id" });
    if (error) {
      // Missing table (migration not applied) or any other failure: one quiet
      // line for ops, nothing for the visitor.
      console.warn("[lead drafts] upsert skipped", { code: error.code ?? null });
      return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
