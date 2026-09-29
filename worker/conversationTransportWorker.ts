import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import WebSocket from "ws";

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

const idlePollMs = boundedInt(
  process.env.QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS,
  100,
  50,
  5000,
);
const busyPollMs = boundedInt(
  process.env.QF_CONVERSATION_TRANSPORT_BUSY_POLL_MS,
  10,
  5,
  1000,
);
const maxDrain = boundedInt(
  process.env.QF_CONVERSATION_TRANSPORT_MAX_DRAIN,
  50,
  1,
  200,
);

const sleep = (ms: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

async function main() {
  const jarvis = await import("@/services/jarvisWhatsAppGatewayService");
  const conversational = await import("@/services/conversationalWhatsAppService");
  let stopping = false;

  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  console.info("[qf-conversation-transport] worker starting", {
    idlePollMs,
    busyPollMs,
    maxDrain,
  });

  while (!stopping) {
    let didWork = false;
    let processed = 0;
    const startedAt = Date.now();

    try {
      for (let i = 0; i < maxDrain && !stopping; i += 1) {
        let cycleWorked = false;

        const reply = await conversational.dispatchNextConversationalOutbox();
        if (reply.processed) {
          cycleWorked = true;
          didWork = true;
          processed += 1;
        }

        const turn = await jarvis.dispatchNextJarvisWhatsAppTurn();
        if (turn.processed) {
          cycleWorked = true;
          didWork = true;
          processed += 1;
        }

        if (!cycleWorked) break;
      }

      if (didWork) {
        console.info("[qf-conversation-transport] cycle", {
          processed,
          elapsedMs: Date.now() - startedAt,
        });
      }

      await sleep(didWork ? busyPollMs : idlePollMs);
    } catch (error) {
      console.error("[qf-conversation-transport] cycle failed", {
        code:
          error instanceof Error
            ? error.message.slice(0, 160)
            : "CONVERSATION_TRANSPORT_UNKNOWN_ERROR",
      });
      await sleep(500);
    }
  }

  console.info("[qf-conversation-transport] worker stopped");
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
