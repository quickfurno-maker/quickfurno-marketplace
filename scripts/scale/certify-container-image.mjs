#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BUFFER = 128 * 1024 * 1024;

function exec(command, args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(
      `command_failed status=${String(result.status)} command=${command} ${args.join(" ")}`,
    );
  }
  return capture ? String(result.stdout ?? "") : "";
}

function execResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  process.stdout.write(`PASS ${message}\n`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.json();
}

const sha = exec("git", ["rev-parse", "HEAD"], { capture: true }).trim();
assert(/^[0-9a-f]{40}$/u.test(sha), "exact Git SHA resolved");

const image = `quickfurno:${sha}`;
const containerName = `qf-container-cert-${process.pid}`;
const envFile = join(tmpdir(), `qf-container-cert-${process.pid}.env`);
writeFileSync(envFile, "", { mode: 0o600 });

const composeEnv = {
  ...process.env,
  QF_IMAGE_REF: "example.invalid/quickfurno@sha256:" + "0".repeat(64),
  QF_RELEASE_SHA: sha,
  QF_ENV_FILE: envFile,
};

try {
  exec("node", ["scripts/scale/validate-container-contract.mjs"]);

  exec(
    "docker",
    ["compose", "-f", "ops/container/compose.production.yml", "config", "--quiet"],
    { env: composeEnv },
  );
  exec(
    "docker",
    [
      "compose",
      "-f",
      "ops/container/compose.production.yml",
      "--profile",
      "aarohi",
      "config",
      "--quiet",
    ],
    { env: composeEnv },
  );
  process.stdout.write("PASS production Compose model\n");

  exec("docker", [
    "build",
    "--build-arg",
    `GIT_SHA=${sha}`,
    "--build-arg",
    "NEXT_PUBLIC_SUPABASE_URL=https://example.invalid",
    "--build-arg",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=container-certification-public-placeholder",
    "--tag",
    image,
    ".",
  ]);

  const user = exec(
    "docker",
    ["image", "inspect", image, "--format", "{{.Config.User}}"],
    { capture: true },
  ).trim();
  assert(user === "10001:10001", "image runs as fixed non-root UID/GID");

  const revision = exec(
    "docker",
    [
      "image",
      "inspect",
      image,
      "--format",
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    ],
    { capture: true },
  ).trim();
  assert(revision === sha, "OCI revision equals exact Git SHA");

  const entrypoint = exec(
    "docker",
    ["image", "inspect", image, "--format", "{{json .Config.Entrypoint}}"],
    { capture: true },
  ).trim();
  assert(entrypoint === '["/usr/local/bin/qf-entrypoint"]', "image entrypoint is deterministic");

  exec("docker", [
    "run",
    "-d",
    "--name",
    containerName,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "256",
    "--memory",
    "1g",
    "--cpus",
    "1.0",
    "-p",
    "127.0.0.1:39000:3000",
    "-e",
    "QF_RUNTIME_ROLE=web",
    "-e",
    "QF_RUNTIME_ENV=production",
    "-e",
    "QF_CONFIG_SCHEMA_VERSION=1",
    "-e",
    "QF_SERVICE_ID=quickfurno.web",
    "-e",
    "NEXT_PUBLIC_SUPABASE_URL=https://example.invalid",
    "-e",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=container-certification-public-placeholder",
    "-e",
    "SUPABASE_SERVICE_ROLE_KEY=container-certification-not-a-secret",
    image,
  ]);

  let live = null;
  let ready = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      live = await fetchJson("http://127.0.0.1:39000/livez");
      ready = await fetchJson("http://127.0.0.1:39000/readyz");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  assert(live?.status === "alive", "hardened web container liveness");
  assert(ready?.status === "ready", "hardened web container readiness");
  assert(live?.revision === sha && ready?.revision === sha, "health diagnostics expose exact revision");

  const uid = exec("docker", ["exec", containerName, "id", "-u"], { capture: true }).trim();
  assert(uid === "10001", "running container remains non-root");

  const readOnly = exec(
    "docker",
    ["inspect", containerName, "--format", "{{.HostConfig.ReadonlyRootfs}}"],
    { capture: true },
  ).trim();
  assert(readOnly === "true", "running container root filesystem is read-only");

  const capDrop = exec(
    "docker",
    ["inspect", containerName, "--format", "{{json .HostConfig.CapDrop}}"],
    { capture: true },
  ).trim();
  assert(capDrop.includes("ALL"), "running container drops Linux capabilities");

  const securityOpt = exec(
    "docker",
    ["inspect", containerName, "--format", "{{json .HostConfig.SecurityOpt}}"],
    { capture: true },
  ).trim();
  assert(securityOpt.includes("no-new-privileges"), "running container enforces no-new-privileges");

  exec("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-c",
    "test -z \"$(find /app -type f \\( -name '.env' -o -name '.env.*' \\) -print -quit)\"",
  ]);
  process.stdout.write("PASS final image contains no dotenv files\n");

  exec("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-c",
    "! command -v npm >/dev/null 2>&1",
  ]);
  process.stdout.write("PASS final image excludes npm\n");

  for (const worker of [
    "dist/automation-worker.mjs",
    "dist/conversation-transport-worker.mjs",
    "dist/aarohi-acquisition-worker.mjs",
  ]) {
    exec("docker", ["run", "--rm", "--entrypoint", "node", image, "--check", worker]);
  }
  process.stdout.write("PASS all worker artifacts parse on runtime Node\n");

  const missing = execResult("docker", ["run", "--rm", "-e", "QF_RUNTIME_ROLE=web", image]);
  process.stdout.write(missing.stdout);
  process.stderr.write(missing.stderr);
  assert(missing.status === 78, "missing mandatory config fails closed");
  assert(
    (missing.stdout + missing.stderr).includes("REFUSED missing mandatory config"),
    "missing-config refusal is observable",
  );

  const unknown = execResult("docker", [
    "run",
    "--rm",
    "-e",
    "QF_RUNTIME_ROLE=unknown",
    image,
  ]);
  process.stdout.write(unknown.stdout);
  process.stderr.write(unknown.stderr);
  assert(unknown.status === 64, "unknown runtime role fails closed");
  assert(
    (unknown.stdout + unknown.stderr).includes("REFUSED unknown runtime role"),
    "unknown-role refusal is observable",
  );

  process.stdout.write(`QuickFurno exact-head container certification PASS sha=${sha}\n`);
} finally {
  spawnSync("docker", ["rm", "-f", containerName], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "ignore",
  });
  rmSync(envFile, { force: true });
}
