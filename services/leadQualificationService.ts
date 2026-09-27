// ============================================================================
// QuickFurno — Client Journey V2 / Phase 1 qualification persistence
// Core owns qualification truth. This module never sends messages or assigns.
// ============================================================================

import { adminClient } from "../lib/supabase";
import type { CreateLeadInput } from "../lib/types";
import {
  evaluateLeadQualification,
  type LeadQualificationSnapshot,
} from "../lib/leads/leadQualificationContract";

export async function evaluateAndStoreLeadQualification(
  leadId: string,
  input: CreateLeadInput,
): Promise<LeadQualificationSnapshot> {
  const snapshot = evaluateLeadQualification(input);
  const db = adminClient();
  const now = new Date().toISOString();

  const { error } = await db
    .from("leads")
    .update({
      journey_state: snapshot.journeyState,
      completeness_status: snapshot.completenessStatus,
      completeness_percent: snapshot.completenessPercent,
      completeness_missing_fields: snapshot.missingFields,
      enrichment_missing_fields: snapshot.enrichmentMissingFields,
      match_readiness_status: snapshot.matchReadinessStatus,
      qualification_field_states: snapshot.fieldStates,
      qualification_checked_at: now,
    })
    .eq("id", leadId);
  if (error) throw error;
  return snapshot;
}

export async function recalculateStoredLeadQualification(
  leadId: string,
): Promise<LeadQualificationSnapshot> {
  const db = adminClient();
  const { data, error } = await db
    .from("leads")
    .select(
      "name, phone, city, area, service_required, category, budget, timeline, property_type, share_consent",
    )
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("LEAD_NOT_FOUND");

  return evaluateAndStoreLeadQualification(leadId, {
    name: String(data.name ?? ""),
    phone: String(data.phone ?? ""),
    city: String(data.city ?? ""),
    area: textOrUndefined(data.area),
    service_required: textOrUndefined(data.service_required ?? data.category),
    budget: textOrUndefined(data.budget),
    timeline: textOrUndefined(data.timeline),
    property_type: textOrUndefined(data.property_type),
    share_consent: data.share_consent === true,
  });
}
export async function markLeadMatchReady(leadId: string): Promise<void> {
  const { error } = await adminClient()
    .from("leads")
    .update({
      journey_state: "match_ready",
      match_readiness_status: "ready",
      qualification_checked_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) throw error;
}

export async function markLeadAwaitingClient(leadId: string): Promise<void> {
  const { error } = await adminClient()
    .from("leads")
    .update({
      journey_state: "awaiting_client",
      match_readiness_status: "needs_enrichment",
      qualification_checked_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) throw error;
}

export async function markLeadMatchingOutcome(
  leadId: string,
  input: {
    status: "matched" | "waiting" | "skipped" | "failed";
    assignedCount: number;
    eligibleVendorCount: number;
  },
): Promise<void> {
  let journeyState:
    | "matched"
    | "partially_matched"
    | "waiting_for_supply"
    | "manual_review" = "manual_review";
  let readiness: "ready" | "blocked" = "blocked";

  if (input.status === "matched" && input.assignedCount >= 3) {
    journeyState = "matched";
    readiness = "ready";
  } else if (input.status === "matched" && input.assignedCount > 0) {
    journeyState = "partially_matched";
    readiness = "ready";
  } else if (
    input.status === "waiting" ||
    (input.status === "matched" && input.assignedCount === 0)
  ) {
    journeyState = "waiting_for_supply";
    readiness = "ready";
  }

  const { error } = await adminClient()
    .from("leads")
    .update({
      journey_state: journeyState,
      match_readiness_status: readiness,
      qualification_checked_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) throw error;
}

export async function markLeadQualificationBlocked(
  leadId: string,
  journeyState: "manual_review" | "nurture" | "cancelled" = "manual_review",
): Promise<void> {
  const { error } = await adminClient()
    .from("leads")
    .update({
      journey_state: journeyState,
      match_readiness_status: "blocked",
      qualification_checked_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) throw error;
}

function textOrUndefined(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}
