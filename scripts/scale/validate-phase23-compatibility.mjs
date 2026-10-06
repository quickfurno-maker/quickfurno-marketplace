#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  QFJ_SCALE_HEADERS,
  createQfjScaleMetadata,
  qfjCompatibilityResponseHeaders,
  qfjScaleBodyDigest,
  qfjScaleSigningInput,
  signQfjScaleHeaders,
  verifyQfjScaleRequest,
} from "../../lib/jarvis/scaleContract.ts";
import {
  buildVersionedIdempotencyScope,
  evaluateClientCompatibility,
} from "../../lib/compatibility/clientPolicy.ts";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (p) => readFile(join(ROOT, p), "utf8");
const contractText = await read("contracts/qfj-phase23-compat-v1.json");
const fixtureText = await read("contracts/qfj-phase23-consumer-fixture-v1.json");
const contract = JSON.parse(contractText);
const fixture = JSON.parse(fixtureText);
const guard = await read("lib/jarvis/scaleRequestGuard.ts");
const phase11Contract = JSON.parse(await read("contracts/qfj-scale-contract-v1.json"));

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + " - " + error.message);
    process.exitCode = 1;
  }
}

check("canonical Phase23 contract", () => {
  assert.equal(contract.contract, "qfj.phase23.compatibility.v1");
  assert.equal(contract.phase22Baselines.quickfurno, "025409bc8fca15adf172a3dfba9545cb5a8ae6d0");
});
check("Phase11 rolling window remains intact", () => {
  assert.deepEqual(phase11Contract.acceptedVersions, [0, 1]);
  assert.equal(phase11Contract.legacyRemovalNotBefore, "2027-01-05T00:00:00Z");
});
check("legacy compatibility headers advertise deprecation", () => {
  assert.deepEqual(qfjCompatibilityResponseHeaders("legacy"), {
    "x-qfj-current-version": "1",
    "x-qfj-min-supported-version": "0",
    deprecation: "true",
    sunset: "Mon, 05 Jan 2027 00:00:00 GMT",
  });
});
check("current compatibility headers remain additive", () => {
  assert.deepEqual(qfjCompatibilityResponseHeaders("current"), {
    "x-qfj-current-version": "1",
    "x-qfj-min-supported-version": "0",
  });
});
check("legacy V0 remains accepted in coexistence window", () => {
  const result = verifyQfjScaleRequest({
    headers: {},
    method: "POST",
    path: "/phase23/consumer-contract",
    rawBody: Buffer.from(fixture.bodyUtf8, "utf8"),
    verificationKeys: [],
    allowLegacy: true,
    nowMs: Date.parse("2026-10-06T13:00:00Z"),
  });
  assert.deepEqual(result, { ok: true, mode: "legacy" });
});
check("unsupported future V2 fails closed", () => {
  const result = verifyQfjScaleRequest({
    headers: { [QFJ_SCALE_HEADERS.version]: "2" },
    method: "POST",
    path: "/phase23/consumer-contract",
    rawBody: Buffer.from(fixture.bodyUtf8, "utf8"),
    verificationKeys: [],
    allowLegacy: true,
    nowMs: Date.parse("2026-10-06T13:00:00Z"),
  });
  assert.deepEqual(result, { ok: false, errorClass: "QFJ_CONTRACT_INVALID" });
});
check("frozen consumer body digest is stable", () => {
  assert.equal(qfjScaleBodyDigest(Buffer.from(fixture.bodyUtf8, "utf8")), fixture.bodyDigestBase64Url);
});
check("frozen signing vector matches QuickFurno producer", () => {
  const metadata = {
    version: 1,
    requestId: fixture.v1.requestId,
    idempotencyKey: fixture.v1.idempotencyKey,
    correlationId: fixture.v1.correlationId,
    traceId: fixture.v1.traceId,
    actor: fixture.v1.actor,
    deadlineAt: fixture.v1.deadlineAt,
  };
  assert.equal(
    qfjScaleSigningInput({
      method: fixture.v1.method,
      path: fixture.v1.path,
      metadata,
      keyId: fixture.v1.keyId,
      bodyDigest: fixture.bodyDigestBase64Url,
    }),
    fixture.v1.expectedSigningInput,
  );
});
check("actual V1 signed request verifies", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const metadata = createQfjScaleMetadata({
    requestId: "phase23-runtime-1",
    idempotencyKey: "phase23-runtime-idem-1",
    actor: "quickfurno-core",
    timeoutMs: 5000,
    traceId: "22222222222222222222222222222222",
    nowMs: Date.parse("2026-10-06T13:00:00Z"),
  });
  const rawBody = Buffer.from(fixture.bodyUtf8, "utf8");
  const headers = signQfjScaleHeaders({
    method: "POST",
    path: fixture.v1.path,
    metadata,
    keyId: "phase23-runtime",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    rawBody,
  });
  const result = verifyQfjScaleRequest({
    headers,
    method: "POST",
    path: fixture.v1.path,
    rawBody,
    verificationKeys: [{
      keyId: "phase23-runtime",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }],
    nowMs: Date.parse("2026-10-06T13:00:01Z"),
    allowLegacy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.mode, "v1");
});
check("compatibility telemetry is wired at QuickFurno ingress", () => {
  assert.match(guard, /qf\.compatibility\.requests/u);
  assert.match(guard, /received_version/u);
  assert.match(guard, /legacy/u);
  assert.match(guard, /unsupported/u);
});
check("web remains server coupled", () => {
  assert.deepEqual(
    evaluateClientCompatibility({
      platform: "web",
      clientVersion: null,
      apiMajor: null,
      nativePolicyActivated: false,
      minimumVersions: { ios: null, android: null },
    }),
    { allowed: true, mode: "server-coupled" },
  );
});
check("future native policy is explicit but not activated", () => {
  assert.deepEqual(
    evaluateClientCompatibility({
      platform: "android",
      clientVersion: "1.0.0",
      apiMajor: 1,
      nativePolicyActivated: false,
      minimumVersions: { ios: "1.0.0", android: "1.0.0" },
    }),
    { allowed: true, mode: "not-enforced" },
  );
  assert.equal(contract.clientPolicy.nativePolicyActivated, false);
});
check("unsupported API major is rejected", () => {
  assert.deepEqual(
    evaluateClientCompatibility({
      platform: "android",
      clientVersion: "1.0.0",
      apiMajor: 2,
      nativePolicyActivated: false,
      minimumVersions: { ios: null, android: null },
    }),
    { allowed: false, mode: "unsupported-api-major", httpStatus: 400 },
  );
});
check("activated native minimum can require upgrade", () => {
  assert.deepEqual(
    evaluateClientCompatibility({
      platform: "ios",
      clientVersion: "1.2.3",
      apiMajor: 1,
      nativePolicyActivated: true,
      minimumVersions: { ios: "1.3.0", android: null },
    }),
    { allowed: false, mode: "upgrade-required", httpStatus: 426 },
  );
});
check("idempotency semantics are scoped by API major", () => {
  assert.equal(
    buildVersionedIdempotencyScope({ apiMajor: 1, operation: "lead.create", key: "abc-1" }),
    "v1:lead.create:abc-1",
  );
  assert.equal(
    buildVersionedIdempotencyScope({ apiMajor: 2, operation: "lead.create", key: "abc-1" }),
    "v2:lead.create:abc-1",
  );
});
check("breaking API changes require new major", () => {
  assert.equal(contract.apiPolicy.removeOrRenameFieldRequiresNewMajor, true);
  assert.equal(contract.apiPolicy.changeFieldMeaningRequiresNewMajor, true);
  assert.equal(contract.apiPolicy.changeIdempotencySemanticsRequiresNewMajor, true);
});
check("event contracts fail closed by policy", () => {
  assert.equal(contract.eventPolicy.unknownTypeFailsClosed, true);
  assert.equal(contract.eventPolicy.unknownVersionFailsClosed, true);
  assert.equal(contract.eventPolicy.permissiveFallbackForbidden, true);
});
check("DB strategy requires N and N-1 overlap", () => {
  assert.equal(contract.databasePolicy.strategy, "expand-backfill-coexist-contract");
  assert.equal(contract.databasePolicy.nAndNMinus1MustCoexist, true);
  assert.equal(contract.databasePolicy.destructiveContractStepRequiresNMinus1Retired, true);
});
check("production cutover is absent", () => {
  for (const [key, value] of Object.entries(contract.productionBoundary)) {
    assert.equal(value, false, key);
  }
});
check("Phase24 is exact next step", () => {
  assert.match(contract.exit.nextPhase, /Phase 24/);
});

const sha = createHash("sha256").update(contractText).digest("hex");
const fixtureSha = createHash("sha256").update(fixtureText).digest("hex");
console.log(
  "QuickFurno Phase23 " +
    (process.exitCode ? "FAILED" : "PASS") +
    ` (${passed}/20) contractSha256=${sha} fixtureSha256=${fixtureSha}`,
);
if (process.exitCode) process.exit(process.exitCode);
