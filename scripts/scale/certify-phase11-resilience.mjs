import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  createQfjScaleMetadata,
  signQfjScaleHeaders,
  verifyQfjScaleRequest,
} from "../../lib/jarvis/scaleContract.ts";
import {
  QfjIsolationFailure,
  QfjIsolationGate,
} from "../../lib/jarvis/scaleIsolation.ts";

const pair = generateKeyPairSync("ed25519");
const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = "phase11-cert-key";
const verificationKeys = [{ keyId, publicKeyPem }];

async function runIsolated(gate, task, timeoutMs) {
  const deadlineAt = new Date(Date.now() + timeoutMs).toISOString();
  try {
    return { ok: true, value: await gate.run({ deadlineAt, task }) };
  } catch (error) {
    if (error instanceof QfjIsolationFailure) {
      return { ok: false, errorClass: error.errorClass, retryable: error.retryable };
    }
    throw error;
  }
}

async function contractCryptoProof() {
  const requestId = randomUUID();
  const rawBody = Buffer.from(JSON.stringify({ requestId }), "utf8");
  const metadata = createQfjScaleMetadata({
    requestId,
    idempotencyKey: requestId,
    actor: "quickfurno-core",
    timeoutMs: 1000,
    correlationId: "corr-phase11",
    traceId: "0123456789abcdef0123456789abcdef",
    expectedRevision: 7,
    nowMs: Date.parse("2026-10-05T07:00:00.000Z"),
  });
  const headers = signQfjScaleHeaders({
    method: "POST",
    path: "/internal/v1/test",
    metadata,
    keyId,
    privateKeyPem,
    rawBody,
  });
  const verified = verifyQfjScaleRequest({
    headers,
    method: "POST",
    path: "/internal/v1/test",
    rawBody,
    verificationKeys,
    nowMs: Date.parse("2026-10-05T07:00:00.500Z"),
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.mode, "v1");
  if (verified.ok && verified.mode === "v1") assert.equal(verified.metadata.expectedRevision, 7);

  const legacy = verifyQfjScaleRequest({
    headers: {},
    method: "POST",
    path: "/internal/v1/test",
    rawBody,
    verificationKeys,
    nowMs: Date.parse("2026-10-05T07:00:00.500Z"),
    allowLegacy: true,
  });
  assert.deepEqual(legacy, { ok: true, mode: "legacy" });

  const rejected = verifyQfjScaleRequest({
    headers: { ...headers, "x-qfj-correlation-id": "tampered" },
    method: "POST",
    path: "/internal/v1/test",
    rawBody,
    verificationKeys,
    nowMs: Date.parse("2026-10-05T07:00:00.500Z"),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.errorClass, "QFJ_AUTHENTICATION_FAILED");

  const expired = verifyQfjScaleRequest({
    headers,
    method: "POST",
    path: "/internal/v1/test",
    rawBody,
    verificationKeys,
    nowMs: Date.parse("2026-10-05T07:00:02.000Z"),
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.errorClass, "QFJ_DEADLINE_EXCEEDED");

  const unsupported = verifyQfjScaleRequest({
    headers: { ...headers, "x-qfj-scale-version": "2" },
    method: "POST",
    path: "/internal/v1/test",
    rawBody,
    verificationKeys,
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.errorClass, "QFJ_CONTRACT_INVALID");

  console.log("PASS crypto + legacy/V1 coexistence + tamper/deadline/version rejection");
}

async function downProof() {
  const gate = new QfjIsolationGate({
    maxConcurrent: 8,
    breakerFailureThreshold: 3,
    breakerOpenMs: 15000,
  });
  let upstreamCalls = 0;
  const fakeDown = async () => {
    upstreamCalls += 1;
    throw new Error("DOWN");
  };
  const results = [];
  const started = performance.now();
  for (let index = 0; index < 12; index += 1) {
    results.push(await runIsolated(gate, fakeDown, 250));
  }
  const elapsedMs = performance.now() - started;
  assert.equal(upstreamCalls, 3);
  assert.equal(
    results.filter((value) => !value.ok && value.errorClass === "QFJ_CIRCUIT_OPEN").length,
    9,
  );
  assert.ok(elapsedMs < 250, "down path exceeded fail-fast budget: " + elapsedMs.toFixed(1));
  console.log(
    "PASS Jarvis down: upstreamCalls=" + upstreamCalls +
      " circuitFastFails=9 elapsedMs=" + elapsedMs.toFixed(1),
  );
}

async function overloadProof() {
  const gate = new QfjIsolationGate({
    maxConcurrent: 8,
    breakerFailureThreshold: 20,
    breakerOpenMs: 15000,
  });
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const fakeBusy = (signal) =>
    new Promise((resolve, reject) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        active -= 1;
        fn();
      };
      releases.push(() => finish(() => resolve("OK")));
      signal.addEventListener(
        "abort",
        () => finish(() => reject(new Error("ABORTED"))),
        { once: true },
      );
    });

  const calls = Array.from({ length: 100 }, () =>
    runIsolated(gate, fakeBusy, 1000),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(releases.length, 8);
  for (const release of releases.splice(0)) release();
  const results = await Promise.all(calls);
  const backpressure = results.filter(
    (value) => !value.ok && value.errorClass === "QFJ_BACKPRESSURE",
  ).length;
  assert.equal(maxActive, 8);
  assert.equal(backpressure, 92);
  console.log(
    "PASS Jarvis overloaded: maxUpstreamConcurrency=" + maxActive +
      " backpressureFastFails=" + backpressure,
  );
}

async function slowAndMarketplaceProof() {
  const gate = new QfjIsolationGate({
    maxConcurrent: 8,
    breakerFailureThreshold: 20,
    breakerOpenMs: 15000,
  });
  let active = 0;
  let maxActive = 0;
  const fakeSlow = (signal) =>
    new Promise((resolve, reject) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        active -= 1;
        fn();
      };
      const timer = setTimeout(() => finish(() => resolve("OK")), 1000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          finish(() => reject(new Error("ABORTED")));
        },
        { once: true },
      );
    });

  const jarvisCalls = Array.from({ length: 80 }, () =>
    runIsolated(gate, fakeSlow, 100),
  );

  const marketplaceStarted = performance.now();
  const marketplaceLatencies = await Promise.all(
    Array.from({ length: 2000 }, async () => {
      const started = performance.now();
      await Promise.resolve();
      return performance.now() - started;
    }),
  );
  const marketplaceElapsed = performance.now() - marketplaceStarted;
  const sorted = marketplaceLatencies.toSorted((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;

  const results = await Promise.all(jarvisCalls);
  const timeoutCount = results.filter(
    (value) => !value.ok && value.errorClass === "QFJ_UPSTREAM_TIMEOUT",
  ).length;
  const backpressureCount = results.filter(
    (value) => !value.ok && value.errorClass === "QFJ_BACKPRESSURE",
  ).length;

  assert.equal(maxActive, 8);
  assert.equal(timeoutCount, 8);
  assert.equal(backpressureCount, 72);
  assert.ok(
    marketplaceElapsed < 100,
    "marketplace batch exceeded responsive budget: " + marketplaceElapsed.toFixed(1),
  );
  assert.ok(p99 < 50, "marketplace p99 exceeded responsive budget: " + p99.toFixed(3));
  console.log(
    "PASS Jarvis slow: maxUpstreamConcurrency=" + maxActive +
      " timeouts=" + timeoutCount +
      " backpressure=" + backpressureCount +
      " marketplaceP99Ms=" + p99.toFixed(3) +
      " marketplaceBatchMs=" + marketplaceElapsed.toFixed(1),
  );
}

await contractCryptoProof();
await downProof();
await overloadProof();
await slowAndMarketplaceProof();
console.log("PHASE11_QUICKFURNO_RESILIENCE=PASS");
