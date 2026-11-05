import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readBoundedVendorMultipart } from "../../../lib/vendors/readBoundedVendorMultipart.ts";

const url = "https://staging-core.quickfurno.in/api/vendor/private-evidence";
const source = readFileSync(resolve(import.meta.dirname, "../../../app/api/vendor/private-evidence/route.ts"), "utf8");

function validForm() {
  const form = new FormData();
  form.set("vendorId", "00000000-0000-4000-8000-000000000001");
  form.set("identityConsent", "true");
  form.set("identityMethod", "passport");
  form.set("evidenceType", "office_proof");
  form.set("file", new File(["%PDF-1.7\n"], "office.pdf", { type: "application/pdf" }));
  return form;
}

test("bounded multipart accepts valid complete multipart data without losing fields", async () => {
  const request = new Request(url, { method: "POST", body: validForm() });
  const result = await readBoundedVendorMultipart(request, 4096);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.form.keys()].sort(),
    ["evidenceType", "file", "identityConsent", "identityMethod", "vendorId"]);
  assert.equal(result.form.get("identityConsent"), "true");
  assert.equal((result.form.get("file")).name, "office.pdf");
});

test("stream larger than limit is rejected despite falsely small Content-Length", async () => {
  const sourceRequest = new Request(url, { method: "POST", body: validForm() });
  const bytes = new Uint8Array(await sourceRequest.arrayBuffer());
  const streamed = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 70));
      controller.enqueue(bytes.subarray(70));
      controller.close();
    },
  });
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": sourceRequest.headers.get("content-type"), "content-length": "1" },
    body: streamed,
    duplex: "half",
  });
  assert.deepEqual(await readBoundedVendorMultipart(request, 100),
    { ok: false, reason: "too_large" });
});

test("missing body, truncation, and invalid limits fail closed", async () => {
  const bodyless = new Request(url, { method: "POST" });
  assert.deepEqual(await readBoundedVendorMultipart(bodyless, 4096),
    { ok: false, reason: "invalid" });
  const request = new Request(url, { method: "POST", body: validForm() });
  assert.deepEqual(await readBoundedVendorMultipart(request, 0),
    { ok: false, reason: "invalid" });
  const full = new Request(url, { method: "POST", body: validForm() });
  const bytes = new Uint8Array(await full.arrayBuffer());
  const incomplete = new Request(url, {
    method: "POST",
    headers: { "content-type": full.headers.get("content-type") },
    body: bytes.subarray(0, 45),
  });
  assert.deepEqual(await readBoundedVendorMultipart(incomplete, 4096),
    { ok: false, reason: "invalid" });
});

test("private evidence route consumes bounded parser before privileged RPC or Storage", () => {
  assert.match(source, /const bounded=await readBoundedVendorMultipart\(request,MAX_BODY\)/);
  assert.doesNotMatch(source, /await request\.formData\(\)/);
  const boundedAt = source.indexOf("readBoundedVendorMultipart(request,MAX_BODY)");
  const rpcAt = source.indexOf('db.rpc(');
  const uploadAt = source.indexOf('privateEvidenceStorage.put(');
  assert.ok(boundedAt >= 0 && boundedAt < rpcAt && boundedAt < uploadAt);
  assert.match(source, /QF_VENDOR_PRIVATE_EVIDENCE_MODE==="staging"/);
  assert.match(source, /QF_VENDOR_PRIVATE_BUCKET_CERTIFIED==="staging"/);
  assert.match(source, /VERIFIED_VENDOR_SESSION_REQUIRED/);
  assert.match(source, /REQUEST_TOO_LARGE/);
  assert.match(source, /PRIVATE_BUCKET_NOT_CERTIFIED/);
  assert.doesNotMatch(source, /getPublicUrl\(/);
});
