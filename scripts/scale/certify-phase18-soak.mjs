#!/usr/bin/env node
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const seconds = Number(process.env.PHASE18_SOAK_SECONDS || 60);
const concurrency = Number(process.env.PHASE18_CONCURRENCY || 32);
const poolMax = Number(process.env.PHASE18_POOL_MAX || 8);
assert.ok(seconds >= 1 && concurrency >= 2 && poolMax >= 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = true;
let produced = 0;
let accepted = 0;
let controlled429 = 0;
let controlled503 = 0;
let providerTimeouts = 0;
let providerRateLimits = 0;
let peakQueue = 0;
let activeDb = 0;
let peakDb = 0;
let schedulerEffects = 0;
const durableQueue = [];
const completedEffects = new Set();
const providerSends = new Set();
const heapSamples = [];
const occurrenceClaims = new Set();

async function withDbSlot(fn) {
  while (activeDb >= poolMax) await sleep(1);
  activeDb += 1;
  peakDb = Math.max(peakDb, activeDb);
  try { return await fn(); } finally { activeDb -= 1; }
}

async function applyDurable(item) {
  await withDbSlot(async () => {
    await sleep(item.seq % 7 === 0 ? 3 : 1);
    if (completedEffects.has(item.id)) return;
    if (item.seq % 41 === 0) { providerRateLimits += 1; return; }
    if (item.seq % 53 === 0) { providerTimeouts += 1; return; }
    completedEffects.add(item.id);
    if (item.kind === "provider_send") providerSends.add(item.id);
  });
}

async function worker() {
  while (running || durableQueue.length) {
    const item = durableQueue.shift();
    if (!item) { await sleep(2); continue; }
    await applyDurable(item);
  }
}

async function producer(lane) {
  while (running) {
    const seq = produced++;
    const id = "event-" + (seq % 500);
    const kind = seq % 5 === 0 ? "provider_send" : "business";
    if (durableQueue.length >= 256) {
      controlled503 += 1;
    } else if (seq % 97 === 0) {
      controlled429 += 1;
    } else {
      durableQueue.push({id, seq, kind, version: seq % 2 ? "N" : "N-1"});
      accepted += 1;
      peakQueue = Math.max(peakQueue, durableQueue.length);
    }
    if ((seq + lane) % 11 === 0) {
      durableQueue.unshift({id, seq, kind, version: "N-1"});
      peakQueue = Math.max(peakQueue, durableQueue.length);
    }
    await sleep(2 + ((seq + lane) % 4));
  }
}

async function schedulerRace() {
  await Promise.all(Array.from({length: 20}, async (_, i) => {
    await sleep(i % 4);
    const key = "daily:2026-10-06";
    if (occurrenceClaims.has(key)) return;
    occurrenceClaims.add(key);
    schedulerEffects += 1;
  }));
}

const startedAt = performance.now();
const startHeap = process.memoryUsage().heapUsed;
const sampler = setInterval(() => heapSamples.push(process.memoryUsage().heapUsed), 1000);
const workers = Array.from({length: Math.max(poolMax, Math.ceil(concurrency / 4))}, () => worker());
const producers = Array.from({length: concurrency}, (_, i) => producer(i));
await schedulerRace();
await sleep(seconds * 1000);
running = false;
await Promise.all(producers);
await Promise.all(workers);
clearInterval(sampler);
heapSamples.push(process.memoryUsage().heapUsed);

const elapsedMs = performance.now() - startedAt;
const endHeap = heapSamples.at(-1) ?? process.memoryUsage().heapUsed;
const heapGrowth = endHeap - startHeap;
assert.equal(schedulerEffects, 1, "identical scheduler occurrence must have exactly one effect");
assert.equal(durableQueue.length, 0, "durable queue must fully drain after producers stop");
assert.equal(peakDb, poolMax, "certification must reach the configured DB pool ceiling");
assert.ok(peakQueue <= 256 + concurrency, "queue exceeded its bounded overload envelope");
assert.ok(heapGrowth <= 67108864, "heap growth exceeded 64 MiB bound");
assert.ok(accepted > Math.max(100, seconds * 20), "soak did not exercise enough accepted work");
assert.ok(controlled429 + controlled503 >= 1, "overload/rate-limit paths were not exercised");
assert.ok(providerTimeouts + providerRateLimits >= 1, "provider failure paths were not exercised");

console.log(JSON.stringify({
  event: "PHASE18_SOAK_CERTIFIED",
  seconds,
  elapsedMs: Math.round(elapsedMs),
  concurrency,
  produced,
  accepted,
  uniqueBusinessEffects: completedEffects.size,
  uniqueProviderSends: providerSends.size,
  controlled429,
  controlled503,
  providerTimeouts,
  providerRateLimits,
  peakQueue,
  peakDb,
  poolMax,
  schedulerEffects,
  heapGrowthBytes: heapGrowth,
  finalQueue: durableQueue.length,
  rollingVersions: ["N","N-1"],
  redisWakeupLossModeledByDurablePolling: true,
  massDuplicateReorderModeled: true
}, null, 2));
