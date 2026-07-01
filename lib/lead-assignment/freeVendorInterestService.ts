import { createHash } from "crypto";
import { runSafeAgentEventPipeline } from "@/lib/aos/events/safeAgentEventPipeline";
import { fail, ok, type Result } from "@/lib/errors";
import { getVendorBySlug } from "@/lib/quickfurno-data";
import { adminClient } from "@/lib/supabase";
import { evaluateVendorLeadAssignmentEligibility } from "@/lib/vendors/vendorEligibility";
import { getVendorPublicVisibility } from "@/lib/vendors/vendorVisibility";
import { loadMarketplaceRuntimeSettings } from "@/lib/lead-assignment/runtimeSettings";

export const FREE_VENDOR_INTEREST_CLIENT_MESSAGE =
  "Request received. QuickFurno has registered your interest. Our team will help you connect with a suitable verified vendor shortly.";

export interface CaptureFreeVendorInterestInput {
  vendorId: string;
  leadId?: string | null;
  clientName?: string | null;
  clientPhone: string;
  city?: string | null;
  area?: string | null;
  category?: string | null;
  subcategory?: string | null;
  interestType?: string | null;
}

export interface FreeVendorProfileInterest {
  id: string;
  vendor_id: string;
  lead_id?: string | null;
  client_name?: string | null;
  client_phone_masked?: string | null;
  client_phone_hash?: string | null;
  city?: string | null;
  area?: string | null;
  category?: string | null;
  subcategory?: string | null;
  interest_type: string;
  status: string;
  vendor_notified: boolean;
  vendor_notified_at?: string | null;
  aos_event_id?: string | null;
  n8n_preview_called: boolean;
  unlocked_after_payment: boolean;
  admin_note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function captureFreeVendorInterest(
  input: CaptureFreeVendorInterestInput,
): Promise<Result<{ id: string; message: string; n8nPreviewCalled: boolean }>> {
  try {
    const vendorId = (input.vendorId ?? "").trim();
    const digits = normalizeClientPhone(input.clientPhone);
    if (!vendorId || digits.length < 10) {
      return { ok: false, code: "VALIDATION", error: "Please enter a valid phone number." };
    }

    const settings = await loadMarketplaceRuntimeSettings();
    if (!settings.allow_free_vendor_interest_capture) {
      return { ok: false, code: "VALIDATION", error: "Interest capture is currently disabled." };
    }

    const vendor = await loadVendorForInterest(vendorId);
    if (!vendor) return { ok: false, code: "UNKNOWN", error: "Vendor not found." };

    const visibility = getVendorPublicVisibility(vendor, settings);
    if (!visibility.isPubliclyVisible) {
      return { ok: false, code: "VALIDATION", error: "This vendor profile is not currently available." };
    }

    const leadContext = {
      id: input.leadId ?? null,
      city: input.city ?? null,
      area: input.area ?? null,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
    };
    const assignmentEligibility = evaluateVendorLeadAssignmentEligibility(vendor, leadContext, settings);
    if (assignmentEligibility.eligible) {
      return { ok: false, code: "VALIDATION", error: "This vendor can receive normal verified lead suggestions." };
    }

    const masked = maskClientPhone(digits);
    const phoneHash = hashClientPhone(digits);
    const now = new Date().toISOString();
    const { data, error } = await adminClient()
      .from("free_vendor_profile_interests")
      .insert({
        vendor_id: vendorId,
        lead_id: input.leadId ?? null,
        client_name: normalizeText(input.clientName),
        client_phone_masked: masked,
        client_phone_hash: phoneHash,
        city: normalizeText(input.city),
        area: normalizeText(input.area),
        category: normalizeText(input.category),
        subcategory: normalizeText(input.subcategory),
        interest_type: normalizeText(input.interestType) ?? "profile_contact_request",
        status: "interest_captured",
        vendor_notified: false,
        n8n_preview_called: false,
        unlocked_after_payment: false,
        updated_at: now,
      })
      .select("id")
      .single();
    if (error || !data?.id) throw error ?? new Error("Could not capture interest.");

    const interestId = String(data.id);
    const profileEvent = await runSafeAgentEventPipeline({
      eventType: "vendor.profile_interest_captured",
      vendorId,
      leadId: input.leadId ?? null,
      source: "phase-25a-free-vendor-interest",
      data: {
        interestId,
        vendorId,
        clientPhoneMasked: masked,
        city: input.city ?? null,
        area: input.area ?? null,
        category: input.category ?? null,
        subcategory: input.subcategory ?? null,
        assignmentEligibility,
      },
    });

    let n8nPreviewCalled = Boolean(profileEvent.n8nWebhookCalled);
    if (settings.notify_free_vendor_recharge_interest) {
      const rechargeEvent = await runSafeAgentEventPipeline({
        eventType: "vendor.recharge_prompt_preview",
        vendorId,
        leadId: input.leadId ?? null,
        source: "phase-25a-free-vendor-recharge-preview",
        data: {
          interestId,
          vendorId,
          reason: "free_vendor_interest_captured",
          clientPhoneMasked: masked,
        },
      });
      n8nPreviewCalled = n8nPreviewCalled || Boolean(rechargeEvent.n8nWebhookCalled);
    }

    await adminClient()
      .from("free_vendor_profile_interests")
      .update({
        aos_event_id: `vendor.profile_interest_captured:${interestId}`,
        n8n_preview_called: n8nPreviewCalled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", interestId);

    return ok({ id: interestId, message: FREE_VENDOR_INTEREST_CLIENT_MESSAGE, n8nPreviewCalled });
  } catch (error) {
    return fail(error);
  }
}

export function maskClientPhone(phone: string): string {
  const digits = normalizeClientPhone(phone);
  if (digits.length < 4) return "****";
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length <= 4) return `${"*".repeat(local.length)}`;
  return `${local.slice(0, 2)}${"x".repeat(Math.max(2, local.length - 4))}${local.slice(-2)}`;
}

export function hashClientPhone(phone: string): string {
  return createHash("sha256").update(normalizeClientPhone(phone)).digest("hex");
}

export async function listFreeVendorInterests(): Promise<Result<FreeVendorProfileInterest[]>> {
  try {
    const { data, error } = await adminClient()
      .from("free_vendor_profile_interests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok((data ?? []).map(mapInterestRow));
  } catch (error) {
    return fail(error);
  }
}

export async function markInterestStatus(
  interestId: string,
  status: string,
  adminNote?: string | null,
): Promise<Result<FreeVendorProfileInterest>> {
  try {
    const id = (interestId ?? "").trim();
    const nextStatus = (status ?? "").trim();
    if (!id || !nextStatus) return { ok: false, code: "VALIDATION", error: "Interest id and status are required." };

    const { data, error } = await adminClient()
      .from("free_vendor_profile_interests")
      .update({
        status: nextStatus,
        admin_note: adminNote?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return ok(mapInterestRow(data));
  } catch (error) {
    return fail(error);
  }
}

async function loadVendorForInterest(vendorId: string): Promise<Record<string, unknown> | null> {
  const db = adminClient();
  const byId = await db.from("vendors").select("*").eq("id", vendorId).maybeSingle();
  if (byId.data) return byId.data as Record<string, unknown>;

  const staticVendor = getVendorBySlug(vendorId);
  if (!staticVendor) return null;
  return {
    id: staticVendor.slug,
    business_name: staticVendor.businessName,
    status: staticVendor.verified ? "Approved" : "Pending",
    is_active: staticVendor.status !== "inactive" && staticVendor.status !== "disabled",
    city: staticVendor.city,
    service_categories: [staticVendor.category, staticVendor.subCategory],
    package_status: staticVendor.activePaidPlan ? "active" : "none",
    paid_status: staticVendor.activePaidPlan ? "Paid" : "Unpaid",
    remaining_credits: staticVendor.activePaidPlan ? 1 : 0,
  };
}

function mapInterestRow(row: Record<string, unknown>): FreeVendorProfileInterest {
  return {
    id: String(row.id),
    vendor_id: String(row.vendor_id),
    lead_id: normalizeText(row.lead_id),
    client_name: normalizeText(row.client_name),
    client_phone_masked: normalizeText(row.client_phone_masked),
    client_phone_hash: normalizeText(row.client_phone_hash),
    city: normalizeText(row.city),
    area: normalizeText(row.area),
    category: normalizeText(row.category),
    subcategory: normalizeText(row.subcategory),
    interest_type: normalizeText(row.interest_type) ?? "profile_contact_request",
    status: normalizeText(row.status) ?? "interest_captured",
    vendor_notified: row.vendor_notified === true,
    vendor_notified_at: normalizeText(row.vendor_notified_at),
    aos_event_id: normalizeText(row.aos_event_id),
    n8n_preview_called: row.n8n_preview_called === true,
    unlocked_after_payment: row.unlocked_after_payment === true,
    admin_note: normalizeText(row.admin_note),
    created_at: normalizeText(row.created_at),
    updated_at: normalizeText(row.updated_at),
  };
}

function normalizeClientPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
