// ============================================================================
// QuickFurno — app/actions.ts   ("use server")
// Thin, auth-guarded entry points the UI calls. Sensitive operations verify the
// caller's role here; the service-role key is never exposed to the browser.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminClient, serverClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import * as leads from "../services/leadService";
import * as vendors from "../services/vendorService";
import * as packages from "../services/packageService";
import * as vendorPackageOrders from "../services/vendorPackageOrderService";
import * as vendorProfileChanges from "../services/vendorProfileChangeService";
import * as vendorNotifications from "../services/vendorNotificationService";
import * as vendorSupport from "../services/vendorSupportService";
import * as admin from "../services/adminService";
import * as audit from "../services/adminAuditService";
import * as manualAssign from "../services/manualLeadAssignmentService";
import * as aos from "../services/aosService";
import { runAutoAssignmentPreviewForLead } from "../lib/lead-assignment/autoAssignmentEngine";
import { recheckQueuedLead } from "../lib/lead-assignment/leadQueueService";
import { captureFreeVendorInterest, markInterestStatus, type CaptureFreeVendorInterestInput } from "../lib/lead-assignment/freeVendorInterestService";
import { updateMarketplaceRuntimeSetting } from "../lib/lead-assignment/runtimeSettings";
import type { AosDecisionLogInput } from "../services/aosService";
import type {
  CreateLeadInput, VendorRegistrationInput, VendorLeadStatus,
} from "../lib/types";

type AdminRoleName =
  | "Superadmin"
  | "Sales Admin"
  | "Support Admin"
  | "Finance Admin"
  | "Content Admin"
  | "Operations Admin";

type CurrentUser = {
  id: string;
  role: "admin" | "vendor" | undefined;
  adminRole: AdminRoleName | null;
};

// --------------------------------------------------------------------------
// Auth guards
// --------------------------------------------------------------------------
async function currentUser(): Promise<CurrentUser | null> {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).single();
  return {
    id: user.id,
    role: profile?.role as "admin" | "vendor" | undefined,
    adminRole: (user.app_metadata?.admin_role as AdminRoleName | undefined) ?? null,
  };
}

async function requireAdmin() {
  const u = await currentUser();
  if (!u || u.role !== "admin") throw appError("UNAUTHORIZED");
  return u;
}

async function requireSuperadmin() {
  const u = await requireAdmin();
  if (u.adminRole !== "Superadmin") throw appError("UNAUTHORIZED");
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

export async function getAdminSession(): Promise<{
  isLoggedIn: boolean;
  isAdmin: boolean;
  isSuperadmin: boolean;
  adminRole: AdminRoleName | null;
}> {
  const u = await currentUser();
  return {
    isLoggedIn: Boolean(u),
    isAdmin: u?.role === "admin",
    isSuperadmin: u?.role === "admin" && u.adminRole === "Superadmin",
    adminRole: u?.adminRole ?? null,
  };
}

/** The vendor business row owned by the signed-in user (or null).
 *  Read-only profile summary used by the vendor dashboard for display. */
export async function getMyVendor(): Promise<Result<import("../lib/types").VendorProfileSummary | null>> {
  const u = await currentUser();
  if (!u) return fail(appError("UNAUTHORIZED"));
  const sb = await serverClient();
  const { data } = await sb
    .from("vendors")
    .select(
      "id, business_name, owner_name, phone, whatsapp_number, email, city, areas_covered, service_categories, selected_category, business_type, office_address_line1, office_address_line2, office_landmark, office_city, office_state, office_pincode, office_latitude, office_longitude, status, verification_status, paid_status, remaining_credits, total_credits, public_visibility, is_active",
    )
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

export async function submitFreeVendorProfileInterest(input: CaptureFreeVendorInterestInput) {
  return captureFreeVendorInterest(input);
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
  return vendors.updateVendorLeadStatus(vendorId, assignmentId, status, notes);
}

export async function vendorReportBadLead(
  vendorId: string, assignmentId: string, reportType: string, reportReason?: string, vendorComment?: string
) {
  try { await requireVendorOwner(vendorId); } catch (e) { return fail(e); }
  const reason = reportReason ?? reportType;
  const comment = vendorComment ?? "";
  return vendors.reportBadLead(vendorId, assignmentId, reportType, reason, comment);
}

/** Phase 26A-2C structured lead-issue report. No refund, no reassignment, no WhatsApp. */
export async function vendorSubmitLeadReport(
  vendorId: string, assignmentId: string, reasonCode: string, comment?: string
) {
  try { await requireVendorOwner(vendorId); } catch (e) { return fail(e); }
  const result = await vendors.submitStructuredLeadReport(vendorId, assignmentId, reasonCode, comment);
  revalidatePath("/vendor/dashboard/leads");
  revalidatePath("/vendor/dashboard");
  revalidatePath("/admin/leads");
  return result;
}

export async function vendorUpdateLeadStatusFromForm(formData: FormData) {
  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/leads?lead=no-vendor");

  const assignmentId = String(formData.get("assignmentId") ?? "");
  const status = String(formData.get("status") ?? "") as VendorLeadStatus;
  const result = await vendorUpdateLeadStatus(me.data.id, assignmentId, status);

  revalidatePath("/vendor/dashboard/leads");
  revalidatePath("/vendor/dashboard");
  if (!result.ok) redirect(`/vendor/dashboard/leads?lead=failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/leads?lead=status-updated");
}

export async function vendorReportBadLeadFromForm(formData: FormData) {
  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/leads?lead=no-vendor");

  const assignmentId = String(formData.get("assignmentId") ?? "");
  const reportType = String(formData.get("report_type") ?? "");
  const reportReason = String(formData.get("report_reason") ?? "");
  const vendorComment = String(formData.get("vendor_comment") ?? "");
  const result = await vendorReportBadLead(me.data.id, assignmentId, reportType, reportReason, vendorComment);

  revalidatePath("/vendor/dashboard/leads");
  revalidatePath("/vendor/dashboard");
  revalidatePath("/admin/leads");
  if (!result.ok) redirect(`/vendor/dashboard/leads?lead=report-failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/leads?lead=bad-lead-submitted");
}

export async function vendorCreatePackageOrder(formData: FormData) {
  const packageId = String(formData.get("packageId") ?? "");
  if (!packageId) redirect("/vendor/dashboard/package?order=invalid");

  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/package?order=no-vendor");

  const result = await vendorPackageOrders.createVendorPackageOrder(me.data.id, packageId);
  revalidatePath("/vendor/dashboard/package");

  if (!result.ok) redirect(`/vendor/dashboard/package?order=failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/package?order=created");
}

export async function vendorSubmitProfileChangeRequest(formData: FormData) {
  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/profile?request=no-vendor");

  const u = await currentUser();
  const result = await vendorProfileChanges.createVendorProfileChangeRequest(me.data.id, u?.id ?? null, {
    public_business_name: String(formData.get("public_business_name") ?? ""),
    public_description: String(formData.get("public_description") ?? ""),
    public_category: String(formData.get("public_category") ?? ""),
    services_offered: String(formData.get("services_offered") ?? "").split(/\r?\n|,/),
    starting_price: String(formData.get("starting_price") ?? ""),
    business_hours: String(formData.get("business_hours") ?? ""),
    service_area_summary: String(formData.get("service_area_summary") ?? ""),
    profile_image_url: String(formData.get("profile_image_url") ?? ""),
    cover_image_url: String(formData.get("cover_image_url") ?? ""),
    portfolio_image_urls: String(formData.get("portfolio_image_urls") ?? "").split(/\r?\n|,/),
  });

  revalidatePath("/vendor/dashboard/profile");
  if (!result.ok) redirect(`/vendor/dashboard/profile?request=failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/profile?request=submitted");
}

export async function vendorMarkNotificationRead(formData: FormData) {
  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/notifications");

  const notificationId = String(formData.get("notificationId") ?? "");
  const result = await vendorNotifications.markVendorNotificationRead(me.data.id, notificationId);

  revalidatePath("/vendor/dashboard/notifications");
  if (!result.ok) redirect(`/vendor/dashboard/notifications?notice=failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/notifications?notice=read");
}

export async function vendorMarkAllNotificationsRead() {
  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/notifications");

  const result = await vendorNotifications.markAllVendorNotificationsRead(me.data.id);

  revalidatePath("/vendor/dashboard/notifications");
  if (!result.ok) redirect(`/vendor/dashboard/notifications?notice=failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/notifications?notice=all-read");
}

export async function vendorCreateSupportThread(formData: FormData) {
  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/support?support=no-vendor");

  const u = await currentUser();
  const result = await vendorSupport.createVendorSupportThread(me.data.id, u?.id ?? null, {
    subject: String(formData.get("subject") ?? ""),
    topic: String(formData.get("topic") ?? "general"),
    message: String(formData.get("message") ?? ""),
  });

  revalidatePath("/vendor/dashboard/support");
  revalidatePath("/admin/vendors");
  if (!result.ok) redirect(`/vendor/dashboard/support?support=failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/support?support=created");
}

export async function vendorSendSupportMessage(formData: FormData) {
  const me = await getMyVendor();
  if (!me.ok || !me.data) redirect("/vendor/dashboard/support?support=no-vendor");

  const u = await currentUser();
  const threadId = String(formData.get("threadId") ?? "");
  const result = await vendorSupport.createVendorSupportMessage(
    me.data.id,
    threadId,
    u?.id ?? null,
    String(formData.get("message") ?? ""),
  );

  revalidatePath("/vendor/dashboard/support");
  revalidatePath("/admin/vendors");
  if (!result.ok) redirect(`/vendor/dashboard/support?support=failed&code=${encodeURIComponent(result.code)}`);
  redirect("/vendor/dashboard/support?support=sent");
}

export async function adminApproveVendorProfileChangeRequest(requestId: string, adminNotes?: string) {
  return asAdmin(async () => {
    const user = await requireSuperadmin();
    const result = await vendorProfileChanges.approveVendorProfileChangeRequest(requestId, user.id, adminNotes);
    revalidatePath("/admin/vendors");
    revalidatePath("/vendors");
    return result;
  });
}

export async function adminRejectVendorProfileChangeRequest(requestId: string, rejectionReason: string) {
  return asAdmin(async () => {
    const user = await requireSuperadmin();
    const result = await vendorProfileChanges.rejectVendorProfileChangeRequest(requestId, user.id, rejectionReason);
    revalidatePath("/admin/vendors");
    return result;
  });
}

export async function adminReplyVendorSupportThread(threadId: string, message: string) {
  return asAdmin(async () => {
    const user = await requireSuperadmin();
    const result = await vendorSupport.createAdminSupportReply(threadId, user.id, message);
    revalidatePath("/admin/vendors");
    revalidatePath("/vendor/dashboard/support");
    revalidatePath("/vendor/dashboard/notifications");
    return result;
  });
}

// --------------------------------------------------------------------------
// ADMIN
// --------------------------------------------------------------------------
async function asAdmin<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try { await requireSuperadmin(); } catch (e) { return fail(e); }
  return fn();
}

export const adminStats           = async () => asAdmin(() => admin.getAdminDashboardStats());
export const adminSnapshot        = async () => asAdmin(() => admin.getSuperadminSnapshot());
// Safe AOS audit logging. Writes to aos_agent_logs if present; otherwise returns
// a safe fallback. No AI, WhatsApp, credit, or distribution side effects.
export const adminLogAosDecision  = async (input: AosDecisionLogInput) => asAdmin(() => aos.logAosAgentDecision(input));
export const adminAllLeads        = async () => asAdmin(() => admin.getAllLeads());
export const adminUpdateLeadStatus = async (leadId: string, status: string) => asAdmin(() => admin.updateLeadStatus(leadId, status));
export const adminAllVendors      = async () => asAdmin(() => admin.getAllVendors());
export const adminApproveVendor   = async (id: string) => asAdmin(() => admin.approveVendor(id));
export const adminRejectVendor    = async (id: string) => asAdmin(() => admin.rejectVendor(id));
export const adminSuspendVendor   = async (id: string) => asAdmin(() => admin.suspendVendor(id));
export const adminCreatePackage   = async (input: { name: string; lead_count: number; total_price: number; validity_days: number; is_active?: boolean }) =>
  asAdmin(() => admin.createPackage(input));
export const adminSetPackageActive = async (id: string, isActive: boolean) =>
  asAdmin(() => admin.setPackageActive(id, isActive));
export const adminCreateCategory = async (input: { name: string; is_active?: boolean }) =>
  asAdmin(() => admin.createCategory(input));
export const adminSetCategoryActive = async (id: string, isActive: boolean) =>
  asAdmin(() => admin.setCategoryActive(id, isActive));
export const adminCreateCity = async (input: { name: string; is_active?: boolean }) =>
  asAdmin(() => admin.createCity(input));
export const adminSetCityActive = async (id: string, isActive: boolean) =>
  asAdmin(() => admin.setCityActive(id, isActive));
export const adminApproveBadLead  = async (id: string, note?: string) => asAdmin(() => admin.approveBadLeadReport(id, note));
export const adminRejectBadLead   = async (id: string, note?: string) => asAdmin(() => admin.rejectBadLeadReport(id, note));
export const adminBadLeadReports  = async () => asAdmin(() => admin.getPendingBadLeadReports());

// --------------------------------------------------------------------------
// ADMIN — Phase 26A-2 audit layer (read-mostly; review actions never touch
// credits, never send WhatsApp, never approve/reject package purchases).
// --------------------------------------------------------------------------
export const adminListLeadMatchingRuns = async (limit?: number) =>
  asAdmin(() => audit.listLeadMatchingRuns(limit));
export const adminListLeadDeliveryLogs = async (limit?: number) =>
  asAdmin(() => audit.listLeadDeliveryLogs(limit));
export const adminListClientNotificationLogs = async (limit?: number) =>
  asAdmin(() => audit.listClientNotificationLogs(limit));
export const adminGetLeadMatchingAuditDetails = async (leadId: string) =>
  asAdmin(() => audit.getLeadMatchingAuditDetails(leadId));
export const adminListVendorLeadReports = async (limit?: number) =>
  asAdmin(() => audit.listVendorLeadReports(limit));
export const adminUpdateVendorLeadReportStatus = async (reportId: string, input: { status: string; adminNotes?: string | null }) =>
  asAdmin(async () => {
    const user = await requireSuperadmin();
    const result = await audit.updateVendorLeadReportStatus(reportId, input, user.id);
    revalidatePath("/admin/leads");
    return result;
  });
export const adminAddVendorLeadReportComment = async (reportId: string, comment: string, isInternal = false) =>
  asAdmin(async () => {
    const user = await requireSuperadmin();
    const result = await audit.addVendorLeadReportComment(reportId, comment, user.id, isInternal);
    revalidatePath("/admin/leads");
    return result;
  });
export const adminListPackageOrdersAuditOnly = async (limit?: number) =>
  asAdmin(() => audit.listPackageOrdersAuditOnly(limit));

export const adminUpdateMarketplaceRuntimeSetting = async (key: string, value: unknown) =>
  asAdmin(async () => {
    const user = await requireSuperadmin();
    return updateMarketplaceRuntimeSetting(key, value, user.id);
  });

export const adminRunAutoMatchPreview = async (leadId: string) =>
  asAdmin(async () => {
    const user = await requireSuperadmin();
    return runAutoAssignmentPreviewForLead(leadId, { createdBy: user.id, source: "admin_preview" });
  });

export const adminRecheckLeadAssignmentQueue = async (queueIdOrLeadId: string) =>
  asAdmin(async () => {
    const user = await requireSuperadmin();
    return recheckQueuedLead(queueIdOrLeadId, user.id);
  });

export const adminMarkFreeVendorInterestStatus = async (interestId: string, status: string, note?: string) =>
  asAdmin(() => markInterestStatus(interestId, status, note));

export const adminCreatePayment = async (vendorId: string, packageId: string, amount: number, method: string, txn?: string) =>
  asAdmin(() => packages.createManualPayment(vendorId, packageId, amount, method, txn));
export const adminMarkPaymentPaid = async (paymentId: string, note?: string) =>
  asAdmin(() => packages.markPaymentPaid(paymentId, note));
export const adminAssignPackage = async (paymentId: string) =>
  asAdmin(() => packages.assignPackageAfterPayment(paymentId));

/** Admin manually assigns/overrides a lead (can include flagged duplicates). */
export const adminAssignLead = async (leadId: string, vendorIds: string[], allowDuplicate = false) =>
  asAdmin(() => leads.assignLeadToVendors(leadId, vendorIds, { allowDuplicate, assignmentType: "admin_assigned" }));

// --------------------------------------------------------------------------
// ADMIN — Phase 26A-2B manual lead-assignment fallback. Reuses the existing
// safe assign_lead_to_vendors RPC (credit deduction handled there); adds only
// audit + preview logs. WhatsApp stays preview/log only.
// --------------------------------------------------------------------------
export const adminPreviewManualLeadAssignment = async (leadId: string) =>
  asAdmin(() => manualAssign.getManualAssignmentPreview(leadId));

export const adminListManualAssignmentCandidates = async (leadId: string) =>
  asAdmin(async () => {
    const preview = await manualAssign.getManualAssignmentPreview(leadId);
    if (!preview.ok) return preview;
    return ok(preview.data.candidates);
  });

export const adminAssignLeadManually = async (leadId: string, vendorIds: string[]) =>
  asAdmin(async () => {
    const user = await requireSuperadmin();
    const result = await manualAssign.assignLeadManually(leadId, vendorIds, user.id);
    revalidatePath("/admin/lead-distribution");
    revalidatePath("/admin/leads");
    revalidatePath("/vendor/dashboard/leads");
    return result;
  });

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
