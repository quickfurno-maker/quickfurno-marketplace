// ============================================================================
// QuickFurno — app/actions.ts   ("use server")
// Thin, auth-guarded entry points the UI calls. Sensitive operations verify the
// caller's role here; the service-role key is never exposed to the browser.
// ============================================================================
"use server";

import { adminClient, serverClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import * as leads from "../services/leadService";
import * as vendors from "../services/vendorService";
import * as packages from "../services/packageService";
import * as admin from "../services/adminService";
import type {
  CreateLeadInput, VendorRegistrationInput, VendorLeadStatus,
} from "../lib/types";

// --------------------------------------------------------------------------
// Auth guards
// --------------------------------------------------------------------------
async function currentUser() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).single();
  return { id: user.id, role: profile?.role as "admin" | "vendor" | undefined };
}

async function requireAdmin() {
  const u = await currentUser();
  if (!u || u.role !== "admin") throw appError("UNAUTHORIZED");
  return u;
}

/** Ensure the signed-in user owns the given vendor row. */
async function requireVendorOwner(vendorId: string) {
  const u = await currentUser();
  if (!u) throw appError("UNAUTHORIZED");
  if (u.role === "admin") return u;
  const sb = await serverClient();
  const { data } = await sb.from("vendors").select("id").eq("id", vendorId).eq("user_id", u.id).single();
  if (!data) throw appError("UNAUTHORIZED");
  return u;
}

// --------------------------------------------------------------------------
// SESSION helpers (used by dashboards to resolve the caller)
// --------------------------------------------------------------------------
export async function getMyRole(): Promise<"admin" | "vendor" | null> {
  const u = await currentUser();
  return u?.role ?? null;
}

/** The vendor business row owned by the signed-in user (or null). */
export async function getMyVendor(): Promise<Result<{ id: string; business_name: string; status: string; remaining_credits: number; public_visibility: boolean } | null>> {
  const u = await currentUser();
  if (!u) return fail(appError("UNAUTHORIZED"));
  const sb = await serverClient();
  const { data } = await sb
    .from("vendors")
    .select("id, business_name, status, remaining_credits, public_visibility")
    .eq("user_id", u.id)
    .maybeSingle();
  return { ok: true, data: (data as any) ?? null };
}

// --------------------------------------------------------------------------
// PUBLIC (no auth) — website + enquiry funnel
// --------------------------------------------------------------------------
export async function submitLead(input: CreateLeadInput) {
  return leads.createLead(input);
}

export async function fetchEligibleVendors(leadId: string) {
  return leads.getEligibleVendors(leadId);
}

export async function assignLead(leadId: string, selectedVendorIds: string[]) {
  return leads.assignLeadToVendors(leadId, selectedVendorIds);
}

export async function fetchPackages() {
  return packages.listPackages();
}

export async function submitVendorRegistration(input: VendorRegistrationInput) {
  return vendors.registerVendor(input);
}

export async function submitVendorAccountRegistration(input: VendorRegistrationInput & { password: string }) {
  let createdUserId: string | null = null;

  try {
    const email = input.email?.trim().toLowerCase();
    const password = input.password;

    if (!input.business_name?.trim() || !input.phone?.trim() || !email || !password || password.length < 6) {
      return fail(appError("VALIDATION"));
    }

    const db = adminClient();
    const { data: auth, error: authErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "vendor",
        full_name: input.owner_name || input.business_name,
        phone: input.phone,
      },
    });

    if (authErr || !auth.user) {
      return {
        ok: false,
        code: authErr?.code ?? "AUTH_SIGNUP_FAILED",
        error: authErr?.message ?? "Could not create vendor account.",
      };
    }

    createdUserId = auth.user.id;

    const vendor = await vendors.registerVendor({
      ...input,
      email,
      user_id: auth.user.id,
    });

    if (!vendor.ok) {
      await db.auth.admin.deleteUser(auth.user.id);
      createdUserId = null;
      return vendor;
    }

    return ok({ ...vendor.data, user_id: auth.user.id });
  } catch (e) {
    if (createdUserId) {
      await adminClient().auth.admin.deleteUser(createdUserId);
    }
    return fail(e);
  }
}

// --------------------------------------------------------------------------
// VENDOR (owner-scoped)
// --------------------------------------------------------------------------
export async function vendorDashboard(vendorId: string) {
  try { await requireVendorOwner(vendorId); } catch (e) { return fail(e); }
  return vendors.getVendorDashboardStats(vendorId);
}

export async function vendorLeads(vendorId: string) {
  try { await requireVendorOwner(vendorId); } catch (e) { return fail(e); }
  return vendors.getVendorAssignedLeads(vendorId);
}

export async function vendorUpdateLeadStatus(
  vendorId: string, assignmentId: string, status: VendorLeadStatus, notes?: string
) {
  try { await requireVendorOwner(vendorId); } catch (e) { return fail(e); }
  return vendors.updateVendorLeadStatus(assignmentId, status, notes);
}

export async function vendorReportBadLead(
  vendorId: string, assignmentId: string, reason: string, description?: string
) {
  try { await requireVendorOwner(vendorId); } catch (e) { return fail(e); }
  return vendors.reportBadLead(assignmentId, reason, description);
}

// --------------------------------------------------------------------------
// ADMIN
// --------------------------------------------------------------------------
async function asAdmin<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try { await requireAdmin(); } catch (e) { return fail(e); }
  return fn();
}

export const adminStats           = async () => asAdmin(() => admin.getAdminDashboardStats());
export const adminAllLeads        = async () => asAdmin(() => admin.getAllLeads());
export const adminUpdateLeadStatus = async (leadId: string, status: string) => asAdmin(() => admin.updateLeadStatus(leadId, status));
export const adminAllVendors      = async () => asAdmin(() => admin.getAllVendors());
export const adminApproveVendor   = async (id: string) => asAdmin(() => admin.approveVendor(id));
export const adminRejectVendor    = async (id: string) => asAdmin(() => admin.rejectVendor(id));
export const adminSuspendVendor   = async (id: string) => asAdmin(() => admin.suspendVendor(id));
export const adminApproveBadLead  = async (id: string, note?: string) => asAdmin(() => admin.approveBadLeadReport(id, note));
export const adminRejectBadLead   = async (id: string, note?: string) => asAdmin(() => admin.rejectBadLeadReport(id, note));
export const adminBadLeadReports  = async () => asAdmin(() => admin.getPendingBadLeadReports());

export const adminCreatePayment = async (vendorId: string, packageId: string, amount: number, method: string, txn?: string) =>
  asAdmin(() => packages.createManualPayment(vendorId, packageId, amount, method, txn));
export const adminMarkPaymentPaid = async (paymentId: string, note?: string) =>
  asAdmin(() => packages.markPaymentPaid(paymentId, note));
export const adminAssignPackage = async (paymentId: string) =>
  asAdmin(() => packages.assignPackageAfterPayment(paymentId));

/** Admin manually assigns/overrides a lead (can include flagged duplicates). */
export const adminAssignLead = async (leadId: string, vendorIds: string[], allowDuplicate = false) =>
  asAdmin(() => leads.assignLeadToVendors(leadId, vendorIds, { allowDuplicate, assignmentType: "admin_assigned" }));

/** One-shot: record a manual payment, mark it Paid, and credit the vendor's pack. */
export const adminCreditVendorNow = async (
  vendorId: string, packageId: string, amount: number, method: string, txn?: string
) =>
  asAdmin(async () => {
    const pay = await packages.createManualPayment(vendorId, packageId, amount, method, txn);
    if (!pay.ok) return pay;
    const paid = await packages.markPaymentPaid(pay.data.id, "Confirmed via admin dashboard.");
    if (!paid.ok) return paid;
    return packages.assignPackageAfterPayment(pay.data.id);
  });
