#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const failures = [];
function check(label, value) {
  if (value) console.log("PASS", label);
  else {
    console.error("FAIL", label);
    failures.push(label);
  }
}
const read = (path) => readFile(join(ROOT, path), "utf8");

const [
  migration,
  automation,
  familyClaim,
  recovery,
  conversation,
  jarvisTurn,
  packagePurchase,
  leadDistribution,
  worker,
  aarohiWorker,
  nativeWorker,
  coordination,
  durableWakeup,
] = await Promise.all([
  read("supabase/migrations/20261004190000_scale_phase07_durable_jobs_hardening.sql"),
  read("supabase/migrations/20260801110000_qf_mvp_automation_action_persistence.sql"),
  read("supabase/migrations/20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql"),
  read("supabase/migrations/20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql"),
  read("services/conversationalWhatsAppService.ts"),
  read("services/jarvisWhatsAppGatewayService.ts"),
  read("supabase/migrations/20260706000145_package_purchase_idempotent_grant.sql"),
  read("supabase/migrations/20261002071500_vendor_fair_opportunity_distribution.sql"),
  read("worker/conversationTransportWorker.ts"),
  read("worker/aarohiAcquisitionWorker.ts"),
  read("worker/nativeAutomationWorker.ts"),
  read("lib/coordination/coordination.ts"),
  read("lib/coordination/durableWorkWakeup.ts"),
]);

check("PostgreSQL scheduler occurrence has unique durable identity", /primary key \(scheduler_key, occurrence_key\)/i.test(migration));
check(
  "scheduler occurrence uses owner token and monotonic fencing",
  /lease_token uuid not null/i.test(migration) &&
    /fence\s*=\s*(?:occurrence\.)?fence\s*\+\s*1/i.test(migration),
);
check("expired incomplete scheduler work is reclaimable", /lease_expires_at <= v_now/i.test(migration));
check("stale/non-owner completion is rejected", /worker_id=p_worker_id[\s\S]*lease_token=p_lease_token[\s\S]*fence=p_fence/i.test(migration));
check("per-replica heartbeat key includes role + worker id", /primary key \(worker_role, worker_id\)/i.test(migration));
check("queue health includes depth, dead-letter and oldest-age observations", /deadLetter/i.test(migration) && /oldestReadyAgeSeconds/i.test(migration));

check("canonical automation jobs are durable PostgreSQL rows", /create table public\.automation_jobs/i.test(automation));
check("automation claims use SKIP LOCKED", /for update skip locked/i.test(automation));
check("automation job has bounded retry exhaustion + dead letter", /max_attempts/i.test(automation) && /dead_letter/i.test(automation));
check("automation execution attempts have one-claim-per-job uniqueness", /unique[\s\S]{0,160}job_id/i.test(automation) || /automation_execution_attempts[\s\S]{0,400}unique/i.test(automation));
check("family claims preserve isolated lanes and reject wildcard/multi-family", /AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID/.test(familyClaim) && /multi-family string was accepted/.test(familyClaim));
check("recovery does not blindly replay uncertain provider effects", /uncertain/i.test(recovery) && /reconcil/i.test(recovery));

check("conversation outbox binds a durable idempotency key", /communication_conversation_outbox[\s\S]{0,1200}idempotency_key/i.test(conversation));
check("conversation replay reconciles bound identity + digest", /existing\.body_digest === digest/.test(conversation));
check("Jarvis turn outbox has bounded exponential retry", /Math\.pow\(2/.test(jarvisTurn) && /attempt < 5/.test(jarvisTurn));
check(
  "provider/package purchase uses durable idempotent grant",
  /qf_apply_vendor_credit_delta/i.test(packagePurchase) &&
    /reference_type = 'package_purchase'/i.test(packagePurchase) &&
    /for update/i.test(packagePurchase) &&
    /already_applied/i.test(packagePurchase),
);
check("fair lead distribution remains transactional/locked", /for update|pg_advisory|locked/i.test(leadDistribution));

check("durable DB writes publish only best-effort wakeups after commit", /publishDurableWorkWakeup/.test(conversation));
check("coordination port can wait for advisory wakeups", /waitForWakeup/.test(coordination));
check("Redis wakeup helper names durable-work topics but owns no durable state", /DURABLE_WORK_NAMESPACE = "durable-work"/.test(durableWakeup) && !/adminClient|supabase|insert\(/i.test(durableWakeup));
check("conversation transport no longer uses 10ms/100ms defaults", !/\b100\b[\s\S]{0,40}idle/i.test(worker) && !/\b10\b[\s\S]{0,40}busy/i.test(worker));
check("conversation transport uses event wakeup with bounded DB fallback", /waitForDurableWorkWakeup/.test(worker) && /idlePollMs/.test(worker));
check("conversation transport exposes graceful drain heartbeat", /GRACEFUL_DRAIN_COMPLETE/.test(worker) && /acceptingWork/.test(worker));
check("Aarohi scheduler uses durable distributed occurrence claim", /claimScaleSchedulerOccurrence/.test(aarohiWorker) && /completeScaleSchedulerOccurrence/.test(aarohiWorker));
check("Aarohi scheduler leaves failed occurrence for lease-based recovery", /intentionally not released on error/.test(aarohiWorker));
check("native automation and Aarohi emit per-replica heartbeats", /writeScaleWorkerHeartbeat/.test(nativeWorker) && /writeScaleWorkerHeartbeat/.test(aarohiWorker));
check("native automation family drain remains bounded for backpressure/fairness", /maxDrainPerFamily/.test(nativeWorker) && /familyLanes/.test(nativeWorker));

if (failures.length > 0) {
  console.error(`QuickFurno Phase 07 durable-job contract FAILED (${failures.length})`);
  process.exit(1);
}
console.log("QuickFurno Phase 07 durable-job contract PASS");
