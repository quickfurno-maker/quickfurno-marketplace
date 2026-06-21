// ============================================================================
// QuickFurno — services/leadService.ts
// Client lead capture, eligible-vendor listing, and hybrid assignment.
// All credit-touching work is delegated to the tested DB RPC.
// ============================================================================
import { adminClient, publicClient } from "../lib/supabase";
import { appError, fromPgError, type Result, ok, fail } from "../lib/errors";
import { logSupabaseInsertError } from "../lib/supabaseLogging";
import type { CreateLeadInput, PublicVendorCard, AssignResult } from "../lib/types";

function firstText(...values: Array<string | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

/** Create a client lead. De-dupes by phone+service+city within the configured window. */
export async function createLead(input: CreateLeadInput): Promise<Result<{ id: string; is_duplicate: boolean }>> {
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

    const { data, error } = await db
      .from("leads")
      .insert({
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
        verification_status: "Verified", // MVP placeholder (OTP comes later)
        is_duplicate: isDuplicate,
        duplicate_of: isDuplicate ? dupId : null,
        status: isDuplicate ? "Duplicate" : "New",
      })
      .select("id, is_duplicate")
      .single();
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

    return ok({ id: data.id, is_duplicate: data.is_duplicate });
  } catch (e) {
    return fail(e);
  }
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
 * Hybrid assignment: client picks 0–4 vendors, the system fills the rest to a
 * hard cap of 4, deducting one credit per assigned vendor — atomically.
 */
export async function assignLeadToVendors(
  leadId: string,
  selectedVendorIds: string[] = [],
  opts: { allowDuplicate?: boolean; assignmentType?: "client_selected" | "admin_assigned" } = {}
): Promise<Result<AssignResult>> {
  try {
    if (selectedVendorIds.length > 4) throw appError("MAX_VENDORS_EXCEEDED");

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
