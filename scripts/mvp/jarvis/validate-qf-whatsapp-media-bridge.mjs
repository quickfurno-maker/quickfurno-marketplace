import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import {
  QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
  QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
  parseQfjWhatsAppMediaContentRequest,
} from "../../../lib/jarvis/whatsAppMediaContentContract.ts";
import {
  fetchMetaWhatsAppMediaContent,
  QF_JARVIS_MEDIA_MAX_BYTES,
} from "../../../lib/communication/providers/metaWhatsAppMediaContent.ts";
import { classifyQfWhatsAppDataClass } from "../../../lib/jarvis/whatsAppAuthorityPolicy.ts";

const routeSource = fs.readFileSync(
  "app/api/internal/jarvis/whatsapp-media-content/route.ts",
  "utf8",
);
const fetcherSource = fs.readFileSync(
  "lib/communication/providers/metaWhatsAppMediaContent.ts",
  "utf8",
);
const envExample = fs.readFileSync(".env.example", "utf8");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}
const baseRequest = () => ({
  protocol: "qfj.whatsapp.media-content",
  version: 1,
  caller: "qf-jarvis",
  audience: "quickfurno-core",
  requestId: crypto.randomUUID(),
  issuedAt: new Date().toISOString(),
  tenantId: "quickfurno",
  conversationId: crypto.randomUUID(),
  inboundMessageId: crypto.randomUUID(),
  expectedRevision: 7,
  mediaId: "media.123",
  mediaKind: "image",
});

const metaConfig = {
  accessToken: "secret-token-never-returned",
  phoneNumberId: "333",
  wabaId: "111",
  graphApiVersion: "v26.0",
  authHttpTimeoutMs: 3000,
  businessHttpTimeoutMs: 10000,
};

function successfulFetch(bytes, overrides = {}) {
  const calls = [];
  const sha256 = crypto.createHash("sha256").update(bytes).digest("base64");
  const metadata = {
    messaging_product: "whatsapp",
    url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=media.123",
    mime_type: "image/jpeg",
    sha256,
    file_size: String(bytes.byteLength),
    ...overrides,
  };
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify(metadata), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(bytes.byteLength),
      },
    });
  };
  return { fetchFn, calls };
}

await test("media request contract is exact and cannot smuggle provider authority", () => {
  const request = baseRequest();
  assert.ok(parseQfjWhatsAppMediaContentRequest(request));
  for (const field of ["accessToken", "url", "phoneNumberId", "wabaId", "providerAccountId"]) {
    assert.equal(parseQfjWhatsAppMediaContentRequest({ ...request, [field]: "x" }), null);
  }
  assert.equal(
    parseQfjWhatsAppMediaContentRequest({ ...request, mediaKind: "location" }),
    null,
  );
});

await test("media policy is LOCAL_ONLY while sensitive non-media stays HUMAN_ONLY", () => {
  for (const type of ["image", "document", "audio", "video", "sticker"]) {
    assert.equal(classifyQfWhatsAppDataClass(type), "LOCAL_ONLY");
  }
  for (const type of ["location", "contact", "order", "system", "unsupported", null]) {
    assert.equal(classifyQfWhatsAppDataClass(type), "HUMAN_ONLY");
  }
  assert.equal(classifyQfWhatsAppDataClass("text"), "HOSTED_ALLOWED");
});

await test("happy path fetches metadata then bounded bytes without exposing provider URL", async () => {
  const bytes = new TextEncoder().encode("example-image-bytes");
  const { fetchFn, calls } = successfulFetch(bytes);
  const result = await fetchMetaWhatsAppMediaContent(
    { mediaId: "media.123", mediaKind: "image", expectedMimeType: "image/jpeg" },
    metaConfig,
    fetchFn,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.bytes], [...bytes]);
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\/v26\.0\/media\.123$/);
  assert.match(calls[1].url, /^https:\/\/lookaside\.fbsbx\.com\//);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token-never-returned");
  assert.equal(calls[1].init.headers.Authorization, "Bearer secret-token-never-returned");
});
await test("untrusted provider media URL is rejected before a second network call", async () => {
  const bytes = new TextEncoder().encode("x");
  const { fetchFn, calls } = successfulFetch(bytes, {
    url: "https://attacker.example/media",
  });
  const result = await fetchMetaWhatsAppMediaContent(
    { mediaId: "media.123", mediaKind: "image" },
    metaConfig,
    fetchFn,
  );
  assert.deepEqual(result, { ok: false, reason: "untrusted_media_url" });
  assert.equal(calls.length, 1);
});

await test("metadata size ceiling rejects oversized media before download", async () => {
  const bytes = new TextEncoder().encode("x");
  const { fetchFn, calls } = successfulFetch(bytes, {
    file_size: String(QF_JARVIS_MEDIA_MAX_BYTES.image + 1),
  });
  const result = await fetchMetaWhatsAppMediaContent(
    { mediaId: "media.123", mediaKind: "image" },
    metaConfig,
    fetchFn,
  );
  assert.deepEqual(result, { ok: false, reason: "media_too_large" });
  assert.equal(calls.length, 1);
});

await test("stored mime binding must agree with Meta metadata", async () => {
  const bytes = new TextEncoder().encode("x");
  const { fetchFn, calls } = successfulFetch(bytes);
  const result = await fetchMetaWhatsAppMediaContent(
    { mediaId: "media.123", mediaKind: "image", expectedMimeType: "image/png" },
    metaConfig,
    fetchFn,
  );
  assert.deepEqual(result, { ok: false, reason: "mime_mismatch" });
  assert.equal(calls.length, 1);
});

await test("provider digest mismatch fails closed", async () => {
  const bytes = new TextEncoder().encode("actual");
  const { fetchFn } = successfulFetch(bytes, {
    sha256: crypto.createHash("sha256").update("different").digest("base64"),
  });
  const result = await fetchMetaWhatsAppMediaContent(
    { mediaId: "media.123", mediaKind: "image" },
    metaConfig,
    fetchFn,
  );
  assert.deepEqual(result, { ok: false, reason: "digest_mismatch" });
});

await test("route requires both Jarvis and media feature gates plus live turn binding", () => {
  assert.equal(QFJ_WHATSAPP_MEDIA_CONTENT_PATH, "/api/internal/jarvis/whatsapp-media-content");
  assert.equal(
    QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
    "qfj.whatsapp.media-content.http.sig.v1",
  );
  assert.match(routeSource, /QF_JARVIS_WHATSAPP_ENABLED/);
  assert.match(routeSource, /QF_JARVIS_WHATSAPP_MEDIA_ENABLED/);
  assert.match(routeSource, /verifyQfjSignedRequestSignature/);
  assert.match(routeSource, /readJarvisWhatsAppTurnMaterial/);
  assert.match(routeSource, /attachment\.mediaId !== parsed\.mediaId/);
  assert.match(routeSource, /attachment\.kind !== parsed\.mediaKind/);
  assert.match(routeSource, /subjectStatus !== "clear"/);
  assert.match(routeSource, /cache-control": "private, no-store, max-age=0"/);
});

await test("bridge keeps Meta credentials on QuickFurno and returns no provider URL", () => {
  assert.match(fetcherSource, /config\.accessToken/);
  assert.match(fetcherSource, /TRUSTED_MEDIA_ROOTS/);
  assert.match(fetcherSource, /redirect: "error"/);
  assert.doesNotMatch(routeSource, /WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN/);
  assert.doesNotMatch(routeSource, /metadata\.url/);
  assert.match(envExample, /QF_JARVIS_WHATSAPP_MEDIA_ENABLED=false/);
});

console.log(`QF WhatsApp signed media bridge: ${passed} passed, 0 failed`);
