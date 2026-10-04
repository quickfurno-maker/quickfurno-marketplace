#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (p) => readFile(path.join(root, p), "utf8");
const [workflow, compose, nextConfig] = await Promise.all([
  read(".github/workflows/oci-supply-chain.yml"),
  read("ops/container/compose.production.yml"),
  read("next.config.mjs"),
]);

const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

add("GHCR is the OCI registry", workflow.includes("ghcr.io/"));
add(
  "Buildx action is pinned",
  workflow.includes(
    "docker/setup-buildx-action@e468171a9de216ec08956ac3ada2f0791b6bd435",
  ),
);
add(
  "PR build job has read-only contents permission",
  workflow.includes("build-certify:") &&
    workflow.includes("permissions:\n      contents: read"),
);
add(
  "publish job is separately privilege-scoped",
  workflow.includes("packages: write") &&
    workflow.includes("id-token: write") &&
    workflow.includes("attestations: write"),
);
add(
  "build-once artifact handoff exists",
  workflow.includes("docker save") &&
    workflow.includes("docker load") &&
    workflow.includes("download-artifact"),
);
add(
  "Trivy vulnerability gate is pinned",
  workflow.includes(
    "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25",
  ),
);
add(
  "CycloneDX SBOM is generated",
  workflow.includes("format: cyclonedx") &&
    workflow.includes("qf-sbom.cdx.json"),
);
add(
  "Cosign installer is pinned",
  workflow.includes(
    "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6",
  ),
);
add(
  "keyless digest signing exists",
  workflow.includes("cosign sign --yes") && workflow.includes("@${DIGEST}"),
);
add(
  "manual publish is restricted to main",
  workflow.includes("manual publish is allowed only from main") &&
    workflow.includes('"${REF_NAME}" != "main"'),
);
add(
  "CycloneDX SBOM is cryptographically attested",
  workflow.includes("cosign attest --yes --type cyclonedx") &&
    workflow.includes("cosign verify-attestation") &&
    workflow.includes("--type cyclonedx"),
);
add(
  "provenance attestation is pinned",
  workflow.includes(
    "actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8",
  ),
);
add(
  "no latest release authority",
  !workflow.match(/(?:image:|tag:|docker tag).*:latest\b/iu),
);
add(
  "production compose uses full immutable image ref variable",
  compose.includes("QF_IMAGE_REF") && !compose.includes("QF_IMAGE_TAG"),
);
add(
  "Next build identity derives from release SHA",
  nextConfig.includes("generateBuildId") &&
    nextConfig.includes("QF_RELEASE_SHA"),
);

const workflowDir = path.join(root, ".github", "workflows");
const files = (await readdir(workflowDir)).filter((name) =>
  /\.ya?ml$/iu.test(name),
);
const floating = [];
for (const file of files) {
  const body = await read(path.join(".github", "workflows", file));
  for (const match of body.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const ref = match[1];
    if (ref.startsWith("./")) continue;
    const at = ref.lastIndexOf("@");
    if (at < 1) {
      floating.push(`${file}:${ref}`);
      continue;
    }
    const version = ref.slice(at + 1);
    if (!/^[0-9a-f]{40}$/u.test(version)) floating.push(`${file}:${ref}`);
  }
}
add(
  "all external GitHub Actions are pinned to immutable commits",
  floating.length === 0,
);

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (floating.length) {
  console.error("Floating action refs:");
  for (const item of floating) console.error(`- ${item}`);
}
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(
    `QuickFurno supply-chain contract failed: ${failed.length} check(s)`,
  );
  process.exit(1);
}
console.log(
  `QuickFurno supply-chain contract PASS (${checks.length}/${checks.length})`,
);
