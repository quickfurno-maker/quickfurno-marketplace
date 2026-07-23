// ============================================================================
// QuickFurno — services/delayedLeadFillService.ts
// Phase 2: Delayed fallback filling for preferred-vendor leads.
//
// Phase 1 (services/preferredVendorLeadService.ts) routes a client-picked
// enquiry FIRST to that single vendor. Phase 2 then, AFTER a 1-hour window,
// tops the lead up to a HARD cap of 3 total vendors with the best matching
// eligible paid/trial vendors — never sooner, never beyond 3, never twice to
// the same vendor, and never sharing client contact with a free/unpaid vendor.
//
// Two queue reasons drive this (rows live in the existing lead_assignment_queue):
//   * delayed_fill_after_preferred_vendor      — preferred vendor already got the
//     lead; fill the remaining ≤2 slots after 1 hour.
//   * preferred_vendor_no_credits_pending_fallback — preferred vendor had no
//     credits; after 1 hour, assign the preferred vendor if they recharged/became
//     eligible, otherwise fill with better matching eligible vendors.
//
// Credits are NEVER touched here directly.
//
// QF-MVP-20.3R1:
//   * The system FILL runs through the sole canonical authority
//     `qf_assign_lead_vendors_v2` (mode `delayed_fill`, actor `worker`), which
//     owns the active-3 / lifetime-6 caps, re-validates eligibility, skips
//     duplicates and debits exactly 1 wallet credit per assignment. No ceiling
//     is passed by this service and no legacy RPC is used as a fallback.
//   * The PREFERRED-vendor recharge re-assignment is a CLIENT-SELECTED
//     assignment and is therefore FAIL-CLOSED under
//     R1_BLOCKED_PENDING_OWNER_BINDING. The lead is still filled with system
//     vendors; nothing is assigned to the preferred vendor and no credit moves.
//
// Category matching uses the shared categoryMatching helper. WhatsApp stays
// preview/log only. Nothing here throws to the caller.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { fail, ok, isMissingRelationError, type Result } from "../lib/errors";
import { NORMAL_PRIMARY_VENDOR_LIMIT, MANUAL_INTERIOR_FALLBACK_ENABLED } from "../lib/config";
import {
  executeCanonicalAssignment,
  R1_BLOCKED_PENDING_OWNER_BINDING,
} from "./canonicalAssignmentAuthority";
import {
  evaluateVendorLeadAssignmentEligibility,
} from "../lib/vendors/vendorEligibility";
import {
  isExactLeadVendorSubcategoryMatch,
  isInteriorFallbackCompatible,
} from "../lib/vendors/categoryMatching";
import {
  createClientAssignedVendorsPreview,
  createVendorLeadWhatsappPreview,
  deliverLeadToVendorDashboard,
  type DeliveredVendor,
} from "./leadDeliveryService";
import { createVendorNotification } from "./vendorNotificationService";
import { queueLeadForAssignment } from "../lib/lead-assignment/leadQueueService";

// Queue reasons owned by the delayed-fill processor. Free text in the DB (no
// CHECK constraint), so no migration is needed to introduce them.
export const DELAYED_FILL_AFTER_PREFERRED = "delayed_fill_after_preferred_vendor";
export const PREFERRED_NO_CREDITS_PENDING_FALLBACK = "preferred_vendor_no_credits_pending_fallback";
export const PROCESSOR_QUEUE_REASONS = [DELAYED_FILL_AFTER_PREFERRED, PREFERRED_NO_CREDITS_PENDING_FALLBACK] as const;

// The 1-hour delayed-fill window and the between-retry cadence when no eligible
// vendor is available yet.
export const DELAYED_FILL_WINDOW_MINUTES = 60;
const RETRY_INTERVAL_MINUTES = 60;
// After this many empty attempts, stop auto-retrying (keep queued for admin).
const MAX_MATCHING_ATTEMPTS = 24;

const ASSIGNMENT_SOURCE = "preferred_delayed_fill";
const FILL_ALLOW_TRIAL = { allow_trial_vendors_for_assignment: true } as const;

const VENDOR_PAGE_SIZE = 500;
const MAX_VENDOR_SCAN = 5000;

// Commercial / city gates that make a vendor unusable for a fill slot. These
// mirror the manual-assignment hard gates (category is matched separately in JS).
const HARD_REASONS = new Set([
  "vendor_pending_approval",
  "vendor_suspended",
  "vendor_inactive",
  "free_unpaid_vendor_not_eligible_for_assignment",
  "package_expired",
  "no_credits",
  "city_mismatch",
  "already_assigned",
]);

// ---------------------------------------------------------------------------
// A) / B) — queue a preferred-vendor lead for delayed fill.
// ---------------------------------------------------------------------------
export type QueuePreferredDelayedFillInput = {
  leadId: string;
  preferredVendorId: string;
  /** true → preferred vendor already assigned (reason A); false → no-credits (reason B). */
  preferredAssigned: boolean;
  city?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

/**
 * Create/refresh the delayed-fill queue row for a preferred-vendor lead. Best-
 * effort: a queue failure must never block lead submission, so it resolves to a
 * safe Result and callers ignore the error.
 */
export async function queuePreferredVendorDelayedFill(
  input: QueuePreferredDelayedFillInput,
): Promise<Result<{ queued: boolean }>> {
  try {
    const leadId = String(input.leadId ?? "").trim();
    const preferredVendorId = String(input.preferredVendorId ?? "").trim();
    if (!leadId || !preferredVendorId) return { ok: false, code: "VALIDATION", error: "lead id and preferred vendor id are required." };

    const nextRetryAt = new Date(Date.now() + DELAYED_FILL_WINDOW_MINUTES * 60_000).toISOString();
    const queued = await queueLeadForAssignment({
      leadId,
      city: input.city ?? null,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
      queueReason: input.preferredAssigned ? DELAYED_FILL_AFTER_PREFERRED : PREFERRED_NO_CREDITS_PENDING_FALLBACK,
      requiredVendorCount: NORMAL_PRIMARY_VENDOR_LIMIT,
      eligibleVendorCount: input.preferredAssigned ? 1 : 0,
      selectedVendorIds: [preferredVendorId],
      nextRetryAt,
    });
    if (!queued.ok) {
      if (isMissingRelationError({ code: queued.code, message: queued.error })) {
        console.warn("[delayed fill] queue table missing — skipping delayed fill queue. Apply migration 20260701000022.");
        return ok({ queued: false });
      }
      console.warn("[delayed fill] queue write skipped", { code: queued.code, error: queued.error });
      return ok({ queued: false });
    }
    return ok({ queued: true });
  } catch (e) {
    console.warn("[delayed fill] queue write threw — lead unaffected", {
      message: e instanceof Error ? e.message : "Unknown error",
    });
    return ok({ queued: false });
  }
}

// ---------------------------------------------------------------------------
// C) — the delayed-fill processor.
// ---------------------------------------------------------------------------
export type DelayedFillRowResult = {
  queue_id: string;
  lead_id: string;
  queue_reason: string;
  status:
    | "resolved_already_full"
    | "resolved_filled"
    | "resolved_partial"
    | "preferred_assigned_then_filled"
    | "waiting_no_vendors"
    | "waiting_no_consent"
    | "skipped_lead_missing"
    | "skipped_duplicate"
    | "error";
  preferred_assigned: boolean;
  assigned_vendor_ids: string[];
  total_assigned_after: number;
  message: string;
};

export type ProcessDueResult = { processed: DelayedFillRowResult[] };

/**
 * Load every due delayed-fill queue row (queued + one of our reasons +
 * next_retry_at ≤ now) and process each. Manual/admin/cron callable. Never
 * throws — per-row failures are captured and the batch continues.
 */
export async function processDueLeadAssignmentQueue(limit = 25): Promise<Result<ProcessDueResult>> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await adminClient()
      .from("lead_assignment_queue")
      .select("*")
      .eq("queue_status", "queued")
      .in("queue_reason", [...PROCESSOR_QUEUE_REASONS])
      .lte("next_retry_at", nowIso)
      .order("next_retry_at", { ascending: true })
      .limit(limit);
    if (error) {
      if (isMissingRelationError(error)) return migrationNotApplied();
      throw error;
    }

    const processed: DelayedFillRowResult[] = [];
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const result = await processOneDelayedFillRow(row);
      processed.push(result);
    }
    return ok({ processed });
  } catch (e) {
    return fail(e);
  }
}

/** Process a single queue row. Always resolves to a DelayedFillRowResult. */
async function processOneDelayedFillRow(row: Record<string, unknown>): Promise<DelayedFillRowResult> {
  const queueId = String(row.id ?? "");
  const leadId = String(row.lead_id ?? "");
  const queueReason = asText(row.queue_reason) ?? DELAYED_FILL_AFTER_PREFERRED;
  const selectedVendorIds = Array.isArray(row.selected_vendor_ids) ? row.selected_vendor_ids.map(String) : [];
  const preferredVendorId = selectedVendorIds[0] ?? null;
  const attemptCount = asNumber(row.matching_attempt_count, 0);

  const base: DelayedFillRowResult = {
    queue_id: queueId,
    lead_id: leadId,
    queue_reason: queueReason,
    status: "error",
    preferred_assigned: false,
    assigned_vendor_ids: [],
    total_assigned_after: 0,
    message: "",
  };

  try {
    const db = adminClient();

    const { data: leadRow, error: leadError } = await db.from("leads").select("*").eq("id", leadId).maybeSingle();
    if (leadError) throw leadError;
    if (!leadRow) {
      await resolveQueueRow(queueId, "delayed_fill_lead_not_found");
      return { ...base, status: "skipped_lead_missing", message: "Lead not found; queue row resolved." };
    }
    const lead = leadRow as Record<string, unknown>;

    // Never share client contact without consent (defensive — routing already
    // required consent, but the lead could have been redacted meanwhile).
    if (lead.share_consent === false) {
      await keepQueuedWaiting(queueId, attemptCount, "delayed_fill_waiting_consent_withdrawn");
      return { ...base, status: "waiting_no_consent", message: "Lead consent withdrawn; delayed fill paused." };
    }

    // Never assign a flagged duplicate automatically.
    if (lead.is_duplicate === true) {
      await resolveQueueRow(queueId, "delayed_fill_duplicate_lead_admin_review");
      return { ...base, status: "skipped_duplicate", message: "Duplicate lead; left for admin review." };
    }

    const assignedVendorIds = await loadAssignedVendorIds(leadId);
    let preferredAssigned = preferredVendorId ? assignedVendorIds.has(preferredVendorId) : false;
    let remainingSlots = NORMAL_PRIMARY_VENDOR_LIMIT - assignedVendorIds.size;

    if (remainingSlots <= 0) {
      await resolveQueueRow(queueId, "delayed_fill_complete_already_full");
      return {
        ...base,
        status: "resolved_already_full",
        preferred_assigned: preferredAssigned,
        total_assigned_after: assignedVendorIds.size,
        message: "Lead already has 3 assigned vendors; nothing to fill.",
      };
    }

    // B) No-credits fallback: give the preferred vendor a second chance first.
    let preferredAssignedNow = false;
    if (
      queueReason === PREFERRED_NO_CREDITS_PENDING_FALLBACK &&
      preferredVendorId &&
      !preferredAssigned
    ) {
      const recheck = await tryAssignPreferredVendor(leadId, preferredVendorId);
      if (recheck.assigned) {
        preferredAssignedNow = true;
        preferredAssigned = true;
        assignedVendorIds.add(preferredVendorId);
        remainingSlots = NORMAL_PRIMARY_VENDOR_LIMIT - assignedVendorIds.size;
        await deliverToVendor(leadId, preferredVendorId, "A client selected your profile");
      }
    }

    if (remainingSlots <= 0) {
      await refreshClientPreview(leadId);
      await resolveQueueRow(queueId, "delayed_fill_preferred_recharged_full");
      return {
        ...base,
        status: preferredAssignedNow ? "preferred_assigned_then_filled" : "resolved_filled",
        preferred_assigned: preferredAssigned,
        assigned_vendor_ids: preferredAssignedNow ? [preferredVendorId!] : [],
        total_assigned_after: assignedVendorIds.size,
        message: "Preferred vendor recharged and the lead is now full.",
      };
    }

    // D) Fill remaining slots with the best matching eligible vendors, EXCLUDING
    // already-assigned vendors and the preferred vendor.
    const excluded = new Set(assignedVendorIds);
    if (preferredVendorId) excluded.add(preferredVendorId);

    const candidateIds = await selectBestFillCandidates(lead, excluded, remainingSlots);
    if (candidateIds.length === 0) {
      await keepQueuedWaiting(queueId, attemptCount, "delayed_fill_waiting_no_eligible_vendors");
      return {
        ...base,
        status: preferredAssignedNow ? "preferred_assigned_then_filled" : "waiting_no_vendors",
        preferred_assigned: preferredAssigned,
        assigned_vendor_ids: preferredAssignedNow ? [preferredVendorId!] : [],
        total_assigned_after: assignedVendorIds.size,
        message: preferredAssignedNow
          ? "Preferred vendor recharged; no other eligible vendors yet — still waiting."
          : "No eligible vendors available yet; kept queued for a later retry.",
      };
    }

    const assign = await callCanonicalDelayedFill(leadId, candidateIds);
    if (!assign.ok) {
      if (assign.code === "DUPLICATE_LEAD" || assign.code === "LEAD_NOT_FOUND") {
        await resolveQueueRow(queueId, `delayed_fill_${assign.code.toLowerCase()}_admin_review`);
        return { ...base, status: "skipped_duplicate", message: `Fill skipped: ${assign.error}` };
      }
      if (assign.code === "LEAD_ALREADY_ASSIGNED") {
        await resolveQueueRow(queueId, "delayed_fill_complete_already_full");
        return { ...base, status: "resolved_already_full", total_assigned_after: assignedVendorIds.size, message: "Lead reached 3 vendors concurrently." };
      }
      // Transient RPC failure (incl. missing migration): keep queued for retry.
      await keepQueuedWaiting(queueId, attemptCount, `delayed_fill_retry_${assign.code.toLowerCase()}`);
      return { ...base, status: "waiting_no_vendors", total_assigned_after: assignedVendorIds.size, message: `Fill RPC failed (${assign.code}); kept queued.` };
    }

    const filledIds = assign.data.assigned;
    for (const vendorId of filledIds) {
      assignedVendorIds.add(vendorId);
      await deliverToVendor(leadId, vendorId, "QuickFurno matched a new lead to you");
    }
    await refreshClientPreview(leadId);

    const totalAfter = assignedVendorIds.size;
    const allAssigned = [...(preferredAssignedNow && preferredVendorId ? [preferredVendorId] : []), ...filledIds];

    if (totalAfter >= NORMAL_PRIMARY_VENDOR_LIMIT || filledIds.length >= remainingSlots) {
      await resolveQueueRow(queueId, "delayed_fill_complete");
      return {
        ...base,
        status: preferredAssignedNow ? "preferred_assigned_then_filled" : "resolved_filled",
        preferred_assigned: preferredAssigned,
        assigned_vendor_ids: allAssigned,
        total_assigned_after: totalAfter,
        message: `Delayed fill assigned ${filledIds.length} vendor(s); lead now has ${totalAfter}.`,
      };
    }

    // Partial fill — some slots remain but no more candidates were assignable this
    // round. Keep queued so later recharges can top it up (never beyond 3).
    await keepQueuedWaiting(queueId, attemptCount, "delayed_fill_partial_waiting_more_vendors", assignedVendorIds);
    return {
      ...base,
      status: "resolved_partial",
      preferred_assigned: preferredAssigned,
      assigned_vendor_ids: allAssigned,
      total_assigned_after: totalAfter,
      message: `Delayed fill assigned ${filledIds.length} vendor(s); ${NORMAL_PRIMARY_VENDOR_LIMIT - totalAfter} slot(s) still pending.`,
    };
  } catch (e) {
    console.warn("[delayed fill] row processing failed", {
      queue_id: queueId,
      lead_id: leadId,
      message: e instanceof Error ? e.message : "Unknown error",
    });
    return { ...base, status: "error", message: e instanceof Error ? e.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------------
// Candidate selection (JS category matching + hard eligibility)
// ---------------------------------------------------------------------------
async function selectBestFillCandidates(
  lead: Record<string, unknown>,
  excluded: Set<string>,
  slots: number,
): Promise<string[]> {
  if (slots <= 0) return [];
  const vendors = await loadVendors();

  const scored = vendors.flatMap((vendor) => {
    const id = String(vendor.id ?? "");
    if (!id || excluded.has(id)) return [];

    const exact = isExactLeadVendorSubcategoryMatch(lead, vendor);
    const fallback = MANUAL_INTERIOR_FALLBACK_ENABLED && isInteriorFallbackCompatible(lead, vendor).compatible;
    if (!exact && !fallback) return [];

    const eligibility = evaluateVendorLeadAssignmentEligibility(vendor, lead, FILL_ALLOW_TRIAL);
    if (eligibility.reasons.some((reason) => HARD_REASONS.has(reason))) return [];

    return [{ id, score: scoreCandidate(vendor, lead, exact, eligibility.credits) }];
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, slots).map((candidate) => candidate.id);
}

/** Best-match tier + area/rating/credit tie-breakers (paid vendors already gated). */
function scoreCandidate(
  vendor: Record<string, unknown>,
  lead: Record<string, unknown>,
  exact: boolean,
  credits: number,
): number {
  let score = exact ? 100 : 60;
  const leadArea = asText(lead.area) || asText(lead.locality);
  const areasCovered = Array.isArray(vendor.areas_covered) ? vendor.areas_covered.map(String) : [];
  if (vendor.covers_full_city === true) score += 10;
  else if (leadArea && areasCovered.some((area) => textEquals(area, leadArea))) score += 12;
  const rating = Number(vendor.rating ?? 0);
  if (Number.isFinite(rating)) score += Math.min(15, Math.max(0, rating * 3));
  const completed = Number(vendor.completed_projects ?? 0);
  if (Number.isFinite(completed)) score += Math.min(10, completed / 10);
  if (Number.isFinite(credits)) score += Math.min(8, credits);
  return Math.round(score * 100) / 100;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** Distinct vendor ids already assigned to a lead. */
async function loadAssignedVendorIds(leadId: string): Promise<Set<string>> {
  const { data, error } = await adminClient().from("lead_assignments").select("vendor_id").eq("lead_id", leadId);
  if (error) throw error;
  return new Set((data ?? []).map((r: { vendor_id?: string | null }) => String(r.vendor_id ?? "")).filter(Boolean));
}

/**
 * QF-MVP-20.3R1 — preferred-vendor re-assignment is FAIL-CLOSED.
 *
 * Re-assigning the client's chosen vendor is a CLIENT-SELECTED assignment. The
 * canonical authority rejects that mode because the database has no trustworthy
 * lead-to-client ownership binding to re-assert (R1_BLOCKED_PENDING_OWNER_BINDING
 * — see services/canonicalAssignmentAuthority.ts). This function therefore
 * performs NO assignment, NO credit deduction, NO ledger write and NO database
 * round-trip at all; the caller continues with the system fill instead.
 */
async function tryAssignPreferredVendor(leadId: string, vendorId: string): Promise<{ assigned: boolean; reason: string }> {
  console.warn("[delayed fill] preferred re-assignment blocked pending owner binding", {
    lead_id: leadId,
    vendor_id: vendorId,
    reason: R1_BLOCKED_PENDING_OWNER_BINDING,
  });
  return { assigned: false, reason: R1_BLOCKED_PENDING_OWNER_BINDING };
}

type SmartAssignData = { assigned: string[]; skipped: string[] };

/**
 * QF-MVP-20.3R1 — system fill through the canonical authority.
 *
 * Takes NO limit argument: active-3 / lifetime-6 belong to the authority. Fails
 * closed; there is no fallback to `admin_smart_assign_lead_to_vendors`.
 */
async function callCanonicalDelayedFill(leadId: string, vendorIds: string[]): Promise<Result<SmartAssignData>> {
  const outcome = await executeCanonicalAssignment({
    leadId,
    mode: "delayed_fill",
    candidateVendorIds: vendorIds,
    operationScope: "delayed_fill",
    actorKind: "worker",
    actorId: null,
    reasonCode: "delayed_fill",
  });
  if (!outcome.ok) return outcome;

  return ok({ assigned: outcome.data.assigned_vendor_ids, skipped: outcome.data.skipped_vendor_ids });
}

/** Dashboard delivery + WhatsApp preview (log only) + vendor notification. */
async function deliverToVendor(leadId: string, vendorId: string, notifyTitle: string): Promise<void> {
  const assignmentId = await resolveAssignmentId(leadId, vendorId);
  if (assignmentId) {
    const dash = await deliverLeadToVendorDashboard(leadId, vendorId, assignmentId, { assignmentSource: ASSIGNMENT_SOURCE });
    if (!dash.ok) console.warn("[delayed fill] dashboard delivery log skipped", { code: dash.code });
    const preview = await createVendorLeadWhatsappPreview(leadId, vendorId, assignmentId, { assignmentSource: ASSIGNMENT_SOURCE });
    if (!preview.ok) console.warn("[delayed fill] vendor whatsapp preview skipped", { code: preview.code });
  } else {
    console.warn("[delayed fill] assignment id unresolved; delivery log skipped", { lead_id: leadId, vendor_id: vendorId });
  }
  const notify = await createVendorNotification(vendorId, {
    title: notifyTitle,
    message: "Open your dashboard to view the client details for this QuickFurno lead.",
    type: "lead_assigned",
    priority: "high",
    cta_label: "View lead",
    cta_url: "/vendor/dashboard/leads",
  });
  if (!notify.ok) console.warn("[delayed fill] vendor notification skipped", { code: notify.code });
}

/** Refresh the client-facing assigned-vendors preview log for the whole lead. */
async function refreshClientPreview(leadId: string): Promise<void> {
  const delivered = await loadDeliveredVendors(leadId);
  const preview = await createClientAssignedVendorsPreview(leadId, delivered);
  if (!preview.ok) console.warn("[delayed fill] client preview skipped", { code: preview.code });
}

async function loadDeliveredVendors(leadId: string): Promise<DeliveredVendor[]> {
  const { data, error } = await adminClient()
    .from("lead_assignments")
    .select("id, vendor_id")
    .eq("lead_id", leadId)
    .order("assigned_at", { ascending: true });
  if (error || !data) return [];
  const seen = new Set<string>();
  const delivered: DeliveredVendor[] = [];
  for (const row of data as Array<{ id?: string; vendor_id?: string }>) {
    const vendorId = String(row.vendor_id ?? "");
    if (!vendorId || !row.id || seen.has(vendorId)) continue;
    seen.add(vendorId);
    delivered.push({ vendor_id: vendorId, assignment_id: String(row.id) });
  }
  return delivered;
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

async function loadVendors(): Promise<Array<Record<string, unknown>>> {
  const db = adminClient();
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < MAX_VENDOR_SCAN; from += VENDOR_PAGE_SIZE) {
    const { data, error } = await db.from("vendors").select("*").order("id", { ascending: true }).range(from, from + VENDOR_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < VENDOR_PAGE_SIZE) break;
  }
  return rows;
}

/** Mark a queue row resolved (terminal). */
async function resolveQueueRow(queueId: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await adminClient()
    .from("lead_assignment_queue")
    .update({ queue_status: "resolved", queue_reason: reason, resolved_at: now, last_checked_at: now, updated_at: now })
    .eq("id", queueId);
  if (error) console.warn("[delayed fill] resolve queue row skipped", { queue_id: queueId, message: error.message });
}

/**
 * Keep a queue row queued and push its retry forward. After MAX_MATCHING_ATTEMPTS
 * empty rounds it stays queued but retries only once a day so it never hot-loops.
 */
async function keepQueuedWaiting(
  queueId: string,
  attemptCount: number,
  reason: string,
  assignedVendorIds?: Set<string>,
): Promise<void> {
  const now = new Date();
  const backoffMinutes = attemptCount >= MAX_MATCHING_ATTEMPTS ? 24 * 60 : RETRY_INTERVAL_MINUTES;
  const patch: Record<string, unknown> = {
    queue_status: "queued",
    queue_reason: reason,
    matching_attempt_count: attemptCount + 1,
    last_checked_at: now.toISOString(),
    next_retry_at: new Date(now.getTime() + backoffMinutes * 60_000).toISOString(),
    updated_at: now.toISOString(),
  };
  if (assignedVendorIds) {
    patch.selected_vendor_ids = [...assignedVendorIds];
    patch.eligible_vendor_count = assignedVendorIds.size;
  }
  const { error } = await adminClient().from("lead_assignment_queue").update(patch).eq("id", queueId);
  if (error) console.warn("[delayed fill] keep-queued update skipped", { queue_id: queueId, message: error.message });
}

function migrationNotApplied(): Result<never> {
  return {
    ok: false,
    code: "MIGRATION_NOT_APPLIED",
    error: "lead_assignment_queue is missing. Apply migration 20260701000022_phase_25a_paid_only_auto_match_free_vendor_interest.sql.",
  };
}

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------
function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function textEquals(a: unknown, b: unknown): boolean {
  const left = typeof a === "string" ? a.trim().toLowerCase() : "";
  const right = typeof b === "string" ? b.trim().toLowerCase() : "";
  return left.length > 0 && left === right;
}
