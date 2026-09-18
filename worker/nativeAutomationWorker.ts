import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import WebSocket from "ws";
import type { NativeAutomationCycleResult } from "@/services/nativeAutomationEngineService";
import type { NativeAutomationRuntimeSnapshot } from "@/services/nativeAutomationRuntimeService";

function loadEnvironment() {
  const explicit = process.env.QF_ENV_FILE?.trim();
  const candidates = [explicit, ".env.local", ".env.production", ".env"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const path = resolve(process.cwd(), candidate);
    if (!existsSync(path)) continue;
    loadDotEnv({ path, override: false });
    if (explicit) break;
  }
}

loadEnvironment();

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
const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

async function main() {
  const runtime = await import("@/services/nativeAutomationRuntimeService");
  const engine = await import("@/services/nativeAutomationEngineService");
  const studio = await import("@/services/automationStudioService");
  const jarvisWhatsApp = await import("@/services/jarvisWhatsAppGatewayService");
  const conversationalWhatsApp = await import("@/services/conversationalWhatsAppService");
  const cfg = runtime.getNativeAutomationRuntimeConfig();
  const startedAt = new Date().toISOString();
  let stopping = false;
  let lastHeartbeatWrite = 0;
  let nextRecoveryAt = 0;
  let nextMaintenanceAt = 0;
  let nextSystemLanesAt = 0;
  let nextDelayedFillAt = 0;
  const snapshot: NativeAutomationRuntimeSnapshot = {
    schemaVersion: 1 as const,
    engine: runtime.NATIVE_AUTOMATION_ENGINE_KEY,
    mode: cfg.mode,
    workerId: cfg.workerId,
    state: cfg.mode === "shadow" ? "shadow" as const : cfg.mode === "off" ? "paused" as const : "starting" as const,
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
  const markResult = (lane: keyof typeof snapshot.laneLastRunAt, result: NativeAutomationCycleResult) => {
    const now = new Date().toISOString();
    snapshot.laneLastRunAt[lane] = now;
    snapshot.lastSafeCode = result.safeCode;
    if (result.jobId) snapshot.lastClaimAt = now;
    if (result.jobId && result.state !== "idle") snapshot.jobsProcessed += 1;
    if (result.state === "completed" || result.state === "finalized") {
      snapshot.lastSuccessAt = now;
      if (snapshot.state === "degraded") snapshot.state = "running";
    }
    if (result.state === "refused") {
      snapshot.lastErrorAt = now;
      snapshot.state = "degraded";
    }
  };

  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  console.info("[qf-native-automation] worker starting", {
    engine: runtime.NATIVE_AUTOMATION_ENGINE_KEY,
    version: ENGINE_VERSION,
    mode: cfg.mode,
    workerId: cfg.workerId,
  });

  if (cfg.mode === "active") snapshot.state = "running";
  await writeHeartbeat(true);

  const familyLanes = [
    ["client_journey", "client_whatsapp"],
    ["vendor_journey", "vendor_whatsapp"],
    ["campaigns", "campaign_execution"],
  ] as const;
  while (!stopping) {
    try {
      snapshot.cycles += 1;
      if (cfg.mode !== "active") {
        snapshot.state = cfg.mode === "shadow" ? "shadow" : "paused";
        await writeHeartbeat();
        await sleep(cfg.idlePollMs);
        continue;
      }

      const globalEnabled = await studio.isAutomationStudioGlobalEnabled();
      if (!globalEnabled) {
        snapshot.state = "paused";
        await writeHeartbeat();
        await sleep(cfg.idlePollMs);
        continue;
      }

      let didWork = false;
      for (const [lane, family] of familyLanes) {
        if (!(await studio.isAutomationStudioWorkflowEnabled(lane))) continue;
        for (let i = 0; i < cfg.maxDrainPerFamily && !stopping; i += 1) {
          const result = await engine.runNativeFamilyClaimCycle({ workerId: cfg.workerId, family });
          markResult(lane, result);
          if (result.state === "idle") break;
          didWork = true;
          if (result.state === "refused") break;
        }
      }

      const now = Date.now();
      if (now >= nextRecoveryAt && await studio.isAutomationStudioWorkflowEnabled("recovery")) {
        const recovered = await engine.runNativeRecoveryCycle(cfg.workerId);
        markResult("recovery", recovered);
        didWork ||= recovered.state !== "idle";
        nextRecoveryAt = now + cfg.recoveryIntervalMs;
      }

      if (now >= nextSystemLanesAt) {
        const dispatched = await engine.runNativeLeadAssignmentDispatchCycle(cfg.leadDispatchBatch);
        markResult("lead_assignment_dispatch", dispatched);
        didWork ||= dispatched.state !== "idle";

        const acknowledgements = await engine.runNativeConsentAckCycle(cfg.workerId, cfg.consentAckBatch);
        markResult("consent_ack", acknowledgements);
        didWork ||= acknowledgements.state !== "idle";

        // QuickFurno remains the transport authority. These two queues are inert
        // unless the conversational account and Jarvis feature gates are enabled.
        const jarvisTurn = await jarvisWhatsApp.dispatchNextJarvisWhatsAppTurn();
        didWork ||= jarvisTurn.processed;
        const conversationalReply = await conversationalWhatsApp.dispatchNextConversationalOutbox();
        didWork ||= conversationalReply.processed;

        nextSystemLanesAt = now + cfg.systemLaneIntervalMs;
      }

      if (now >= nextDelayedFillAt) {
        const delayedFill = await engine.runNativeDelayedFillCycle(cfg.delayedFillBatch);
        markResult("delayed_fill", delayedFill);
        didWork ||= delayedFill.state !== "idle";
        nextDelayedFillAt = now + cfg.delayedFillIntervalMs;
      }

      if (now >= nextMaintenanceAt) {
        if (await studio.isAutomationStudioWorkflowEnabled("recovery")) {
          const reconciled = await engine.runNativeReconcileCycle(cfg.workerId);
          markResult("reconcile", reconciled);
          didWork ||= reconciled.state !== "idle";
        }
        if (await studio.isAutomationStudioWorkflowEnabled("orphan_cleanup")) {
          const orphaned = await engine.runNativeOrphanCleanupCycle(cfg.workerId);
          markResult("orphan_cleanup", orphaned);
          didWork ||= orphaned.state !== "idle";
        }
        if (await studio.isAutomationStudioWorkflowEnabled("stale_cleanup")) {
          const stale = await engine.runNativeStaleCleanupCycle(cfg.workerId);
          markResult("stale_cleanup", stale);
          didWork ||= stale.state !== "idle";
        }
        nextMaintenanceAt = now + cfg.maintenanceIntervalMs;
      }

      if (snapshot.state !== "degraded") snapshot.state = "running";
      await writeHeartbeat();
      await sleep(didWork ? 50 : cfg.idlePollMs);
    } catch (error) {
      snapshot.state = "degraded";
      snapshot.lastErrorAt = new Date().toISOString();
      snapshot.lastSafeCode = error instanceof Error ? error.message.slice(0, 160) : "NATIVE_WORKER_UNKNOWN_ERROR";
      console.error("[qf-native-automation] cycle failed", { code: snapshot.lastSafeCode });
      await writeHeartbeat(true).catch(() => undefined);
      await sleep(Math.max(cfg.idlePollMs, 5000));
    }
  }

  snapshot.state = "stopping";
  snapshot.heartbeatAt = new Date().toISOString();
  await runtime.writeNativeAutomationRuntimeSnapshot(snapshot).catch(() => undefined);
  console.info("[qf-native-automation] worker stopped", { workerId: cfg.workerId });
}

main().catch((error) => {
  console.error("[qf-native-automation] fatal startup failure", {
    code: error instanceof Error ? error.message.slice(0, 160) : "NATIVE_WORKER_FATAL",
  });
  process.exitCode = 1;
});
