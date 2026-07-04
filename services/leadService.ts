// ============================================================================
// QuickFurno — services/leadService.ts
// Client lead capture, eligible-vendor listing, and hybrid assignment.
// All credit-touching work is delegated to the tested DB RPC.
// ============================================================================
import { adminClient, publicClient } from "../lib/supabase";
import { appError, fromPgError, type Result, ok, fail } from "../lib/errors";
import { logSupabaseInsertError } from "../lib/supabaseLogging";
import { MAX_VENDORS_PER_LEAD } from "../lib/config";
import { emitLeadCreatedEvent } from "../lib/aos/events/emitLeadCreatedEvent";
import { emitLeadClarificationRequiredEvent } from "../lib/aos/events/emitLeadClarificationRequiredEvent";
import { runAutoLeadMatchingForLead } from "./leadMatchingEngine";
import { createClarificationRequestForLead, shouldCreateClarificationForLead } from "./leadClarificationService";
import { canAutoDistributeLead, scoreAndStoreLead, type LeadQualityScoreResult } from "./leadQualityService";
import {
  holdPreferredVendorForQualityGate,
  routePreferredVendorLead,
  type PreferredVendorRoutingResult,
} from "./preferredVendorLeadService";
import type { CreateLeadInput, PublicVendorCard, AssignResult } from "../lib/types";

function firstText(...values: Array<string | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

/** PostgREST/Postgres "column does not exist" — i.e. the lead tracking/consent
 *  migration (008_lead_capture_consent.sql) has not been applied yet. */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || (message.includes("column") && message.includes("does not exist"));
}

/** Create a client lead. De-dupes by phone+service+city within the configured window. */
export async function createLead(
  input: CreateLeadInput,
): Promise<Result<{ id: string; is_duplicate: boolean; preferred_vendor?: PreferredVendorRoutingResult }>> {
  try {
    const name = firstText(input.name);
    const phone = firstText(input.phone);
    const city = firstText(input.city);
    const serviceRequired = firstText(input.service_required, input.service_category, input.serviceCategory);
    const budget = firstText(input.budget, input.budget_range, input.budgetRange);
    const message = firstText(input.message, input.requirement);
    const source = firstText(input.source) || "Website";

    if (!name || !phone || !city || !serviceRequired) throw appError("VALIDATION");

    const db = adminClient();

    console.info("[lead submit] starting", {
      source,
      city,
      service_category: serviceRequired,
      has_budget_range: Boolean(budget),
      has_requirement: Boolean(message),
    });

    // duplicate check (RPC honours app_settings.duplicate_lead_window_days)
    const { data: dupId, error: dupErr } = await db.rpc("check_duplicate_lead", {
      p_phone: phone,
      p_service: serviceRequired,
      p_city: city,
    });
    if (dupErr) throw dupErr;

    const isDuplicate = Boolean(dupId);

    const basePayload = {
      name,
      phone,
      city,
      area: input.area ?? null,
      service_required: serviceRequired,
      budget: budget || null,
      property_type: input.property_type ?? null,
      timeline: input.timeline ?? null,
      message: message || null,
      source,
      verification_status: isDuplicate ? "Manual Review" : "Quality Pending",
      is_duplicate: isDuplicate,
      duplicate_of: isDuplicate ? dupId : null,
      status: isDuplicate ? "Duplicate" : "New",
    };

    // Tracking + consent fields — only persisted once 008_lead_capture_consent.sql
    // has added these columns. Falls back to basePayload if not migrated yet.
    const trackingPayload = {
      source_url: input.source_url ?? null,
      utm_source: input.utm_source ?? null,
      utm_medium: input.utm_medium ?? null,
      utm_campaign: input.utm_campaign ?? null,
      utm_term: input.utm_term ?? null,
      utm_content: input.utm_content ?? null,
      email: input.email ?? null,
      location_consent: input.location_consent ?? false,
      share_consent: input.share_consent ?? false,
      // Phase 26A-2D requirement-group context (additive; the missing-column
      // fallback below drops these together with the tracking fields).
      parent_category_group: input.parent_category_group ?? null,
      requirement_group_id: input.requirement_group_id ?? null,
      selected_vendor_id: input.selected_vendor_id ?? null,
      selected_vendor_name: input.selected_vendor_name ?? null,
      assignment_intent: input.assignment_intent ?? null,
      // Phase 26A-2E: vendor subcategory carried from the vendor profile.
      subcategory: input.subcategory ?? null,
    };

    // Phase 1 (Google area foundation): structured lead location + Google Place
    // identity. Additive/optional — persisted once migration
    // 20260704000040_google_area_location_foundation.sql runs. The existing
    // missing-column fallback below drops these together with the tracking
    // fields, so lead capture is never blocked on a not-yet-migrated database.
    // Foundation only: matching/quality/duplicate logic is unchanged this phase.
    const locationPayload = {
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      location_accuracy_meters: input.location_accuracy_meters ?? null,
      location_source: input.location_source ?? null,
      location_captured_at: input.location_captured_at ?? null,
      google_place_id: input.google_place_id ?? null,
      formatted_address: input.formatted_address ?? null,
      area_normalized: input.area_normalized ?? null,
      sublocality: input.sublocality ?? null,
      neighborhood: input.neighborhood ?? null,
      postal_code: input.postal_code ?? null,
    };

    const insertLead = (payload: Record<string, unknown>) =>
      db.from("leads").insert(payload).select("id, is_duplicate").single();

    let { data, error } = await insertLead({ ...basePayload, ...trackingPayload, ...locationPayload });

    // Graceful fallback: if the tracking/consent OR Phase 1 location columns
    // aren't migrated yet, insert base fields only so lead capture is never blocked.
    if (error && isMissingColumnError(error)) {
      console.warn("[leads] tracking/consent or location columns missing — run 008_lead_capture_consent.sql / 20260704000040_google_area_location_foundation.sql; saving lead without them.");
      ({ data, error } = await insertLead(basePayload));
    }

    if (error) {
      logSupabaseInsertError("leads", error, {
        source,
        city,
        service_category: serviceRequired,
        has_area: Boolean(input.area),
        has_budget_range: Boolean(budget),
        has_requirement: Boolean(message),
        is_duplicate: isDuplicate,
      });
      throw error;
    }
    if (!data?.id) throw appError("UNKNOWN");

    console.info("[lead submit] inserted", {
      lead_id: data.id,
      is_duplicate: data.is_duplicate,
      source,
    });

    // ── Phase 9: Real Lead Form → AOS Event Bridge ──────────────────────────
    // The lead is now safely persisted. Emit a SAFE, non-blocking `lead.created`
    // AOS event. This is fire-and-forget: it never awaits the user response, has
    // its own timeout, never throws, and performs no side effects (no WhatsApp,
    // no credits, no assignment, no extra DB writes). Failures cannot affect the
    // lead submission, which already succeeded above.
    void emitLeadCreatedEvent({
      leadId: data.id,
      name,
      phone,
      city,
      area: input.area ?? null,
      category: serviceRequired,
      budget: budget || null,
      message: message || null,
      isDuplicate: Boolean(data.is_duplicate),
      formSource: source,
    });

    let scoreResult: LeadQualityScoreResult | null = null;
    try {
      scoreResult = await scoreAndStoreLead(data.id, {
        ...input,
        name,
        phone,
        city,
        area: input.area ?? null,
        service_required: serviceRequired,
        budget,
        message,
        is_duplicate: Boolean(data.is_duplicate),
      });
      void emitLeadCreatedEvent({
        leadId: data.id,
        name,
        phone,
        city,
        area: input.area ?? null,
        category: serviceRequired,
        budget: budget || null,
        message: message || null,
        isDuplicate: Boolean(data.is_duplicate),
        formSource: "lead.quality.preview",
        eventType: "lead.scored",
      });
      if (shouldCreateClarificationForLead({ is_duplicate: Boolean(data.is_duplicate) }, scoreResult)) {
        const clarification = await createClarificationRequestForLead(data.id);
        if (clarification.ok) {
          void emitLeadClarificationRequiredEvent({
            leadId: data.id,
            score: scoreResult.total_score,
            scoreClass: scoreResult.score_class,
            missingFields: clarification.data.missing_fields ?? [],
            parentCategoryGroup: clarification.data.parent_category_group,
            marketplaceCategory: clarification.data.marketplace_category,
            serviceRequired: clarification.data.service_required,
            previewMessage: clarification.data.preview_message,
            questionsCount: clarification.data.questions_json?.length ?? 0,
            source: "lead.quality.preview",
          });
        } else {
          console.warn("[lead clarification] preview preparation skipped", {
            lead_id: data.id,
            code: clarification.code,
            error: clarification.error,
          });
        }
      } else {
        void emitLeadCreatedEvent({
          leadId: data.id,
          name,
          phone,
          city,
          area: input.area ?? null,
          category: serviceRequired,
          budget: budget || null,
          message: message || null,
          isDuplicate: Boolean(data.is_duplicate),
          formSource: "lead.quality.preview",
          eventType: qualityEventType(scoreResult),
        });
      }
    } catch (qualityError) {
      console.warn("[lead quality] scoring failed; distribution held to protect vendor trust", {
        lead_id: data.id,
        message: qualityError instanceof Error ? qualityError.message : "Unknown error",
      });
    }

    // Phase 26A-2D: a client-selected-vendor enquiry must NOT trigger the
    // immediate max-3 auto match — the client-selected priority + 1-hour
    // auto-fill window (clientRequirementGroupService) owns that lead instead.
    const isClientSelectedIntent = input.assignment_intent === "client_selected_vendor";
    // Phase 1 preferred-vendor routing: a specific-vendor CTA routes the lead
    // FIRST (and only) to the client-picked vendor — never the normal max-3 auto
    // match, and never a fan-out to other vendors in this phase.
    const preferredVendorId = firstText(input.target_vendor_id);
    const isPreferredVendorIntent = input.lead_intent === "preferred_vendor" && Boolean(preferredVendorId);
    const qualityGatePassed = scoreResult ? canAutoDistributeLead(scoreResult) : false;

    let preferredVendor: PreferredVendorRoutingResult | undefined;

    if (isPreferredVendorIntent) {
      if (qualityGatePassed) {
        preferredVendor = await routePreferredVendorLead({
          leadId: data.id,
          vendorId: preferredVendorId,
          vendorName: input.target_vendor_name,
          city,
          serviceRequired,
          category: input.target_vendor_category,
          subcategory: input.target_vendor_subcategory ?? input.subcategory,
          isDuplicate: Boolean(data.is_duplicate),
          fallbackAllowed: input.fallback_allowed,
        });
      } else {
        preferredVendor = await holdPreferredVendorForQualityGate({
          leadId: data.id,
          vendorId: preferredVendorId,
          vendorName: input.target_vendor_name,
          city,
          serviceRequired,
          category: input.target_vendor_category,
          subcategory: input.target_vendor_subcategory ?? input.subcategory,
          isDuplicate: Boolean(data.is_duplicate),
          fallbackAllowed: input.fallback_allowed,
          reason: scoreResult?.hard_block_reason ?? "lead_quality_scoring_unavailable",
        });
      }
    } else if (qualityGatePassed && !isClientSelectedIntent) {
      const matching = await runAutoLeadMatchingForLead(data.id);
      if (!matching.ok) {
        console.warn("[lead matching] auto matching failed without blocking lead submission", {
          lead_id: data.id,
          code: matching.code,
          error: matching.error,
        });
      }
    }

    return ok({ id: data.id, is_duplicate: data.is_duplicate, preferred_vendor: preferredVendor });
  } catch (e) {
    return fail(e);
  }
}

function qualityEventType(scoreResult: LeadQualityScoreResult): "lead.qualified" | "lead.clarification_required" | "lead.rejected_quality" {
  if (canAutoDistributeLead(scoreResult)) return "lead.qualified";
  if (scoreResult.recommended_action === "clarification_required") return "lead.clarification_required";
  return "lead.rejected_quality";
}

/** Vendors eligible for a lead — safe public fields only (no phone/email). */
export async function getEligibleVendors(leadId: string): Promise<Result<PublicVendorCard[]>> {
  try {
    const db = adminClient();
    const { data: lead, error: leadErr } = await db
      .from("leads")
      .select("city, area, service_required")
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) throw appError("LEAD_NOT_FOUND");

    // TODO: Future matching updates will use covers_full_city:
    // A vendor should match a client request if:
    // 1. vendor.is_active is true
    // 2. vendor.public_visibility is true if applicable
    // 3. vendor.city matches client city
    // 4. AND one of these is true:
    //    - vendor.covers_full_city is true
    //    - client area exists in vendor.areas_covered
    //    - distance is available and vendor is within service_radius_km (now 20 km)
    // RPC returns the curated safe-field set, filtered to credited + visible vendors
    const { data, error } = await publicClient().rpc("get_public_eligible_vendors", {
      p_city: lead.city,
      p_area: lead.area,
      p_service: lead.service_required,
    });
    if (error) throw error;

    return ok((data ?? []) as PublicVendorCard[]);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Hybrid assignment: client picks 0–3 vendors, the system fills the rest to a
 * hard cap of MAX_VENDORS_PER_LEAD, deducting one credit per assigned vendor —
 * atomically. The DB RPC enforces the same cap via app_settings.
 */
export async function assignLeadToVendors(
  leadId: string,
  selectedVendorIds: string[] = [],
  opts: { allowDuplicate?: boolean; assignmentType?: "client_selected" | "admin_assigned" } = {}
): Promise<Result<AssignResult>> {
  try {
    if (selectedVendorIds.length > MAX_VENDORS_PER_LEAD) throw appError("MAX_VENDORS_EXCEEDED");

    const { data, error } = await adminClient().rpc("assign_lead_to_vendors", {
      p_lead_id: leadId,
      p_selected_vendor_ids: selectedVendorIds,
      p_allow_duplicate: opts.allowDuplicate ?? false,
      p_selected_type: opts.assignmentType ?? "client_selected",
    });
    if (error) throw fromPgError(error);

    return ok(data as AssignResult);
  } catch (e) {
    return fail(e);
  }
}
