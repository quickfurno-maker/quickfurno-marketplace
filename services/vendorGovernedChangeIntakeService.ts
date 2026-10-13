// Vendor OS V3 — intake ONLY for governed, non-public-profile changes.
// All proposed values are quarantined in the existing request table. No
// canonical vendor, Supabase Auth, zone, verification or wallet mutation here.
import "server-only";
import { adminClient } from "@/lib/supabase";
import { appError, fail, ok, type Result } from "@/lib/errors";
import { requireVendorScope } from "@/services/vendorAccessService";

export type GovernedVendorChangeFamily = "owner_contact_change" | "service_coverage_change";
export type GovernedVendorChangeInput = {
  family: GovernedVendorChangeFamily;
  owner_name?: string;
  email?: string;
  phone?: string;
  requested_city?: string;
  requested_categories?: string[];
};

const ALLOWED_CATEGORIES = new Set([
  "Interior Designers", "Carpenters", "Modular Factory",
  "Premium Interiors", "Sofa", "Painter", "Civil Work", "False Ceiling",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^\+[1-9][0-9]{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && v.length <= max ? v : null;
}

export function validateGovernedChange(input: GovernedVendorChangeInput):
  { family: GovernedVendorChangeFamily; proposed: Record<string, unknown>; fields: string[] } {
  const proposed: Record<string, unknown> = {};
  if (input.family === "owner_contact_change") {
    if (input.owner_name !== undefined) {
      const name = clean(input.owner_name, 100);
      if (!name) throw appError("VALIDATION");
      proposed.owner_name = name;
    }
    if (input.email !== undefined) {
      const email = clean(input.email, 254)?.toLowerCase();
      if (!email || !EMAIL.test(email)) throw appError("VALIDATION");
      proposed.email = email;
    }
    if (input.phone !== undefined) {
      const phone = clean(input.phone, 16);
      if (!phone || !PHONE.test(phone)) throw appError("VALIDATION");
      proposed.phone = phone;
    }
  } else if (input.family === "service_coverage_change") {
    const city = clean(input.requested_city, 100);
    const categories = input.requested_categories;
    if (!city || !Array.isArray(categories) || categories.length === 0 || categories.length > 8 ||
        categories.some(c => typeof c !== "string" || !ALLOWED_CATEGORIES.has(c)) ||
        new Set(categories).size !== categories.length) throw appError("VALIDATION");
    proposed.requested_city = city;
    proposed.requested_categories = categories;
    // The city is only a request. Core must independently validate supported
    // zones and matching coordinates before granting eligibility.
  } else {
    throw appError("VALIDATION");
  }
  if (Object.keys(proposed).length === 0) throw appError("VALIDATION");
  return { family: input.family, proposed, fields: Object.keys(proposed) };
}

export async function createGovernedVendorChangeRequest(
  vendorId: string,
  actorId: string,
  input: GovernedVendorChangeInput,
): Promise<Result<{ id: string; status: string; request_type: string }>> {
  try {
    if (!UUID.test(vendorId) || !UUID.test(actorId)) throw appError("UNAUTHORIZED");
    const validated = validateGovernedChange(input);
    const db = adminClient();
    // Double-check the authenticated owner in Core even though the caller
    // server action already resolves their vendor from the user session.
    const { data: vendor, error: vendorError } = await db.from("vendors")
      .select("id,user_id,owner_name,email,phone,city,service_categories,areas_covered")
      .eq("id", vendorId).eq("user_id", actorId).maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) throw appError("UNAUTHORIZED");

    const snapshot: Record<string, unknown> = {};
    for (const field of validated.fields) {
      if (field === "requested_city") snapshot.city = vendor.city ?? null;
      else if (field === "requested_categories") snapshot.service_categories = vendor.service_categories ?? null;
      else snapshot[field] = (vendor as Record<string, unknown>)[field] ?? null;
    }
    const { data, error } = await db.from("vendor_profile_change_requests").insert({
      vendor_id: vendorId,
      requested_by: actorId,
      request_type: validated.family,
      proposed_changes: validated.proposed,
      current_snapshot: snapshot,
      status: "pending",
    }).select("id,status,request_type").single();
    // DB unique index (V3 pending migration) is the concurrency authority.
    if (error) throw error;
    return ok(data as { id: string; status: string; request_type: string });
  } catch (error) {
    return fail(error);
  }
}
