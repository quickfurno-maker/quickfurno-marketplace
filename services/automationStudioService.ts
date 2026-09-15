import "server-only";

import { adminClient } from "@/lib/supabase";
import {
  AUTOMATION_STUDIO_WORKFLOWS,
  DEFAULT_AUTOMATION_STUDIO_DEFINITIONS,
  cloneAutomationStudioDefinition,
  validateAutomationStudioDefinition,
  type AutomationStudioDefinition,
  type AutomationStudioExecutionRow,
  type AutomationStudioOverview,
  type AutomationStudioVersionSummary,
  type AutomationStudioWorkflowKey,
  type AutomationStudioWorkflowRuntime,
} from "@/lib/automation/studioContract";
import {
  getWorkflowFamilyForAction,
  isAutomationActionType,
  type AutomationWorkflowFamily,
} from "@/lib/automation/actionRegistry";
import { getAutomationTransportRuntimeConfig } from "@/services/automationTransportService";

const PREFIX = "automation_studio.";
const GLOBAL_ENABLED_KEY = `${PREFIX}global_enabled`;
const MAX_HISTORY = 20;

const familyToWorkflow: Record<AutomationWorkflowFamily, AutomationStudioWorkflowKey> = {
  client_whatsapp: "client_journey",
  vendor_whatsapp: "vendor_journey",
  campaign_execution: "campaigns",
};

export function getAutomationStudioWorkflowKeyForFamily(
  family: AutomationWorkflowFamily,
): AutomationStudioWorkflowKey {
  return familyToWorkflow[family];
}

interface RuntimeSettingRow {
  key: string;
  value: unknown;
  updated_by?: string | null;
  updated_at?: string | null;
}
interface JobRow {
  id: string;
  action_request_id: string;
  status: string;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

interface ActionRequestRow {
  id: string;
  action_type: string;
}

interface TransportRow {
  route_key: string;
  state: string;
  worker_id: string | null;
  created_at: string;
}

function keyFor(workflowKey: AutomationStudioWorkflowKey, suffix: string) {
  return `${PREFIX}${workflowKey}.${suffix}`;
}

function readBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

function readNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function readDefinition(value: unknown, workflowKey: AutomationStudioWorkflowKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneAutomationStudioDefinition(workflowKey);
  }
  const candidate = value as AutomationStudioDefinition;
  const validated = validateAutomationStudioDefinition(candidate);
  if (!validated.ok || candidate.workflowKey !== workflowKey) {
    return cloneAutomationStudioDefinition(workflowKey);
  }
  return JSON.parse(JSON.stringify(candidate)) as AutomationStudioDefinition;
}

function readHistory(value: unknown, workflowKey: AutomationStudioWorkflowKey): AutomationStudioVersionSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Partial<AutomationStudioVersionSummary>;
    if (!row.version || !row.publishedAt || !row.definition) return [];
    const definition = readDefinition(row.definition, workflowKey);
    return [{
      version: readNumber(row.version, 1),
      publishedAt: String(row.publishedAt),
      publishedBy: String(row.publishedBy || "Superadmin"),
      changeSummary: String(row.changeSummary || "Published workflow version"),
      definition,
    }];
  }).slice(0, MAX_HISTORY);
}
async function loadStudioSettingRows(): Promise<Map<string, RuntimeSettingRow>> {
  const { data, error } = await adminClient()
    .from("marketplace_runtime_settings")
    .select("key,value,updated_by,updated_at")
    .like("key", `${PREFIX}%`)
    .order("key", { ascending: true });
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.key, row as RuntimeSettingRow]));
}

async function upsertStudioSetting(
  key: string,
  value: unknown,
  updatedBy: string,
  description: string,
) {
  const now = new Date().toISOString();
  const { error } = await adminClient()
    .from("marketplace_runtime_settings")
    .upsert({
      key,
      value,
      description,
      updated_by: updatedBy,
      updated_at: now,
    }, { onConflict: "key" });
  if (error) throw error;
}

function workflowForAction(actionType: string | null): AutomationStudioWorkflowKey | "unknown" {
  if (!actionType || !isAutomationActionType(actionType)) return "unknown";
  return familyToWorkflow[getWorkflowFamilyForAction(actionType)];
}

function currentStepForStatus(status: string) {
  switch (status) {
    case "pending": return "Queued";
    case "processing": return "Executing";
    case "retry_scheduled": return "Waiting for retry";
    case "succeeded": return "Completed";
    case "failed": return "Failed";
    case "uncertain": return "Needs reconciliation";
    case "dead_letter": return "Dead letter";
    case "cancelled": return "Cancelled";
    default: return "Unknown";
  }
}

function routeForWorkflow(workflowKey: AutomationStudioWorkflowKey): string[] {
  if (workflowKey === "recovery") return ["recover_v1", "reconcile_v1"];
  if (workflowKey === "orphan_cleanup") return ["cancel_orphan_v1"];
  if (workflowKey === "stale_cleanup") return ["cancel_stale_v1"];
  return ["claim_v1"];
}
export async function getAutomationStudioOverview(): Promise<AutomationStudioOverview> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since30m = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  const [settings, jobsResult, transportResult] = await Promise.all([
    loadStudioSettingRows(),
    adminClient()
      .from("automation_jobs")
      .select("id,action_request_id,status,attempt_count,created_at,updated_at")
      .gte("created_at", since24h)
      .order("created_at", { ascending: false })
      .limit(250),
    adminClient()
      .from("automation_transport_requests")
      .select("route_key,state,worker_id,created_at")
      .gte("created_at", since30m)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (jobsResult.error) throw jobsResult.error;
  if (transportResult.error) throw transportResult.error;

  const jobs = (jobsResult.data ?? []) as JobRow[];
  const transportRows = (transportResult.data ?? []) as TransportRow[];
  const actionIds = [...new Set(jobs.map((job) => job.action_request_id))];
  let actionRequests: ActionRequestRow[] = [];
  if (actionIds.length) {
    const { data, error } = await adminClient()
      .from("automation_action_requests")
      .select("id,action_type")
      .in("id", actionIds);
    if (error) throw error;
    actionRequests = (data ?? []) as ActionRequestRow[];
  }

  const actionTypeByRequest = new Map(actionRequests.map((row) => [row.id, row.action_type]));
  const globalEnabled = readBoolean(settings.get(GLOBAL_ENABLED_KEY)?.value, true);
  const runtimeConfig = getAutomationTransportRuntimeConfig();
  const lastTransport = transportRows[0] ?? null;
  const lastSeenMs = lastTransport ? Date.parse(lastTransport.created_at) : 0;
  const transportHealthy = runtimeConfig.ok && runtimeConfig.config.mode !== "off" && lastSeenMs > now.getTime() - 6 * 60 * 1000;

  const workflows = AUTOMATION_STUDIO_WORKFLOWS.map((meta): AutomationStudioWorkflowRuntime => {
    const enabled = globalEnabled && readBoolean(settings.get(keyFor(meta.key, "enabled"))?.value, true);
    const published = readDefinition(settings.get(keyFor(meta.key, "published"))?.value, meta.key);
    const draft = readDefinition(settings.get(keyFor(meta.key, "draft"))?.value, meta.key);
    const history = readHistory(settings.get(keyFor(meta.key, "version_history"))?.value, meta.key);
    const currentVersion = readNumber(settings.get(keyFor(meta.key, "version"))?.value, history[0]?.version ?? 1);

    const workflowJobs = jobs.filter((job) => workflowForAction(actionTypeByRequest.get(job.action_request_id) ?? null) === meta.key);
    const terminal = workflowJobs.filter((job) => ["succeeded", "failed", "dead_letter", "uncertain"].includes(job.status));
    const succeeded = terminal.filter((job) => job.status === "succeeded").length;
    const failed = terminal.filter((job) => job.status !== "succeeded").length;
    const queue = workflowJobs.filter((job) => ["pending", "processing", "retry_scheduled"].includes(job.status)).length;
    const routeSet = new Set(routeForWorkflow(meta.key));
    const workflowTransport = transportRows.filter((row) => routeSet.has(row.route_key));
    const lastRunAt = workflowJobs[0]?.updated_at ?? workflowTransport[0]?.created_at ?? null;
    const recentRoute = workflowTransport[0]?.created_at ? Date.parse(workflowTransport[0].created_at) > now.getTime() - 12 * 60 * 1000 : false;

    return {
      ...meta,
      enabled,
      health: !enabled ? "paused" : recentRoute && transportHealthy ? "healthy" : "unknown",
      queue,
      successRate24h: terminal.length ? Math.round((succeeded / terminal.length) * 100) : null,
      completed24h: succeeded,
      failed24h: failed,
      lastRunAt,
      currentVersion,
      draftDefinition: draft,
      publishedDefinition: published,
      versions: history,
    };
  });
  const executions: AutomationStudioExecutionRow[] = jobs.slice(0, 40).map((job) => {
    const actionType = actionTypeByRequest.get(job.action_request_id) ?? null;
    return {
      id: job.id,
      workflowKey: workflowForAction(actionType),
      actionType,
      status: job.status,
      currentStep: currentStepForStatus(job.status),
      startedAt: job.created_at,
      updatedAt: job.updated_at,
      attemptCount: job.attempt_count,
    };
  });

  const mode = runtimeConfig.ok ? runtimeConfig.config.mode : "invalid";
  const workerId = runtimeConfig.ok ? runtimeConfig.config.workerId : null;

  return {
    ok: true,
    globalEnabled,
    transport: {
      mode,
      healthy: transportHealthy,
      workerId: lastTransport?.worker_id ?? workerId,
      lastSeenAt: lastTransport?.created_at ?? null,
      routeCalls30m: transportRows.length,
    },
    workflows,
    executions,
    queueTotal: workflows.reduce((sum, workflow) => sum + workflow.queue, 0),
    generatedAt: now.toISOString(),
  };
}

export async function setAutomationStudioGlobalEnabled(enabled: boolean, actorId: string) {
  await upsertStudioSetting(
    GLOBAL_ENABLED_KEY,
    enabled,
    actorId,
    "QuickFurno Automation Studio global execution switch. Core reads this before transport execution.",
  );
}

export async function setAutomationStudioWorkflowEnabled(
  workflowKey: AutomationStudioWorkflowKey,
  enabled: boolean,
  actorId: string,
) {
  await upsertStudioSetting(
    keyFor(workflowKey, "enabled"),
    enabled,
    actorId,
    `Automation Studio execution switch for ${workflowKey}.`,
  );
}

export async function isAutomationStudioWorkflowEnabled(
  workflowKey: AutomationStudioWorkflowKey,
): Promise<boolean> {
  try {
    const { data, error } = await adminClient()
      .from("marketplace_runtime_settings")
      .select("key,value")
      .in("key", [GLOBAL_ENABLED_KEY, keyFor(workflowKey, "enabled")]);
    if (error) throw error;
    const rows = new Map((data ?? []).map((row) => [row.key, row.value]));
    return readBoolean(rows.get(GLOBAL_ENABLED_KEY), true) && readBoolean(rows.get(keyFor(workflowKey, "enabled")), true);
  } catch (error) {
    console.error("[automation studio] runtime control read failed; failing closed", {
      message: error instanceof Error ? error.message : "Unknown error",
      workflowKey,
    });
    return false;
  }
}
export async function saveAutomationStudioDraft(
  workflowKey: AutomationStudioWorkflowKey,
  definition: AutomationStudioDefinition,
  actorId: string,
) {
  if (definition.workflowKey !== workflowKey) throw new Error("AUTOMATION_STUDIO_WORKFLOW_KEY_MISMATCH");
  const validation = validateAutomationStudioDefinition(definition);
  if (!validation.ok) throw new Error(`AUTOMATION_STUDIO_DEFINITION_INVALID:${validation.errors.join("|")}`);
  await upsertStudioSetting(
    keyFor(workflowKey, "draft"),
    definition,
    actorId,
    `Automation Studio draft definition for ${workflowKey}.`,
  );
}

export async function publishAutomationStudioDraft(
  workflowKey: AutomationStudioWorkflowKey,
  definition: AutomationStudioDefinition,
  actorId: string,
  changeSummary: string,
) {
  if (definition.workflowKey !== workflowKey) throw new Error("AUTOMATION_STUDIO_WORKFLOW_KEY_MISMATCH");
  const validation = validateAutomationStudioDefinition(definition);
  if (!validation.ok) throw new Error(`AUTOMATION_STUDIO_DEFINITION_INVALID:${validation.errors.join("|")}`);

  const settings = await loadStudioSettingRows();
  const previousVersion = readNumber(settings.get(keyFor(workflowKey, "version"))?.value, 0);
  const version = previousVersion + 1;
  const history = readHistory(settings.get(keyFor(workflowKey, "version_history"))?.value, workflowKey);
  const entry: AutomationStudioVersionSummary = {
    version,
    publishedAt: new Date().toISOString(),
    publishedBy: actorId,
    changeSummary: changeSummary.trim().slice(0, 240) || "Published from Automation Studio",
    definition,
  };
  const nextHistory = [entry, ...history].slice(0, MAX_HISTORY);

  await Promise.all([
    upsertStudioSetting(keyFor(workflowKey, "published"), definition, actorId, `Published Automation Studio definition for ${workflowKey}.`),
    upsertStudioSetting(keyFor(workflowKey, "draft"), definition, actorId, `Automation Studio draft definition for ${workflowKey}.`),
    upsertStudioSetting(keyFor(workflowKey, "version"), version, actorId, `Published Automation Studio version for ${workflowKey}.`),
    upsertStudioSetting(keyFor(workflowKey, "version_history"), nextHistory, actorId, `Bounded Automation Studio version history for ${workflowKey}.`),
  ]);

  return entry;
}

export async function rollbackAutomationStudioWorkflow(
  workflowKey: AutomationStudioWorkflowKey,
  version: number,
  actorId: string,
) {
  const settings = await loadStudioSettingRows();
  const history = readHistory(settings.get(keyFor(workflowKey, "version_history"))?.value, workflowKey);
  const target = history.find((item) => item.version === version);
  if (!target) throw new Error("AUTOMATION_STUDIO_VERSION_NOT_FOUND");
  return publishAutomationStudioDraft(
    workflowKey,
    target.definition,
    actorId,
    `Rollback to v${target.version}`,
  );
}
