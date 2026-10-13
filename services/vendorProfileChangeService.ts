// ============================================================================
// QuickFurno - services/vendorProfileChangeService.ts
// Approval-only public profile changes. Vendors create requests; admins approve
// or reject. Only approved requests update whitelisted public fields.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import { createVendorNotification } from "./vendorNotificationService";
import { backfillVendorExactLocation, type VendorLocationBackfillInput } from "./adminVendorLocationService";
import { normalizeCoordinate } from "../lib/geo/canonicalCoordinate";

export type VendorProfileChangeInput = {
  public_business_name?: string;
  public_description?: string;
  public_category?: string;
  services_offered?: string[];
  starting_price?: string;
  business_hours?: string;
  service_area_summary?: string;
  profile_image_url?: string;
  cover_image_url?: string;
  portfolio_image_urls?: string[];
};

export type VendorProfileChangeRequest = {
  id: string;
  vendor_id: string;
  requested_by: string | null;
  request_type: string | null;
  proposed_changes: Record<string, unknown>;
  current_snapshot: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  admin_notes: string | null;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VendorApprovedProfileSummary = {
  business_name: string | null;
  public_description: string | null;
  selected_category: string | null;
  service_categories: string[] | null;
  starting_price: string | null;
  public_business_hours: string | null;
  public_service_area_summary: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  portfolio_urls: string[] | null;
};

const VENDOR_PUBLIC_SELECT = [
  "business_name",
  "public_description",
  "selected_category",
  "service_categories",
  "starting_price",
  "public_business_hours",
  "public_service_area_summary",
  "profile_image_url",
  "cover_image_url",
  "portfolio_urls",
].join(", ");

const ALLOWED_CATEGORIES = new Set([
  "Interior Designers",
  "Carpenters",
  "Modular Factory",
  "Premium Interiors",
  "Sofa",
  "Painter",
  "Civil Work",
  "False Ceiling",
]);

export async function getVendorApprovedProfileSummary(vendorId: string): Promise<Result<VendorApprovedProfileSummary>> {
  try {
    const { data, error } = await adminClient().from("vendors").select(VENDOR_PUBLIC_SELECT).eq("id", vendorId).maybeSingle();
    if (error) throw error;
    if (!data) throw appError("UNAUTHORIZED");
    return ok(data as unknown as VendorApprovedProfileSummary);
  } catch (e) {
    return fail(e);
  }
}

export async function listVendorProfileChangeRequests(vendorId: string): Promise<Result<VendorProfileChangeRequest[]>> {
  try {
    const { data, error } = await adminClient()
      .from("vendor_profile_change_requests")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok((data ?? []) as VendorProfileChangeRequest[]);
  } catch (e) {
    return fail(e);
  }
}

export async function listPendingVendorProfileChangeRequests(): Promise<Result<VendorProfileChangeRequest[]>> {
  try {
    const { data, error } = await adminClient()
      .from("vendor_profile_change_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    return ok((data ?? []) as VendorProfileChangeRequest[]);
  } catch (e) {
    return fail(e);
  }
}

/** Bounded single-count read for the Superadmin dashboard's approvals shortcut. */
export async function countPendingVendorProfileChangeRequests(): Promise<Result<number>> {
  try {
    const { count, error } = await adminClient()
      .from("vendor_profile_change_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return ok(count ?? 0);
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorProfileChangeRequest(
  vendorId: string,
  requestedBy: string | null,
  input: VendorProfileChangeInput,
): Promise<Result<VendorProfileChangeRequest>> {
  try {
    const proposed = sanitizeProfileInput(input);
    if (Object.keys(proposed).length === 0) throw appError("VALIDATION");

    const summary = await getVendorApprovedProfileSummary(vendorId);
    if (!summary.ok) return fail(summary.error);

    const { data, error } = await adminClient()
      .from("vendor_profile_change_requests")
      .insert({
        vendor_id: vendorId,
        requested_by: requestedBy,
        request_type: "profile_update",
        proposed_changes: proposed,
        current_snapshot: summary.data,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) throw error;
    return ok(data as VendorProfileChangeRequest);
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorOfficeLocationChangeRequest(
  vendorId: string,
  requestedBy: string,
  input: VendorLocationBackfillInput,
): Promise<Result<VendorProfileChangeRequest>> {
  try {
    if (!requestedBy || !/^[0-9a-f-]{36}$/i.test(vendorId)) throw appError("UNAUTHORIZED");
    const placeId = typeof input.google_place_id === "string" ? input.google_place_id.trim() : "";
    const googleCity = typeof input.google_city === "string" ? input.google_city.trim() : "";
    const address = typeof input.formatted_address === "string" ? input.formatted_address.trim() : "";
    const point = normalizeCoordinate(input.latitude, input.longitude);
    if (!/^[A-Za-z0-9_-]{8,300}$/.test(placeId) ||
        !googleCity || googleCity.length > 200 ||
        !address || address.length > 1000 || !point) throw appError("VALIDATION");

    const db = adminClient();
    const { data: vendor, error: vendorError } = await db.from("vendors")
      .select("id,city,office_latitude,office_longitude,google_place_id,location_verification_status")
      .eq("id", vendorId).maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) throw appError("UNAUTHORIZED");

    // Only one outstanding office request per vendor. Do not adopt a profile
    // update or mutate the existing Core vendor while the request is pending.
    const { data: existing, error: existingError } = await db.from("vendor_profile_change_requests")
      .select("id").eq("vendor_id", vendorId).eq("request_type", "office_location_change")
      .eq("status", "pending").limit(1);
    if (existingError) throw existingError;
    if (existing?.length) throw appError("VALIDATION");

    const { data, error } = await db.from("vendor_profile_change_requests").insert({
      vendor_id: vendorId,
      requested_by: requestedBy,
      request_type: "office_location_change",
      proposed_changes: {
        google_place_id: placeId,
        google_city: googleCity,
        formatted_address: address,
        latitude: point.latitude,
        longitude: point.longitude,
      },
      current_snapshot: {
        google_place_id: vendor.google_place_id ?? null,
        office_latitude: vendor.office_latitude ?? null,
        office_longitude: vendor.office_longitude ?? null,
        location_verification_status: vendor.location_verification_status ?? null,
      },
      status: "pending",
    }).select("*").single();
    if (error) throw error;
    return ok(data as VendorProfileChangeRequest);
  } catch (error) {
    return fail(error);
  }
}

export async function approveVendorProfileChangeRequest(
  requestId: string,
  reviewedBy: string | null,
  adminNotes?: string,
): Promise<Result<VendorProfileChangeRequest>> {
  try {
    const db = adminClient();
    const { data: request, error: requestError } = await db
      .from("vendor_profile_change_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pending")
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request) throw appError("UNKNOWN");

    if (request.request_type === "office_location_change") {
      // A Google Place Details lookup and a vendor write are NOT a single
      // transaction with this change request. No env flag may turn an
      // unverified, split-write office flow into an approval authority.
      // Only a future signed, atomic, provider-proven Core RPC can unlock it.
      throw appError("VALIDATION");
    } else if (request.request_type === "profile_update") {
      // One Core transaction, not a vendor write followed by an independently
      // fallible status write. Locks the request+vendor, verifies immutable
      // submit-time snapshot, validates the field allowlist, applies exactly
      // once and commits the approval atomically. No missing-RPC fallback.
      if (!reviewedBy) throw appError("UNAUTHORIZED");
      const { data, error } = await db.rpc("qf_approve_vendor_profile_update_v3", {
        p_request_id: requestId,
        p_admin_id: reviewedBy,
        p_notes: adminNotes?.trim() || null,
      });
      if (error) throw error;
      if (!data || data.status !== "approved") throw appError("UNKNOWN");
      await createVendorNotification(request.vendor_id, {
        title: "Profile changes approved",
        message: "Your public profile changes were approved and are now live.",
        type: "profile",
        priority: "normal",
        cta_label: "View profile",
        cta_url: "/vendor/dashboard/profile",
      }).catch(() => undefined);
      return ok(data as VendorProfileChangeRequest);
    } else {
      throw appError("VALIDATION");
    }

    // Google office verification currently delegates to Core's guarded
    // Place-ID authority. Until an atomic external-proof finalization exists,
    // do not let this path bypass the approved status compare-and-swap.
    const { data, error } = await db
      .from("vendor_profile_change_requests")
      .update({
        status: "approved",
        admin_notes: adminNotes?.trim() || null,
        rejection_reason: null,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw error;

    await createVendorNotification(request.vendor_id, {
      title: request.request_type === "office_location_change" ? "Office location verified" : "Profile changes approved",
      message: request.request_type === "office_location_change"
        ? "Your Google-selected business location has passed Core verification. Lead acceptance requires separate approval and available credits."
        : "Your public profile changes were approved and are now live.",
      type: "profile",
      priority: "normal",
      cta_label: "View profile",
      cta_url: "/vendor/dashboard/profile",
    });
    return ok(data as VendorProfileChangeRequest);
  } catch (e) {
    return fail(e);
  }
}

export async function rejectVendorProfileChangeRequest(
  requestId: string,
  reviewedBy: string | null,
  rejectionReason: string,
): Promise<Result<VendorProfileChangeRequest>> {
  try {
    const reason = rejectionReason.trim();
    if (!reason) throw appError("VALIDATION");

    const db = adminClient();
    const { data: current, error: currentError } = await db
      .from("vendor_profile_change_requests")
      .select("vendor_id")
      .eq("id", requestId)
      .eq("status", "pending")
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw appError("UNKNOWN");

    const { data, error } = await db
      .from("vendor_profile_change_requests")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw error;

    // The review transaction has committed; notification is a best-effort
    // side effect and must never turn a successful rejection into an apparent
    // failure that encourages a confusing/replayed operator action.
    await createVendorNotification(current.vendor_id, {
      title: "Profile changes rejected",
      message: reason,
      type: "profile",
      priority: "normal",
      cta_label: "View request",
      cta_url: "/vendor/dashboard/profile",
    }).catch(() => undefined);
    return ok(data as VendorProfileChangeRequest);
  } catch (e) {
    return fail(e);
  }
}

function sanitizeProfileInput(input: VendorProfileChangeInput): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  setText(output, "public_business_name", input.public_business_name, 100);
  setText(output, "public_description", input.public_description, 700);
  setText(output, "public_category", ALLOWED_CATEGORIES.has(input.public_category ?? "") ? input.public_category : "", 80);
  setText(output, "starting_price", input.starting_price, 80);
  setText(output, "business_hours", input.business_hours, 140);
  setText(output, "service_area_summary", input.service_area_summary, 220);
  setSafeUrl(output, "profile_image_url", input.profile_image_url);
  setSafeUrl(output, "cover_image_url", input.cover_image_url);
  setTextArray(output, "services_offered", input.services_offered, 12, 80);
  setUrlArray(output, "portfolio_image_urls", input.portfolio_image_urls, 12);
  return output;
}

function mapApprovedChangesToVendorUpdate(changes: Record<string, unknown>) {
  const update: Record<string, unknown> = {};
  if ("public_business_name" in changes) update.business_name = changes.public_business_name;
  if ("public_description" in changes) update.public_description = changes.public_description;
  if ("public_category" in changes) update.selected_category = changes.public_category;
  if ("services_offered" in changes) update.service_categories = changes.services_offered;
  if ("starting_price" in changes) update.starting_price = changes.starting_price;
  if ("business_hours" in changes) update.public_business_hours = changes.business_hours;
  if ("service_area_summary" in changes) update.public_service_area_summary = changes.service_area_summary;
  if ("profile_image_url" in changes) update.profile_image_url = changes.profile_image_url;
  if ("cover_image_url" in changes) update.cover_image_url = changes.cover_image_url;
  if ("portfolio_image_urls" in changes) update.portfolio_urls = changes.portfolio_image_urls;
  return update;
}

function setText(output: Record<string, unknown>, key: string, value: unknown, maxLength: number) {
  if (typeof value !== "string") return;
  const cleaned = value.trim().slice(0, maxLength);
  if (cleaned) output[key] = cleaned;
}

function setSafeUrl(output: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value !== "string") return;
  const cleaned = value.trim();
  if (!cleaned) return;
  if (cleaned.startsWith("/") || /^https?:\/\//i.test(cleaned)) output[key] = cleaned.slice(0, 500);
}

function setTextArray(output: Record<string, unknown>, key: string, value: unknown, maxItems: number, maxLength: number) {
  const items = toArray(value).map((item) => item.slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
  if (items.length) output[key] = items;
}

function setUrlArray(output: Record<string, unknown>, key: string, value: unknown, maxItems: number) {
  const items = toArray(value)
    .filter((item) => item.startsWith("/") || /^https?:\/\//i.test(item))
    .map((item) => item.slice(0, 500))
    .slice(0, maxItems);
  if (items.length) output[key] = items;
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(toArray);
  if (typeof value !== "string") return [];
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}
