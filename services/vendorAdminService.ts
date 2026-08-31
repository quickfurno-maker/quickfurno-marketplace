// ============================================================================
// QuickFurno — services/vendorAdminService.ts
// Phase 13B: Superadmin vendor status / credits / package management.
//
// SAFETY CONTRACT:
//   - SERVER ONLY. Uses the service-role client; never reaches the browser.
//   - NO WhatsApp, NO vendor notification, NO automatic credit deduction, NO
//     auto-assignment, NO n8n. The only side effects are admin-initiated
//     writes to public.vendors and public.vendor_credit_logs.
//   - Credits use the EXISTING public.vendors.remaining_credits column.
//   - Package fields are denormalized columns on the vendor row used by the
//     Phase 13 preview eligibility. The real public.vendor_packages system and
//     the public funnel are untouched.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { evaluateVendorEligibility, type VendorEligibility } from "../lib/vendors/vendorEligibility";
// Phase 4: manual admin credit changes go through the canonical atomic primitive
// (no direct remaining_credits/total_credits writes from here). The legacy package
// metadata path does NOT grant credits — paid package credits come from the
// payment-confirmed wallet path (assign_package_to_vendor), manual grants from the
// dedicated credits endpoint.
import { applyVendorCreditDelta } from "./vendorCreditWalletService";

const VENDOR_FIELDS =
  "id, business_name, owner_name, phone, email, city, areas_covered, covers_full_city, service_categories, status, total_credits, remaining_credits, rating, completed_projects, is_active, public_visibility, paid_status, package_name, package_status, package_expires_at, created_at";

export type VendorStatusAction = "approve" | "reject" | "suspend" | "activate" | "deactivate";

const STATUS_BY_ACTION: Record<"approve" | "reject" | "suspend", string> = {
  approve: "Approved",
  reject: "Rejected",
  suspend: "Suspended",
};

export const ALLOWED_PACKAGE_STATUSES = ["none", "active", "expired", "cancelled", "trial"] as const;
export type PackageStatus = (typeof ALLOWED_PACKAGE_STATUSES)[number];

export interface VendorAdminRow extends Record<string, unknown> {
  id: string;
  eligibility: VendorEligibility;
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

/**
 * QF-MVP-80.03 PR C — an authorized admin action whose actor cannot be named is
 * refused BEFORE it mutates anything. Attribution is not decoration: the first
 * production audit rows carried admin_user_id NULL, which is exactly the state
 * that made a real incident un-investigable.
 */
function requireActor(actorUserId: string): string | null {
  const id = typeof actorUserId === "string" ? actorUserId.trim() : "";
  return id === "" ? null : id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Record one admin vendor action. FAIL-OPEN by design: the audit must never
 * block or roll back the business action it describes.
 *
 * QF-MVP-80.03 — this used to be fail-open AND fail-SILENT. PostgREST returns
 * its errors in `{ error }` rather than throwing, so the bare `catch` here never
 * fired and every failure was discarded without a trace. Combined with
 * `audit_logs` being absent from production entirely (see migration
 * 20260817000000), that meant no superadmin vendor action had EVER been
 * recorded, and nothing said so. A silent audit is worse than no audit: it
 * looks like one.
 *
 * The returned error is now inspected and reported. What is logged is
 * deliberately narrow — action, entity type, an id PREFIX and the database's own
 * code/message. The caller's `metadata` is NEVER logged: it is the one field
 * that could carry business context, and a log line is the wrong place to widen
 * its blast radius.
 */
async function bestEffortAudit(
  action: string,
  vendorId: string,
  metadata: Record<string, unknown>,
  actorUserId: string,
) {
  try {
    const { error } = await adminClient().from("audit_logs").insert({
      action,
      entity_type: "vendor",
      entity_id: vendorId,
      // QF-MVP-80.03 PR C — the authenticated principal, resolved server-side by
      // getAdminSession() and passed down after authorization succeeded. NEVER
      // from the request body, a header, or the `updatedBy` display label.
      admin_user_id: actorUserId,
      metadata,
    });
    if (error) {
      console.warn("[audit log] vendor admin action was NOT recorded", {
        action,
        entity_type: "vendor",
        entity_id_prefix: vendorId.slice(0, 8),
        code: error.code ?? null,
        message: error.message ?? null,
      });
    }
  } catch (e) {
    // A transport-level throw (network, client construction) lands here. Still
    // never rethrown — the admin action has already succeeded and must stand.
    console.warn("[audit log] vendor admin action was NOT recorded", {
      action,
      entity_type: "vendor",
      entity_id_prefix: vendorId.slice(0, 8),
      code: null,
      message: e instanceof Error ? e.message : "Unknown audit transport failure",
    });
  }
}

async function recomputeVisibility(vendorId: string) {
  // Keep public_visibility consistent with the REAL vendor_packages system.
  // Best-effort: the preview eligibility does not depend on this.
  try {
    await adminClient().rpc("update_vendor_visibility", { p_vendor_id: vendorId });
  } catch {
    /* RPC may be unavailable in some environments — safe to ignore. */
  }
}

// ----------------------------------------------------------------------------
// READ: vendors with computed eligibility
// ----------------------------------------------------------------------------
export async function getVendorsWithEligibility(): Promise<ServiceResult<VendorAdminRow[]>> {
  try {
    const { data, error } = await adminClient()
      .from("vendors")
      .select(VENDOR_FIELDS)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: "Could not load vendors.", code: "READ_FAILED" };

    const rows = (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return { ...record, id: String(record.id), eligibility: evaluateVendorEligibility(record) } as VendorAdminRow;
    });
    return { ok: true, data: rows };
  } catch {
    return { ok: false, error: "Could not load vendors.", code: "READ_FAILED" };
  }
}

async function getVendorRow(vendorId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await adminClient().from("vendors").select(VENDOR_FIELDS).eq("id", vendorId).maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// STATUS / ACTIVE
// ----------------------------------------------------------------------------
export async function setVendorStatusAction(
  vendorId: string,
  action: VendorStatusAction,
  updatedBy: string,
  actorUserId: string,
): Promise<ServiceResult<VendorAdminRow>> {
  const id = (vendorId ?? "").trim();
  if (!id) return { ok: false, error: "A vendorId is required.", code: "VALIDATION" };
  const actor = requireActor(actorUserId);
  if (!actor) return { ok: false, error: "Unauthorized.", code: "UNAUTHORIZED" };

  try {
    const db = adminClient();
    let update: Record<string, unknown>;
    if (action === "activate") update = { is_active: true };
    else if (action === "deactivate") update = { is_active: false };
    else if (action in STATUS_BY_ACTION) update = { status: STATUS_BY_ACTION[action as keyof typeof STATUS_BY_ACTION] };
    else return { ok: false, error: "Unknown vendor action.", code: "VALIDATION" };

    const { error } = await db.from("vendors").update(update).eq("id", id);
    if (error) return { ok: false, error: "Could not update the vendor.", code: "UPDATE_FAILED" };

    await recomputeVisibility(id);
    await bestEffortAudit(`vendor.${action}`, id, { ...update, updatedBy }, actor);

    const row = await getVendorRow(id);
    if (!row) return { ok: false, error: "Vendor not found after update.", code: "NOT_FOUND" };
    return { ok: true, data: { ...row, id, eligibility: evaluateVendorEligibility(row) } };
  } catch {
    return { ok: false, error: "Could not update the vendor.", code: "UPDATE_FAILED" };
  }
}

// ----------------------------------------------------------------------------
// CREDITS (manual only — never auto-deducts)
// ----------------------------------------------------------------------------
export interface UpdateCreditsInput {
  /** QF-MVP-80.03 PR C — trusted server-session principal. Not client input. */
  actorUserId: string;
  mode: "add" | "set";
  amount: number;
  reason?: string | null;
  updatedBy: string;
  /** Optional idempotency key (same reference applies the change at most once). */
  reference?: string | null;
}

export async function updateVendorCredits(
  vendorId: string,
  input: UpdateCreditsInput,
): Promise<ServiceResult<VendorAdminRow>> {
  const id = (vendorId ?? "").trim();
  const actor = requireActor(input?.actorUserId);
  if (!actor) return { ok: false, error: "Unauthorized.", code: "UNAUTHORIZED" };
  if (!id) return { ok: false, error: "A vendorId is required.", code: "VALIDATION" };

  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount)) return { ok: false, error: "Amount must be a number.", code: "VALIDATION" };
  if (input.mode === "set" && amount < 0) return { ok: false, error: "Set value cannot be negative.", code: "VALIDATION" };

  try {
    const row = await getVendorRow(id);
    if (!row) return { ok: false, error: "Vendor not found.", code: "NOT_FOUND" };

    const before = Math.max(0, Math.round(Number(row.remaining_credits ?? 0)));
    // Deterministic delta. NEVER clamps: an "add" removal (negative amount) that
    // would go below zero is rejected by the RPC (INSUFFICIENT_CREDITS), not zeroed.
    const delta = input.mode === "set" ? Math.max(0, amount) - before : amount;
    const changeType = input.mode === "add" && delta > 0 ? "admin_credit_grant" : "manual_adjustment";
    const reference = typeof input.reference === "string" && input.reference.trim() ? input.reference.trim() : null;

    if (delta !== 0) {
      const applied = await applyVendorCreditDelta({
        vendorId: id,
        delta,
        changeType,
        reason: input.reason ?? null,
        referenceType: reference ? changeType : null,
        referenceId: reference,
        updatedBy: input.updatedBy,
        allowNegative: false,
      });
      if (!applied.ok) {
        return { ok: false, error: "Could not update credits (insufficient balance or wallet error).", code: "UPDATE_FAILED" };
      }
    }

    await recomputeVisibility(id);
    await bestEffortAudit("vendor.credits_updated", id, { before, delta, mode: input.mode, changeType, updatedBy: input.updatedBy }, actor);

    const fresh = (await getVendorRow(id)) ?? row;
    return { ok: true, data: { ...fresh, id, eligibility: evaluateVendorEligibility(fresh) } };
  } catch {
    return { ok: false, error: "Could not update credits.", code: "UPDATE_FAILED" };
  }
}

// ----------------------------------------------------------------------------
// PACKAGE (denormalized fields used by the preview)
// ----------------------------------------------------------------------------
export interface UpdatePackageInput {
  /** QF-MVP-80.03 PR C — trusted server-session principal. Not client input. */
  actorUserId: string;
  packageName?: string | null;
  packageStatus: PackageStatus;
  packageExpiresAt?: string | null;
  updatedBy: string;
}

export async function updateVendorPackage(
  vendorId: string,
  input: UpdatePackageInput,
): Promise<ServiceResult<VendorAdminRow>> {
  const id = (vendorId ?? "").trim();
  const actor = requireActor(input?.actorUserId);
  if (!actor) return { ok: false, error: "Unauthorized.", code: "UNAUTHORIZED" };
  if (!id) return { ok: false, error: "A vendorId is required.", code: "VALIDATION" };

  if (!ALLOWED_PACKAGE_STATUSES.includes(input.packageStatus)) {
    return { ok: false, error: "Invalid package status.", code: "VALIDATION" };
  }

  const expiresAt = normalizeExpiry(input.packageExpiresAt);

  try {
    const row = await getVendorRow(id);
    if (!row) return { ok: false, error: "Vendor not found.", code: "NOT_FOUND" };

    const db = adminClient();
    const { error: updateErr } = await db
      .from("vendors")
      .update({
        package_name: typeof input.packageName === "string" ? input.packageName.trim() || null : null,
        package_status: input.packageStatus,
        package_expires_at: expiresAt,
      })
      .eq("id", id);
    if (updateErr) return { ok: false, error: "Could not update the package.", code: "UPDATE_FAILED" };

    // Phase 4: this legacy route updates DISPLAY/legacy package metadata ONLY. It
    // must NEVER grant credits (that would be a second, uncontrolled credit path).
    // Paid package credits come from the payment-confirmed wallet path
    // (assign_package_to_vendor); manual admin grants use POST /credits.

    await recomputeVisibility(id);
    await bestEffortAudit("vendor.package_updated", id, {
      package_status: input.packageStatus,
      package_name: input.packageName ?? null,
      updatedBy: input.updatedBy,
    }, actor);

    const fresh = (await getVendorRow(id)) ?? row;
    return { ok: true, data: { ...fresh, id, eligibility: evaluateVendorEligibility(fresh) } };
  } catch {
    return { ok: false, error: "Could not update the package.", code: "UPDATE_FAILED" };
  }
}

// ----------------------------------------------------------------------------
// CREDIT LOG
// ----------------------------------------------------------------------------
export interface VendorCreditLogRow {
  id: string;
  vendorId: string;
  changeType: string;
  creditsBefore: number;
  creditsDelta: number;
  creditsAfter: number;
  reason: string | null;
  updatedBy: string | null;
  createdAt: string | null;
}

export async function getVendorCreditLog(vendorId: string): Promise<ServiceResult<VendorCreditLogRow[]>> {
  const id = (vendorId ?? "").trim();
  if (!id) return { ok: false, error: "A vendorId is required.", code: "VALIDATION" };

  try {
    const { data, error } = await adminClient()
      .from("vendor_credit_logs")
      .select("id, vendor_id, change_type, credits_before, credits_delta, credits_after, reason, updated_by, created_at")
      .eq("vendor_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    // Missing table (migration not applied) resolves to an empty log, not an error.
    if (error) return { ok: true, data: [] };

    const rows = (data ?? []).map((raw) => {
      const record: Record<string, unknown> = isRecord(raw) ? raw : {};
      return {
        id: String(record.id ?? ""),
        vendorId: String(record.vendor_id ?? id),
        changeType: String(record.change_type ?? "correction"),
        creditsBefore: Number(record.credits_before ?? 0),
        creditsDelta: Number(record.credits_delta ?? 0),
        creditsAfter: Number(record.credits_after ?? 0),
        reason: typeof record.reason === "string" ? record.reason : null,
        updatedBy: typeof record.updated_by === "string" ? record.updated_by : null,
        createdAt: typeof record.created_at === "string" ? record.created_at : null,
      } satisfies VendorCreditLogRow;
    });
    return { ok: true, data: rows };
  } catch {
    return { ok: true, data: [] };
  }
}

function normalizeExpiry(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
