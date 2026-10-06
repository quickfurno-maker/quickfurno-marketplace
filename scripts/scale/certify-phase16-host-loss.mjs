#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const url = process.env.PHASE16_LB_URL || "http://127.0.0.1:8088/readyz";
const victim = process.env.PHASE16_VICTIM_CONTAINER || "qf-phase16-host-a-web";
const durationMs = Number(process.env.PHASE16_LOAD_DURATION_MS || 5000);
const killAfterMs = Number(process.env.PHASE16_KILL_AFTER_MS || 1500);
const concurrency = Number(process.env.PHASE16_LOAD_CONCURRENCY || 8);

let stopping = false;
let killed = false;
let successes = 0;
let failures = 0;

async function requestOnce() {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (res.ok) successes += 1;
    else failures += 1;
  } catch {
    failures += 1;
  }
}

async function lane() {
  while (!stopping) {
    await requestOnce();
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

const lanes = Array.from({ length: concurrency }, () => lane());
setTimeout(() => {
  execFileSync("docker", ["kill", victim], { stdio: "inherit" });
  killed = true;
}, killAfterMs);

await new Promise((resolve) => setTimeout(resolve, durationMs));
stopping = true;
await Promise.all(lanes);

assert.equal(killed, true, "the simulated host replica must be terminated under load");
assert.ok(successes >= 100, "load drill must observe substantial successful traffic");
assert.equal(failures, 0, "health-based failover must expose no request failures in the drill");

for (let i = 0; i < 30; i += 1) await requestOnce();
assert.equal(failures, 0, "remaining host must continue serving after failover");

console.log(JSON.stringify({
  event: "PHASE16_HOST_LOSS_CERTIFIED",
  victim,
  successes,
  failures,
  concurrency,
  durationMs
}));
