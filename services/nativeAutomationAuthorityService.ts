import { adminClient } from "@/lib/supabase";
import { isAutomationWorkflowFamily, type AutomationWorkflowFamily } from "@/lib/automation/actionRegistry";
import type { ClaimedAutomationJob } from "@/lib/automation/persistenceTypes";
import { AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS } from "@/lib/automation/recoveryContract";

const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function assertWorker(workerId: string) {
  if (!SAFE_WORKER_RE.test(workerId)) throw new Error("NATIVE_AUTOMATION_WORKER_ID_INVALID");
}

export async function claimNativeAutomationJob(
  workerId: string,
  family: AutomationWorkflowFamily,
): Promise<ClaimedAutomationJob | null> {
  assertWorker(workerId);
  if (!isAutomationWorkflowFamily(family)) throw new Error("NATIVE_AUTOMATION_FAMILY_INVALID");
  const { data, error } = await adminClient()
    .rpc("qf_claim_automation_job_for_family_v1", {
      p_worker_id: workerId,
      p_workflow_family: family,
    })
    .maybeSingle();
  if (error) throw error;
  return (data as ClaimedAutomationJob | null) ?? null;
}
export interface NativeRecoveredAttempt extends ClaimedAutomationJob {
  workflow_family: AutomationWorkflowFamily;
}

export async function recoverNativeAutomationRetry(
  workerId: string,
): Promise<NativeRecoveredAttempt | null> {
  assertWorker(workerId);
  const { data, error } = await adminClient()
    .rpc("qf_recover_automation_job_v1", { p_worker_id: workerId })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as ClaimedAutomationJob & { workflow_family?: string | null };
  if (!isAutomationWorkflowFamily(row.workflow_family)) {
    throw new Error("NATIVE_AUTOMATION_RECOVERY_FAMILY_INVALID");
  }
  return { ...row, workflow_family: row.workflow_family };
}

export async function cancelNativeOrphanAutomationJob(workerId: string) {
  assertWorker(workerId);
  const { data, error } = await adminClient()
    .rpc("qf_cancel_orphan_automation_job_v1", { p_worker_id: workerId })
    .maybeSingle();
  if (error) throw error;
  return (data as { job_id: string; safe_code: string } | null) ?? null;
}
export async function cancelNativeStaleAutomationJob(workerId: string) {
  assertWorker(workerId);
  const { data, error } = await adminClient()
    .rpc("qf_cancel_stale_automation_job_v1", { p_worker_id: workerId })
    .maybeSingle();
  if (error) throw error;
  return (data as { job_id: string; safe_code: string } | null) ?? null;
}

export async function hasNativeStaleAutomationCandidate(): Promise<boolean> {
  const { data, error } = await adminClient()
    .rpc("qf_select_stale_automation_attempt_v1", {
      p_stale_after_seconds: AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS,
    })
    .maybeSingle();
  if (error) throw error;
  return data != null;
}
