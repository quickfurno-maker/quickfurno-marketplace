// ============================================================================
// QuickFurno — Client Journey V2 / Phase 1 enrichment maintenance.
// No provider calls, no matching, no assignment. Core only closes genuinely
// unanswered enrichment after a successfully-sent reminder and a grace period.
// ============================================================================

import { adminClient } from "@/lib/supabase";

const NO_RESPONSE_GRACE_HOURS = 24;
const QUALIFYING_COMMUNICATION_STATUSES = new Set(["sent", "delivered", "read"]);

export type LeadEnrichmentMaintenanceResult = {
  checked: number;
  nurtured: number;
  skipped: number;
};

export async function runLeadEnrichmentNoResponseSweep(
  limit = 25,
  now = new Date(),
): Promise<LeadEnrichmentMaintenanceResult> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const cutoff = new Date(
    now.getTime() - NO_RESPONSE_GRACE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: candidates, error } = await adminClient()
    .from("lead_clarification_requests")
    .select(
      "id,lead_id,status,response_received_at,reminder_communication_message_id,reminder_sent_at",
    )
    .eq("status", "preview_sent")
    .is("response_received_at", null)
    .not("reminder_communication_message_id", "is", null)
    .not("reminder_sent_at", "is", null)
    .lte("reminder_sent_at", cutoff)
    .order("reminder_sent_at", { ascending: true })
    .limit(boundedLimit);

  if (error) throw error;

  const result: LeadEnrichmentMaintenanceResult = {
    checked: 0,
    nurtured: 0,
    skipped: 0,
  };

  for (const candidate of candidates ?? []) {
    result.checked += 1;
    const messageId = String(candidate.reminder_communication_message_id ?? "");
    if (!messageId) {
      result.skipped += 1;
      continue;
    }

    const { data: communication, error: communicationError } = await adminClient()
      .from("communication_messages")
      .select("id,status")
      .eq("id", messageId)
      .maybeSingle();
    if (communicationError) throw communicationError;

    if (
      !communication ||
      !QUALIFYING_COMMUNICATION_STATUSES.has(String(communication.status ?? ""))
    ) {
      // Accepted-only, failed, cancelled, uncertain, or missing evidence must
      // never be interpreted as "the client ignored us".
      result.skipped += 1;
      continue;
    }

    const completedAt = now.toISOString();
    const { data: expiredRows, error: expireError } = await adminClient()
      .from("lead_clarification_requests")
      .update({
        status: "expired_no_response",
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", candidate.id)
      .eq("lead_id", candidate.lead_id)
      .eq("status", "preview_sent")
      .is("response_received_at", null)
      .select("id");
    if (expireError) throw expireError;

    if (!Array.isArray(expiredRows) || expiredRows.length !== 1) {
      result.skipped += 1;
      continue;
    }

    const { error: leadError } = await adminClient()
      .from("leads")
      .update({
        clarification_required: false,
        clarification_status: "expired_no_response",
        journey_state: "nurture",
        match_readiness_status: "blocked",
        reachability_status: "unknown",
        clarification_checked_at: completedAt,
        qualification_checked_at: completedAt,
      })
      .eq("id", candidate.lead_id)
      .eq("clarification_last_request_id", candidate.id)
      .eq("clarification_required", true);
    if (leadError) throw leadError;

    result.nurtured += 1;
  }

  return result;
}
