import type { JsonRecord, WorkflowTransitionRecord } from "../../../workflow/workflowPersistenceTypes";
import type {
  DistributionValidationResult,
  LeadDistributionApprovalBinding,
  LeadDistributionApprovalBindingPort,
} from "./leadDistributionTypes";

/**
 * QuickFurno Distribution Control — current approval binding (Phase 3A).
 *
 * The authoritative "which recommendation snapshot is currently awaiting
 * approval?" gate. It reads the most recent `→ DISTRIBUTION_APPROVAL_PENDING`
 * transition from workflow_transition_history and extracts the durable
 * `metadata_json.recommendation_event_id` stamped by the handler at transition
 * time. It NEVER mutates anything and fails safely.
 */

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Pure resolver over a loaded transition record. Fails safely:
 *   - no binding transition          → DISTRIBUTION_APPROVAL_BINDING_NOT_FOUND
 *   - missing/invalid metadata       → DISTRIBUTION_APPROVAL_BINDING_INVALID
 *   - blank recommendation_event_id  → DISTRIBUTION_APPROVAL_BINDING_INVALID
 */
export function resolveDistributionApprovalBinding(
  transition: WorkflowTransitionRecord | null,
): DistributionValidationResult<LeadDistributionApprovalBinding> {
  if (!transition) {
    return { ok: false, message: "DISTRIBUTION_APPROVAL_BINDING_NOT_FOUND" };
  }
  if (!isPlainObject(transition.metadata_json)) {
    return { ok: false, message: "DISTRIBUTION_APPROVAL_BINDING_INVALID" };
  }
  const recommendationEventId = transition.metadata_json.recommendation_event_id;
  if (!isNonEmptyString(recommendationEventId)) {
    return { ok: false, message: "DISTRIBUTION_APPROVAL_BINDING_INVALID" };
  }
  return { ok: true, value: { recommendationEventId: recommendationEventId.trim() } };
}

/**
 * Load the current approval binding for a workflow via the injected port and
 * resolve it. The port returns the newest `→ DISTRIBUTION_APPROVAL_PENDING`
 * transition (or null).
 */
export async function readCurrentDistributionApprovalBinding(
  workflowInstanceId: string,
  port: LeadDistributionApprovalBindingPort,
): Promise<DistributionValidationResult<LeadDistributionApprovalBinding>> {
  const id = workflowInstanceId?.trim();
  if (!id) {
    return { ok: false, message: "DISTRIBUTION_APPROVAL_BINDING_WORKFLOW_ID_REQUIRED" };
  }
  const transition = await port.readCurrentApprovalBindingTransition(id);
  return resolveDistributionApprovalBinding(transition);
}
