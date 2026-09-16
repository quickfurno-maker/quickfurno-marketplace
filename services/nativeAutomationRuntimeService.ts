import { adminClient } from "@/lib/supabase";

export const NATIVE_AUTOMATION_ENGINE_KEY = "quickfurno_native_v1" as const;
export const NATIVE_AUTOMATION_RUNTIME_SETTING_KEY = "automation_native.runtime";

export type NativeAutomationMode = "off" | "shadow" | "active";
export type NativeAutomationWorkerState =
  | "starting"
  | "running"
  | "shadow"
  | "paused"
  | "degraded"
  | "stopping";

export interface NativeAutomationRuntimeConfig {
  mode: NativeAutomationMode;
  workerId: string;
  idlePollMs: number;
  heartbeatMs: number;
  recoveryIntervalMs: number;
  maintenanceIntervalMs: number;
  systemLaneIntervalMs: number;
  delayedFillIntervalMs: number;
  maxDrainPerFamily: number;
  leadDispatchBatch: number;
  consentAckBatch: number;
  delayedFillBatch: number;
}

export interface NativeAutomationLaneTimes {
  client_journey: string | null;
  vendor_journey: string | null;
  campaigns: string | null;
  recovery: string | null;
  reconcile: string | null;
  orphan_cleanup: string | null;
  stale_cleanup: string | null;
  lead_assignment_dispatch: string | null;
  consent_ack: string | null;
  delayed_fill: string | null;
}
export interface NativeAutomationRuntimeSnapshot {
  schemaVersion: 1;
  engine: typeof NATIVE_AUTOMATION_ENGINE_KEY;
  mode: NativeAutomationMode;
  workerId: string;
  state: NativeAutomationWorkerState;
  engineVersion: string;
  startedAt: string;
  heartbeatAt: string;
  lastClaimAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastSafeCode: string | null;
  cycles: number;
  jobsProcessed: number;
  laneLastRunAt: NativeAutomationLaneTimes;
}

const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function getNativeAutomationRuntimeConfig(): NativeAutomationRuntimeConfig {
  const rawMode = (process.env.QF_NATIVE_AUTOMATION_MODE ?? "off").trim().toLowerCase();
  const mode: NativeAutomationMode = rawMode === "active" || rawMode === "shadow" ? rawMode : "off";
  const workerId = (process.env.QF_NATIVE_AUTOMATION_WORKER_ID ?? "").trim();
  if (mode !== "off" && !SAFE_WORKER_RE.test(workerId)) {
    throw new Error("NATIVE_AUTOMATION_WORKER_ID_INVALID");
  }
  return {
    mode,
    workerId: workerId || "qf-native-automation-off",
    idlePollMs: boundedInt(process.env.QF_NATIVE_AUTOMATION_IDLE_POLL_MS, 5000, 500, 60000),
    heartbeatMs: boundedInt(process.env.QF_NATIVE_AUTOMATION_HEARTBEAT_MS, 15000, 5000, 60000),
    recoveryIntervalMs: boundedInt(process.env.QF_NATIVE_AUTOMATION_RECOVERY_MS, 60000, 10000, 300000),
    maintenanceIntervalMs: boundedInt(process.env.QF_NATIVE_AUTOMATION_MAINTENANCE_MS, 300000, 30000, 900000),
    systemLaneIntervalMs: boundedInt(process.env.QF_NATIVE_AUTOMATION_SYSTEM_MS, 60000, 10000, 300000),
    delayedFillIntervalMs: boundedInt(process.env.QF_NATIVE_AUTOMATION_DELAYED_FILL_MS, 300000, 60000, 3600000),
    maxDrainPerFamily: boundedInt(process.env.QF_NATIVE_AUTOMATION_MAX_DRAIN, 10, 1, 100),
    leadDispatchBatch: boundedInt(process.env.QF_NATIVE_AUTOMATION_LEAD_DISPATCH_BATCH, 3, 1, 25),
    consentAckBatch: boundedInt(process.env.QF_NATIVE_AUTOMATION_CONSENT_ACK_BATCH, 25, 1, 25),
    delayedFillBatch: boundedInt(process.env.QF_NATIVE_AUTOMATION_DELAYED_FILL_BATCH, 25, 1, 100),
  };
}

export async function writeNativeAutomationRuntimeSnapshot(
  snapshot: NativeAutomationRuntimeSnapshot,
): Promise<void> {
  const { error } = await adminClient()
    .from("marketplace_runtime_settings")
    .upsert({
      key: NATIVE_AUTOMATION_RUNTIME_SETTING_KEY,
      value: snapshot,
      description: "QuickFurno native automation worker heartbeat and bounded operational state.",
      updated_by: snapshot.workerId,
      updated_at: snapshot.heartbeatAt,
    }, { onConflict: "key" });
  if (error) throw error;
}

export async function readNativeAutomationRuntimeSnapshot(): Promise<NativeAutomationRuntimeSnapshot | null> {
  const { data, error } = await adminClient()
    .from("marketplace_runtime_settings")
    .select("value")
    .eq("key", NATIVE_AUTOMATION_RUNTIME_SETTING_KEY)
    .maybeSingle();
  if (error) throw error;
  return normalizeSnapshot(data?.value);
}
function normalizeSnapshot(value: unknown): NativeAutomationRuntimeSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<NativeAutomationRuntimeSnapshot>;
  if (row.schemaVersion !== 1 || row.engine !== NATIVE_AUTOMATION_ENGINE_KEY) return null;
  if (row.mode !== "off" && row.mode !== "shadow" && row.mode !== "active") return null;
  if (!row.workerId || !SAFE_WORKER_RE.test(row.workerId)) return null;
  if (!row.heartbeatAt || Number.isNaN(Date.parse(row.heartbeatAt))) return null;
  const lanes = row.laneLastRunAt;
  if (!lanes || typeof lanes !== "object") return null;
  return {
    schemaVersion: 1,
    engine: NATIVE_AUTOMATION_ENGINE_KEY,
    mode: row.mode,
    workerId: row.workerId,
    state: row.state ?? "degraded",
    engineVersion: String(row.engineVersion ?? "unknown"),
    startedAt: String(row.startedAt ?? row.heartbeatAt),
    heartbeatAt: row.heartbeatAt,
    lastClaimAt: row.lastClaimAt ?? null,
    lastSuccessAt: row.lastSuccessAt ?? null,
    lastErrorAt: row.lastErrorAt ?? null,
    lastSafeCode: row.lastSafeCode ?? null,
    cycles: Number.isFinite(row.cycles) ? Number(row.cycles) : 0,
    jobsProcessed: Number.isFinite(row.jobsProcessed) ? Number(row.jobsProcessed) : 0,
    laneLastRunAt: {
      client_journey: lanes.client_journey ?? null,
      vendor_journey: lanes.vendor_journey ?? null,
      campaigns: lanes.campaigns ?? null,
      recovery: lanes.recovery ?? null,
      reconcile: lanes.reconcile ?? null,
      orphan_cleanup: lanes.orphan_cleanup ?? null,
      stale_cleanup: lanes.stale_cleanup ?? null,
      lead_assignment_dispatch: lanes.lead_assignment_dispatch ?? null,
      consent_ack: lanes.consent_ack ?? null,
      delayed_fill: lanes.delayed_fill ?? null,
    },
  };
}
