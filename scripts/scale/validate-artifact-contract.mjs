#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL("../../" + path, import.meta.url), "utf8");
const [compose, nextConfig, workflow] = await Promise.all([
  read("ops/container/compose.production.yml"),
  read("next.config.mjs"),
  read(".github/workflows/scale-container-supply-chain.yml"),
]);

const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);
const count = (text, pattern) => (text.match(pattern) ?? []).length;

add(
  "all runtime roles use one immutable OCI digest reference",
  count(compose, /image: \$\{QF_IMAGE_REF:\?/g) === 4 &&
    !compose.includes("QF_IMAGE_TAG"),
);
add(
  "runtime source SHA is independent from image digest",
  count(compose, /QF_RELEASE_SHA: \$\{QF_RELEASE_SHA:\?/g) === 4,
);
add(
  "Next build ID is deterministic from release/source SHA",
  nextConfig.includes("generateBuildId") &&
    nextConfig.includes("process.env.QF_RELEASE_SHA") &&
    nextConfig.includes("process.env.GITHUB_SHA"),
);
add(
  "supply-chain workflow binds PR builds to reviewed source head",
  workflow.includes("github.event.pull_request.head.sha || github.sha") &&
    workflow.includes("git rev-parse HEAD"),
);
add(
  "release publication is guarded to main push or explicit manual proof",
  workflow.includes("workflow_dispatch:") &&
    workflow.includes("publish:") &&
    workflow.includes(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    ) &&
    workflow.includes(
      "github.event_name == 'workflow_dispatch' && inputs.publish == true",
    ),
);
add(
  "workflow never publishes mutable latest image tag",
  !workflow.match(/ghcr\.io\/[^\s"'\`]+:latest\b/i) &&
    !workflow.match(/docker\s+tag[^\n]*:latest\b/i),
);
add(
  "release candidate is built once then transferred as an artifact",
  workflow.includes("docker save") &&
    workflow.includes("actions/upload-artifact") &&
    workflow.includes("actions/download-artifact") &&
    workflow.includes("docker load"),
);
add(
  "GHCR release is signed and provenance-attested",
  workflow.includes("cosign sign") &&
    workflow.includes("cosign attest") &&
    workflow.includes("actions/attest-build-provenance"),
);
add(
  "image vulnerability scan and SPDX SBOM are required",
  workflow.includes("aquasecurity/trivy-action") &&
    workflow.includes("spdx-json") &&
    workflow.includes("CRITICAL,HIGH"),
);
add(
  "main release requires real public Supabase build variables",
  workflow.includes("QF_PUBLIC_SUPABASE_URL") &&
    workflow.includes("QF_PUBLIC_SUPABASE_ANON_KEY") &&
    workflow.includes("PUBLIC_BUILD_CONFIG_MISSING"),
);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks)
  console.log((ok ? "PASS" : "FAIL") + " " + name);
if (failed.length) {
  console.error("artifact contract failed: " + failed.length + " check(s)");
  process.exit(1);
}
console.log(
  "QuickFurno Phase 04 artifact contract PASS (" +
    checks.length +
    "/" +
    checks.length +
    ")",
);
