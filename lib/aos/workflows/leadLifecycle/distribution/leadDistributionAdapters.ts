import { adminClient } from "../../../../supabase";
import { getDomainEventById } from "../../../workflow/domainEventService";
import { getWorkflowInstanceById } from "../../../workflow/workflowRepository";
import { LeadLifecycleState } from "../leadLifecycleStates";
import { SupabaseLeadLifecycleDomainEventRepository } from "../events/leadLifecycleEventPublisher";
import type {
  DomainEventRecord,
  WorkflowInstanceRecord,
  WorkflowTransitionRecord,
} from "../../../workflow/workflowPersistenceTypes";
import type {
  LeadDistributionApprovalBindingPort,
  LeadDistributionRecommendationEventPort,
  LeadDistributionRoutingPort,
  LeadDistributionWorkflowStatePort,
  LeadRoutingSnapshot,
} from "./leadDistributionTypes";
import type { LeadDistributionAssignmentPort } from "./leadDistributionAssignmentTypes";
import { SupabaseLeadDistributionAssignmentPort } from "./leadDistributionAssignmentAdapter";
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

/** Reads ONLY the six real routing columns used to classify a lead's route. */
export class SupabaseLeadDistributionRoutingPort implements LeadDistributionRoutingPort {
  async readLeadRouting(leadId: string): Promise<LeadRoutingSnapshot | null> {
    const { data, error } = await adminClient()
      .from("leads")
      .select("lead_intent, target_vendor_id, preferred_vendor_id, requirement_group_id, selected_vendor_id, assignment_intent")
      .eq("id", leadId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const row = data as {
      lead_intent: string | null;
      target_vendor_id: string | null;
      preferred_vendor_id: string | null;
      requirement_group_id: string | null;
      selected_vendor_id: string | null;
      assignment_intent: string | null;
    };
    return {
      leadIntent: row.lead_intent ?? null,
      targetVendorId: row.target_vendor_id ?? null,
      preferredVendorId: row.preferred_vendor_id ?? null,
      requirementGroupId: row.requirement_group_id ?? null,
      selectedVendorId: row.selected_vendor_id ?? null,
      assignmentIntent: row.assignment_intent ?? null,
    };
  }
}

/**
 * Reads the current approval binding from workflow_transition_history: the
 * newest `→ DISTRIBUTION_APPROVAL_PENDING` transition for the workflow. Read-only.
 */
export class SupabaseLeadDistributionApprovalBindingPort
  implements LeadDistributionApprovalBindingPort
{
  async readCurrentApprovalBindingTransition(
    workflowInstanceId: string,
  ): Promise<WorkflowTransitionRecord | null> {
    const { data, error } = await adminClient()
      .from("workflow_transition_history")
      .select("id, workflow_instance_id, from_state, to_state, event_type, reason, metadata_json, created_by, created_at")
      .eq("workflow_instance_id", workflowInstanceId)
      .eq("to_state", LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as WorkflowTransitionRecord | null) ?? null;
  }
}

export class SupabaseLeadDistributionWorkflowStatePort
  implements LeadDistributionWorkflowStatePort
{
  async getWorkflowInstanceById(id: string): Promise<WorkflowInstanceRecord | null> {
    return getWorkflowInstanceById(id);
  }
}

/**
 * Ports the distribution executor tasks need: prepare_approval (3A) uses
 * recommendation + routing; prepare (3B) additionally uses the assignment
 * execution boundary.
 */
export interface LeadDistributionExecutorPorts {
  recommendationEventPort: LeadDistributionRecommendationEventPort;
  routingPort: LeadDistributionRoutingPort;
  assignmentExecution: LeadDistributionAssignmentPort;
}

export function createLeadDistributionExecutorPorts(): LeadDistributionExecutorPorts {
  return {
    recommendationEventPort: new SupabaseLeadDistributionRecommendationEventPort(),
    routingPort: new SupabaseLeadDistributionRoutingPort(),
    assignmentExecution: new SupabaseLeadDistributionAssignmentPort(),
  };
}

/** Full dependency set for the human distribution approval service. */
export function createLeadDistributionApprovalServiceDeps(): LeadDistributionApprovalServiceDeps {
  return {
    recommendationEventPort: new SupabaseLeadDistributionRecommendationEventPort(),
    routingPort: new SupabaseLeadDistributionRoutingPort(),
    workflowStatePort: new SupabaseLeadDistributionWorkflowStatePort(),
    bindingPort: new SupabaseLeadDistributionApprovalBindingPort(),
    approvalPublisher: new DurableLeadDistributionApprovalPublisher(
      new SupabaseLeadLifecycleDomainEventRepository(),
    ),
  };
}
