import WebSocket from "ws";
import {
  assertQfRuntimeIdentity,
  loadQfRuntimeEnvironment,
} from "@/lib/runtime/deploymentConfig";
import type { NativeAutomationCycleResult } from "@/services/nativeAutomationEngineService";
import {
  addMetric,
  startQfObservability,
} from "@/lib/observability/runtime";
import type { NativeAutomationRuntimeSnapshot } from "@/services/nativeAutomationRuntimeService";

loadQfRuntimeEnvironment();
const runtimeIdentity = assertQfRuntimeIdentity("quickfurno.automation-worker");
const observability = startQfObservability(runtimeIdentity);

// Supabase Realtime 2.108+ requires an explicit WebSocket implementation on Node <22.
// The worker does not use Realtime directly, but SupabaseClient initializes its Realtime
// client eagerly. Install the transport before any service module can create a client.
if (typeof globalThis.WebSocket === "undefined") {
  Object.defineProperty(globalThis, "WebSocket", {
    value: WebSocket,
    configurable: true,
    writable: true,
  });
}

const ENGINE_VERSION = "native-v1";
const sleep = (ms: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

const AUTOMATION_LANES = ["client", "vendor", "campaigns", "system", "background"] as const;
type AutomationLane = (typeof AUTOMATION_LANES)[number];

function parseAutomationLanes(raw = process.env.QF_NATIVE_AUTOMATION_LANES): readonly AutomationLane[] {
  if (!raw?.trim()) return AUTOMATION_LANES;
  const lanes = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    lanes.length < 1 ||
    new Set(lanes).size !== lanes.length ||
    lanes.some((lane) => !AUTOMATION_LANES.includes(lane as AutomationLane))
  ) {
    throw new Error("NATIVE_AUTOMATION_LANES_INVALID");
  }
  return Object.freeze(lanes as AutomationLane[]);
}

const automationLanes = parseAutomationLanes();
const automationLaneSet = new Set<AutomationLane>(automationLanes);

async function main() {
  const runtime = await import("@/services/nativeAutomationRuntimeService");
  const scale = await import("@/services/scaleWorkerRuntimeService");
  const engine = await import("@/services/nativeAutomationEngineService");
  const studio = await import("@/services/automationStudioService");
  const leadEnrichmentMaintenance =
    await import("@/services/leadEnrichmentMaintenanceService");
  const vendorIntelligence =
    await import("@/services/vendorIntelligenceService");
  const cfg = runtime.getNativeAutomationRuntimeConfig();
  const scaleRole =
    automationLanes.length === AUTOMATION_LANES.length
      ? "native-automation"
      : automationLanes.length === 1
        ? `native-automation-${automationLanes[0]}`
        : "native-automation-mixed";
  const startedAt = new Date().toISOString();
  let stopping = false;
  let drainStartedAt: string | null = null;
  let lastHeartbeatWrite = 0;
  let lastReplicaHeartbeatWrite = 0;
  let nextRecoveryAt = 0;
  let nextMaintenanceAt = 0;
  let nextSystemLanesAt = 0;
  let nextDelayedFillAt = 0;
  const snapshot: NativeAutomationRuntimeSnapshot = {
    schemaVersion: 1 as const,
    engine: runtime.NATIVE_AUTOMATION_ENGINE_KEY,
    mode: cfg.mode,
    workerId: cfg.workerId,
    state:
      cfg.mode === "shadow"
        ? ("shadow" as const)
        : cfg.mode === "off"
          ? ("paused" as const)
          : ("starting" as const),
    engineVersion: ENGINE_VERSION,
    startedAt,
    heartbeatAt: startedAt,
    lastClaimAt: null as string | null,
    lastSuccessAt: null as string | null,
    lastErrorAt: null as string | null,
    lastSafeCode: null as string | null,
    cycles: 0,
    jobsProcessed: 0,
    laneLastRunAt: {
      client_journey: null as string | null,
      vendor_journey: null as string | null,
      campaigns: null as string | null,
      recovery: null as string | null,
      reconcile: null as string | null,
      orphan_cleanup: null as string | null,
      stale_cleanup: null as string | null,
      lead_assignment_dispatch: null as string | null,
      consent_ack: null as string | null,
      delayed_fill: null as string | null,
    },
  };

  const writeHeartbeat = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastHeartbeatWrite < cfg.heartbeatMs) return;
    snapshot.heartbeatAt = new Date(now).toISOString();
    await runtime.writeNativeAutomationRuntimeSnapshot(snapshot);
    lastHeartbeatWrite = now;
  };
  const writeReplicaHeartbeat = async (
    state: "starting" | "running" | "idle" | "degraded" | "draining" | "stopped",
    acceptingWork: boolean,
    force = false,
    lastSafeCode?: string,
  ) => {
    const now = Date.now();
    if (!force && now - lastReplicaHeartbeatWrite < cfg.heartbeatMs) return;
    await scale.writeScaleWorkerHeartbeat({
      role: scaleRole,
      workerId: cfg.workerId,
      state,
      acceptingWork,
      inFlight: 0,
      startedAt,
      drainStartedAt,
      lastSafeCode,
    });
    lastReplicaHeartbeatWrite = now;
  };
  const markResult = (
    lane: keyof typeof snapshot.laneLastRunAt,
    result: NativeAutomationCycleResult,
  ) => {
    const now = new Date().toISOString();
    snapshot.laneLastRunAt[lane] = now;
    snapshot.lastSafeCode = result.safeCode;
    if (result.jobId) snapshot.lastClaimAt = now;
    if (result.jobId && result.state !== "idle") {
      snapshot.jobsProcessed += 1;
      addMetric("qf.worker.jobs", 1, {
        worker_role: "automation-worker",
        lane,
        result: result.state,
      });
    }
    if (result.state === "completed" || result.state === "finalized") {
      snapshot.lastSuccessAt = now;
      if (snapshot.state === "degraded") snapshot.state = "running";
    }
    if (result.state === "refused") {
      snapshot.lastErrorAt = now;
      snapshot.state = "degraded";
    }
  };

  const stop = () => {
    stopping = true;
    drainStartedAt ??= new Date().toISOString();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  console.info("[qf-native-automation] worker starting", {
    engine: runtime.NATIVE_AUTOMATION_ENGINE_KEY,
    version: ENGINE_VERSION,
    mode: cfg.mode,
    workerId: cfg.workerId,
    role: scaleRole,
    lanes: automationLanes,
  });

  if (cfg.mode === "active") snapshot.state = "running";
  await writeHeartbeat(true);
  await writeReplicaHeartbeat("starting", cfg.mode === "active", true).catch(
    () => undefined,
  );

  const familyLanes = [
    ["client_journey", "client_whatsapp", "client"],
    ["vendor_journey", "vendor_whatsapp", "vendor"],
    ["campaigns", "campaign_execution", "campaigns"],
  ] as const;
  while (!stopping) {
    try {
      snapshot.cycles += 1;
      await writeReplicaHeartbeat(
        cfg.mode === "active" ? "running" : "idle",
        cfg.mode === "active",
      ).catch(() => undefined);
      if (cfg.mode !== "active") {
        snapshot.state = cfg.mode === "shadow" ? "shadow" : "paused";
        await writeHeartbeat();
        await sleep(cfg.idlePollMs);
        continue;
      }

      let didWork = false;

      const globalEnabled = await studio.isAutomationStudioGlobalEnabled();
      if (!globalEnabled) {
        snapshot.state = snapshot.state === "degraded" ? "degraded" : "paused";
        await writeHeartbeat();
        await sleep(didWork ? 50 : cfg.idlePollMs);
        continue;
      }
      for (const [lane, family, scaleLane] of familyLanes) {
        if (!automationLaneSet.has(scaleLane)) continue;
        if (!(await studio.isAutomationStudioWorkflowEnabled(lane))) continue;
        for (let i = 0; i < cfg.maxDrainPerFamily && !stopping; i += 1) {
          const result = await engine.runNativeFamilyClaimCycle({
            workerId: cfg.workerId,
            family,
          });
          markResult(lane, result);
          if (result.state === "idle") break;
          didWork = true;
          if (result.state === "refused") break;
        }
      }

      const now = Date.now();
      if (
        automationLaneSet.has("background") &&
        now >= nextRecoveryAt &&
        (await studio.isAutomationStudioWorkflowEnabled("recovery"))
      ) {
        const recovered = await engine.runNativeRecoveryCycle(cfg.workerId);
        markResult("recovery", recovered);
        didWork ||= recovered.state !== "idle";
        nextRecoveryAt = now + cfg.recoveryIntervalMs;
      }

      if (automationLaneSet.has("system") && now >= nextSystemLanesAt) {
        const dispatched = await engine.runNativeLeadAssignmentDispatchCycle(
          cfg.leadDispatchBatch,
        );
        markResult("lead_assignment_dispatch", dispatched);
        didWork ||= dispatched.state !== "idle";

        const acknowledgements = await engine.runNativeConsentAckCycle(
          cfg.workerId,
          cfg.consentAckBatch,
        );
        markResult("consent_ack", acknowledgements);
        didWork ||= acknowledgements.state !== "idle";

        nextSystemLanesAt = now + cfg.systemLaneIntervalMs;
      }

      if (automationLaneSet.has("system") && now >= nextDelayedFillAt) {
        const delayedFill = await engine.runNativeDelayedFillCycle(
          cfg.delayedFillBatch,
        );
        markResult("delayed_fill", delayedFill);
        didWork ||= delayedFill.state !== "idle";
        nextDelayedFillAt = now + cfg.delayedFillIntervalMs;
      }

      if (automationLaneSet.has("background") && now >= nextMaintenanceAt) {
        if (await studio.isAutomationStudioWorkflowEnabled("recovery")) {
          const reconciled = await engine.runNativeReconcileCycle(cfg.workerId);
          markResult("reconcile", reconciled);
          didWork ||= reconciled.state !== "idle";
        }
        if (await studio.isAutomationStudioWorkflowEnabled("orphan_cleanup")) {
          const orphaned = await engine.runNativeOrphanCleanupCycle(
            cfg.workerId,
          );
          markResult("orphan_cleanup", orphaned);
          didWork ||= orphaned.state !== "idle";
        }
        if (await studio.isAutomationStudioWorkflowEnabled("stale_cleanup")) {
          const stale = await engine.runNativeStaleCleanupCycle(cfg.workerId);
          markResult("stale_cleanup", stale);
          didWork ||= stale.state !== "idle";
        }

        if (await studio.isAutomationStudioWorkflowEnabled("client_journey")) {
          const enrichment =
            await leadEnrichmentMaintenance.runLeadEnrichmentNoResponseSweep();
          if (enrichment.nurtured > 0) {
            didWork = true;
            snapshot.lastSuccessAt = new Date().toISOString();
            snapshot.lastSafeCode = "NATIVE_LEAD_ENRICHMENT_NURTURE";
          }
        }
        if (await studio.isAutomationStudioWorkflowEnabled("vendor_journey")) {
          const vendorSignals =
            await vendorIntelligence.runVendorIntelligenceMaintenance(100);
          if (vendorSignals.noticesCreated > 0) {
            didWork = true;
            snapshot.lastSuccessAt = new Date().toISOString();
            snapshot.lastSafeCode = "NATIVE_VENDOR_INTELLIGENCE_NOTICES";
          }
        }
        nextMaintenanceAt = now + cfg.maintenanceIntervalMs;
      }

      if (snapshot.state !== "degraded") snapshot.state = "running";
      await writeHeartbeat();
      await sleep(didWork ? 50 : cfg.idlePollMs);
    } catch (error) {
      snapshot.state = "degraded";
      snapshot.lastErrorAt = new Date().toISOString();
      snapshot.lastSafeCode =
        error instanceof Error
          ? error.message.slice(0, 160)
          : "NATIVE_WORKER_UNKNOWN_ERROR";
      console.error("[qf-native-automation] cycle failed", {
        code: snapshot.lastSafeCode,
      });
      await writeHeartbeat(true).catch(() => undefined);
      await writeReplicaHeartbeat(
        "degraded",
        true,
        true,
        snapshot.lastSafeCode ?? undefined,
      ).catch(() => undefined);
      await sleep(Math.max(cfg.idlePollMs, 5000));
    }
  }

  drainStartedAt ??= new Date().toISOString();
  await writeReplicaHeartbeat("draining", false, true, "GRACEFUL_DRAIN").catch(
    () => undefined,
  );
  snapshot.state = "stopping";
  snapshot.heartbeatAt = new Date().toISOString();
  await runtime
    .writeNativeAutomationRuntimeSnapshot(snapshot)
    .catch(() => undefined);
  await writeReplicaHeartbeat(
    "stopped",
    false,
    true,
    "GRACEFUL_DRAIN_COMPLETE",
  ).catch(() => undefined);
  console.info("[qf-native-automation] worker stopped", {
    workerId: cfg.workerId,
  });
}

main()
  .catch((error) => {
    console.error("[qf-native-automation] fatal startup failure", {
      code:
        error instanceof Error
          ? error.message.slice(0, 160)
          : "NATIVE_WORKER_FATAL",
    });
    process.exitCode = 1;
  })
  .finally(() => observability.shutdown().catch(() => undefined));
