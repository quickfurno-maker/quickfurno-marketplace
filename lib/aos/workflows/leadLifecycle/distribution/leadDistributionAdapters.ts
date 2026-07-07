import { adminClient } from "../../../../supabase";
import { getDomainEventById } from "../../../workflow/domainEventService";
import { getWorkflowInstanceById } from "../../../workflow/workflowRepository";
import { SupabaseLeadLifecycleDomainEventRepository } from "../events/leadLifecycleEventPublisher";
import type { DomainEventRecord, WorkflowInstanceRecord } from "../../../workflow/workflowPersistenceTypes";
import type {
  LeadDistributionRecommendationEventPort,
  LeadDistributionRoutingPort,
  LeadDistributionWorkflowStatePort,
  LeadRoutingSnapshot,
} from "./leadDistributionTypes";
import {
  DurableLeadDistributionApprovalPublisher,
} from "./leadDistributionApprovalPublisher";
import type { LeadDistributionApprovalServiceDeps } from "./leadDistributionApprovalService";

/**
 * QuickFurno Distribution Control — Supabase-backed default ports (Phase 3A).
 *
 * These read-only adapters wire the pure distribution modules to the durable
 * kernel tables. They are NOT exercised by the Phase 3A harness (which injects
 * in-memory ports), and they are NOT invoked by any running worker in Phase 3A.
 */

export class SupabaseLeadDistributionRecommendationEventPort
  implements LeadDistributionRecommendationEventPort
{
  async getDomainEventById(eventId: string): Promise<DomainEventRecord | null> {
    return getDomainEventById(eventId);
  }
}

/** Reads ONLY the four real routing columns used to classify a lead's route. */
export class SupabaseLeadDistributionRoutingPort implements LeadDistributionRoutingPort {
  async readLeadRouting(leadId: string): Promise<LeadRoutingSnapshot | null> {
    const { data, error } = await adminClient()
      .from("leads")
      .select("lead_intent, target_vendor_id, preferred_vendor_id, requirement_group_id")
      .eq("id", leadId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const row = data as {
      lead_intent: string | null;
      target_vendor_id: string | null;
      preferred_vendor_id: string | null;
      requirement_group_id: string | null;
    };
    return {
      leadIntent: row.lead_intent ?? null,
      targetVendorId: row.target_vendor_id ?? null,
      preferredVendorId: row.preferred_vendor_id ?? null,
      requirementGroupId: row.requirement_group_id ?? null,
    };
  }
}

export class SupabaseLeadDistributionWorkflowStatePort
  implements LeadDistributionWorkflowStatePort
{
  async getWorkflowInstanceById(id: string): Promise<WorkflowInstanceRecord | null> {
    return getWorkflowInstanceById(id);
  }
}

/** Ports the prepare_approval executor task needs (recommendation + routing). */
export interface LeadDistributionExecutorPorts {
  recommendationEventPort: LeadDistributionRecommendationEventPort;
  routingPort: LeadDistributionRoutingPort;
}

export function createLeadDistributionExecutorPorts(): LeadDistributionExecutorPorts {
  return {
    recommendationEventPort: new SupabaseLeadDistributionRecommendationEventPort(),
    routingPort: new SupabaseLeadDistributionRoutingPort(),
  };
}

/** Full dependency set for the human distribution approval service. */
export function createLeadDistributionApprovalServiceDeps(): LeadDistributionApprovalServiceDeps {
  return {
    recommendationEventPort: new SupabaseLeadDistributionRecommendationEventPort(),
    routingPort: new SupabaseLeadDistributionRoutingPort(),
    workflowStatePort: new SupabaseLeadDistributionWorkflowStatePort(),
    approvalPublisher: new DurableLeadDistributionApprovalPublisher(
      new SupabaseLeadLifecycleDomainEventRepository(),
    ),
  };
}
