// ============================================================================
// QuickFurno — services/leadService.ts
// Client lead capture, eligible-vendor listing, and hybrid assignment.
// All credit-touching work is delegated to the tested DB RPC.
// ============================================================================
import { adminClient, publicClient } from "../lib/supabase";
import { appError, fromPgError, type Result, ok, fail } from "../lib/errors";
import type { CreateLeadInput, PublicVendorCard, AssignResult } from "../lib/types";

/** Create a client lead. De-dupes by phone+service+city within the configured window. */
export async function createLead(input: CreateLeadInput): Promise<Result<{ id: string; is_duplicate: boolean }>> {
  try {
    const required = ["name", "phone", "city", "service_required"] as const;
    for (const f of required) {
      if (!input[f] || String(input[f]).trim() === "") throw appError("VALIDATION");
    }

    const db = adminClient();

    // duplicate check (RPC honours app_settings.duplicate_lead_window_days)
    const { data: dupId, error: dupErr } = await db.rpc("check_duplicate_lead", {
      p_phone: input.phone,
      p_service: input.service_required,
      p_city: input.city,
    });
    if (dupErr) throw dupErr;

    const isDuplicate = Boolean(dupId);

    const { data, error } = await db
      .from("leads")
      .insert({
        name: input.name,
        phone: input.phone,
        city: input.city,
        area: input.area ?? null,
        service_required: input.service_required,
        budget: input.budget ?? null,
        property_type: input.property_type ?? null,
        timeline: input.timeline ?? null,
        message: input.message ?? null,
        source: input.source ?? "Website",
        verification_status: "Verified", // MVP placeholder (OTP comes later)
        is_duplicate: isDuplicate,
        duplicate_of: isDuplicate ? dupId : null,
        status: isDuplicate ? "Duplicate" : "New",
      })
      .select("id, is_duplicate")
      .single();
    if (error) throw error;

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
