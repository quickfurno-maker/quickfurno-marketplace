import { adminClient } from "@/lib/supabase";
import type { JsonRecord, WorkflowInstanceRecord, WorkflowStatus } from "./workflowPersistenceTypes";

export interface CreateWorkflowInstanceInput {
  workflowType: string;
  entityType: string;
  entityId: string;
  initialState: string;
  status?: WorkflowStatus;
  context?: JsonRecord;
}

export async function createWorkflowInstance(input: CreateWorkflowInstanceInput): Promise<WorkflowInstanceRecord> {
  const payload = {
    workflow_type: input.workflowType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    current_state: input.initialState,
    status: input.status ?? "active",
    context_json: input.context ?? {},
  };

  const { data, error } = await adminClient()
    .from("workflow_instances")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error || !data) throw error ?? new Error("WORKFLOW_INSTANCE_CREATE_FAILED");
  return data as WorkflowInstanceRecord;
}

export async function findActiveWorkflowInstance(
  workflowType: string,
  entityType: string,
  entityId: string,
): Promise<WorkflowInstanceRecord | null> {
  const { data, error } = await adminClient()
    .from("workflow_instances")
    .select("*")
    .eq("workflow_type", workflowType)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as WorkflowInstanceRecord | null) ?? null;
}

export async function getWorkflowInstanceById(id: string): Promise<WorkflowInstanceRecord | null> {
  const { data, error } = await adminClient()
    .from("workflow_instances")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as WorkflowInstanceRecord | null) ?? null;
}

export async function getOrCreateWorkflowInstance(input: CreateWorkflowInstanceInput): Promise<WorkflowInstanceRecord> {
  const existing = await findActiveWorkflowInstance(input.workflowType, input.entityType, input.entityId);
  if (existing) return existing;
  return createWorkflowInstance(input);
}

