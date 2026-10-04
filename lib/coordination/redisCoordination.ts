import { createHash } from "node:crypto";
import { createClient } from "redis";

import type {
  CacheRead,
  CoordinationPort,
  CoordinationStatus,
  CoordinationWrite,
  LockAcquire,
  LockRelease,
  RateLimitDecision,
} from "./coordination";

const DEFAULT_PREFIX = "qf:v1";
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TAG_VERSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LOCK_TTL_MS = 5 * 60 * 1000;
const FENCE_RETENTION_MS = 24 * 60 * 60 * 1000;
const MACHINE_TOKEN = /^[a-z0-9][a-z0-9:_-]{0,95}$/u;

function machineToken(value: string, label: string): string {
  if (!MACHINE_TOKEN.test(value)) {
    throw new Error(`${label} must be a lowercase machine token`);
  }
  return value;
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive integer <= ${maximum}`);
  }
  return value;
}

function opaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function numberFromReply(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Redis returned an invalid ${label}`);
  }
  return parsed;
}

function arrayReply(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Redis returned an invalid ${label}`);
  }
  return value;
}

export type RedisCoordinationOptions = {
  url: string;
  prefix?: string;
  connectTimeoutMs?: number;
};

export class RedisCoordination implements CoordinationPort {
  readonly #client;
  readonly #prefix;

  constructor(options: RedisCoordinationOptions) {
    const url = options.url.trim();
    if (url === "") throw new Error("Redis coordination URL is required");
    this.#prefix = machineToken(
      options.prefix ?? DEFAULT_PREFIX,
      "coordination prefix",
    );
    this.#client = createClient({
      url,
      socket: {
        connectTimeout: positiveInteger(
          options.connectTimeoutMs ?? 750,
          "connectTimeoutMs",
          10_000,
        ),
        reconnectStrategy: false,
      },
    });
    this.#client.on("error", () => undefined);
  }

  async #ready(): Promise<boolean> {
    if (this.#client.isReady) return true;
    try {
      if (!this.#client.isOpen) await this.#client.connect();
      return this.#client.isReady;
    } catch {
      return false;
    }
  }

  #base(namespace: string): string {
    return `${this.#prefix}:${machineToken(namespace, "namespace")}`;
  }

  #tagKey(namespace: string, tag: string): string {
    return `${this.#base(namespace)}:tag:${machineToken(tag, "tag")}`;
  }

  async #tagVersions(
    namespace: string,
    tags: readonly string[],
  ): Promise<readonly string[] | null> {
    if (tags.length === 0) return [];
    const keys = tags.map((tag) => this.#tagKey(namespace, tag));
    if (!(await this.#ready())) return null;
    try {
      const reply = await this.#client.sendCommand(["MGET", ...keys]);
      return arrayReply(reply, "tag version reply").map((value) =>
        value === null ? "0" : String(value),
      );
    } catch {
      return null;
    }
  }

  #cacheKey(
    namespace: string,
    key: string,
    tags: readonly string[],
    versions: readonly string[],
  ): string {
    const vector = tags
      .map(
        (tag, index) =>
          `${machineToken(tag, "tag")}=${versions[index] ?? "0"}`,
      )
      .join(",");
    return `${this.#base(namespace)}:cache:${opaque(key)}:${opaque(vector)}`;
  }

  async ping(): Promise<CoordinationStatus> {
    if (!(await this.#ready())) return "unavailable";
    try {
      return (await this.#client.ping()) === "PONG" ? "ok" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  async rateLimit(input: {
    namespace: string;
    subject: string;
    limit: number;
    windowMs: number;
  }): Promise<RateLimitDecision> {
    const limit = positiveInteger(input.limit, "limit", 1_000_000);
    const windowMs = positiveInteger(
      input.windowMs,
      "windowMs",
      MAX_RATE_WINDOW_MS,
    );
    const key = `${this.#base(input.namespace)}:rate:${opaque(input.subject)}`;
    if (!(await this.#ready())) return { status: "unavailable" };

    const script = [
      "local current = redis.call('INCR', KEYS[1])",
      "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
      "local ttl = redis.call('PTTL', KEYS[1])",
      "return {current, ttl}",
    ].join("\n");

    try {
      const reply = arrayReply(
        await this.#client.sendCommand([
          "EVAL",
          script,
          "1",
          key,
          String(windowMs),
        ]),
        "rate limit reply",
      );
      const current = numberFromReply(reply[0], "rate counter");
      const ttl = Math.max(0, numberFromReply(reply[1], "rate ttl"));
      return {
        status: "ok",
        allowed: current <= limit,
        remaining: Math.max(0, limit - current),
        retryAfterMs: current <= limit ? 0 : ttl,
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  async cacheGet<T>(input: {
    namespace: string;
    key: string;
    tags?: readonly string[];
  }): Promise<CacheRead<T>> {
    const tags = input.tags ?? [];
    const versions = await this.#tagVersions(input.namespace, tags);
    if (versions === null) return { status: "unavailable" };
    const key = this.#cacheKey(input.namespace, input.key, tags, versions);

    try {
      const raw = await this.#client.get(key);
      if (raw === null) return { status: "miss" };
      return { status: "hit", value: JSON.parse(raw) as T };
    } catch {
      return { status: "unavailable" };
    }
  }

  async cacheSet(input: {
    namespace: string;
    key: string;
    value: unknown;
    ttlMs: number;
    tags?: readonly string[];
  }): Promise<CoordinationWrite> {
    const ttlMs = positiveInteger(input.ttlMs, "ttlMs", MAX_CACHE_TTL_MS);
    const tags = input.tags ?? [];
    const versions = await this.#tagVersions(input.namespace, tags);
    if (versions === null) return { status: "unavailable" };
    const key = this.#cacheKey(input.namespace, input.key, tags, versions);

    try {
      await this.#client.set(key, JSON.stringify(input.value), { PX: ttlMs });
      return { status: "ok" };
    } catch {
      return { status: "unavailable" };
    }
  }

  async invalidateTag(input: {
    namespace: string;
    tag: string;
  }): Promise<CoordinationWrite> {
    const key = this.#tagKey(input.namespace, input.tag);
    if (!(await this.#ready())) return { status: "unavailable" };
    const script = [
      "local version = redis.call('INCR', KEYS[1])",
      "redis.call('PEXPIRE', KEYS[1], ARGV[1])",
      "return version",
    ].join("\n");
    try {
      await this.#client.sendCommand([
        "EVAL",
        script,
        "1",
        key,
        String(TAG_VERSION_TTL_MS),
      ]);
      return { status: "ok" };
    } catch {
      return { status: "unavailable" };
    }
  }

  async acquireLock(input: {
    namespace: string;
    resource: string;
    owner: string;
    ttlMs: number;
  }): Promise<LockAcquire> {
    const ttlMs = positiveInteger(input.ttlMs, "ttlMs", MAX_LOCK_TTL_MS);
    machineToken(input.owner, "owner");
    const slot = `lock:${machineToken(input.namespace, "namespace")}:${opaque(input.resource)}`;
    const lockKey = `${this.#prefix}:{${slot}}:owner`;
    const fenceKey = `${this.#prefix}:{${slot}}:fence`;
    if (!(await this.#ready())) return { status: "unavailable" };

    const script = [
      "if redis.call('EXISTS', KEYS[1]) == 1 then return {0, 0} end",
      "local fence = redis.call('INCR', KEYS[2])",
      "redis.call('PEXPIRE', KEYS[2], ARGV[2])",
      "redis.call('PSETEX', KEYS[1], ARGV[1], ARGV[3] .. ':' .. fence)",
      "return {1, fence}",
    ].join("\n");

    try {
      const reply = arrayReply(
        await this.#client.sendCommand([
          "EVAL",
          script,
          "2",
          lockKey,
          fenceKey,
          String(ttlMs),
          String(FENCE_RETENTION_MS),
          input.owner,
        ]),
        "lock reply",
      );
      if (numberFromReply(reply[0], "lock result") !== 1) {
        return { status: "busy" };
      }
      return {
        status: "acquired",
        owner: input.owner,
        fence: numberFromReply(reply[1], "fence"),
        expiresInMs: ttlMs,
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  async releaseLock(input: {
    namespace: string;
    resource: string;
    owner: string;
    fence: number;
  }): Promise<LockRelease> {
    machineToken(input.owner, "owner");
    positiveInteger(input.fence, "fence", Number.MAX_SAFE_INTEGER);
    const slot = `lock:${machineToken(input.namespace, "namespace")}:${opaque(input.resource)}`;
    const lockKey = `${this.#prefix}:{${slot}}:owner`;
    if (!(await this.#ready())) return { status: "unavailable" };

    const expected = `${input.owner}:${input.fence}`;
    const script = [
      "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
      "return redis.call('DEL', KEYS[1])",
    ].join("\n");
    try {
      const reply = await this.#client.sendCommand([
        "EVAL",
        script,
        "1",
        lockKey,
        expected,
      ]);
      return numberFromReply(reply, "unlock result") === 1
        ? { status: "released" }
        : { status: "not-owner" };
    } catch {
      return { status: "unavailable" };
    }
  }

  async publishWakeup(input: {
    namespace: string;
    topic: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<CoordinationWrite> {
    const channel = `${this.#base(input.namespace)}:wake:${machineToken(input.topic, "topic")}`;
    if (!(await this.#ready())) return { status: "unavailable" };
    try {
      await this.#client.publish(channel, JSON.stringify(input.payload));
      return { status: "ok" };
    } catch {
      return { status: "unavailable" };
    }
  }

  async disconnect(): Promise<void> {
    if (!this.#client.isOpen) return;
    try {
      await this.#client.quit();
    } catch {
      this.#client.destroy();
    }
  }
}

export function createRedisCoordinationFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisCoordination | null {
  const url = env.QF_COORDINATION_REDIS_URL?.trim();
  if (!url) return null;
  return new RedisCoordination({ url });
}
