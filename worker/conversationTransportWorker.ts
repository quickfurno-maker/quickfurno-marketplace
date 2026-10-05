import WebSocket from "ws";
import {
  assertQfRuntimeIdentity,
  loadQfRuntimeEnvironment,
} from "@/lib/runtime/deploymentConfig";

loadQfRuntimeEnvironment();
assertQfRuntimeIdentity("quickfurno.conversation-transport");

if (typeof globalThis.WebSocket === "undefined") {
  Object.defineProperty(globalThis, "WebSocket", {
    value: WebSocket,
    configurable: true,
    writable: true,
  });
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

const TRANSPORT_LANES = ["provider-outbound", "jarvis-ingress"] as const;
type TransportLane = (typeof TRANSPORT_LANES)[number];

function parseTransportLanes(raw = process.env.QF_CONVERSATION_TRANSPORT_LANES): readonly TransportLane[] {
  if (!raw?.trim()) return TRANSPORT_LANES;
  const lanes = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    lanes.length < 1 ||
    new Set(lanes).size !== lanes.length ||
    lanes.some((lane) => !TRANSPORT_LANES.includes(lane as TransportLane))
  ) {
    throw new Error("CONVERSATION_TRANSPORT_LANES_INVALID");
  }
  return Object.freeze(lanes as TransportLane[]);
}

const transportLanes = parseTransportLanes();
const providerOutboundEnabled = transportLanes.includes("provider-outbound");
const jarvisIngressEnabled = transportLanes.includes("jarvis-ingress");
const wakeTopics = Object.freeze([
  ...(providerOutboundEnabled ? ["conversation-outbox" as const] : []),
  ...(jarvisIngressEnabled ? ["jarvis-turn-outbox" as const] : []),
]);

const idlePollMs = boundedInt(
  process.env.QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS,
  1000,
  250,
  5000,
);
const busyPollMs = boundedInt(
  process.env.QF_CONVERSATION_TRANSPORT_BUSY_POLL_MS,
  25,
  10,
  500,
);
const maxDrain = boundedInt(
  process.env.QF_CONVERSATION_TRANSPORT_MAX_DRAIN,
  50,
  1,
  200,
);
const heartbeatMs = boundedInt(
  process.env.QF_CONVERSATION_TRANSPORT_HEARTBEAT_MS,
  15000,
  5000,
  60000,
);

const sleep = (ms: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

function jitter(ms: number): number {
  const spread = Math.max(25, Math.floor(ms * 0.2));
  return Math.max(10, ms - spread + Math.floor(Math.random() * (spread * 2 + 1)));
}

async function main() {
  const jarvis = await import("@/services/jarvisWhatsAppGatewayService");
  const conversational = await import("@/services/conversationalWhatsAppService");
  const wakeups = await import("@/lib/coordination/durableWorkWakeup");
  const scale = await import("@/services/scaleWorkerRuntimeService");

  const role =
    transportLanes.length === 2
      ? "conversation-transport"
      : providerOutboundEnabled
        ? "conversation-provider-outbound"
        : "conversation-jarvis-ingress";
  const workerId = scale.scaleWorkerId(
    role,
    process.env.QF_CONVERSATION_TRANSPORT_WORKER_ID,
  );
  const startedAt = new Date().toISOString();
  let stopping = false;
  let drainStartedAt: string | null = null;
  let lastHeartbeatAt = 0;

  const heartbeat = async (
    state: "starting" | "running" | "idle" | "degraded" | "draining" | "stopped",
    acceptingWork: boolean,
    inFlight: number,
    force = false,
    lastSafeCode?: string,
  ) => {
    const now = Date.now();
    if (!force && now - lastHeartbeatAt < heartbeatMs) return;
    await scale.writeScaleWorkerHeartbeat({
      role,
      workerId,
      state,
      acceptingWork,
      inFlight,
      startedAt,
      drainStartedAt,
      lastSafeCode,
    });
    lastHeartbeatAt = now;
  };

  const stop = () => {
    stopping = true;
    drainStartedAt ??= new Date().toISOString();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  console.info("[qf-conversation-transport] worker starting", {
    workerId,
    role,
    lanes: transportLanes,
    idlePollMs,
    busyPollMs,
    maxDrain,
  });
  await heartbeat("starting", true, 0, true).catch(() => undefined);

  while (!stopping) {
    let didWork = false;
    let processed = 0;
    const started = Date.now();

    try {
      await heartbeat("running", true, 0).catch(() => undefined);
      for (let i = 0; i < maxDrain && !stopping; i += 1) {
        let cycleWorked = false;
        await heartbeat("running", true, 1).catch(() => undefined);

        if (providerOutboundEnabled) {
          const reply = await conversational.dispatchNextConversationalOutbox();
          if (reply.processed) {
            cycleWorked = true;
            didWork = true;
            processed += 1;
          }
        }

        if (stopping) break;

        if (jarvisIngressEnabled) {
          const turn = await jarvis.dispatchNextJarvisWhatsAppTurn();
          if (turn.processed) {
            cycleWorked = true;
            didWork = true;
            processed += 1;
          }
        }

        if (!cycleWorked) break;
      }

      if (didWork) {
        console.info("[qf-conversation-transport] cycle", {
          processed,
          elapsedMs: Date.now() - started,
        });
        await heartbeat("running", true, 0).catch(() => undefined);
        if (!stopping) await sleep(jitter(busyPollMs));
        continue;
      }

      await heartbeat("idle", true, 0).catch(() => undefined);
      const wake = await wakeups.waitForDurableWorkWakeup({
        topics: wakeTopics,
        timeoutMs: idlePollMs,
      });
      if (wake.status === "unavailable" && !stopping) {
        await sleep(jitter(idlePollMs));
      }
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message.slice(0, 160)
          : "CONVERSATION_TRANSPORT_UNKNOWN_ERROR";
      console.error("[qf-conversation-transport] cycle failed", { code });
      await heartbeat("degraded", true, 0, true, code).catch(() => undefined);
      if (!stopping) await sleep(jitter(Math.max(idlePollMs, 1000)));
    }
  }

  drainStartedAt ??= new Date().toISOString();
  await heartbeat("draining", false, 0, true, "GRACEFUL_DRAIN").catch(() => undefined);
  await wakeups.closeDurableWorkCoordination().catch(() => undefined);
  await heartbeat("stopped", false, 0, true, "GRACEFUL_DRAIN_COMPLETE").catch(
    () => undefined,
  );
  console.info("[qf-conversation-transport] worker stopped", { workerId });
}

main().catch((error) => {
  console.error("[qf-conversation-transport] fatal startup failure", {
    code:
      error instanceof Error
        ? error.message.slice(0, 160)
        : "CONVERSATION_TRANSPORT_FATAL",
  });
  process.exitCode = 1;
});
