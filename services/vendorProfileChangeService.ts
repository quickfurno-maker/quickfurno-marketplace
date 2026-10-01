// ============================================================================
// QuickFurno - services/vendorProfileChangeService.ts
// Approval-only public profile changes. Vendors create requests; admins approve
// or reject. Only approved requests update whitelisted public fields.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import { createVendorNotification } from "./vendorNotificationService";
import { normalizeVendorOfficeEvidence } from "../lib/locations/locationEvidence";

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
  office_google_place_id?: string;
  office_formatted_address?: string;
  office_latitude?: number;
  office_longitude?: number;
  office_area_normalized?: string;
  office_sublocality?: string;
  office_neighborhood?: string;
  office_covers_full_city?: boolean;
  office_service_radius_km?: number;
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
  google_place_id: string | null;
  formatted_address: string | null;
  area_normalized: string | null;
  sublocality: string | null;
  neighborhood: string | null;
  office_latitude: number | null;
  office_longitude: number | null;
  covers_full_city: boolean | null;
  service_radius_km: number | null;
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
  "google_place_id",
  "formatted_address",
  "area_normalized",
  "sublocality",
  "neighborhood",
  "office_latitude",
  "office_longitude",
  "covers_full_city",
  "service_radius_km",
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

const LOCATION_CHANGE_KEYS = new Set([
  "office_google_place_id",
  "office_formatted_address",
  "office_latitude",
  "office_longitude",
  "office_area_normalized",
  "office_sublocality",
  "office_neighborhood",
  "office_covers_full_city",
  "office_service_radius_km",
]);

const SERVICE_RADIUS_OPTIONS = new Set([5, 10, 15, 20, 30, 50]);

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
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ok((data ?? []) as VendorProfileChangeRequest[]);
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

    const requestType = classifyProfileRequest(proposed);
    const currentSnapshot =
      requestType === "location_update"
        ? locationSnapshotFromSummary(summary.data)
        : summary.data;

    const { data, error } = await adminClient()
      .from("vendor_profile_change_requests")
      .insert({
        vendor_id: vendorId,
        requested_by: requestedBy,
        request_type: requestType,
        proposed_changes: proposed,
        current_snapshot: currentSnapshot,
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

    const proposed = sanitizeProfileInput((request.proposed_changes ?? {}) as VendorProfileChangeInput);
    const update = mapApprovedChangesToVendorUpdate(proposed);
    if (Object.keys(update).length > 0) {
      const { error: updateError } = await db.from("vendors").update(update).eq("id", request.vendor_id);
      if (updateError) throw updateError;
    }

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
      .select("*")
      .single();
    if (error) throw error;

    const locationOnly = request.request_type === "location_update";
    await createVendorNotification(request.vendor_id, {
      title: locationOnly ? "Business location approved" : "Profile changes approved",
      message: locationOnly
        ? "Your exact office location and service coverage were approved for matching."
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
      .select("*")
      .single();
    if (error) throw error;

    await createVendorNotification(current.vendor_id, {
      title: "Profile changes rejected",
      message: reason,
      type: "profile",
      priority: "normal",
      cta_label: "View request",
      cta_url: "/vendor/dashboard/profile",
    });
    return ok(data as VendorProfileChangeRequest);
  } catch (e) {
    return fail(e);
  }
}

function classifyProfileRequest(changes: Record<string, unknown>): string {
  const keys = Object.keys(changes);
  const hasLocation = keys.some((key) => LOCATION_CHANGE_KEYS.has(key));
  const hasPublicProfile = keys.some((key) => !LOCATION_CHANGE_KEYS.has(key));
  if (hasLocation && !hasPublicProfile) return "location_update";
  if (hasLocation && hasPublicProfile) return "profile_and_location_update";
  return "profile_update";
}

function locationSnapshotFromSummary(summary: VendorApprovedProfileSummary): Record<string, unknown> {
  return {
    office_formatted_address: summary.formatted_address,
    office_google_place_id: summary.google_place_id,
    office_latitude: summary.office_latitude,
    office_longitude: summary.office_longitude,
    office_area_normalized: summary.area_normalized,
    office_sublocality: summary.sublocality,
    office_neighborhood: summary.neighborhood,
    office_covers_full_city: summary.covers_full_city,
    office_service_radius_km: summary.service_radius_km,
  };
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

  const office = normalizeVendorOfficeEvidence({
    office_latitude: input.office_latitude,
    office_longitude: input.office_longitude,
    google_place_id: input.office_google_place_id,
    formatted_address: input.office_formatted_address,
    area_normalized: input.office_area_normalized,
    sublocality: input.office_sublocality,
    neighborhood: input.office_neighborhood,
  });
  const fullCity = input.office_covers_full_city === true;
  const radius = Number(input.office_service_radius_km ?? 0);
  const validCoverage = fullCity || SERVICE_RADIUS_OPTIONS.has(radius);

  if (office.verified && validCoverage) {
    output.office_formatted_address = office.formatted_address;
    output.office_google_place_id = office.google_place_id;
    output.office_latitude = office.office_latitude;
    output.office_longitude = office.office_longitude;
    output.office_area_normalized = office.area_normalized;
    output.office_sublocality = office.sublocality;
    output.office_neighborhood = office.neighborhood;
    output.office_covers_full_city = fullCity;
    output.office_service_radius_km = fullCity ? null : radius;
  }

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

  if ("office_google_place_id" in changes) {
    const office = normalizeVendorOfficeEvidence({
      office_latitude: changes.office_latitude as number | null | undefined,
      office_longitude: changes.office_longitude as number | null | undefined,
      google_place_id: changes.office_google_place_id as string | null | undefined,
      formatted_address: changes.office_formatted_address as string | null | undefined,
      area_normalized: changes.office_area_normalized as string | null | undefined,
      sublocality: changes.office_sublocality as string | null | undefined,
      neighborhood: changes.office_neighborhood as string | null | undefined,
    });
    const fullCity = changes.office_covers_full_city === true;
    const radius = Number(changes.office_service_radius_km ?? 0);
    const validCoverage = fullCity || SERVICE_RADIUS_OPTIONS.has(radius);

    if (office.verified && validCoverage) {
      update.google_place_id = office.google_place_id;
      update.formatted_address = office.formatted_address;
      update.area_normalized = office.area_normalized;
      update.sublocality = office.sublocality;
      update.neighborhood = office.neighborhood;
      update.office_latitude = office.office_latitude;
      update.office_longitude = office.office_longitude;
      update.covers_full_city = fullCity;
      update.service_radius_km = fullCity ? null : radius;
    }
  }

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
