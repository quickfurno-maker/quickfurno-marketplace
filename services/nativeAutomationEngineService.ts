import { createHash, randomUUID } from "node:crypto";
import { isAutomationWorkflowFamily, type AutomationWorkflowFamily } from "@/lib/automation/actionRegistry";
import {
  claimNativeAutomationJob,
  recoverNativeAutomationRetry,
  cancelNativeOrphanAutomationJob,
  cancelNativeStaleAutomationJob,
  hasNativeStaleAutomationCandidate,
} from "@/services/nativeAutomationAuthorityService";
import { runLeadAssignmentDispatchBatch } from "@/services/leadAssignmentDispatchService";
import { processConsentAckIntents } from "@/services/consentAckWorkerService";
import { processDueLeadAssignmentQueue } from "@/services/delayedLeadFillService";
import { executeClientAutomationAttempt } from "@/services/automationClientExecutionService";
import { executeVendorAutomationAttempt } from "@/services/automationVendorExecutionService";
import { executeCampaignAutomationAttempt } from "@/services/automationCampaignExecutionService";
import { completeAutomationAttempt } from "@/services/automationTransportService";
import { reconcileStaleAutomationAttempt } from "@/services/automationRecoveryService";

export type NativeAutomationCycleState =
  | "idle"
  | "completed"
  | "waiting"
  | "finalized"
  | "refused";

export interface NativeAutomationCycleResult {
  state: NativeAutomationCycleState;
  safeCode: string;
  family?: AutomationWorkflowFamily;
  jobId?: string;
  attemptId?: string;
}
function ledgerIdentity(workerId: string, operation: string, scope: string) {
  const requestId = randomUUID();
  const bodySha256 = createHash("sha256")
    .update(JSON.stringify({ workerId, operation, scope, requestId }))
    .digest("hex");
  return { requestId, bodySha256 };
}

export async function runNativeFamilyClaimCycle(input: {
  workerId: string;
  family: AutomationWorkflowFamily;
}): Promise<NativeAutomationCycleResult> {
  const claim = await claimNativeAutomationJob(input.workerId, input.family);
  if (!claim) {
    return { state: "idle", safeCode: "NATIVE_QUEUE_EMPTY", family: input.family };
  }
  return executeOwnedAttempt({
    workerId: input.workerId,
    family: input.family,
    jobId: claim.job_id,
    attemptId: claim.attempt_id,
  });
}
async function executeOwnedAttempt(input: {
  workerId: string;
  family: AutomationWorkflowFamily;
  jobId: string;
  attemptId: string;
}): Promise<NativeAutomationCycleResult> {
  const identity = ledgerIdentity(input.workerId, "execute", `${input.family}:${input.jobId}:${input.attemptId}`);
  const executionInput = {
    requestId: identity.requestId,
    workerId: input.workerId,
    bodySha256: identity.bodySha256,
    jobId: input.jobId,
    attemptId: input.attemptId,
  };

  const execution = input.family === "client_whatsapp"
    ? await executeClientAutomationAttempt(executionInput)
    : input.family === "vendor_whatsapp"
      ? await executeVendorAutomationAttempt(executionInput)
      : await executeCampaignAutomationAttempt(executionInput);

  if (!execution.ok) {
    return {
      state: "refused",
      safeCode: execution.code,
      family: input.family,
      jobId: input.jobId,
      attemptId: input.attemptId,
    };
  }

  if (execution.body.orchestrationState === "communication_pending") {
    return {
      state: "waiting",
      safeCode: "NATIVE_COMMUNICATION_PENDING",
      family: input.family,
      jobId: input.jobId,
      attemptId: input.attemptId,
    };
  }
  if (execution.body.orchestrationState === "attempt_finalized") {
    return {
      state: "finalized",
      safeCode: "NATIVE_ATTEMPT_ALREADY_FINALIZED",
      family: input.family,
      jobId: input.jobId,
      attemptId: input.attemptId,
    };
  }

  if (!execution.body.executorReference) {
    return {
      state: "refused",
      safeCode: "NATIVE_EXECUTOR_REFERENCE_MISSING",
      family: input.family,
      jobId: input.jobId,
      attemptId: input.attemptId,
    };
  }

  const completionIdentity = ledgerIdentity(
    input.workerId,
    "complete",
    `${input.family}:${input.jobId}:${input.attemptId}`,
  );
  const completion = await completeAutomationAttempt({
    requestId: completionIdentity.requestId,
    workerId: input.workerId,
    bodySha256: completionIdentity.bodySha256,
    jobId: input.jobId,
    attemptId: input.attemptId,
    executorReference: execution.body.executorReference,
  });

  if (!completion.ok) {
    return {
      state: "refused",
      safeCode: completion.code,
      family: input.family,
      jobId: input.jobId,
      attemptId: input.attemptId,
    };
  }

  return {
    state: "completed",
    safeCode: completion.body.safeCode,
    family: input.family,
    jobId: input.jobId,
    attemptId: input.attemptId,
  };
}
export async function runNativeRecoveryCycle(workerId: string): Promise<NativeAutomationCycleResult> {
  const recovered = await recoverNativeAutomationRetry(workerId);
  if (!recovered) return { state: "idle", safeCode: "NATIVE_RECOVERY_EMPTY" };
  return executeOwnedAttempt({
    workerId,
    family: recovered.workflow_family,
    jobId: recovered.job_id,
    attemptId: recovered.attempt_id,
  });
}

export async function runNativeReconcileCycle(workerId: string): Promise<NativeAutomationCycleResult> {
  if (!(await hasNativeStaleAutomationCandidate())) {
    return { state: "idle", safeCode: "NATIVE_RECONCILE_EMPTY" };
  }
  const identity = ledgerIdentity(workerId, "reconcile", "stale-attempt");
  const result = await reconcileStaleAutomationAttempt({
    requestId: identity.requestId,
    workerId,
    bodySha256: identity.bodySha256,
  });
  if (!result.ok) {
    return { state: "refused", safeCode: result.code };
  }
  if (result.body.orchestrationState === "reconcile_empty") {
    return { state: "idle", safeCode: "NATIVE_RECONCILE_EMPTY" };
  }
  if (result.body.orchestrationState === "reconcile_deferred") {
    return { state: "waiting", safeCode: "NATIVE_RECONCILE_DEFERRED" };
  }
  return {
    state: "finalized",
    safeCode: result.body.safeCode ?? "NATIVE_RECONCILE_FINALIZED",
  };
}

export async function runNativeOrphanCleanupCycle(workerId: string): Promise<NativeAutomationCycleResult> {
  const result = await cancelNativeOrphanAutomationJob(workerId);
  if (!result) return { state: "idle", safeCode: "NATIVE_ORPHAN_EMPTY" };
  return { state: "finalized", safeCode: result.safe_code ?? "NATIVE_ORPHAN_CANCELLED", jobId: result.job_id };
}
export async function runNativeStaleCleanupCycle(workerId: string): Promise<NativeAutomationCycleResult> {
  const result = await cancelNativeStaleAutomationJob(workerId);
  if (!result) return { state: "idle", safeCode: "NATIVE_STALE_EMPTY" };
  return { state: "finalized", safeCode: result.safe_code ?? "NATIVE_STALE_CANCELLED", jobId: result.job_id };
}
export async function runNativeLeadAssignmentDispatchCycle(limit: number): Promise<NativeAutomationCycleResult> {
  const summary = await runLeadAssignmentDispatchBatch({ limit });
  if (summary.selected === 0) {
    return { state: "idle", safeCode: summary.selectionRefusal ? `NATIVE_LEAD_DISPATCH_${summary.selectionRefusal}` : "NATIVE_LEAD_DISPATCH_EMPTY" };
  }
  return { state: "completed", safeCode: summary.refused > 0 ? "NATIVE_LEAD_DISPATCH_PARTIAL" : "NATIVE_LEAD_DISPATCH_COMPLETED" };
}

export async function runNativeConsentAckCycle(workerId: string, limit: number): Promise<NativeAutomationCycleResult> {
  const outcome = await processConsentAckIntents({ workerId: `${workerId}.consent-ack`, limit });
  if (!outcome.ok) return { state: "refused", safeCode: "NATIVE_CONSENT_ACK_BATCH_FAILED" };
  const maintenanceWork = outcome.maintenance.expired + outcome.maintenance.recoveredUncertain;
  if (outcome.result.claimed === 0 && maintenanceWork === 0) return { state: "idle", safeCode: "NATIVE_CONSENT_ACK_EMPTY" };
  return { state: "completed", safeCode: outcome.result.uncertain > 0 ? "NATIVE_CONSENT_ACK_UNCERTAIN" : "NATIVE_CONSENT_ACK_COMPLETED" };
}

export async function runNativeDelayedFillCycle(limit: number): Promise<NativeAutomationCycleResult> {
  const outcome = await processDueLeadAssignmentQueue(limit);
  if (!outcome.ok) return { state: "refused", safeCode: `NATIVE_DELAYED_FILL_${outcome.code}` };
  if (outcome.data.processed.length === 0) return { state: "idle", safeCode: "NATIVE_DELAYED_FILL_EMPTY" };
  const hasError = outcome.data.processed.some((row) => row.status === "error");
  return { state: "completed", safeCode: hasError ? "NATIVE_DELAYED_FILL_PARTIAL" : "NATIVE_DELAYED_FILL_COMPLETED" };
}
