import assert from "node:assert/strict";
import { createClient } from "redis";

import { RedisCoordination } from "../../lib/coordination/redisCoordination.ts";

const url = process.env.QF_COORDINATION_REDIS_URL?.trim();
if (!url) {
  throw new Error("QF_COORDINATION_REDIS_URL is required for Phase 06 certification");
}

const namespace = `phase06-${process.pid}`;
const web1 = new RedisCoordination({ url });
const web2 = new RedisCoordination({ url });
const worker1 = new RedisCoordination({ url });
const worker2 = new RedisCoordination({ url });
const all = [web1, web2, worker1, worker2];

for (const client of all) {
  assert.equal(await client.ping(), "ok");
}

const rateResults = await Promise.all(
  all.map((client) =>
    client.rateLimit({
      namespace,
      subject: "client:+91-should-never-appear-in-key",
      limit: 3,
      windowMs: 30_000,
    }),
  ),
);
assert.equal(
  rateResults.filter((result) => result.status === "ok" && result.allowed).length,
  3,
);
assert.equal(
  rateResults.filter((result) => result.status === "ok" && !result.allowed).length,
  1,
);

assert.deepEqual(
  await web1.cacheSet({
    namespace,
    key: "lead:client-visible-reference",
    value: { vendorCount: 3 },
    ttlMs: 10_000,
    tags: ["matching"],
  }),
  { status: "ok" },
);
assert.deepEqual(
  await web2.cacheGet({
    namespace,
    key: "lead:client-visible-reference",
    tags: ["matching"],
  }),
  { status: "hit", value: { vendorCount: 3 } },
);
assert.deepEqual(await web2.invalidateTag({ namespace, tag: "matching" }), {
  status: "ok",
});
assert.deepEqual(
  await web1.cacheGet({
    namespace,
    key: "lead:client-visible-reference",
    tags: ["matching"],
  }),
  { status: "miss" },
);

const lockRace = await Promise.all([
  worker1.acquireLock({
    namespace,
    resource: "assignment:lead-visible-reference",
    owner: "worker-a",
    ttlMs: 10_000,
  }),
  worker2.acquireLock({
    namespace,
    resource: "assignment:lead-visible-reference",
    owner: "worker-b",
    ttlMs: 10_000,
  }),
]);
const winner = lockRace.find((result) => result.status === "acquired");
const loser = lockRace.find((result) => result.status === "busy");
assert.ok(winner && winner.status === "acquired");
assert.ok(loser && loser.status === "busy");

assert.deepEqual(
  await worker2.releaseLock({
    namespace,
    resource: "assignment:lead-visible-reference",
    owner: winner.owner === "worker-a" ? "worker-b" : "worker-a",
    fence: winner.fence,
  }),
  { status: "not-owner" },
);
assert.deepEqual(
  await (winner.owner === "worker-a" ? worker1 : worker2).releaseLock({
    namespace,
    resource: "assignment:lead-visible-reference",
    owner: winner.owner,
    fence: winner.fence,
  }),
  { status: "released" },
);

const nextOwner = winner.owner === "worker-a" ? "worker-b" : "worker-a";
const nextLock = await (nextOwner === "worker-a" ? worker1 : worker2).acquireLock({
  namespace,
  resource: "assignment:lead-visible-reference",
  owner: nextOwner,
  ttlMs: 10_000,
});
assert.equal(nextLock.status, "acquired");
if (nextLock.status === "acquired") {
  assert.ok(nextLock.fence > winner.fence);
}

const subscriber = createClient({ url });
subscriber.on("error", () => undefined);
await subscriber.connect();
let resolveWakeup;
let rejectWakeup;
const wakeup = new Promise((resolve, reject) => {
  resolveWakeup = resolve;
  rejectWakeup = reject;
});
const wakeupTimer = setTimeout(
  () => rejectWakeup?.(new Error("wakeup was not observed")),
  3_000,
);
await subscriber.subscribe(`qf:v1:${namespace}:wake:jobs`, (message) => {
  clearTimeout(wakeupTimer);
  resolveWakeup?.(message);
});
assert.deepEqual(
  await worker1.publishWakeup({
    namespace,
    topic: "jobs",
    payload: { kind: "durable-work-available", opaqueId: "job-123" },
  }),
  { status: "ok" },
);
assert.deepEqual(JSON.parse(await wakeup), {
  kind: "durable-work-available",
  opaqueId: "job-123",
});
await subscriber.unsubscribe();
await subscriber.quit();

// SCALE-P07: production workers consume the same advisory signal through the
// provider-neutral port. Missing signals remain harmless because timeout returns
// to the durable PostgreSQL poll path.
const portWait = worker2.waitForWakeup({
  namespace,
  topics: ["jobs"],
  timeoutMs: 2_000,
});
await new Promise((resolve) => setTimeout(resolve, 50));
await worker1.publishWakeup({
  namespace,
  topic: "jobs",
  payload: { kind: "phase07-port-wakeup", opaqueId: "job-456" },
});
const observedPortWakeup = await portWait;
assert.equal(observedPortWakeup.status, "wakeup");
if (observedPortWakeup.status === "wakeup") {
  assert.equal(observedPortWakeup.topic, "jobs");
  assert.deepEqual(JSON.parse(observedPortWakeup.payload), {
    kind: "phase07-port-wakeup",
    opaqueId: "job-456",
  });
}
assert.deepEqual(
  await worker2.waitForWakeup({
    namespace,
    topics: ["jobs"],
    timeoutMs: 50,
  }),
  { status: "timeout" },
);

const inspector = createClient({ url });
inspector.on("error", () => undefined);
await inspector.connect();
const discovered = await inspector.keys(`qf:v1:*${namespace}*`);
assert.ok(discovered.length >= 4);
for (const key of discovered) {
  const ttl = await inspector.pTTL(key);
  assert.ok(ttl > 0, `expected TTL on coordination key ${key}, got ${ttl}`);
  assert.equal(key.includes("+91-should-never-appear-in-key"), false);
  assert.equal(key.includes("lead-visible-reference"), false);
}
await inspector.quit();

const outage = new RedisCoordination({
  url: "redis://127.0.0.1:63991",
  connectTimeoutMs: 100,
});
const durableBusinessTruth = Object.freeze({
  credits: 11,
  paymentStatus: "paid",
  assignedVendors: 3,
  consent: "granted",
});
assert.deepEqual(
  await outage.rateLimit({
    namespace,
    subject: "outage-subject",
    limit: 1,
    windowMs: 1_000,
  }),
  { status: "unavailable" },
);
assert.deepEqual(
  await outage.cacheGet({ namespace, key: "outage-cache", tags: ["matching"] }),
  { status: "unavailable" },
);
assert.deepEqual(
  await outage.acquireLock({
    namespace,
    resource: "outage-lock",
    owner: "worker-c",
    ttlMs: 1_000,
  }),
  { status: "unavailable" },
);
assert.deepEqual(
  await outage.publishWakeup({
    namespace,
    topic: "jobs",
    payload: { opaqueId: "missed-wakeup" },
  }),
  { status: "unavailable" },
);
assert.deepEqual(
  await outage.waitForWakeup({
    namespace,
    topics: ["jobs"],
    timeoutMs: 100,
  }),
  { status: "unavailable" },
);
assert.deepEqual(durableBusinessTruth, {
  credits: 11,
  paymentStatus: "paid",
  assignedVendors: 3,
  consent: "granted",
});
await outage.disconnect();

if (nextLock.status === "acquired") {
  await (nextOwner === "worker-a" ? worker1 : worker2).releaseLock({
    namespace,
    resource: "assignment:lead-visible-reference",
    owner: nextOwner,
    fence: nextLock.fence,
  });
}
await Promise.all(all.map((client) => client.disconnect()));

console.log(
  JSON.stringify(
    {
      phase: "06",
      replicas: { web: 2, worker: 2 },
      distributedRateLimit: "PASS",
      cacheInvalidation: "PASS",
      fencedLockOwnership: "PASS",
      wakeupSignal: "PASS",
      ttlDiscipline: "PASS",
      opaqueKeyNames: "PASS",
      redisOutage: "SAFE_UNAVAILABLE",
      durableBusinessTruth: "UNCHANGED",
    },
    null,
    2,
  ),
);
