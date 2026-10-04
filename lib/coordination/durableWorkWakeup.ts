import type { WakeupWait } from "./coordination";
import {
  createRedisCoordinationFromEnv,
  type RedisCoordination,
} from "./redisCoordination";

export const DURABLE_WORK_NAMESPACE = "durable-work";
export const DURABLE_WORK_TOPICS = Object.freeze([
  "conversation-outbox",
  "jarvis-turn-outbox",
  "automation-jobs",
  "aarohi-scheduler",
] as const);

let shared: RedisCoordination | null | undefined;

function coordination(): RedisCoordination | null {
  if (shared !== undefined) return shared;
  shared = createRedisCoordinationFromEnv();
  return shared;
}

export async function publishDurableWorkWakeup(
  topic: (typeof DURABLE_WORK_TOPICS)[number],
  reference: string,
): Promise<"published" | "unavailable"> {
  try {
    const client = coordination();
    if (client === null) return "unavailable";
    const result = await client.publishWakeup({
      namespace: DURABLE_WORK_NAMESPACE,
      topic,
      payload: { reference: reference.slice(0, 200) },
    });
    return result.status === "ok" ? "published" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function waitForDurableWorkWakeup(input: {
  topics: readonly (typeof DURABLE_WORK_TOPICS)[number][];
  timeoutMs: number;
}): Promise<WakeupWait> {
  try {
    const client = coordination();
    if (client === null) return { status: "unavailable" };
    return await client.waitForWakeup({
      namespace: DURABLE_WORK_NAMESPACE,
      topics: input.topics,
      timeoutMs: input.timeoutMs,
    });
  } catch {
    return { status: "unavailable" };
  }
}

export async function closeDurableWorkCoordination(): Promise<void> {
  const client = shared;
  shared = undefined;
  if (client) await client.disconnect();
}
