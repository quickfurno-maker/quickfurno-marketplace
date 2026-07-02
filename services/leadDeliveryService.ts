// ============================================================================
// QuickFurno - services/leadDeliveryService.ts
// Dashboard delivery and preview/log creation for auto-matched leads.
// No live WhatsApp sends are performed here.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";

export type DeliveredVendor = {
  vendor_id: string;
  assignment_id: string;
  credits_before?: number | null;
  credits_after?: number | null;
};

export type LeadAssignmentDeliveryResult = {
  status: string;
  lead_id: string;
  assigned: DeliveredVendor[];
  skipped: string[];
  assigned_count: number;
};

type LeadPreviewRow = {
  id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  area: string | null;
  service_required: string | null;
  budget: string | null;
  timeline: string | null;
};

type VendorPreviewRow = {
  id: string;
  business_name: string | null;
  city: string | null;
  service_categories: string[] | null;
  rating: number | null;
  completed_projects: number | null;
};

export async function assignLeadToMatchedVendors(leadId: string, vendorIds: string[]): Promise<Result<LeadAssignmentDeliveryResult>> {
  try {
    if (!leadId || vendorIds.length > 3) throw appError("VALIDATION");

    const { data, error } = await adminClient().rpc("assign_lead_to_paid_vendors_phase26a", {
      p_lead_id: leadId,
      p_vendor_ids: vendorIds,
    });
    if (error) {
      if (isMissingRpcError(error)) {
        return {
          ok: false,
          code: "MIGRATION_NOT_APPLIED",
          error:
            "assign_lead_to_paid_vendors_phase26a is missing on this database. Apply migration 20260701000027_phase26a_auto_lead_matching_foundation.sql.",
        };
      }
      throw error;
    }

    const result = normalizeAssignmentResult(data, leadId);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}

export async function deliverLeadToVendorDashboard(
  leadId: string,
  vendorId: string,
  assignmentId: string,
  opts: { assignmentSource?: string } = {},
): Promise<Result<null>> {
  try {
    const { error } = await adminClient().from("lead_delivery_logs").insert({
      lead_id: leadId,
      vendor_id: vendorId,
      assignment_id: assignmentId,
      delivery_channel: "vendor_dashboard",
      delivery_status: "delivered",
      contact_shared: true,
      credit_deducted: true,
      whatsapp_status: "preview_only",
      ...(opts.assignmentSource ? { assignment_source: opts.assignmentSource } : {}),
    });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorLeadWhatsappPreview(
  leadId: string,
  vendorId: string,
  assignmentId: string,
  opts: { assignmentSource?: string } = {},
): Promise<Result<null>> {
  try {
    const [leadResult, vendorResult] = await Promise.all([
      adminClient()
        .from("leads")
        .select("id, name, phone, city, area, service_required, budget, timeline")
        .eq("id", leadId)
        .maybeSingle(),
      adminClient().from("vendors").select("id, business_name").eq("id", vendorId).maybeSingle(),
    ]);
    if (leadResult.error) throw leadResult.error;
    if (vendorResult.error) throw vendorResult.error;
    if (!leadResult.data) throw appError("LEAD_NOT_FOUND");

    const lead = leadResult.data as LeadPreviewRow;
    const vendorName = String((vendorResult.data as { business_name?: string | null } | null)?.business_name ?? "vendor");
    const message = [
      `Preview only: New QuickFurno lead for ${vendorName}.`,
      `${lead.name ?? "Client"} needs ${lead.service_required ?? "a service"} in ${[lead.area, lead.city].filter(Boolean).join(", ") || "their city"}.`,
      `Phone: ${lead.phone ?? "available in dashboard"}.`,
      "No live WhatsApp was sent. Open /vendor/dashboard/leads to respond.",
    ].join(" ");

    const { error } = await adminClient().from("lead_delivery_logs").insert({
      lead_id: leadId,
      vendor_id: vendorId,
      assignment_id: assignmentId,
      delivery_channel: "whatsapp_preview",
      delivery_status: "preview_created",
      contact_shared: true,
      credit_deducted: false,
      whatsapp_preview_message: message,
      whatsapp_status: "preview_only",
      ...(opts.assignmentSource ? { assignment_source: opts.assignmentSource } : {}),
    });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function createClientAssignedVendorsPreview(
  leadId: string,
  deliveredVendors: DeliveredVendor[],
): Promise<Result<null>> {
  try {
    const vendorIds = deliveredVendors.map((vendor) => vendor.vendor_id).filter(Boolean);
    let vendorSnapshot: VendorPreviewRow[] = [];

    if (vendorIds.length > 0) {
      const { data, error } = await adminClient()
        .from("vendors")
        .select("id, business_name, city, service_categories, rating, completed_projects")
        .in("id", vendorIds);
      if (error) throw error;
      vendorSnapshot = (data ?? []) as VendorPreviewRow[];
    }

    const message = vendorSnapshot.length > 0
      ? `Preview only: ${vendorSnapshot.length} verified QuickFurno vendor${vendorSnapshot.length === 1 ? "" : "s"} assigned to this enquiry. No live WhatsApp was sent.`
      : "Preview only: Your enquiry is received. QuickFurno is waiting for eligible verified vendors before sharing your contact details.";

    const { error } = await adminClient().from("client_notification_logs").insert({
      lead_id: leadId,
      notification_type: vendorSnapshot.length > 0 ? "assigned_vendors_preview" : "waiting_for_vendors_preview",
      channel: "dashboard_preview",
      status: "preview_created",
      message,
      vendor_snapshot: vendorSnapshot,
      whatsapp_status: "preview_only",
    });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

function normalizeAssignmentResult(value: unknown, fallbackLeadId: string): LeadAssignmentDeliveryResult {
  const record = isRecord(value) ? value : {};
  const assigned = Array.isArray(record.assigned)
    ? record.assigned.flatMap((item) => {
        if (!isRecord(item)) return [];
        const vendorId = asText(item.vendor_id);
        const assignmentId = asText(item.assignment_id);
        if (!vendorId || !assignmentId) return [];
        return [{
          vendor_id: vendorId,
          assignment_id: assignmentId,
          credits_before: asNumber(item.credits_before),
          credits_after: asNumber(item.credits_after),
        }];
      })
    : [];

  const skipped = Array.isArray(record.skipped)
    ? record.skipped.map(String).filter(Boolean)
    : [];

  return {
    status: asText(record.status) ?? "unknown",
    lead_id: asText(record.lead_id) ?? fallbackLeadId,
    assigned,
    skipped,
    assigned_count: Number(record.assigned_count ?? assigned.length) || assigned.length,
  };
}

/** 42883 = Postgres undefined_function; PGRST202 = PostgREST function not in schema cache. */
function isMissingRpcError(error: { code?: string; message?: string }): boolean {
  if (error.code === "42883" || error.code === "PGRST202") return true;
  const message = error.message ?? "";
  return message.includes("assign_lead_to_paid_vendors_phase26a") && /does not exist|schema cache/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
