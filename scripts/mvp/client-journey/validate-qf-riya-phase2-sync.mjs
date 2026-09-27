import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildQfjPrivateRiyaQualificationIngressRequest,
  parseQfjPrivateRiyaQualificationIngressResponse,
} from "../../../lib/jarvis/privateRiyaIngressContract.ts";
import { resolveQfJarvisRuntimePolicy } from "../../../lib/jarvis/runtimePolicy.ts";
import { sendRiyaQualificationInterpretation } from "../../../services/jarvisRiyaWebGatewayService.ts";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const requestInput = {
  requestId: "phase2.req.1",
  issuedAt: "2026-09-27T12:30:00.000Z",
  tenantId: "quickfurno",
  conversationId: "phase2.conv.1",
  messageId: "phase2.msg.1",
  receivedAt: "2026-09-27T12:29:59.000Z",
  webTurnRef: "lead-qualification:test",
  qualificationTarget: "budget",
  questionText: "Budget range?",
  allowedOptions: ["Below ₹1 lakh", "₹1–3 lakh", "₹3–7 lakh"],
  answerText: "around five lakh",
};

check("qualification kill switch defaults OFF", () => {
  const policy = resolveQfJarvisRuntimePolicy({});
  assert.equal(policy.riyaQualificationEnabled, false);
});

check("V2 request builder seals bounded Core options", () => {
  const request = buildQfjPrivateRiyaQualificationIngressRequest(requestInput);
  assert.equal(request.version, 2);
  assert.deepEqual(request.allowedOptions, requestInput.allowedOptions);
  assert.equal(request.answerText, "around five lakh");
});

check("V2 request rejects missing option authority", () => {
  assert.throws(() =>
    buildQfjPrivateRiyaQualificationIngressRequest({
      ...requestInput,
      allowedOptions: ["one"],
    }),
  );
});

const validResponse = {
  protocol: "qfj.riya.web.ingress",
  version: 2,
  requestId: "phase2.req.1",
  tenantId: "quickfurno",
  conversationId: "phase2.conv.1",
  messageId: "phase2.msg.1",
  disposition: "PROCESSED",
  reason: null,
  authorizedReply: null,
  qualificationProposal: {
    field: "budget",
    operation: "SET",
    value: "₹3–7 lakh",
    provenance: "user_stated",
  },
};

check("V2 response accepts only bounded proposal shape", () => {
  const parsed = parseQfjPrivateRiyaQualificationIngressResponse(validResponse);
  assert.equal(parsed?.qualificationProposal?.value, "₹3–7 lakh");
});

check("V2 response rejects inferred provenance", () => {
  assert.equal(
    parseQfjPrivateRiyaQualificationIngressResponse({
      ...validResponse,
      qualificationProposal: {
        ...validResponse.qualificationProposal,
        provenance: "inferred",
      },
    }),
    null,
  );
});

async function checkAsync(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")} ${name}`);
}

const { privateKey } = crypto.generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

await checkAsync("disabled qualification gateway performs zero network calls", async () => {
  let calls = 0;
  const result = await sendRiyaQualificationInterpretation({
    policy: resolveQfJarvisRuntimePolicy({
      QF_JARVIS_MODE: "active",
      QF_JARVIS_RIYA_ENABLED: "true",
      QF_JARVIS_RIYA_WEB_TURN_ENABLED: "true",
      QF_JARVIS_RIYA_QUALIFICATION_ENABLED: "false",
    }),
    config: {
      baseUrl: "https://jarvis.invalid/",
      keyId: "qf.phase2.test",
      privateKeyPem,
      httpPost: async () => {
        calls += 1;
        throw new Error("must not call");
      },
    },
    request: requestInput,
  });
  assert.deepEqual(result, { ok: false, reason: "disabled" });
  assert.equal(calls, 0);
});

await checkAsync("enabled qualification gateway sends exactly one signed V2 request", async () => {
  let calls = 0;
  let observedBody = null;
  let observedHeaders = null;
  const result = await sendRiyaQualificationInterpretation({
    policy: resolveQfJarvisRuntimePolicy({
      QF_JARVIS_MODE: "active",
      QF_JARVIS_RIYA_ENABLED: "true",
      QF_JARVIS_RIYA_WEB_TURN_ENABLED: "true",
      QF_JARVIS_RIYA_QUALIFICATION_ENABLED: "true",
    }),
    config: {
      baseUrl: "https://jarvis.invalid/",
      keyId: "qf.phase2.test",
      privateKeyPem,
      httpPost: async (_url, init) => {
        calls += 1;
        observedBody = JSON.parse(init.body);
        observedHeaders = init.headers;
        return {
          status: 200,
          async text() {
            return JSON.stringify(validResponse);
          },
        };
      },
    },
    request: requestInput,
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(observedBody.version, 2);
  assert.deepEqual(observedBody.allowedOptions, requestInput.allowedOptions);
  assert.equal(typeof observedHeaders["x-qfj-key-id"], "string");
  assert.equal(typeof observedHeaders["x-qfj-signature"], "string");
});

await checkAsync("qualification gateway rejects response identity mismatch", async () => {
  const result = await sendRiyaQualificationInterpretation({
    policy: resolveQfJarvisRuntimePolicy({
      QF_JARVIS_MODE: "active",
      QF_JARVIS_RIYA_ENABLED: "true",
      QF_JARVIS_RIYA_WEB_TURN_ENABLED: "true",
      QF_JARVIS_RIYA_QUALIFICATION_ENABLED: "true",
    }),
    config: {
      baseUrl: "https://jarvis.invalid/",
      keyId: "qf.phase2.test",
      privateKeyPem,
      httpPost: async () => ({
        status: 200,
        async text() {
          return JSON.stringify({ ...validResponse, messageId: "other.msg" });
        },
      }),
    },
    request: requestInput,
  });
  assert.deepEqual(result, { ok: false, reason: "invalid_response" });
});

const root = process.cwd();
const enrichmentCode = fs.readFileSync(
  path.join(root, "services/leadEnrichmentInboundService.ts"),
  "utf8",
);
const gatewayCode = fs.readFileSync(
  path.join(root, "services/jarvisRiyaWebGatewayService.ts"),
  "utf8",
);

check("Core invokes Riya only after deterministic answer resolution fails", () => {
  const deterministic = enrichmentCode.indexOf("let answer = resolveAnswer");
  const riya = enrichmentCode.indexOf("resolveAmbiguousTextWithRiya");
  assert.ok(deterministic >= 0 && riya > deterministic);
});

check("Core restricts Riya qualification to budget timeline and standard property type", () => {
  assert.match(enrichmentCode, /question\.key === "budget"/);
  assert.match(enrichmentCode, /question\.key === "timeline"/);
  assert.match(enrichmentCode, /question\.key === "property_type"/);
  assert.doesNotMatch(enrichmentCode, /question\.key === "property_size"/);
  assert.doesNotMatch(enrichmentCode, /question\.key === "site_type"/);
  assert.doesNotMatch(enrichmentCode, /question\.key === "area_location"[\s\S]{0,120}return "propertyType"/);
});

check("Core signs exact allowed options and revalidates proposal against them", () => {
  assert.match(enrichmentCode, /allowedOptions = options\.map/);
  assert.match(enrichmentCode, /allowedOptions,/);
  assert.match(enrichmentCode, /candidate\.value === proposal\.value/);
});

check("Riya-derived answers remain auditable and Core-applied", () => {
  assert.match(enrichmentCode, /responseSource: "whatsapp" \| "riya"/);
  assert.match(enrichmentCode, /response_source: input\.responseSource/);
  assert.match(enrichmentCode, /applyClarificationResponsesToLead/);
});

check("Riya failure falls back to the deterministic Core question", () => {
  assert.match(enrichmentCode, /if \(!answer\)[\s\S]{0,500}queueQuestion/);
});

check("qualification gateway has no database or provider-send authority", () => {
  assert.doesNotMatch(gatewayCode, /adminClient|createClient|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(gatewayCode, /WHATSAPP_ACCESS_TOKEN|META_ACCESS_TOKEN|\/messages/);
});

console.log(`QF Riya Phase 2 sync: ${passed}/${passed} PASS`);
