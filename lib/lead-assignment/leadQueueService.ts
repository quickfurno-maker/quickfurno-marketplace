import { runSafeAgentEventPipeline } from "@/lib/aos/events/safeAgentEventPipeline";
import { fail, ok, type Result } from "@/lib/errors";
import { adminClient } from "@/lib/supabase";

export interface QueueLeadForAssignmentInput {
  leadId: string;
  city?: string | null;
  category?: string | null;
  subcategory?: string | null;
  queueReason: string;
  requiredVendorCount: number;
  eligibleVendorCount: number;
  selectedVendorIds?: string[];
  rejectedVendorReasons?: Record<string, string[]>;
  nextRetryAt?: string | null;
}

export interface LeadAssignmentQueueRow {
  id: string;
  lead_id: string;
  city?: string | null;
  category?: string | null;
  subcategory?: string | null;
  queue_status: string;
  queue_reason: string;
  required_vendor_count: number;
  eligible_vendor_count: number;
  selected_vendor_ids: string[];
  rejected_vendor_reasons: Record<string, string[]>;
  last_checked_at?: string | null;
  next_retry_at?: string | null;
  matching_attempt_count: number;
  resolved_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function queueLeadForAssignment(
  input: QueueLeadForAssignmentInput,
): Promise<Result<LeadAssignmentQueueRow>> {
  try {
    const leadId = (input.leadId ?? "").trim();
    if (!leadId) return { ok: false, code: "VALIDATION", error: "A lead id is required." };

    const db = adminClient();
    const now = new Date().toISOString();
    const existing = await db
      .from("lead_assignment_queue")
      .select("*")
      .eq("lead_id", leadId)
      .in("queue_status", ["queued", "matched_preview"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = {
      lead_id: leadId,
      city: input.city ?? null,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
      queue_status: "queued",
      queue_reason: input.queueReason,
      required_vendor_count: input.requiredVendorCount,
      eligible_vendor_count: input.eligibleVendorCount,
      selected_vendor_ids: input.selectedVendorIds ?? [],
      rejected_vendor_reasons: input.rejectedVendorReasons ?? {},
      last_checked_at: now,
      next_retry_at: input.nextRetryAt ?? null,
      updated_at: now,
    };

    if (existing.data?.id) {
      const previousAttempts = Number(existing.data.matching_attempt_count ?? 0);
      const { data, error } = await db
        .from("lead_assignment_queue")
        .update({
          ...payload,
          matching_attempt_count: previousAttempts + 1,
        })
        .eq("id", existing.data.id)
        .select("*")
        .single();
      if (error) throw error;
      return ok(mapQueueRow(data));
    }

    const { data, error } = await db
      .from("lead_assignment_queue")
      .insert({
        ...payload,
        matching_attempt_count: 1,
      })
      .select("*")
      .single();
    if (error) throw error;
    return ok(mapQueueRow(data));
  } catch (error) {
    return fail(error);
  }
}

export async function listQueuedLeads(): Promise<Result<LeadAssignmentQueueRow[]>> {
  try {
    const { data, error } = await adminClient()
      .from("lead_assignment_queue")
      .select("*")
      .in("queue_status", ["queued", "matched_preview"])
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok((data ?? []).map(mapQueueRow));
  } catch (error) {
    return fail(error);
  }
}

export async function recheckQueuedLead(
  queueIdOrLeadId: string,
  checkedBy = "Superadmin",
): Promise<Result<Record<string, unknown>>> {
  try {
    const lookup = (queueIdOrLeadId ?? "").trim();
    if (!lookup) return { ok: false, code: "VALIDATION", error: "A queue id or lead id is required." };

    const queue = await findQueueRow(lookup);
    if (!queue) return { ok: false, code: "UNKNOWN", error: "Queue row not found." };

    const { runAutoAssignmentPreviewForLead } = await import("@/lib/lead-assignment/autoAssignmentEngine");
    const result = await runAutoAssignmentPreviewForLead(queue.lead_id, {
      createdBy: checkedBy,
      source: "queue_recheck",
    });

    if (result.ok && result.data.status === "auto_suggested") {
      await adminClient()
        .from("lead_assignment_queue")
        .update({
          queue_status: "matched_preview",
          queue_reason: "paid_vendor_preview_available",
          eligible_vendor_count: result.data.eligibleVendorCount,
          selected_vendor_ids: result.data.selectedVendorIds,
          rejected_vendor_reasons: result.data.rejectedVendorReasons,
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", queue.id);
    }

    await runSafeAgentEventPipeline({
      eventType: "lead.assignment_queue_rechecked",
      leadId: queue.lead_id,
      source: "phase-25a-admin-recheck",
      data: {
        queueId: queue.id,
        checkedBy,
        result: result.ok ? result.data.status : "failed",
      },
    });

    if (!result.ok) return result;
    return ok({ queueId: queue.id, ...result.data });
  } catch (error) {
    return fail(error);
  }
}

export async function markQueueResolved(
  queueId: string,
  adminNote?: string | null,
): Promise<Result<LeadAssignmentQueueRow>> {
  try {
    const id = (queueId ?? "").trim();
    if (!id) return { ok: false, code: "VALIDATION", error: "A queue id is required." };
    const now = new Date().toISOString();
    const { data, error } = await adminClient()
      .from("lead_assignment_queue")
      .update({
        queue_status: "resolved",
        queue_reason: adminNote?.trim() || "resolved_by_admin",
        resolved_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return ok(mapQueueRow(data));
  } catch (error) {
    return fail(error);
  }
}

async function findQueueRow(queueIdOrLeadId: string): Promise<LeadAssignmentQueueRow | null> {
  const db = adminClient();
  const byId = await db
    .from("lead_assignment_queue")
    .select("*")
    .eq("id", queueIdOrLeadId)
    .maybeSingle();
  if (byId.data) return mapQueueRow(byId.data);

  const byLead = await db
    .from("lead_assignment_queue")
    .select("*")
    .eq("lead_id", queueIdOrLeadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return byLead.data ? mapQueueRow(byLead.data) : null;
}

function mapQueueRow(row: Record<string, unknown>): LeadAssignmentQueueRow {
  return {
    id: String(row.id),
    lead_id: String(row.lead_id),
    city: asText(row.city),
    category: asText(row.category),
    subcategory: asText(row.subcategory),
    queue_status: asText(row.queue_status) ?? "queued",
    queue_reason: asText(row.queue_reason) ?? "queued",
    required_vendor_count: asNumber(row.required_vendor_count, 1),
    eligible_vendor_count: asNumber(row.eligible_vendor_count, 0),
    selected_vendor_ids: Array.isArray(row.selected_vendor_ids) ? row.selected_vendor_ids.map(String) : [],
    rejected_vendor_reasons: isRecord(row.rejected_vendor_reasons)
      ? Object.fromEntries(Object.entries(row.rejected_vendor_reasons).map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : []]))
      : {},
    last_checked_at: asText(row.last_checked_at),
    next_retry_at: asText(row.next_retry_at),
    matching_attempt_count: asNumber(row.matching_attempt_count, 0),
    resolved_at: asText(row.resolved_at),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
  };
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
