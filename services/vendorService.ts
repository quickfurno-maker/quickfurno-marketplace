// ============================================================================
// QuickFurno — services/vendorService.ts
// Vendor registration, dashboard data, lead status updates, bad-lead reports.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, AppError, type Result, ok, fail } from "../lib/errors";
import { logSupabaseInsertError } from "../lib/supabaseLogging";
import type {
  VendorRegistrationInput, VendorDashboardStats, VendorLeadStatus,
} from "../lib/types";

/** Public vendor registration. Always lands as Pending + not visible. */
export async function registerVendor(input: VendorRegistrationInput): Promise<Result<{ id: string }>> {
  try {
    // 1. Clean phone and whatsapp numbers to 10 digits
    const cleanedPhone = (input.phone ?? "").replace(/\D/g, "");
    const cleanedWhatsapp = input.whatsapp_number
      ? input.whatsapp_number.replace(/\D/g, "")
      : cleanedPhone;

    // 2. Validate all required fields before database call
    const businessNameClean = (input.business_name ?? "").trim();
    const ownerNameClean = (input.owner_name ?? "").trim();
    const emailClean = (input.email ?? "").trim();
    const cityClean = (input.city ?? "").trim();

    // Check if it's the full onboarding registration wizard or simple form
    const isFullOnboarding = Boolean(
      input.office_address_line1 || 
      input.whatsapp_number || 
      input.office_state || 
      input.office_pincode
    );

    if (!businessNameClean || !ownerNameClean || cleanedPhone.length !== 10 || !cityClean) {
      return {
        ok: false,
        code: "VALIDATION",
        error: "Some required details are missing. Please go back and complete the highlighted fields.",
      };
    }

    if (isFullOnboarding) {
      const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean);
      const pincodeClean = (input.office_pincode ?? "").replace(/\D/g, "");

      if (
        cleanedWhatsapp.length !== 10 ||
        !emailClean ||
        !isEmailValid ||
        !input.office_address_line1?.trim() ||
        !input.office_state?.trim() ||
        pincodeClean.length !== 6
      ) {
        return {
          ok: false,
          code: "VALIDATION",
          error: "Some required details are missing. Please go back and complete the highlighted fields.",
        };
      }
    }

    // Exact column set written to public.vendors (matches the onboarding wizard).
    // Status/consent defaults are forced here regardless of input.
    const payload = {
      business_name: businessNameClean,
      owner_name: ownerNameClean,
      phone: cleanedPhone,
      whatsapp_number: cleanedWhatsapp || null,
      email: emailClean || null,
      city: cityClean,
      // Detailed office / business address (migration 011).
      office_address_line1: input.office_address_line1 ?? null,
      office_address_line2: input.office_address_line2 ?? null,
      office_landmark: input.office_landmark ?? null,
      office_city: input.office_city ?? cityClean,
      office_state: input.office_state ?? null,
      office_pincode: input.office_pincode ?? null,
      office_latitude: input.office_latitude ?? null,
      office_longitude: input.office_longitude ?? null,
      areas_covered: input.areas_covered ?? [],
      covers_full_city: input.covers_full_city ?? false,
      service_categories: input.service_categories ?? [],
      experience: input.experience ?? null,
      portfolio_urls: input.portfolio_urls ?? [],
      gst_number: input.gst_number ?? null,
      message: input.message ?? null,
      location_permission_status: input.location_permission_status ?? "not_requested",
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      service_radius_km: input.service_radius_km ?? 20,
      business_type: input.business_type ?? null,
      team_size: input.team_size ?? null,
      monthly_capacity: input.monthly_capacity ?? null,
      starting_price: input.starting_price ?? null,
      status: "Pending",
      verification_status: "Pending",
      paid_status: "Unpaid",
      is_active: true,
      public_visibility: false,
      source_url: input.source_url ?? null,
      utm_source: input.utm_source ?? null,
      utm_medium: input.utm_medium ?? null,
      utm_campaign: input.utm_campaign ?? null,
      // Kept for the account-linked registration path (FK to profiles); null for
      // the public application wizard.
      user_id: input.user_id ?? null,
    };

    if (process.env.NODE_ENV === "development") {
      console.log("Supabase URL exists:", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL));
      console.log("Supabase Anon Key exists:", Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
      console.log("Supabase Service Role Key exists:", Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));
      console.log("Vendor payload:", payload);
    }

    // Single insert with the full payload
    const { data, error } = await adminClient()
      .from("vendors")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("Vendor insert error:", error);
      if (process.env.NODE_ENV === "development") {
        console.log("Supabase Error Details:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
      }
      logSupabaseInsertError("vendors", error, {
        has_user_id: Boolean(input.user_id),
        has_email: Boolean(input.email),
        service_count: input.service_categories?.length ?? 0,
        area_count: input.areas_covered?.length ?? 0,
      });

      // Map database error code to distinct readable message
      const errMsg = String(error.message ?? "").toLowerCase();
      let friendlyError = "Unable to submit right now. Please check your internet connection and try again.";

      if (errMsg.includes("fetch failed") || errMsg.includes("network error") || errMsg.includes("typeerror")) {
        friendlyError = "Unable to submit right now. Please check your internet connection and try again.";
      } else if (error.code === "23505") {
        friendlyError = "This business email or phone number is already registered. Please use another number or contact QuickFurno.";
      } else if (error.code === "23502") {
        friendlyError = "Some required details are missing. Please go back and complete the highlighted fields.";
      } else if (error.code === "42703") {
        friendlyError = "We could not save your application due to a system configuration issue. Please contact QuickFurno support.";
      } else if (error.code && (error.code.startsWith("08") || error.code === "P0001")) {
        friendlyError = "Network issue while submitting. Please try again.";
      } else if (error.code) {
        // Any other database error code indicates a schema/constraint issue
        friendlyError = "We could not save your application due to a system configuration issue. Please contact QuickFurno support.";
      }

      return {
        ok: false,
        code: error.code || "DB_ERROR",
        error: friendlyError,
      };
    }
    return ok({ id: data!.id });
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    const message = (e as { message?: string })?.message ?? "Unknown error";
    const errMsg = message.toLowerCase();
    
    let friendlyError = "Unable to submit right now. Please check your internet connection and try again.";
    if (errMsg.includes("fetch failed") || errMsg.includes("network error") || errMsg.includes("typeerror")) {
      friendlyError = "Unable to submit right now. Please check your internet connection and try again.";
    } else {
      friendlyError = "We could not save your application due to a system configuration issue. Please contact QuickFurno support.";
    }

    return {
      ok: false,
      code: "UNKNOWN",
      error: friendlyError,
    };
  }
}

/** Recompute and persist a vendor's public visibility (approved+active+credits+pack). */
export async function updateVendorVisibility(vendorId: string): Promise<Result<null>> {
  try {
    const { error } = await adminClient().rpc("update_vendor_visibility", { p_vendor_id: vendorId });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function getVendorDashboardStats(vendorId: string): Promise<Result<VendorDashboardStats>> {
  try {
    const db = adminClient();
    const [vendor, assignments, reports] = await Promise.all([
      db.from("vendors").select("total_credits, remaining_credits").eq("id", vendorId).single(),
      db.from("lead_assignments").select("vendor_status").eq("vendor_id", vendorId),
      db.from("bad_lead_reports").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
    ]);
    if (vendor.error) throw vendor.error;

    const rows = assignments.data ?? [];
    const count = (s: VendorLeadStatus) => rows.filter((r: { vendor_status: string }) => r.vendor_status === s).length;

    return ok({
      total_credits: vendor.data.total_credits,
      remaining_credits: vendor.data.remaining_credits,
      total_leads: rows.length,
      won: count("Won"),
      lost: count("Lost"),
      in_progress: rows.length - count("Won") - count("Lost"),
      bad_lead_reports: reports.count ?? 0,
    });
  } catch (e) {
    return fail(e);
  }
}

/** Leads assigned to a vendor, newest first. Client contact is returned only for paid, active, approved vendors. */
export async function getVendorAssignedLeads(vendorId: string): Promise<Result<unknown[]>> {
  try {
    const contactEligible = await canVendorViewLeadContact(vendorId);
    if (!contactEligible.ok) return contactEligible;

    const leadSelect = contactEligible.data
      ? "id, name, phone, city, area, service_required, budget, property_type, timeline, message, created_at"
      : "id, name, city, area, service_required, budget, property_type, timeline, message, created_at";

    const { data, error } = await adminClient()
      .from("lead_assignments")
      .select(`
        id, assigned_at, assignment_type, vendor_status, is_bad_lead_reported,
        lead:leads ( ${leadSelect} )
      `)
      .eq("vendor_id", vendorId)
      .order("assigned_at", { ascending: false });
    if (error) throw error;
    return ok(data ?? []);
  } catch (e) {
    return fail(e);
  }
}

/** Vendor updates their pipeline status for a lead + logs it to the timeline. */
export async function updateVendorLeadStatus(
  vendorId: string, assignmentId: string, status: VendorLeadStatus, notes?: string
): Promise<Result<null>> {
  try {
    const db = adminClient();
    const { data: a, error: aErr } = await db
      .from("lead_assignments")
      .select("id, vendor_id")
      .eq("id", assignmentId)
      .eq("vendor_id", vendorId)
      .single();
    if (aErr || !a) throw appError("UNKNOWN");

    const { error: upErr } = await db
      .from("lead_assignments").update({ vendor_status: status }).eq("id", assignmentId);
    if (upErr) throw upErr;

    const { error: statusErr } = await db.from("lead_status_updates").insert({
      lead_assignment_id: assignmentId, vendor_id: a.vendor_id, status, notes: notes ?? null,
    });
    if (statusErr) {
      logSupabaseInsertError("lead_status_updates", statusErr, {
        assignment_id: assignmentId,
        vendor_id: a.vendor_id,
        status,
      });
      throw statusErr;
    }
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** Report a bad lead — only within app_settings.bad_lead_report_window_hours. */
export async function reportBadLead(
  vendorId: string,
  assignmentId: string,
  reportType: string,
  reportReason: string,
  vendorComment: string,
): Promise<Result<{ id: string }>> {
  try {
    const type = reportType.trim();
    const reason = reportReason.trim();
    const comment = vendorComment.trim();
    if (!type || !reason || !comment) throw appError("VALIDATION");

    const db = adminClient();

    const { data: a, error: aErr } = await db
      .from("lead_assignments")
      .select("id, vendor_id, assigned_at")
      .eq("id", assignmentId)
      .eq("vendor_id", vendorId)
      .single();
    if (aErr || !a) throw appError("UNKNOWN");

    const { data: windowH } = await db.rpc("get_setting_int", {
      p_key: "bad_lead_report_window_hours", p_default: 24,
    });
    const ageHours = (Date.now() - new Date(a.assigned_at).getTime()) / 36e5;
    if (ageHours > Number(windowH ?? 24)) throw appError("REPORT_WINDOW_CLOSED");

    const { data, error } = await db
      .from("bad_lead_reports")
      .insert({
        lead_assignment_id: assignmentId, vendor_id: a.vendor_id,
        reason, description: comment, report_type: type, report_reason: reason, vendor_comment: comment, status: "Pending",
        credit_restored: false,
      })
      .select("id")
      .single();
    if (error) {
      logSupabaseInsertError("bad_lead_reports", error, {
        assignment_id: assignmentId,
        vendor_id: a.vendor_id,
        has_description: Boolean(comment),
      });
      throw error;
    }

    await db.from("lead_assignments").update({ is_bad_lead_reported: true }).eq("id", assignmentId);
    return ok({ id: data.id });
  } catch (e) {
    return fail(e);
  }
}

// Phase 26A-2C: structured vendor lead-issue reasons. Codes are machine-
// readable so later WhatsApp/AI automation can follow up with the client.
export const LEAD_REPORT_REASONS = [
  { code: "client_not_reachable", label: "Client not reachable after multiple attempts", commentRequired: false },
  { code: "requirement_already_closed", label: "Client says requirement is already closed", commentRequired: false },
  { code: "service_mismatch", label: "Client requirement does not match selected service", commentRequired: true },
  { code: "outside_service_area", label: "Client location is outside my service area", commentRequired: true },
  { code: "invalid_wrong_phone", label: "Invalid or wrong phone number", commentRequired: true },
  { code: "other", label: "Other reason", commentRequired: true },
] as const;

export type LeadReportReasonCode = (typeof LEAD_REPORT_REASONS)[number]["code"];

const REPORT_COMMENT_MIN = 20;

/**
 * Structured vendor lead-issue report. Never refunds/removes credit, never
 * removes the assignment, never auto-reassigns, never sends WhatsApp. One
 * active report per assignment is enforced in-service (plus a DB partial
 * unique index when migration 031 is applied).
 */
export async function submitStructuredLeadReport(
  vendorId: string,
  assignmentId: string,
  reasonCode: string,
  comment?: string,
): Promise<Result<{ id: string }>> {
  try {
    const reason = LEAD_REPORT_REASONS.find((r) => r.code === reasonCode);
    if (!reason) throw appError("VALIDATION");
    const trimmed = (comment ?? "").trim();
    if (reason.commentRequired && trimmed.length < REPORT_COMMENT_MIN) throw appError("VALIDATION");

    const db = adminClient();
    const { data: a, error: aErr } = await db
      .from("lead_assignments")
      .select("id, vendor_id, is_bad_lead_reported")
      .eq("id", assignmentId)
      .eq("vendor_id", vendorId)
      .single();
    if (aErr || !a) throw appError("UNKNOWN");

    // Duplicate-report guard: one active report per assignment.
    const { data: existing } = await db
      .from("bad_lead_reports")
      .select("id, status")
      .eq("lead_assignment_id", assignmentId)
      .in("status", ["Pending", "Under Review"])
      .limit(1);
    if ((existing ?? []).length > 0 || a.is_bad_lead_reported) {
      return { ok: false, code: "REPORT_EXISTS", error: "You already have an active report for this lead under admin review." };
    }

    const base = {
      lead_assignment_id: assignmentId,
      vendor_id: a.vendor_id,
      reason: reason.label,
      description: trimmed || null,
      report_type: reason.code,
      report_reason: reason.label,
      vendor_comment: trimmed || null,
      status: "Pending",
      credit_restored: false,
    };

    // Prefer the structured columns; fall back gracefully if migration 031
    // (reason_code / reason_label) has not been applied on this database.
    let inserted = await db.from("bad_lead_reports").insert({ ...base, reason_code: reason.code, reason_label: reason.label }).select("id").single();
    if (inserted.error && /reason_code|reason_label|column/i.test(inserted.error.message ?? "")) {
      inserted = await db.from("bad_lead_reports").insert(base).select("id").single();
    }
    if (inserted.error) {
      logSupabaseInsertError("bad_lead_reports", inserted.error, { assignment_id: assignmentId, vendor_id: a.vendor_id, reason_code: reason.code });
      throw inserted.error;
    }

    await db.from("lead_assignments").update({ is_bad_lead_reported: true }).eq("id", assignmentId);
    return ok({ id: inserted.data.id });
  } catch (e) {
    return fail(e);
  }
}

async function canVendorViewLeadContact(vendorId: string): Promise<Result<boolean>> {
  try {
    const { data, error } = await adminClient()
      .from("vendors")
      .select("status, is_active, paid_status")
      .eq("id", vendorId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw appError("UNKNOWN");

    const status = String((data as any).status ?? "").toLowerCase();
    const paidStatus = String((data as any).paid_status ?? "").toLowerCase();
    return ok(status === "approved" && (data as any).is_active !== false && paidStatus === "paid");
  } catch (e) {
    return fail(e);
  }
}
