#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const dockerfile = await readFile(
  new URL("../../Dockerfile", import.meta.url),
  "utf8",
);
const compose = await readFile(
  new URL("../../ops/container/compose.production.yml", import.meta.url),
  "utf8",
);
const entrypoint = await readFile(
  new URL("../../ops/container/entrypoint.sh", import.meta.url),
  "utf8",
);
const nextConfig = await readFile(
  new URL("../../next.config.mjs", import.meta.url),
  "utf8",
);
const middleware = await readFile(
  new URL("../../middleware.ts", import.meta.url),
  "utf8",
);
const rootLayout = await readFile(
  new URL("../../app/layout.tsx", import.meta.url),
  "utf8",
);

const checks = [
  [
    "pinned Node 20.20.2 amd64 digest",
    dockerfile.includes(
      "sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c",
    ),
  ],
  [
    "multi-stage build",
    dockerfile.includes(" AS builder") && dockerfile.includes(" AS runtime"),
  ],
  [
    "production dependencies isolated",
    dockerfile.includes("npm ci --omit=dev"),
  ],
  [
    "mandatory public build inputs",
    dockerfile.includes("QuickFurno image build REFUSED"),
  ],
  [
    "runtime OS security refresh",
    dockerfile.includes("apt-get upgrade -y") &&
      dockerfile.includes("rm -rf /var/lib/apt/lists/*"),
  ],
  ["non-root runtime", dockerfile.includes("USER 10001:10001")],
  [
    "exact revision label",
    dockerfile.includes("org.opencontainers.image.revision"),
  ],
  [
    "single entrypoint",
    dockerfile.includes('ENTRYPOINT ["/usr/local/bin/qf-entrypoint"]'),
  ],
  ["standalone Next output", nextConfig.includes('output: "standalone"')],
  [
    "Google font loader absent",
    !rootLayout.includes('from "next/font/google"') &&
      !rootLayout.includes("from 'next/font/google'"),
  ],
  [
    "self-hosted primary font",
    rootLayout.includes("next/font/local") &&
      rootLayout.includes("plus-jakarta-sans-latin-wght-normal.woff2"),
  ],
  [
    "web role",
    entrypoint.includes("web)") && entrypoint.includes("exec node server.js"),
  ],
  ["automation role", entrypoint.includes("automation-worker)")],
  ["conversation role", entrypoint.includes("conversation-transport)")],
  ["aarohi role", entrypoint.includes("aarohi-acquisition)")],
  [
    "unknown role fails closed",
    entrypoint.includes("REFUSED unknown runtime role"),
  ],
  [
    "missing config fails closed",
    entrypoint.includes("REFUSED missing mandatory config"),
  ],
  [
    "health probes bypass auth middleware",
    middleware.includes("livez$|readyz$"),
  ],
  [
    "web localhost-only publish",
    compose.includes('"127.0.0.1:${QF_WEB_HOST_PORT:-3000}:3000"'),
  ],
  [
    "read-only containers",
    (compose.match(/read_only: true/g) ?? []).length >= 4,
  ],
  ["capabilities dropped", (compose.match(/cap_drop:/g) ?? []).length >= 4],
  [
    "no-new-privileges",
    (compose.match(/no-new-privileges:true/g) ?? []).length >= 4,
  ],
  [
    "bounded logs",
    compose.includes('max-size: "10m"') && compose.includes('max-file: "5"'),
  ],
  [
    "external environment file",
    compose.includes(
      "QF_ENV_FILE must point to an external production env file",
    ),
  ],
  [
    "Aarohi remains opt-in",
    compose.includes('profiles: ["aarohi"]') &&
      compose.includes("QF_RUNTIME_ROLE: aarohi-acquisition"),
  ],
  ["no PM2 in container runtime", !dockerfile.toLowerCase().includes("pm2")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
if (failed.length) {
  console.error(`container contract failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log(
  `QuickFurno container contract PASS (${checks.length}/${checks.length})`,
);
