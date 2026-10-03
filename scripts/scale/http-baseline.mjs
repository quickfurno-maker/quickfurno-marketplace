#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const intEnv = (name, fallback, min, max) => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const boolEnv = (name) =>
  ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());

const baseRaw = process.env.QF_SCALE_BASE_URL?.trim();
if (!baseRaw) {
  throw new Error("QF_SCALE_BASE_URL is required");
}

const baseUrl = new URL(baseRaw);
if (!["http:", "https:"].includes(baseUrl.protocol)) {
  throw new Error("QF_SCALE_BASE_URL must use http or https");
}

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const isRemote = !localHosts.has(baseUrl.hostname);
if (isRemote && !boolEnv("QF_SCALE_ALLOW_REMOTE")) {
  throw new Error(
    "Remote benchmark refused. Set QF_SCALE_ALLOW_REMOTE=true after confirming the target.",
  );
}

const requestsPerPath = intEnv("QF_SCALE_REQUESTS", 30, 1, 5000);
const concurrency = intEnv("QF_SCALE_CONCURRENCY", 2, 1, 100);
const warmups = intEnv("QF_SCALE_WARMUPS", 2, 0, 20);
const timeoutMs = intEnv("QF_SCALE_TIMEOUT_MS", 10000, 100, 120000);

if (
  isRemote &&
  (requestsPerPath > 200 || concurrency > 10) &&
  !boolEnv("QF_SCALE_ALLOW_HIGH_LOAD")
) {
  throw new Error(
    "Remote high-load benchmark refused. Keep requests <= 200 and concurrency <= 10, or set QF_SCALE_ALLOW_HIGH_LOAD=true after explicit approval.",
  );
}

const paths = (process.env.QF_SCALE_PATHS ?? "/")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => (value.startsWith("/") ? value : `/${value}`));

if (paths.length === 0) {
  throw new Error("QF_SCALE_PATHS must contain at least one path");
}

const percentile = (sorted, p) => {
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[rank].toFixed(2));
};

const fetchOnce = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "quickfurno-scale-baseline/1.0",
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
    });
    // Consume the body so keep-alive/transfer time is represented in the sample.
    await response.arrayBuffer();
    return {
      elapsedMs: performance.now() - started,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return {
      elapsedMs: performance.now() - started,
      status: null,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : "UNKNOWN_FETCH_ERROR",
    };
  } finally {
    clearTimeout(timer);
  }
};

const runPath = async (path) => {
  const target = new URL(path, baseUrl);
  for (let i = 0; i < warmups; i += 1) {
    await fetchOnce(target);
  }

  const results = new Array(requestsPerPath);
  let cursor = 0;
  const wallStarted = performance.now();

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= requestsPerPath) return;
      results[index] = await fetchOnce(target);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, requestsPerPath) }, () => worker()),
  );

  const wallMs = performance.now() - wallStarted;
  const success = results.filter(
    (sample) => sample.error == null && sample.status >= 200 && sample.status < 400,
  );
  const failures = results.filter(
    (sample) => sample.error != null || sample.status == null || sample.status >= 400,
  );
  const latencies = success.map((sample) => sample.elapsedMs).sort((a, b) => a - b);

  const statuses = {};
  const errors = {};
  for (const sample of results) {
    const key = sample.status == null ? "network_error" : String(sample.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
    if (sample.error) errors[sample.error] = (errors[sample.error] ?? 0) + 1;
  }

  return {
    path,
    target: target.toString(),
    requests: requestsPerPath,
    concurrency,
    warmups,
    wallMs: Number(wallMs.toFixed(2)),
    requestsPerSecond: Number(((requestsPerPath * 1000) / wallMs).toFixed(2)),
    successes: success.length,
    failures: failures.length,
    errorRatePct: Number(((failures.length / requestsPerPath) * 100).toFixed(2)),
    latencyMs: {
      min: latencies.length ? Number(latencies[0].toFixed(2)) : null,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length
        ? Number(latencies[latencies.length - 1].toFixed(2))
        : null,
    },
    statuses,
    errors,
  };
};

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  baseUrl: baseUrl.toString(),
  remote: isRemote,
  timeoutMs,
  results: [],
};

for (const path of paths) {
  output.results.push(await runPath(path));
}

console.log(JSON.stringify(output, null, 2));

if (
  boolEnv("QF_SCALE_FAIL_ON_ERROR") &&
  output.results.some((result) => result.failures > 0)
) {
  process.exitCode = 2;
}
