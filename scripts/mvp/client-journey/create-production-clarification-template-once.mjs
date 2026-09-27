// QuickFurno Client Journey V2 — production Meta clarification template one-shot.
// GET-first, exact production identity, at most ONE template create POST.
// No message send/edit/delete surface exists in this operator.

import { readFileSync } from "node:fs";
import { templatesAreIdentical } from "../communication/submit-meta-templates.mjs";

const PACKET_PATH = "docs/provider-manifests/meta-template-submission-packet.json";
const EXPECTED_WABA_ID = "27861262223494153";
const EXPECTED_PHONE_NUMBER_ID = "1333595106493545";
const TARGET_KEY = "clarification_request";
const TARGET_NAME = "qf_clarification_request_v2";
const TARGET_LANGUAGE = "en";
const TARGET_CATEGORY = "UTILITY";
const TARGET_FINGERPRINT =
  "b1211ade37ded439861d9ddb8297d9e5c7cb73c4959e68363ab53c5e76933c77";
const TEMPLATE_FIELDS = "id,name,language,status,category,components";
const API_VERSION_RE = /^v\d+\.\d+$/;
const TIMEOUT_MS = 10000;

const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--execute", "--reconcile-only"]);
for (const arg of args) {
  if (!allowedArgs.has(arg)) throw new Error("QF_PROD_META_UNKNOWN_ARG");
}
if (args.has("--execute") && args.has("--reconcile-only")) {
  throw new Error("QF_PROD_META_MODE_CONFLICT");
}
const packet = JSON.parse(readFileSync(PACKET_PATH, "utf8"));
const templates = Array.isArray(packet.templates) ? packet.templates : [];
const target = templates.find((row) => row.internal_template_key === TARGET_KEY);
if (!target) throw new Error("QF_PROD_META_TARGET_MISSING");
if (target.provider_template_name !== TARGET_NAME) {
  throw new Error("QF_PROD_META_TARGET_NAME_DRIFT");
}
if (target.provider_language !== TARGET_LANGUAGE || target.category !== TARGET_CATEGORY) {
  throw new Error("QF_PROD_META_TARGET_CLASSIFICATION_DRIFT");
}
if (target.payload_fingerprint !== TARGET_FINGERPRINT) {
  throw new Error("QF_PROD_META_FINGERPRINT_DRIFT");
}
if (!target.creation_payload || target.creation_payload.name !== TARGET_NAME) {
  throw new Error("QF_PROD_META_PAYLOAD_DRIFT");
}

const execute = args.has("--execute");
const reconcileOnly = args.has("--reconcile-only");
if (!execute && !reconcileOnly) {
  console.log(JSON.stringify({
    outcome: "DRY_RUN",
    template_key: TARGET_KEY,
    provider_template_name: TARGET_NAME,
    provider_category: TARGET_CATEGORY,
    payload_fingerprint: TARGET_FINGERPRINT,
    create_post_count: 0,
  }));
  process.exit(0);
}
const env = {
  graph: process.env.QF_META_GRAPH_API_VERSION,
  waba: process.env.QF_META_WABA_ID,
  phone: process.env.QF_META_PHONE_NUMBER_ID,
  token: process.env.QF_META_ACCESS_TOKEN,
};
if (!env.graph || !env.waba || !env.phone || !env.token) {
  throw new Error("QF_PROD_META_ENV_MISSING");
}
if (!API_VERSION_RE.test(env.graph)) throw new Error("QF_PROD_META_API_VERSION_INVALID");
if (env.waba !== EXPECTED_WABA_ID) throw new Error("QF_PROD_META_WABA_IDENTITY_MISMATCH");
if (env.phone !== EXPECTED_PHONE_NUMBER_ID) {
  throw new Error("QF_PROD_META_PHONE_IDENTITY_MISMATCH");
}

const graphBase = `https://graph.facebook.com/${env.graph}`;
const headers = { Authorization: `Bearer ${env.token}` };

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}
function safeError(body) {
  const e = body && typeof body === "object" ? body.error : null;
  return {
    code: Number.isInteger(e?.code) ? e.code : null,
    subcode: Number.isInteger(e?.error_subcode) ? e.error_subcode : null,
    type: typeof e?.type === "string" ? e.type.slice(0, 128) : null,
    is_transient: typeof e?.is_transient === "boolean" ? e.is_transient : null,
  };
}

async function proveAccountIdentity() {
  const waba = await requestJson(`${graphBase}/${env.waba}?fields=id`);
  if (!waba.response.ok || String(waba.body?.id ?? "") !== EXPECTED_WABA_ID) {
    throw new Error("QF_PROD_META_WABA_PROOF_FAILED");
  }
  const phone = await requestJson(`${graphBase}/${env.phone}?fields=id`);
  if (!phone.response.ok || String(phone.body?.id ?? "") !== EXPECTED_PHONE_NUMBER_ID) {
    throw new Error("QF_PROD_META_PHONE_PROOF_FAILED");
  }
}

async function lookupExact() {
  const url =
    `${graphBase}/${env.waba}/message_templates?name=${encodeURIComponent(TARGET_NAME)}` +
    `&fields=${encodeURIComponent(TEMPLATE_FIELDS)}&limit=100`;
  const lookup = await requestJson(url);
  if (!lookup.response.ok || !Array.isArray(lookup.body?.data)) {
    throw new Error("QF_PROD_META_TEMPLATE_LOOKUP_FAILED");
  }
  const exact = lookup.body.data.filter(
    (row) => row?.name === TARGET_NAME && row?.language === TARGET_LANGUAGE,
  );
  if (exact.length > 1) throw new Error("QF_PROD_META_TEMPLATE_AMBIGUOUS");
  if (exact.length === 0) return null;

  const row = exact[0];
  if (String(row.category ?? "").toUpperCase() !== TARGET_CATEGORY) {
    throw new Error("QF_PROD_META_TEMPLATE_CATEGORY_COLLISION");
  }
  if (!templatesAreIdentical(target.creation_payload, row)) {
    throw new Error("QF_PROD_META_TEMPLATE_SEMANTIC_COLLISION");
  }
  return row;
}

function safeResult(outcome, row, createPostCount, extra = {}) {
  return {
    outcome,
    template_key: TARGET_KEY,
    provider_template_name: TARGET_NAME,
    provider_template_id: typeof row?.id === "string" ? row.id : null,
    provider_category: typeof row?.category === "string" ? row.category.toUpperCase() : null,
    remote_status: typeof row?.status === "string" ? row.status.toUpperCase() : null,
    payload_fingerprint: TARGET_FINGERPRINT,
    semantic_match: row ? true : null,
    create_post_count: createPostCount,
    ...extra,
  };
}
await proveAccountIdentity();

const existing = await lookupExact();
if (existing) {
  console.log(JSON.stringify(
    safeResult(
      existing.status === "APPROVED" ? "RECONCILED_APPROVED" : "RECONCILED_EXISTING",
      existing,
      0,
    ),
  ));
  process.exit(existing.status === "APPROVED" ? 0 : 3);
}

if (reconcileOnly) {
  console.log(JSON.stringify(safeResult("RECONCILED_NOT_FOUND", null, 0)));
  process.exit(4);
}

const create = await requestJson(
  `${graphBase}/${env.waba}/message_templates`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target.creation_payload),
  },
);
if (!create.response.ok) {
  console.log(JSON.stringify(
    safeResult("CREATE_REJECTED", null, 1, {
      http_status: create.response.status,
      meta_error: safeError(create.body),
    }),
  ));
  process.exit(5);
}

const readback = await lookupExact();
if (!readback) {
  console.log(JSON.stringify(
    safeResult("CREATE_ACCEPTED_READBACK_MISSING", null, 1, {
      http_status: create.response.status,
    }),
  ));
  process.exit(6);
}

const outcome =
  readback.status === "APPROVED"
    ? "CREATED_APPROVED"
    : readback.status === "PENDING"
      ? "CREATED_PENDING"
      : "CREATED_OTHER_STATUS";

console.log(JSON.stringify(
  safeResult(outcome, readback, 1, { http_status: create.response.status }),
));
process.exit(readback.status === "APPROVED" ? 0 : 3);
