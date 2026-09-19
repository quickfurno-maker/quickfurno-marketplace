import { adminClient } from "../lib/supabase";
import { AppError, fail, isMissingRelationError, ok, type Result } from "../lib/errors";
import {
  ADMIN_DIRECTORY_PAGE_SIZE,
  boundPage,
  pageRange,
  sanitizeFilterValue,
  sanitizeSearchTerm,
} from "../lib/adminPaging";

export type PublicVendorReview = {
  id: string;
  reviewerDisplayName: string;
  rating: number;
  reviewText: string;
  createdAt: string;
  category: string | null;
  city: string | null;
};

export type VendorReviewSummary = {
  averageRating: number | null;
  reviewCount: number;
  reviews: PublicVendorReview[];
};

export type VendorReviewStats = {
  averageRating: number | null;
  reviewCount: number;
};

export type SubmitVendorReviewInput = {
  vendorId: string;
  phone: string;
  rating: number;
  reviewText: string;
};

export type AdminReviewsQuery = {
  page?: unknown;
  status?: string;
  search?: string;
};

type DbRow = Record<string, any>;

const REVIEW_STATUSES = new Set(["pending", "approved", "rejected", "hidden"]);

function reviewError(code: string, message: string) {
  return new AppError(code, message);
}

function normalizeIndianPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(national) ? national : null;
}

function sanitizeReviewText(value: unknown): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length >= 20 && text.length <= 1000 ? text : null;
}

function reviewerDisplayName(value: unknown): string {
  const parts = String(value ?? "")
    .replace(/[^\p{L}\p{N} .'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!parts.length) return "QuickFurno client";
  if (parts.length === 1) return parts[0].slice(0, 40);
  const first = parts[0].slice(0, 40);
  const initial = parts[parts.length - 1].slice(0, 1).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

function asPublicReview(row: DbRow): PublicVendorReview {
  return {
    id: String(row.id),
    reviewerDisplayName: String(row.reviewer_display_name ?? "QuickFurno client"),
    rating: Number(row.rating),
    reviewText: String(row.review_text ?? ""),
    createdAt: String(row.created_at ?? ""),
    category: typeof row.category === "string" ? row.category : null,
    city: typeof row.city === "string" ? row.city : null,
  };
}

export async function getApprovedReviewStatsForVendors(
  vendorIds: string[],
): Promise<Map<string, VendorReviewStats>> {
  const ids = [...new Set(vendorIds.filter(Boolean))];
  const result = new Map<string, VendorReviewStats>();
  ids.forEach((id) => result.set(id, { averageRating: null, reviewCount: 0 }));
  if (!ids.length) return result;

  const { data, error } = await adminClient()
    .from("vendor_reviews")
    .select("vendor_id, rating")
    .in("vendor_id", ids)
    .eq("status", "approved")
    .limit(5000);

  if (error) {
    if (isMissingRelationError(error)) return result;
    throw error;
  }

  const totals = new Map<string, { sum: number; count: number }>();
  for (const row of data ?? []) {
    const id = String((row as DbRow).vendor_id ?? "");
    const rating = Number((row as DbRow).rating);
    if (!id || !Number.isFinite(rating)) continue;
    const current = totals.get(id) ?? { sum: 0, count: 0 };
    current.sum += rating;
    current.count += 1;
    totals.set(id, current);
  }

  for (const [id, total] of totals) {
    result.set(id, {
      averageRating: total.count ? Math.round((total.sum / total.count) * 10) / 10 : null,
      reviewCount: total.count,
    });
  }
  return result;
}

export async function getApprovedReviewsForVendor(
  vendorId: string,
  limit = 20,
): Promise<VendorReviewSummary> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit || 20)));
  const { data, error } = await adminClient()
    .from("vendor_reviews")
    .select("id, reviewer_display_name, rating, review_text, created_at, category, city")
    .eq("vendor_id", vendorId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    if (isMissingRelationError(error)) {
      return { averageRating: null, reviewCount: 0, reviews: [] };
    }
    throw error;
  }

  const reviews = (data ?? []).map((row) => asPublicReview(row as DbRow));
  const stats = await getApprovedReviewStatsForVendors([vendorId]);
  const summary = stats.get(vendorId) ?? { averageRating: null, reviewCount: 0 };
  return { ...summary, reviews };
}

export async function submitVerifiedVendorReview(
  input: SubmitVendorReviewInput,
): Promise<Result<{ reviewId: string; status: "pending" }>> {
  try {
    const vendorId = String(input.vendorId ?? "").trim();
    const phone = normalizeIndianPhone(input.phone);
    const rating = Number(input.rating);
    const reviewText = sanitizeReviewText(input.reviewText);

    if (!/^[0-9a-f-]{36}$/i.test(vendorId) || !phone || !Number.isInteger(rating) || rating < 1 || rating > 5 || !reviewText) {
      return fail(reviewError("REVIEW_VALIDATION", "Enter a valid phone number, 1–5 rating, and at least 20 characters of review text."));
    }

    const db = adminClient();
    const { data: vendor, error: vendorError } = await db
      .from("vendors")
      .select("id, status, is_active")
      .eq("id", vendorId)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor || String(vendor.status ?? "").toLowerCase() !== "approved" || vendor.is_active === false) {
      return fail(reviewError("REVIEW_VENDOR_UNAVAILABLE", "This vendor is not currently eligible for public reviews."));
    }

    const { data: leadRows, error: leadError } = await db
      .from("leads")
      .select("id, name, phone, city, category, service_required, created_at")
      .ilike("phone", `%${phone}%`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (leadError) throw leadError;

    const matchedLeads = (leadRows ?? []).filter((row: DbRow) => normalizeIndianPhone(row.phone) === phone);
    const leadIds = matchedLeads.map((row: DbRow) => String(row.id)).filter(Boolean);
    if (!leadIds.length) {
      return fail(reviewError("REVIEW_NOT_ELIGIBLE", "We could not verify a QuickFurno enquiry for this phone number."));
    }

    const { data: assignments, error: assignmentError } = await db
      .from("lead_assignments")
      .select("id, lead_id, assigned_at")
      .eq("vendor_id", vendorId)
      .in("lead_id", leadIds)
      .order("assigned_at", { ascending: false })
      .limit(50);
    if (assignmentError) throw assignmentError;

    const assignment = (assignments ?? [])[0] as DbRow | undefined;
    if (!assignment) {
      return fail(reviewError("REVIEW_NOT_ELIGIBLE", "Only clients actually connected to this vendor through QuickFurno can submit a review."));
    }

    const lead = matchedLeads.find((row: DbRow) => String(row.id) === String(assignment.lead_id)) as DbRow | undefined;
    if (!lead) {
      return fail(reviewError("REVIEW_NOT_ELIGIBLE", "We could not verify this vendor interaction."));
    }

    const { data: existing, error: existingError } = await db
      .from("vendor_reviews")
      .select("id, status")
      .eq("vendor_id", vendorId)
      .eq("lead_id", lead.id)
      .maybeSingle();
    if (existingError && !isMissingRelationError(existingError)) throw existingError;
    if (existing) {
      return fail(reviewError("REVIEW_ALREADY_SUBMITTED", "A review for this QuickFurno vendor interaction has already been submitted."));
    }

    const { data: inserted, error: insertError } = await db
      .from("vendor_reviews")
      .insert({
        vendor_id: vendorId,
        lead_id: lead.id,
        assignment_id: assignment.id,
        reviewer_display_name: reviewerDisplayName(lead.name),
        rating,
        review_text: reviewText,
        category: lead.category ?? lead.service_required ?? null,
        city: lead.city ?? null,
        status: "pending",
        source: "verified_lead",
        verified_interaction: true,
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return fail(reviewError("REVIEW_ALREADY_SUBMITTED", "A review for this QuickFurno vendor interaction has already been submitted."));
      }
      throw insertError;
    }

    return ok({ reviewId: String(inserted.id), status: "pending" });
  } catch (error) {
    return fail(error);
  }
}

async function bestEffortReviewAudit(
  action: string,
  reviewId: string,
  actorUserId: string,
  metadata: Record<string, unknown>,
) {
  try {
    const { error } = await adminClient().from("audit_logs").insert({
      action,
      entity_type: "vendor_review",
      entity_id: reviewId,
      admin_user_id: actorUserId,
      metadata,
    });
    if (error) throw error;
  } catch {
    // Review moderation must not be rolled back because the best-effort audit trail is unavailable.
  }
}

export async function moderateVendorReview(
  reviewId: string,
  status: string,
  actorUserId: string,
  note?: string,
): Promise<Result<{ id: string; status: string }>> {
  try {
    const id = String(reviewId ?? "").trim();
    const nextStatus = String(status ?? "").trim().toLowerCase();
    const moderationNote = String(note ?? "").trim().slice(0, 500) || null;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !REVIEW_STATUSES.has(nextStatus)) {
      return fail(reviewError("REVIEW_VALIDATION", "Invalid review moderation request."));
    }

    const { data, error } = await adminClient()
      .from("vendor_reviews")
      .update({
        status: nextStatus,
        moderated_at: new Date().toISOString(),
        moderated_by: actorUserId,
        moderation_note: moderationNote,
        updated_at: new Date().toISOString(),
        ...(nextStatus === "approved" ? {} : { feature_on_homepage: false }),
      })
      .eq("id", id)
      .select("id, vendor_id, status")
      .single();
    if (error) throw error;

    await bestEffortReviewAudit("vendor_review.status_updated", id, actorUserId, {
      vendor_id: data.vendor_id,
      status: nextStatus,
    });

    return ok({ id: String(data.id), status: String(data.status) });
  } catch (error) {
    return fail(error);
  }
}

export async function getAdminReviewsPage(query: AdminReviewsQuery): Promise<Result<DbRow>> {
  try {
    const db = adminClient();
    const page = boundPage(query.page);
    const { from, to } = pageRange(page);
    const status = sanitizeFilterValue(query.status).toLowerCase();
    const search = sanitizeSearchTerm(query.search);

    let rowsQ = db.from("vendor_reviews")
      .select("id, created_at, vendor_id, lead_id, reviewer_display_name, rating, review_text, category, city, status, moderated_at, moderation_note");
    let countQ = db.from("vendor_reviews").select("id", { count: "exact", head: true });

    if (status && status !== "all" && REVIEW_STATUSES.has(status)) {
      rowsQ = rowsQ.eq("status", status);
      countQ = countQ.eq("status", status);
    }
    if (search) {
      const filter = ["reviewer_display_name", "review_text", "category", "city"]
        .map((column) => `${column}.ilike.*${search}*`)
        .join(",");
      rowsQ = rowsQ.or(filter);
      countQ = countQ.or(filter);
    }

    const [rowsRes, countRes, pendingRes, approvedRes, rejectedRes, hiddenRes] = await Promise.all([
      rowsQ.order("created_at", { ascending: false }).range(from, to),
      countQ,
      db.from("vendor_reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
      db.from("vendor_reviews").select("id", { count: "exact", head: true }).eq("status", "approved"),
      db.from("vendor_reviews").select("id", { count: "exact", head: true }).eq("status", "rejected"),
      db.from("vendor_reviews").select("id", { count: "exact", head: true }).eq("status", "hidden"),
    ]);

    if (rowsRes.error) {
      if (isMissingRelationError(rowsRes.error)) {
        return ok({
          result: { rows: [], page: 1, pageSize: ADMIN_DIRECTORY_PAGE_SIZE, total: 0 },
          vendors: [],
          counts: { pending: 0, approved: 0, rejected: 0, hidden: 0 },
          unavailable: true,
        });
      }
      throw rowsRes.error;
    }
    if (countRes.error) throw countRes.error;

    const rows = (rowsRes.data ?? []) as DbRow[];
    const vendorIds = [...new Set(rows.map((row) => String(row.vendor_id ?? "")).filter(Boolean))];
    const vendorRes = vendorIds.length
      ? await db.from("vendors").select("id, business_name").in("id", vendorIds)
      : { data: [], error: null };
    if (vendorRes.error) throw vendorRes.error;

    return ok({
      result: {
        rows,
        page,
        pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
        total: countRes.count ?? 0,
      },
      vendors: vendorRes.data ?? [],
      counts: {
        pending: pendingRes.count ?? 0,
        approved: approvedRes.count ?? 0,
        rejected: rejectedRes.count ?? 0,
        hidden: hiddenRes.count ?? 0,
      },
      unavailable: false,
    });
  } catch (error) {
    return fail(error);
  }
}
