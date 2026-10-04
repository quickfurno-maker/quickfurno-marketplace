#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const failures = [];

function check(name, condition, detail) {
  if (!condition) failures.push({ name, detail });
  else console.log("PASS " + name);
}

const port = await readFile(resolve(ROOT, "lib/coordination/coordination.ts"), "utf8");
const adapter = await readFile(resolve(ROOT, "lib/coordination/redisCoordination.ts"), "utf8");
const compose = await readFile(resolve(ROOT, "ops/coordination/compose.valkey.yml"), "utf8");
const productionCompose = await readFile(resolve(ROOT, "ops/container/compose.production.yml"), "utf8");
const certification = await readFile(resolve(ROOT, "scripts/scale/certify-coordination.mjs"), "utf8");
const pkg = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));

check(
  "provider-neutral coordination port exists",
  port.includes("export interface CoordinationPort") &&
    !port.includes('from "redis"') &&
    !port.includes("createClient("),
  "business-facing code must depend on the port, not node-redis",
);
check(
  "Redis adapter is isolated behind the port",
  adapter.includes('from "redis"') &&
    adapter.includes("implements CoordinationPort") &&
    adapter.includes("createRedisCoordinationFromEnv"),
  "node-redis must stay inside the reviewed adapter",
);
check(
  "coordination URL is optional",
  adapter.includes("if (!url) return null"),
  "Redis outage/absence must not become an application boot dependency",
);
check(
  "sensitive subjects and resources are hashed in keys",
  adapter.includes('createHash("sha256")') &&
    adapter.includes("opaque(input.subject)") &&
    adapter.includes("opaque(input.resource)") &&
    adapter.includes("opaque(key)"),
  "plaintext phone/lead/resource identifiers must not appear in key names",
);
check(
  "ephemeral cache writes require TTL",
  adapter.includes("MAX_CACHE_TTL_MS") && adapter.includes("{ PX: ttlMs }"),
  "shared cache entries must expire",
);
check(
  "rate counters require TTL",
  adapter.includes("PEXPIRE") && adapter.includes("MAX_RATE_WINDOW_MS"),
  "distributed rate-limit counters must expire",
);
check(
  "lock ownership and fencing are explicit",
  adapter.includes("fence") &&
    adapter.includes("PSETEX") &&
    adapter.includes("not-owner") &&
    adapter.includes("FENCE_RETENTION_MS"),
  "distributed locks need ownership, bounded lifetime and fencing",
);
check(
  "coordination outage is surfaced, not mistaken for success",
  (adapter.match(/status: "unavailable"/g) ?? []).length >= 6,
  "callers must be able to choose DB fallback/refusal",
);
check(
  "Valkey image is digest pinned",
  compose.includes("valkey/valkey@sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507"),
  "Valkey runtime must be reproducible",
);
check(
  "Valkey persistence is disabled",
  compose.includes("--appendonly") &&
    compose.includes('"no"') &&
    compose.includes("--save") &&
    compose.includes('      - ""'),
  "coordination is not durable truth",
);
check(
  "Valkey memory is bounded with TTL-aware eviction",
  compose.includes("--maxmemory") &&
    compose.includes("256mb") &&
    compose.includes("volatile-ttl"),
  "ephemeral coordination must have a defined memory policy",
);
check(
  "Valkey has no host-published port",
  !/\n\s+ports\s*:/u.test(compose),
  "coordination service must stay on the private Docker network",
);
check(
  "Valkey filesystem is disposable",
  compose.includes("read_only: true") &&
    compose.includes("/data:rw,noexec,nosuid,nodev"),
  "Valkey data must not become persistent host state",
);
check(
  "QuickFurno production services do not depend on Valkey",
  !productionCompose.includes("depends_on:") &&
    !productionCompose.includes("QF_COORDINATION_REDIS_URL:?"),
  "Redis failure must not block web/worker startup",
);
check(
  "node-redis dependency is pinned",
  pkg.dependencies?.redis === "6.3.0",
  "coordination adapter dependency must be explicit and reproducible",
);
check(
  "certification runs two web and two worker replicas",
  certification.includes("const web1") &&
    certification.includes("const web2") &&
    certification.includes("const worker1") &&
    certification.includes("const worker2"),
  "exit gate requires 2 web + 2 worker replicas",
);
check(
  "certification covers outage, invalidation and distributed rate limiting",
  certification.includes("redis://127.0.0.1:63991") &&
    certification.includes("invalidateTag") &&
    certification.includes("rateResults") &&
    certification.includes("durableBusinessTruth"),
  "Phase 06 failure and concurrency gates must be executable",
);
check(
  "wake-up remains best effort",
  port.includes("wake-up => DB recovery polling") &&
    adapter.includes("publishWakeup"),
  "Redis wake-up cannot replace durable Postgres work",
);

if (failures.length > 0) {
  console.error("QuickFurno Phase 06 coordination contract FAILED");
  for (const failure of failures) {
    console.error("- " + failure.name + ": " + failure.detail);
  }
  process.exit(1);
}

console.log("QuickFurno Phase 06 coordination contract PASS");
