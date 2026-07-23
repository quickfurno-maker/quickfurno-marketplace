// ============================================================================
// QuickFurno — services/preferredVendorLeadService.ts
// Phase 1: Safe preferred-vendor enquiry routing.
//
// When a client picks a specific vendor CTA, the lead is routed FIRST to that
// one vendor. This service:
//   * loads the target vendor
//   * runs a DIRECT commercial check — the client already picked this vendor from
//     its public CTA, so it is NEVER blocked on public_visibility, package_status,
//     paid_status, or category/area. Only the essentials gate it: status is
//     approved/active (case-insensitive), verification is not rejected/pending/
//     failed/unverified, is_active (default true), and remaining_credits > 0.
//   * if no credits → assigns nothing, deducts nothing, shares NO client contact,
//     notifies the vendor to recharge, and queues the delayed fallback (Phase 2)
//   * if not approved/verified/active → assigns nothing and marks for admin review
//   * NEVER fans out to other vendors here (delayed fill is Phase 2)
//
// QF-MVP-20.3R1 — DIRECT PREFERRED-VENDOR ASSIGNMENT IS FAIL-CLOSED.
// Assigning the vendor a CLIENT picked is a client-selected assignment, and the
// canonical authority rejects that mode until the schema carries a trustworthy
// lead-to-client ownership binding (R1_BLOCKED_PENDING_OWNER_BINDING). The
// legacy `assign_lead_to_preferred_vendor` RPC is no longer called and is not a
// fallback. A commercially eligible pick now resolves to
// `preferred_vendor_pending` with NO assignment, NO credit deduction and NO
// client contact shared, and the lead is queued for the delayed SYSTEM fill.
//
// It never throws: every failure resolves to a safe result so lead submission is
// never blocked. Credits are only ever touched by the canonical authority.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { R1_BLOCKED_PENDING_OWNER_BINDING } from "./canonicalAssignmentAuthority";
import { normalizeCredits } from "../lib/vendors/vendorEligibility";
import {
  createClientAssignedVendorsPreview,
  createVendorLeadWhatsappPreview,
  deliverLeadToVendorDashboard,
} from "./leadDeliveryService";
import { createVendorNotification } from "./vendorNotificationService";
import { queuePreferredVendorDelayedFill } from "./delayedLeadFillService";

export const PREFERRED_VENDOR_MIGRATION_HINT =
  "Apply migration 20260702000035_preferred_vendor_lead_intent.sql on the live database.";

export const PREFERRED_ASSIGNMENT_SOURCE = "client_selected_vendor";

export type PreferredVendorRoutingStatus =
  | "assigned_to_preferred_vendor"
  | "preferred_vendor_no_credits"
  | "preferred_vendor_not_eligible"
  | "preferred_vendor_not_found"
  | "preferred_vendor_pending"
  | "quality_gate_hold"
  | "failed";

export type PreferredVendorRoutingResult = {
  status: PreferredVendorRoutingStatus;
  assigned: boolean;
  vendor_id: string | null;
  vendor_name: string | null;
  reason: string | null;
  /** true only when a lead_assignments row was created (contact is shared). */
  contact_shared: boolean;
  /** Phase 2: true when a delayed remaining-slot fill was queued for this lead. */
  queued_for_delayed_fill: boolean;
};

export type RoutePreferredVendorInput = {
  leadId: string;
  vendorId: string;
  vendorName?: string | null;
  city?: string | null;
  serviceRequired?: string | null;
  category?: string | null;
  subcategory?: string | null;
  isDuplicate?: boolean;
  /** Reserved for Phase 2 delayed fill. Recorded only; not acted on in Phase 1. */
  fallbackAllowed?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// verification_status values that block a direct assignment (case-insensitive).
// A missing/blank verification is treated as verified (default trust).
const BAD_VERIFICATION_STATUSES = new Set([
  "pending",
  "rejected",
  "unverified",
  "not verified",
  "failed",
  "in review",
]);

type PreferredDirectBlockReason =
  | "vendor_not_approved_or_active"
  | "vendor_not_verified"
  | "vendor_inactive"
  | "no_credits";

/**
 * Direct commercial eligibility for a CLIENT-PICKED vendor. The client already
 * chose this vendor from its public CTA, so this deliberately does NOT gate on
 * public_visibility, package_status, paid_status, or category/city — only the
 * commercial essentials. `blockReason` is null when the vendor is assignable.
 */
function evaluatePreferredVendorDirectEligibility(
  vendor: Record<string, unknown>,
): { eligible: boolean; blockReason: PreferredDirectBlockReason | null } {
  const statusText = typeof vendor.status === "string" ? vendor.status.trim().toLowerCase() : "";
  if (statusText !== "approved" && statusText !== "active") {
    return { eligible: false, blockReason: "vendor_not_approved_or_active" };
  }

  const rawVerification = typeof vendor.verification_status === "string" ? vendor.verification_status.trim() : "";
  const verificationText = rawVerification.length > 0 ? rawVerification.toLowerCase() : "verified";
  if (BAD_VERIFICATION_STATUSES.has(verificationText)) {
    return { eligible: false, blockReason: "vendor_not_verified" };
  }

  // is_active defaults to true only when the field is entirely absent/null.
  const isActive =
    vendor.is_active === undefined || vendor.is_active === null
      ? true
      : vendor.is_active === true || vendor.is_active === "true" || vendor.is_active === 1;
  if (!isActive) {
    return { eligible: false, blockReason: "vendor_inactive" };
  }

  if (normalizeCredits(vendor) <= 0) {
    return { eligible: false, blockReason: "no_credits" };
  }

  return { eligible: true, blockReason: null };
}

/**
 * Route one lead to a single preferred vendor. Always resolves (never throws).
 */
export async function routePreferredVendorLead(
  input: RoutePreferredVendorInput,
): Promise<PreferredVendorRoutingResult> {
  const vendorId = String(input.vendorId ?? "").trim();
  const fallbackName = asText(input.vendorName);

  try {
    // A non-uuid target (e.g. a static demo vendor slug) can never be a real
    // assignable Supabase vendor — treat as not found, keep the lead safe.
    if (!vendorId || !UUID_RE.test(vendorId)) {
      await markLeadPreferred(input, "preferred_vendor_not_found", null);
      return result("preferred_vendor_not_found", false, vendorId || null, fallbackName, "invalid_or_missing_vendor_id");
    }

    // Duplicate leads are never auto-assigned (protects vendor credits); leave
    // for admin review with the preferred context recorded.
    if (input.isDuplicate) {
      await markLeadPreferred(input, "preferred_vendor_pending", "duplicate_lead");
      return result("preferred_vendor_pending", false, vendorId, fallbackName, "duplicate_lead");
    }

    const { data: vendorRow, error: vendorError } = await adminClient()
      .from("vendors")
      .select("*")
      .eq("id", vendorId)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendorRow) {
      await markLeadPreferred(input, "preferred_vendor_not_found", null);
      return result("preferred_vendor_not_found", false, vendorId, fallbackName, "vendor_not_found");
    }

    const vendor = vendorRow as Record<string, unknown>;
    const vendorName = asText(vendor.business_name) ?? fallbackName;

    // Direct commercial check (never trust the client). A client-picked vendor is
    // NOT gated on public_visibility / package_status / paid_status / category —
    // only status, verification, active, and credits decide a direct assignment.
    const eligibility = evaluatePreferredVendorDirectEligibility(vendor);

    if (eligibility.blockReason === "no_credits") {
      // No credits → assign nothing, share NO client contact. Notify the vendor to
      // recharge and queue the 1-hour delayed fallback (Phase 2).
      console.warn("[preferred vendor] direct assignment held — no credits", {
        lead_id: input.leadId,
        vendor_id: vendorId,
        reason: "no_credits",
      });
      await notifyVendorRechargeSafe(vendorId);
      const queued = await queueDelayedFillSafe(input, vendorId, false);
      await markLeadPreferred(input, "preferred_vendor_no_credits", "no_credits", vendorName);
      return result("preferred_vendor_no_credits", false, vendorId, vendorName, "no_credits", false, queued);
    }
    if (eligibility.blockReason) {
      // Not approved/verified/active → do not assign, keep for admin review.
      console.warn("[preferred vendor] direct assignment blocked — vendor not eligible", {
        lead_id: input.leadId,
        vendor_id: vendorId,
        reason: eligibility.blockReason,
      });
      await markLeadPreferred(input, "preferred_vendor_not_eligible", eligibility.blockReason, vendorName);
      return result("preferred_vendor_not_eligible", false, vendorId, vendorName, eligibility.blockReason);
    }

    // Commercially eligible, but assignment authority is a separate question.
    const assign = await callAssignPreferredVendorRpc(input.leadId, vendorId);

    if (assign.status === R1_BLOCKED_PENDING_OWNER_BINDING) {
      // Fail-closed: nothing assigned, no credit, no contact shared. The lead is
      // saved and queued so the delayed SYSTEM fill (canonical `delayed_fill`
      // mode) can still connect the client with verified vendors.
      const queued = await queueDelayedFillSafe(input, vendorId, false);
      await markLeadPreferred(input, "preferred_vendor_pending", R1_BLOCKED_PENDING_OWNER_BINDING, vendorName);
      return result(
        "preferred_vendor_pending",
        false,
        vendorId,
        vendorName,
        R1_BLOCKED_PENDING_OWNER_BINDING,
        false,
        queued,
      );
    }

    if (assign.status === "assigned_to_preferred_vendor" || assign.status === "already_assigned") {
      await deliverPreferredAssignment(input.leadId, vendorId, vendorName);
      // Phase 2: preferred vendor already has the lead — queue the remaining ≤2
      // slots to be filled after 1 hour (up to a hard cap of 3 total).
      const queued = await queueDelayedFillSafe(input, vendorId, true);
      await markLeadPreferred(input, "assigned_immediately", null, vendorName);
      return result("assigned_to_preferred_vendor", true, vendorId, vendorName, null, true, queued);
    }

    if (assign.status === "preferred_vendor_no_credits") {
      await notifyVendorRechargeSafe(vendorId);
      const queued = await queueDelayedFillSafe(input, vendorId, false);
      await markLeadPreferred(input, "preferred_vendor_no_credits", "no_credits", vendorName);
      return result("preferred_vendor_no_credits", false, vendorId, vendorName, "no_credits", false, queued);
    }
    if (assign.status === "preferred_vendor_not_eligible") {
      await markLeadPreferred(input, "preferred_vendor_not_eligible", assign.reason ?? "not_eligible", vendorName);
      return result("preferred_vendor_not_eligible", false, vendorId, vendorName, assign.reason ?? "not_eligible");
    }
    if (assign.status === "migration_not_applied") {
      // The lead is already saved. Keep it safe for admin follow-up.
      await markLeadPreferred(input, "preferred_vendor_pending", "migration_not_applied", vendorName);
      return result("preferred_vendor_pending", false, vendorId, vendorName, "migration_not_applied");
    }

    await markLeadPreferred(input, "preferred_vendor_pending", assign.reason ?? assign.status, vendorName);
    return result("preferred_vendor_pending", false, vendorId, vendorName, assign.reason ?? assign.status);
  } catch (error) {
    console.warn("[preferred vendor] routing failed — lead submission unaffected", {
      lead_id: input.leadId,
      vendor_id: vendorId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return result("failed", false, vendorId || null, fallbackName, "unexpected_error");
  }
}

/**
 * Preferred-vendor lead was captured, but Phase 1 quality gate held it before
 * any credit deduction/contact share. This does not call the assignment RPC.
 */
export async function holdPreferredVendorForQualityGate(
  input: RoutePreferredVendorInput & { reason?: string | null },
): Promise<PreferredVendorRoutingResult> {
  const vendorId = String(input.vendorId ?? "").trim();
  const reason = asText(input.reason) ?? "lead_quality_gate_hold";
  const vendorName = asText(input.vendorName);
  try {
    await markLeadPreferred(input, "quality_gate_hold", reason, vendorName);
  } catch {
    // Lead submission must remain successful even if this audit write is skipped.
  }
  return result("quality_gate_hold", false, vendorId || null, vendorName, reason);
}

type RpcResult = { status: string; assigned: boolean; reason: string | null; assignment_id: string | null };

/**
 * QF-MVP-20.3R1 — direct assignment to a client-picked vendor is FAIL-CLOSED.
 *
 * This is the archetypal CLIENT-SELECTED assignment: the client, not the system
 * and not an admin, chose the vendor. The canonical authority
 * `qf_assign_lead_vendors_v2` rejects that mode because the database has no
 * trustworthy lead-to-client ownership binding to re-assert, and phone equality
 * is not accepted as ownership authority (R1_BLOCKED_PENDING_OWNER_BINDING —
 * see services/canonicalAssignmentAuthority.ts for the exact prerequisite).
 *
 * The legacy `assign_lead_to_preferred_vendor` RPC is NOT called and is not
 * available as a fallback. Nothing is assigned, no credit is deducted, no
 * ledger row is written and no client contact is shared. The lead itself is
 * already captured and is queued for the delayed system fill by the caller.
 */
async function callAssignPreferredVendorRpc(leadId: string, vendorId: string): Promise<RpcResult> {
  console.warn("[preferred vendor] direct assignment blocked pending owner binding", {
    lead_id: leadId,
    vendor_id: vendorId,
    reason: R1_BLOCKED_PENDING_OWNER_BINDING,
  });
  return {
    status: R1_BLOCKED_PENDING_OWNER_BINDING,
    assigned: false,
    reason: R1_BLOCKED_PENDING_OWNER_BINDING,
    assignment_id: null,
  };
}

/** Dashboard delivery + WhatsApp preview + client preview (all preview/log only). */
async function deliverPreferredAssignment(leadId: string, vendorId: string, vendorName: string | null): Promise<void> {
  const assignmentId = await resolveAssignmentId(leadId, vendorId);
  if (assignmentId) {
    const dash = await deliverLeadToVendorDashboard(leadId, vendorId, assignmentId, { assignmentSource: PREFERRED_ASSIGNMENT_SOURCE });
    if (!dash.ok) console.warn("[preferred vendor] dashboard delivery log skipped", { code: dash.code });
    const preview = await createVendorLeadWhatsappPreview(leadId, vendorId, assignmentId, { assignmentSource: PREFERRED_ASSIGNMENT_SOURCE });
    if (!preview.ok) console.warn("[preferred vendor] vendor whatsapp preview skipped", { code: preview.code });
    const clientPreview = await createClientAssignedVendorsPreview(leadId, [{ vendor_id: vendorId, assignment_id: assignmentId }]);
    if (!clientPreview.ok) console.warn("[preferred vendor] client preview skipped", { code: clientPreview.code });
  }
  const notify = await createVendorNotification(vendorId, {
    title: "A client selected your profile",
    message: "A client sent you an enquiry from your QuickFurno profile. Open your dashboard to view the client details.",
    type: "lead_assigned",
    priority: "high",
    cta_label: "View lead",
    cta_url: "/vendor/dashboard/leads",
  });
  if (!notify.ok) console.warn("[preferred vendor] vendor notification skipped", { code: notify.code });
}

/**
 * Phase 2: queue this preferred-vendor lead for delayed remaining-slot fill.
 * Honours the `fallbackAllowed` flag (default on) and never throws — a queue
 * failure must never affect the already-completed routing/lead submission.
 * Returns whether a queue row was created.
 */
async function queueDelayedFillSafe(
  input: RoutePreferredVendorInput,
  vendorId: string,
  preferredAssigned: boolean,
): Promise<boolean> {
  if (input.fallbackAllowed === false) return false;
  try {
    const queued = await queuePreferredVendorDelayedFill({
      leadId: input.leadId,
      preferredVendorId: vendorId,
      preferredAssigned,
      city: input.city ?? null,
      category: input.category ?? input.serviceRequired ?? null,
      subcategory: input.subcategory ?? null,
    });
    return queued.ok ? queued.data.queued : false;
  } catch (error) {
    console.warn("[preferred vendor] delayed-fill queue skipped", {
      lead_id: input.leadId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return false;
  }
}

/** No-credits notification — never contains client contact. Best-effort. */
async function notifyVendorRechargeSafe(vendorId: string): Promise<void> {
  const notify = await createVendorNotification(vendorId, {
    title: "A client selected your profile",
    message: "A client selected your profile, but your lead credits are unavailable. Recharge to receive this enquiry. QuickFurno will hold the client contact until then.",
    type: "lead_selected_recharge",
    priority: "high",
    cta_label: "Recharge now",
    cta_url: "/vendor/dashboard/package",
  });
  if (!notify.ok) console.warn("[preferred vendor] recharge notification skipped", { code: notify.code });
}

async function resolveAssignmentId(leadId: string, vendorId: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("lead_assignments")
    .select("id")
    .eq("lead_id", leadId)
    .eq("vendor_id", vendorId)
    .order("assigned_at", { ascending: false })
    .limit(1);
  if (error || !data || !data[0]) return null;
  const id = (data[0] as { id?: string }).id;
  return id ? String(id) : null;
}

/**
 * Best-effort audit write of the preferred-vendor context onto the lead. If the
 * Phase 1 columns (migration 035) are not applied yet, this silently no-ops so
 * lead submission and routing are never blocked.
 */
async function markLeadPreferred(
  input: RoutePreferredVendorInput,
  preferredStatus: string,
  reason: string | null,
  vendorName?: string | null,
): Promise<void> {
  const payload: Record<string, unknown> = {
    lead_intent: "preferred_vendor",
    target_vendor_id: UUID_RE.test(String(input.vendorId ?? "")) ? input.vendorId : null,
    target_vendor_name: asText(vendorName) ?? asText(input.vendorName),
    target_vendor_category: asText(input.category),
    target_vendor_subcategory: asText(input.subcategory),
    preferred_vendor_id: UUID_RE.test(String(input.vendorId ?? "")) ? input.vendorId : null,
    preferred_vendor_status: preferredStatus,
    preferred_vendor_status_reason: reason,
    preferred_vendor_checked_at: new Date().toISOString(),
    fallback_allowed: input.fallbackAllowed ?? true,
  };

  const { error } = await adminClient().from("leads").update(payload).eq("id", input.leadId);
  if (error && isMissingColumnError(error)) {
    console.warn("[preferred vendor] lead intent columns missing — skipping audit write.", {
      hint: PREFERRED_VENDOR_MIGRATION_HINT,
    });
    return;
  }
  if (error) {
    console.warn("[preferred vendor] lead audit write skipped", { message: error.message });
  }
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || (message.includes("column") && message.includes("does not exist"));
}

function result(
  status: PreferredVendorRoutingStatus,
  assigned: boolean,
  vendorId: string | null,
  vendorName: string | null,
  reason: string | null,
  contactShared = false,
  queuedForDelayedFill = false,
): PreferredVendorRoutingResult {
  return {
    status,
    assigned,
    vendor_id: vendorId,
    vendor_name: vendorName,
    reason,
    contact_shared: contactShared,
    queued_for_delayed_fill: queuedForDelayedFill,
  };
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
