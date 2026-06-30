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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function bestEffortAudit(action: string, vendorId: string, metadata: Record<string, unknown>) {
  try {
    await adminClient().from("audit_logs").insert({
      action,
      entity_type: "vendor",
      entity_id: vendorId,
      metadata,
    });
  } catch {
    // audit_logs is optional; never block the admin action.
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
): Promise<ServiceResult<VendorAdminRow>> {
  const id = (vendorId ?? "").trim();
  if (!id) return { ok: false, error: "A vendorId is required.", code: "VALIDATION" };

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
    await bestEffortAudit(`vendor.${action}`, id, { ...update, updatedBy });

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
  mode: "add" | "set";
  amount: number;
  reason?: string | null;
  updatedBy: string;
}

export async function updateVendorCredits(
  vendorId: string,
  input: UpdateCreditsInput,
): Promise<ServiceResult<VendorAdminRow>> {
  const id = (vendorId ?? "").trim();
  if (!id) return { ok: false, error: "A vendorId is required.", code: "VALIDATION" };

  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount)) return { ok: false, error: "Amount must be a number.", code: "VALIDATION" };
  if (input.mode === "set" && amount < 0) return { ok: false, error: "Set value cannot be negative.", code: "VALIDATION" };

  try {
    const row = await getVendorRow(id);
    if (!row) return { ok: false, error: "Vendor not found.", code: "NOT_FOUND" };

    const before = Math.max(0, Math.round(Number(row.remaining_credits ?? 0)));
    const currentTotal = Math.max(0, Math.round(Number(row.total_credits ?? 0)));

    const after = input.mode === "set" ? Math.max(0, amount) : Math.max(0, before + amount);
    const delta = after - before;
    const changeType = input.mode === "set" ? "manual_set" : delta >= 0 ? "manual_add" : "manual_remove";

    const db = adminClient();
    const { error: updateErr } = await db
      .from("vendors")
      .update({ remaining_credits: after, total_credits: Math.max(currentTotal, after) })
      .eq("id", id);
    if (updateErr) return { ok: false, error: "Could not update credits.", code: "UPDATE_FAILED" };

    await insertCreditLog(id, {
      changeType,
      before,
      delta,
      after,
      reason: input.reason ?? null,
      updatedBy: input.updatedBy,
    });
    await recomputeVisibility(id);
    await bestEffortAudit("vendor.credits_updated", id, { before, delta, after, mode: input.mode, updatedBy: input.updatedBy });

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
  packageName?: string | null;
  packageStatus: PackageStatus;
  creditsToAdd?: number | null;
  packageExpiresAt?: string | null;
  updatedBy: string;
}

export async function updateVendorPackage(
  vendorId: string,
  input: UpdatePackageInput,
): Promise<ServiceResult<VendorAdminRow>> {
  const id = (vendorId ?? "").trim();
  if (!id) return { ok: false, error: "A vendorId is required.", code: "VALIDATION" };

  if (!ALLOWED_PACKAGE_STATUSES.includes(input.packageStatus)) {
    return { ok: false, error: "Invalid package status.", code: "VALIDATION" };
  }

  const creditsToAdd = Math.round(Number(input.creditsToAdd ?? 0));
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

    // Optionally top up credits along with the package change.
    if (Number.isFinite(creditsToAdd) && creditsToAdd > 0) {
      const before = Math.max(0, Math.round(Number(row.remaining_credits ?? 0)));
      const currentTotal = Math.max(0, Math.round(Number(row.total_credits ?? 0)));
      const after = before + creditsToAdd;
      const { error: creditErr } = await db
        .from("vendors")
        .update({ remaining_credits: after, total_credits: Math.max(currentTotal, after) })
        .eq("id", id);
      if (!creditErr) {
        await insertCreditLog(id, {
          changeType: "package_credit",
          before,
          delta: creditsToAdd,
          after,
          reason: `Package credit (${input.packageStatus}${input.packageName ? `: ${input.packageName}` : ""})`,
          updatedBy: input.updatedBy,
        });
      }
    }

    await recomputeVisibility(id);
    await bestEffortAudit("vendor.package_updated", id, {
      package_status: input.packageStatus,
      package_name: input.packageName ?? null,
      creditsToAdd: creditsToAdd > 0 ? creditsToAdd : 0,
      updatedBy: input.updatedBy,
    });

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

async function insertCreditLog(
  vendorId: string,
  input: { changeType: string; before: number; delta: number; after: number; reason: string | null; updatedBy: string },
) {
  try {
    await adminClient().from("vendor_credit_logs").insert({
      vendor_id: vendorId,
      change_type: input.changeType,
      credits_before: input.before,
      credits_delta: input.delta,
      credits_after: input.after,
      reason: input.reason,
      updated_by: input.updatedBy,
    });
  } catch {
    // Log table optional; the credit balance update already succeeded.
  }
}

function normalizeExpiry(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
