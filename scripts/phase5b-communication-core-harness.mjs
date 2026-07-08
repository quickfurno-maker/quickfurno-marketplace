import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5B — QuickFurno Unified Communication Core harness.
 *
 * Exercises templates, intents, security, recipient resolution, idempotency
 * (including the insert-conflict race), state transitions, retries and
 * dead-lettering, webhook processing and de-duplication, provider-neutrality,
 * deterministic mock behaviour, phone canonicalization, and admin read models.
 *
 * The mock database models the REAL PostgreSQL uniqueness constraints declared
 * in the migration — including the partial indexes — so a duplicate insert that
 * production would reject is rejected here too.
 */

const outDir = resolve(".phase5b-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/identity/principal.ts",
  "lib/identity/verification.ts",
  "lib/identity/clientAccount.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/identity/index.ts",
  "lib/communication/types.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/communication/recipientResolver.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/mockWhatsAppProvider.ts",
  "services/communicationRecipientResolver.ts",
  "services/communicationService.ts",
  "services/communicationAdminService.ts",
  "lib/errors.ts",
  "lib/supabase.ts",
];

const tsconfigPath = resolve(".phase5b-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node",
    skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
    outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files,
}, null, 2));

try {
  execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
} finally {
  rmSync(tsconfigPath, { force: true });
}

// ----------------------------------------------------------------------------
// Mock database: models the real PostgreSQL unique indexes (incl. partial ones)
// ----------------------------------------------------------------------------

/** Mirrors the unique indexes declared in the Phase 5B migration. */
const UNIQUE_INDEXES = {
  communication_templates: [
    { name: "communication_templates_template_key_key", cols: ["template_key"] },
  ],
  communication_messages: [
    { name: "communication_messages_idempotency_key_key", cols: ["idempotency_key"] },
  ],
  communication_delivery_events: [
    {
      name: "uq_comm_delivery_event_provider_event",
      cols: ["provider", "provider_event_id", "provider_message_id", "normalized_event_type"],
      where: (r) => r.provider_event_id !== null && r.provider_event_id !== undefined,
    },
  ],
  communication_webhook_receipts: [
    {
      name: "uq_comm_webhook_receipt_provider_event",
      cols: ["provider", "provider_event_id"],
      where: (r) => r.signature_valid === true && r.provider_event_id !== null && r.provider_event_id !== undefined,
    },
    {
      name: "uq_comm_webhook_receipt_payload_verified",
      cols: ["provider", "payload_hash"],
      where: (r) => r.signature_valid === true,
    },
    {
      name: "uq_comm_webhook_receipt_payload_rejected",
      cols: ["provider", "payload_hash"],
      where: (r) => r.signature_valid === false,
    },
  ],
  communication_automation_catalog: [
    { name: "communication_automation_catalog_pkey", cols: ["automation_key"] },
  ],
};

/** Column defaults the migration declares, so mock rows look like real rows. */
const TABLE_DEFAULTS = {
  communication_messages: () => ({
    status: "queued", attempt_count: 0, max_attempts: 5, next_retry_at: null,
    destination_source: "recipient_reference",
    provider_message_id: null, failure_code: null, failure_reason_sanitized: null,
    scheduled_at: null, accepted_at: null, sent_at: null, delivered_at: null,
    read_at: null, failed_at: null, variables: {}, metadata: {},
  }),
  communication_webhook_receipts: () => ({
    provider_event_id: null, normalized_event_type: null, processing_status: "received",
    duplicate_count: 0, last_duplicate_at: null, received_at: new Date().toISOString(),
    processed_at: null, failure_reason_sanitized: null,
  }),
  communication_delivery_events: () => ({ provider_event_id: null, sanitized_metadata: {} }),
  communication_automation_catalog: () => ({
    readiness_status: "wiring_pending", is_operationally_enabled: false,
    last_triggered_at: null, last_success_at: null, last_failure_at: null,
  }),
  communication_templates: () => ({ readiness_status: "draft", is_active: true, provider_template_name: null }),
};

/**
 * PostgreSQL semantics: a unique index never conflicts when any indexed column
 * is NULL, and a partial index only covers rows satisfying its predicate.
 */
function findUniqueViolation(table, newRow, rows) {
  for (const index of UNIQUE_INDEXES[table] ?? []) {
    if (index.where && !index.where(newRow)) continue;
    if (index.cols.some((c) => newRow[c] === null || newRow[c] === undefined)) continue;

    const clash = rows.some(
      (existing) =>
        (!index.where || index.where(existing)) &&
        index.cols.every((c) => existing[c] === newRow[c])
    );
    if (clash) {
      return {
        code: "23505",
        message: `duplicate key value violates unique constraint "${index.name}"`,
        details: `Key already exists.`,
        constraint: index.name,
      };
    }
  }
  return null;
}

const db = {};

/** One-shot hooks that fire AFTER a select resolves — used to simulate races. */
let selectRaceHooks = [];
function onNextSelect(table, fire) {
  selectRaceHooks.push({ table, fire });
}

/**
 * One-shot hooks that fire BEFORE an update's filters are applied — used to let a
 * competing worker mutate the row between our read and our compare-and-set.
 * Async, so the competitor can run a whole dispatch.
 */
let updateRaceHooks = [];
function onNextUpdate(table, fire) {
  updateRaceHooks.push({ table, fire });
}

/** One-shot fault injection so hard database failures can be exercised. */
let insertFaults = [];
function failNextInsert(table, error) {
  insertFaults.push({ table, error });
}

/** `match(updatePayload)` narrows the fault to one specific update in a flow. */
let updateFaults = [];
function failNextUpdate(table, error, match) {
  updateFaults.push({ table, error, match });
}

function resetDb() {
  selectRaceHooks = [];
  updateRaceHooks = [];
  insertFaults = [];
  updateFaults = [];
  db.communication_templates = [
    { template_key: "client_login_otp", channel: "whatsapp", category: "authentication", description: "OTP for client", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
    { template_key: "vendor_whatsapp_verify", channel: "whatsapp", category: "authentication", description: "OTP for vendor verify", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
    { template_key: "vendor_password_reset", channel: "whatsapp", category: "authentication", description: "OTP for reset", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
    { template_key: "lead_received", channel: "whatsapp", category: "business", description: "Lead confirmation", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
    { template_key: "vendor_new_lead", channel: "whatsapp", category: "business", description: "New lead", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
    { template_key: "admin_policy_block_alert", channel: "whatsapp", category: "business", description: "Policy block alert", version: "1.0", readiness_status: "mock_ready", is_active: true, provider_template_name: null },
    { template_key: "draft_template", channel: "whatsapp", category: "business", description: "Draft", version: "1.0", readiness_status: "draft", is_active: true, provider_template_name: null },
    { template_key: "disabled_template", channel: "whatsapp", category: "business", description: "Disabled", version: "1.0", readiness_status: "disabled", is_active: true, provider_template_name: null },
    { template_key: "inactive_template", channel: "whatsapp", category: "business", description: "Inactive", version: "1.0", readiness_status: "mock_ready", is_active: false, provider_template_name: null },
  ];
  db.communication_messages = [];
  db.communication_delivery_events = [];
  db.communication_webhook_receipts = [];
  db.communication_automation_catalog = [
    { automation_key: "client_login_otp", category: "otp", lane: "authentication", channel: "whatsapp", readiness_status: "wiring_pending", is_operationally_enabled: false, provider_required: "mock", template_key: "client_login_otp" },
    { automation_key: "vendor_whatsapp_verify", category: "otp", lane: "authentication", channel: "whatsapp", readiness_status: "wiring_pending", is_operationally_enabled: false, provider_required: "mock", template_key: "vendor_whatsapp_verify" },
    { automation_key: "vendor_password_reset", category: "otp", lane: "authentication", channel: "whatsapp", readiness_status: "wiring_pending", is_operationally_enabled: false, provider_required: "mock", template_key: "vendor_password_reset" },
    { automation_key: "lead_received", category: "notification", lane: "business", channel: "whatsapp", readiness_status: "wiring_pending", is_operationally_enabled: false, provider_required: "mock", template_key: "lead_received" },
    { automation_key: "vendor_new_lead", category: "notification", lane: "business", channel: "whatsapp", readiness_status: "wiring_pending", is_operationally_enabled: false, provider_required: "mock", template_key: "vendor_new_lead" },
  ];
  // Phase 5A / Phase 1 recipient sources used by the Supabase-backed resolver.
  db.client_accounts = [{ id: "ca-123", phone_e164: "+919876543210", status: "active" }];
  db.vendors = [
    { id: "vend-123", whatsapp_number: "+91 88765 43211", phone: "+918800000000" },
    { id: "vend-no-wa", whatsapp_number: null, phone: "+91 88000 00001" },
    { id: "vend-bad", whatsapp_number: "98765", phone: "+918800000002" },
    { id: "vend-none", whatsapp_number: null, phone: null },
  ];
  db.profiles = [
    { id: "adm-1", phone: "+919000000001", role: "admin" },
    { id: "usr-1", phone: "+919000000002", role: "vendor" },
  ];
}

class MockQueryBuilder {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.limitVal = null;
    this.action = "select";
    this.actionData = null;
  }

  select() { return this; }
  order() { return this; }
  limit(n) { this.limitVal = n; return this; }
  eq(col, val) { this.filters.push((item) => item[col] === val); return this; }
  in(col, vals) { this.filters.push((item) => vals.includes(item[col])); return this; }

  or(exp) {
    const parts = exp.split(",");
    this.filters.push((item) =>
      parts.some((p) => {
        const [field, op, val] = p.split(".");
        if (op === "eq") return String(item[field]) === String(val);
        return false;
      })
    );
    return this;
  }

  insert(row) { this.action = "insert"; this.actionData = row; return this; }
  update(updates) { this.action = "update"; this.actionData = updates; return this; }
  maybeSingle() { return this.single(); }

  async single() {
    const { data, error } = await this.execute();
    const result = Array.isArray(data) ? data[0] : data;
    return { data: result ?? null, error };
  }

  async execute() {
    let list = db[this.table] || [];

    if (this.action === "insert") {
      const faultIndex = insertFaults.findIndex((f) => f.table === this.table);
      if (faultIndex !== -1) {
        const [fault] = insertFaults.splice(faultIndex, 1);
        return { data: null, error: fault.error };
      }

      const records = Array.isArray(this.actionData) ? this.actionData : [this.actionData];
      const inserted = [];
      for (const r of records) {
        const defaults = TABLE_DEFAULTS[this.table]?.() ?? {};
        // PostgREST omits undefined keys; a column default then applies.
        const supplied = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
        const dbRow = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...defaults, ...supplied };

        const violation = findUniqueViolation(this.table, dbRow, db[this.table]);
        if (violation) return { data: null, error: violation };

        db[this.table].push(dbRow);
        inserted.push(dbRow);
      }
      return { data: Array.isArray(this.actionData) ? inserted : inserted[0], error: null };
    }

    if (this.action === "update") {
      // A competing worker gets to move the row BEFORE our filters run — this is
      // exactly the window a compare-and-set has to close.
      const hookIndex = updateRaceHooks.findIndex((h) => h.table === this.table);
      if (hookIndex !== -1) {
        const [hook] = updateRaceHooks.splice(hookIndex, 1);
        await hook.fire();
      }

      const faultIndex = updateFaults.findIndex(
        (f) => f.table === this.table && (!f.match || f.match(this.actionData))
      );
      if (faultIndex !== -1) {
        const [fault] = updateFaults.splice(faultIndex, 1);
        return { data: null, error: fault.error };
      }

      for (const f of this.filters) list = list.filter(f);
      for (const item of list) Object.assign(item, this.actionData);
      return { data: list, error: null };
    }

    for (const f of this.filters) list = list.filter(f);
    if (this.limitVal !== null) list = list.slice(0, this.limitVal);

    const hookIndex = selectRaceHooks.findIndex((h) => h.table === this.table);
    if (hookIndex !== -1) {
      const [hook] = selectRaceHooks.splice(hookIndex, 1);
      hook.fire();
    }

    return { data: list, error: null };
  }

  async then(resolve) {
    const { data, error } = await this.execute();
    return resolve({ data, count: Array.isArray(data) ? data.length : 0, error });
  }
}

resetDb();

const requireFromBuild = createRequire(`${outDir}/`);
const supabaseMod = requireFromBuild("./lib/supabase.js");
supabaseMod.adminClient = () => ({ from: (table) => new MockQueryBuilder(table) });

const CommServiceMod = requireFromBuild("./services/communicationService.js");
const AdminServiceMod = requireFromBuild("./services/communicationAdminService.js");
const MockProviderMod = requireFromBuild("./lib/communication/providers/mockWhatsAppProvider.js");
const ProviderErrorMod = requireFromBuild("./lib/communication/providers/providerError.js");
const PhoneMod = requireFromBuild("./lib/communication/phone.js");
const ResolverMod = requireFromBuild("./lib/communication/recipientResolver.js");
const SupabaseResolverMod = requireFromBuild("./services/communicationRecipientResolver.js");
const TypesMod = requireFromBuild("./lib/communication/types.js");

const {
  MOCK_DESTINATIONS, MockWhatsAppProvider, computeMockWebhookSignature,
  MOCK_LEAKY_EXCEPTION_MESSAGE,
} = MockProviderMod;
const { StaticCommunicationRecipientResolver } = ResolverMod;
const { CommunicationService, hashDestination } = CommServiceMod;
const { ephemeralAuthDestination } = TypesMod;

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const MIGRATION = "supabase/migrations/20260708000170_unified_communication_core.sql";
const sql = readFileSync(MIGRATION, "utf8");
const normalizedSql = sql.toLowerCase().replace(/\s+/g, " ");

/** Source scans must inspect CODE, not the prose in comments that describes it. */
function readCode(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SERVICE_SOURCE = readCode("services/communicationService.ts");
const ADMIN_SOURCE = readCode("services/communicationAdminService.ts");
const MOCK_PROVIDER_SOURCE = readCode("lib/communication/providers/mockWhatsAppProvider.ts");

const WEBHOOK_SECRET = "phase5b-test-secret";
const CLIENT_DEST = "+919876543210";
const VENDOR_DEST = "+918876543211";

function resolverFor(overrides = {}) {
  const r = new StaticCommunicationRecipientResolver();
  r.set("client", "ca-123", CLIENT_DEST);
  r.set("vendor", "vend-123", VENDOR_DEST);
  r.set("admin", "adm-1", "+919000000001");
  for (const [key, dest] of Object.entries(overrides)) {
    const [type, id] = key.split(":");
    r.set(type, id, dest);
  }
  return r;
}

function businessIntent(overrides = {}) {
  return {
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123",
    template_key: "vendor_new_lead", variables: { name: "Keshav Studio" },
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: `idem-${crypto.randomUUID()}`, priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
    ...overrides,
  };
}

function authIntent(overrides = {}) {
  return {
    type: "client_login_otp", lane: "authentication", channel: "whatsapp",
    recipient_type: "client", recipient_id: "ca-123",
    template_key: "client_login_otp", variables: { otp: "123456" },
    entity_type: null, entity_id: null, correlation_id: "corr-11",
    idempotency_key: `idem-${crypto.randomUUID()}`, priority: "critical",
    scheduled_at: null, policy_decision_id: null, metadata: {},
    ...overrides,
  };
}

function postWebhook(service, payload, { secret = WEBHOOK_SECRET, signature } = {}) {
  const rawBody = JSON.stringify(payload);
  const sig = signature ?? computeMockWebhookSignature(rawBody, secret);
  return service.processWebhook(rawBody, sig, secret);
}

/** Minimal second provider proving providerKey drives every persisted value. */
function makeNamedProvider(providerKey) {
  return {
    providerKey,
    sentCount: 0,
    async sendAuthenticationMessage() { return this.simulate(); },
    async sendTemplateMessage() { return this.simulate(); },
    simulate() {
      this.sentCount += 1;
      return {
        accepted: true, provider: this.providerKey,
        providerMessageId: `${providerKey}-msg-${this.sentCount}`,
        normalizedStatus: "accepted", errorCode: null, errorMessage: null, retryable: false,
      };
    },
    verifyWebhookSignature(rawBody, signature, secret) {
      return signature === `${providerKey}:${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    },
    deriveWebhookEventId(payload) { return String(payload.event_id ?? "unknown"); },
    normalizeWebhook(payload) {
      if (!payload.message_id || !payload.status || !payload.timestamp) return [];
      return [{
        providerEventId: this.deriveWebhookEventId(payload),
        providerMessageId: String(payload.message_id),
        normalizedEventType: String(payload.status),
        occurredAt: String(payload.timestamp),
        sanitizedMetadata: {},
      }];
    },
    async healthCheck() {
      return { provider: providerKey, configured: true, reachable: true, status: "healthy", checkedAt: new Date().toISOString(), latencyMs: 1, detailsSanitized: {} };
    },
  };
}

// ============================================================================
// PROVIDER CONTRACT & MOCK SIMULATIONS
// ============================================================================
check("P1. mock provider success", async () => {
  const p = new MockWhatsAppProvider();
  const res = await p.sendTemplateMessage(CLIENT_DEST, "lead_received", { name: "Keshav" });
  assert(res.accepted === true, "should accept template message");
  assert(res.providerMessageId !== null, "message ID should be generated");
  assert(res.provider === "mock", "provider name mismatch");
  assert(res.normalizedStatus === "accepted", "should return accepted status");
});

check("P2. mock provider retryable failure", async () => {
  const p = new MockWhatsAppProvider();
  const res = await p.sendTemplateMessage(MOCK_DESTINATIONS.RETRYABLE_FAILURE, "lead_received", {});
  assert(res.accepted === false, "should reject");
  assert(res.retryable === true, "should be retryable");
  assert(res.errorCode === "RATE_LIMIT_EXCEEDED", "rate limit error code");
});

check("P3. mock provider permanent failure", async () => {
  const p = new MockWhatsAppProvider();
  const res = await p.sendTemplateMessage(MOCK_DESTINATIONS.PERMANENT_FAILURE, "lead_received", {});
  assert(res.accepted === false, "should reject");
  assert(res.retryable === false, "should be permanent");
  assert(res.errorCode === "INVALID_DESTINATION_NUMBER", "invalid number error");
});

check("P4. provider health check", async () => {
  const p = new MockWhatsAppProvider();
  const res = await p.healthCheck();
  assert(res.provider === "mock", "provider name incorrect");
  assert(res.status === "healthy", "should be healthy");
  assert(res.reachable === true && res.configured === true, "reachable/configured");
});

check("P5. mock never retains authentication variable values", async () => {
  const p = new MockWhatsAppProvider();
  await p.sendAuthenticationMessage(CLIENT_DEST, "client_login_otp", { otp: "123456", text: "Your OTP is 123456" });
  const [record] = p.getLastSentPayloads();
  assert(record.lane === "authentication", "lane recorded");
  assert(Object.keys(record.variables).length === 0, "auth variables must not be retained at all");
  assert(record.variableKeys.includes("otp"), "variable names retained for assertions");
  assert(!JSON.stringify(record).includes("123456"), "no OTP value anywhere in the record");
});

check("P6. webhook payload normalization", () => {
  const p = new MockWhatsAppProvider();
  const events = p.normalizeWebhook({
    event_id: "evt-111", message_id: "msg-222", status: "delivered",
    timestamp: "2026-07-08T12:00:00Z", metadata: { key: "value" },
  });
  assert(events.length === 1, "normalize exactly 1 event");
  assert(events[0].providerEventId === "evt-111", "eventId mismatch");
  assert(events[0].providerMessageId === "msg-222", "messageId mismatch");
  assert(events[0].normalizedEventType === "delivered", "eventType mismatch");
  assert(events[0].occurredAt === "2026-07-08T12:00:00Z", "timestamp mismatch");
});

// ============================================================================
// FIX 5 — STRICT MOCK SIGNATURE VERIFICATION
// ============================================================================
check("FIX5-a. strict invalid signature rejection", () => {
  const p = new MockWhatsAppProvider();
  const rawBody = JSON.stringify({ event_id: "e1" });
  const valid = computeMockWebhookSignature(rawBody, WEBHOOK_SECRET);

  assert(p.verifyWebhookSignature(rawBody, valid, WEBHOOK_SECRET), "exact deterministic signature accepted");
  assert(!p.verifyWebhookSignature(rawBody, "sha256=deadbeef", WEBHOOK_SECRET), "arbitrary sha256= prefix rejected");
  assert(!p.verifyWebhookSignature(rawBody, "sha256=", WEBHOOK_SECRET), "empty sha256= rejected");
  assert(!p.verifyWebhookSignature(rawBody, "mock-valid-signature", WEBHOOK_SECRET), "legacy magic string rejected");
  assert(!p.verifyWebhookSignature(rawBody, valid, "wrong-secret"), "wrong secret rejected");
  assert(!p.verifyWebhookSignature(`${rawBody} `, valid, WEBHOOK_SECRET), "tampered body rejected");
  assert(!p.verifyWebhookSignature(rawBody, "", WEBHOOK_SECRET), "empty signature rejected");
});

check("FIX5-b. service rejects an invalid signature and records a rejected receipt", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await postWebhook(s, { event_id: "evt-bad", message_id: "m", status: "delivered", timestamp: "t" }, { signature: "sha256=deadbeef" });
  assert(res.ok === false, "invalid signature must fail");
  assert(res.code === "INVALID_WEBHOOK_SIGNATURE", `expected INVALID_WEBHOOK_SIGNATURE, got ${res.code}`);
  assert(db.communication_webhook_receipts.length === 1, "one rejected receipt recorded");
  assert(db.communication_webhook_receipts[0].signature_valid === false, "receipt marked signature_valid=false");
  assert(db.communication_webhook_receipts[0].processing_status === "rejected", "receipt marked rejected");
  assert(db.communication_messages.length === 0, "no message touched");
});

// ============================================================================
// FIX 6 — DETERMINISTIC MOCK PROVIDER
// ============================================================================
check("FIX6-a. deterministic mock message IDs", async () => {
  const a = new MockWhatsAppProvider();
  const b = new MockWhatsAppProvider();
  const idsA = [
    (await a.sendTemplateMessage(CLIENT_DEST, "lead_received", { n: "1" })).providerMessageId,
    (await a.sendTemplateMessage(VENDOR_DEST, "vendor_new_lead", { n: "2" })).providerMessageId,
  ];
  const idsB = [
    (await b.sendTemplateMessage(CLIENT_DEST, "lead_received", { n: "1" })).providerMessageId,
    (await b.sendTemplateMessage(VENDOR_DEST, "vendor_new_lead", { n: "2" })).providerMessageId,
  ];
  assert(JSON.stringify(idsA) === JSON.stringify(idsB), `ids must be deterministic: ${idsA} vs ${idsB}`);
  assert(idsA[0] !== idsA[1], "distinct sends produce distinct ids");
  assert(idsA[0].startsWith("mock-msg-000001-"), `monotonic counter expected, got ${idsA[0]}`);
  assert(!/\d{13}/.test(idsA[0]), "id must not embed a Date.now() timestamp");
});

check("FIX6-b. deterministic mock webhook handling", () => {
  const p = new MockWhatsAppProvider();
  const payload = { message_id: "m-1", status: "sent", timestamp: "2026-07-08T00:00:00Z" };
  const first = p.normalizeWebhook(payload);
  const second = p.normalizeWebhook(payload);
  assert(JSON.stringify(first) === JSON.stringify(second), "normalizeWebhook must be pure");
  assert(first[0].providerEventId === p.deriveWebhookEventId(payload), "fallback event id derived deterministically");
  assert(first[0].providerEventId.startsWith("mock-evt-"), "deterministic fallback prefix");

  // Same event id for the same payload across instances — the de-dup contract.
  assert(new MockWhatsAppProvider().deriveWebhookEventId(payload) === first[0].providerEventId, "event id stable across instances");
  // Key order must not change the derived id.
  assert(p.deriveWebhookEventId({ timestamp: "2026-07-08T00:00:00Z", status: "sent", message_id: "m-1" }) === first[0].providerEventId, "event id independent of key order");
});

check("FIX6-c. required webhook identifiers missing are rejected, not defaulted", () => {
  const p = new MockWhatsAppProvider();
  assert(p.normalizeWebhook({ status: "delivered", timestamp: "t" }).length === 0, "missing message_id rejected");
  assert(p.normalizeWebhook({ message_id: "m", status: "delivered" }).length === 0, "missing timestamp rejected");
  assert(p.normalizeWebhook({ message_id: "m", timestamp: "t" }).length === 0, "missing status rejected");
});

check("FIX6-d. mock provider source is free of Math.random and message-id clock reads", () => {
  assert(!/Math\.random/.test(MOCK_PROVIDER_SOURCE), "Math.random must not appear in the mock provider");
  const dateNowUses = MOCK_PROVIDER_SOURCE.match(/Date\.now\(\)/g) ?? [];
  assert(dateNowUses.length === 0, "Date.now() must not appear in the mock provider");
});

// ============================================================================
// FIX 4 — UNKNOWN WEBHOOK STATUS MUST NEVER BECOME DELIVERED
// ============================================================================
check("FIX4-a. unknown status is dropped by the normalizer", () => {
  const p = new MockWhatsAppProvider();
  for (const status of ["exploded", "DELIVERED", "queued", "", "delivered_maybe"]) {
    const events = p.normalizeWebhook({ message_id: "m-1", status, timestamp: "2026-07-08T00:00:00Z" });
    assert(events.length === 0, `status "${status}" must not normalize`);
  }
});

check("FIX4-b. unknown status never mutates a message and never becomes delivered", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-unknown", provider: "mock", provider_message_id: "p-unknown", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, accepted_at: "2026-07-08T00:00:00Z",
    sent_at: null, delivered_at: null, created_at: new Date().toISOString(),
  }];

  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await postWebhook(s, { event_id: "evt-unknown", message_id: "p-unknown", status: "exploded", timestamp: "2026-07-08T01:00:00Z" });

  assert(res.ok === true, "unknown status returns idempotent success (no provider redelivery storm)");
  assert(res.data.processingStatus === "rejected", `receipt should be rejected, got ${res.data.processingStatus}`);
  assert(res.data.eventsNormalized === 0, "no events normalized");
  assert(db.communication_messages[0].status === "accepted", "message must not move");
  assert(db.communication_messages[0].delivered_at === null, "delivered_at must stay null");
  assert(db.communication_delivery_events.length === 0, "no delivery event created");
  assert(db.communication_webhook_receipts[0].processing_status === "rejected", "receipt recorded as rejected");
});

// ============================================================================
// FIX 3 — WEBHOOK DUPLICATE STORAGE
// ============================================================================
check("FIX3-a. duplicate webhook does not insert a conflicting receipt", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-dup", provider: "mock", provider_message_id: "p-dup", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
    accepted_at: "2026-07-08T00:00:00Z", sent_at: null, delivered_at: null,
  }];

  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const payload = { event_id: "evt-dup-11", message_id: "p-dup", status: "delivered", timestamp: "2026-07-08T02:00:00Z" };

  const first = await postWebhook(s, payload);
  const second = await postWebhook(s, payload);

  assert(first.ok === true && second.ok === true, "both calls succeed idempotently");
  assert(first.data.duplicate === false, "first is not a duplicate");
  assert(second.data.duplicate === true, "second is a duplicate");
  assert(second.data.processingStatus === "duplicate", "duplicate processing status reported");
  assert(db.communication_webhook_receipts.length === 1, `exactly one receipt row, got ${db.communication_webhook_receipts.length}`);
  assert(db.communication_webhook_receipts[0].duplicate_count === 1, "duplicate_count bumped for monitoring");
  assert(db.communication_webhook_receipts[0].last_duplicate_at !== null, "last_duplicate_at stamped");
  assert(second.data.receiptId === first.data.receiptId, "duplicate resolves to the original receipt");
});

check("FIX3-b. duplicate webhook does not double-create a delivery event", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-dup2", provider: "mock", provider_message_id: "p-dup2", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
    accepted_at: "2026-07-08T00:00:00Z", sent_at: null, delivered_at: null,
  }];

  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const payload = { event_id: "evt-dup-22", message_id: "p-dup2", status: "delivered", timestamp: "2026-07-08T02:00:00Z" };

  await postWebhook(s, payload);
  const deliveredAt = db.communication_messages[0].delivered_at;
  await postWebhook(s, payload);

  assert(db.communication_delivery_events.length === 1, `exactly one delivery event, got ${db.communication_delivery_events.length}`);
  assert(db.communication_messages[0].status === "delivered", "state applied once");
  assert(db.communication_messages[0].delivered_at === deliveredAt, "timestamp not rewritten by the duplicate");
});

check("FIX3-c. an identical payload with a different event id still de-duplicates on payload_hash", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-dup3", provider: "mock", provider_message_id: "p-dup3", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  // No event_id at all: the deterministic fallback derives one from the payload,
  // so a redelivery collides on BOTH unique indexes.
  const payload = { message_id: "p-dup3", status: "sent", timestamp: "2026-07-08T02:00:00Z" };
  const first = await postWebhook(s, payload);
  const second = await postWebhook(s, payload);

  assert(first.ok && second.ok, "both succeed");
  assert(second.data.duplicate === true, "redelivery detected");
  assert(db.communication_webhook_receipts.length === 1, "no conflicting receipt inserted");
  assert(db.communication_delivery_events.length === 1, "no duplicate delivery event");
});

check("FIX3-d. a forged payload cannot poison the de-duplication slot of a valid one", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-poison", provider: "mock", provider_message_id: "p-poison", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const payload = { event_id: "evt-poison", message_id: "p-poison", status: "delivered", timestamp: "2026-07-08T02:00:00Z" };

  const forged = await postWebhook(s, payload, { signature: "sha256=deadbeef" });
  assert(forged.ok === false, "forged webhook rejected");

  const genuine = await postWebhook(s, payload);
  assert(genuine.ok === true, "genuine webhook still processes");
  assert(genuine.data.duplicate === false, "genuine webhook is NOT treated as a duplicate of the forgery");
  assert(db.communication_messages[0].status === "delivered", "genuine webhook applied");
  assert(db.communication_webhook_receipts.length === 2, "rejected + verified receipts coexist");
});

check("FIX3-e. a provider event id is never spliced into a PostgREST filter", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-inj", provider: "mock", provider_message_id: "p-inj", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  // An event id full of PostgREST `or=` syntax must be treated as an opaque value.
  const hostile = "evt),payload_hash.neq.x,id.neq.";
  const payload = { event_id: hostile, message_id: "p-inj", status: "delivered", timestamp: "2026-07-08T02:00:00Z" };

  const first = await postWebhook(s, payload);
  const second = await postWebhook(s, payload);

  assert(first.ok && second.ok, "both succeed");
  assert(second.data.duplicate === true, "redelivery still de-duplicates on the hostile id");
  assert(second.data.receiptId === first.data.receiptId, "the original receipt is found by equality, not by filter syntax");
  assert(db.communication_webhook_receipts.length === 1, "no conflicting receipt");
  assert(!/\.or\(/.test(SERVICE_SOURCE), "receipt lookup must not build an interpolated or() filter");
});

check("FIX3-f. a hard failure while applying events leaves the receipt marked failed, not stranded", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-hard", provider: "mock", provider_message_id: "p-hard", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());

  // A non-unique database error while appending the immutable trace row.
  failNextInsert("communication_delivery_events", { code: "08006", message: "connection failure" });

  const res = await postWebhook(s, { event_id: "evt-hard", message_id: "p-hard", status: "delivered", timestamp: "2026-07-08T02:00:00Z" });

  assert(res.ok === false, "a hard failure must surface");
  assert(db.communication_webhook_receipts.length === 1, "the receipt row exists");
  assert(db.communication_webhook_receipts[0].processing_status === "failed",
    `receipt must be marked failed, got ${db.communication_webhook_receipts[0].processing_status}`);
  assert(db.communication_webhook_receipts[0].failure_reason_sanitized !== null, "an operator-visible reason is recorded");
});

// ============================================================================
// FIX 7 — STATUS / TIMESTAMP SEMANTICS
// ============================================================================
check("FIX7-a. accepted state does not populate sent_at", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await s.send(businessIntent());
  assert(res.ok === true, `send should succeed: ${res.ok ? "" : res.error}`);
  assert(res.data.status === "accepted", `expected accepted, got ${res.data.status}`);
  assert(res.data.accepted_at !== null && res.data.accepted_at !== undefined, "accepted_at must be set");
  assert(res.data.sent_at === null, `sent_at must remain null on accepted, got ${res.data.sent_at}`);
});

check("FIX7-b. sent_at is stamped only when the normalized state becomes sent", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-sent", provider: "mock", provider_message_id: "p-sent", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
    accepted_at: "2026-07-08T00:00:00Z", sent_at: null,
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  await postWebhook(s, { event_id: "evt-s", message_id: "p-sent", status: "sent", timestamp: "2026-07-08T03:00:00Z" });
  assert(db.communication_messages[0].status === "sent", "status advanced to sent");
  assert(db.communication_messages[0].sent_at === "2026-07-08T03:00:00Z", "sent_at stamped from the event");
});

check("FIX7-c. delivered cannot transition to failed", async () => {
  assert(!CommServiceMod.isValidTransition("delivered", "failed"), "delivered -> failed must be rejected");

  resetDb();
  db.communication_messages = [{
    id: "msg-del", provider: "mock", provider_message_id: "p-del", status: "delivered",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
    delivered_at: "2026-07-08T04:00:00Z", failed_at: null, failure_code: null,
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await postWebhook(s, { event_id: "evt-fail-late", message_id: "p-del", status: "failed", timestamp: "2026-07-08T05:00:00Z" });

  assert(res.ok === true, "webhook accepted");
  assert(res.data.messagesUpdated === 0, "no message may be updated by a forbidden transition");
  assert(db.communication_messages[0].status === "delivered", "a delivered message must never regress to failed");
  assert(db.communication_messages[0].failed_at === null, "failed_at must stay null");
  assert(db.communication_delivery_events.length === 1, "the event is still traced for monitoring");
});

check("FIX7-c2. a failed webhook writes a scalar failure_code, never [object Object]", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-scalar", provider: "mock", provider_message_id: "p-scalar", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  await postWebhook(s, {
    event_id: "evt-scalar", message_id: "p-scalar", status: "failed", timestamp: "2026-07-08T05:00:00Z",
    metadata: { error_code: { nested: "oops" }, error_message: ["a", "b"] },
  });

  const msg = db.communication_messages[0];
  assert(msg.status === "failed", "failure applied");
  assert(msg.failure_code === "WEBHOOK_FAILED", `expected the safe default, got ${msg.failure_code}`);
  assert(!String(msg.failure_code).includes("[object"), "never coerce an object into failure_code");
  assert(!String(msg.failure_reason_sanitized).includes("[object"), "never coerce an object into the reason");
});

check("FIX7-d. out-of-order forward progress stays safe", () => {
  assert(CommServiceMod.isValidTransition("accepted", "delivered"), "accepted -> delivered");
  assert(CommServiceMod.isValidTransition("accepted", "read"), "accepted -> read");
  assert(CommServiceMod.isValidTransition("sent", "read"), "sent -> read");
  assert(CommServiceMod.isValidTransition("delivered", "read"), "delivered -> read");
  assert(!CommServiceMod.isValidTransition("delivered", "sent"), "delivered -> sent rejected");
  assert(!CommServiceMod.isValidTransition("read", "delivered"), "read -> delivered rejected");
  assert(!CommServiceMod.isValidTransition("dead_letter", "accepted"), "dead_letter is terminal");
});

check("FIX7-e. duplicate same-state webhook events are a safe no-op", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-same", provider: "mock", provider_message_id: "p-same", status: "delivered",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
    delivered_at: "2026-07-08T04:00:00Z",
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await postWebhook(s, { event_id: "evt-same", message_id: "p-same", status: "delivered", timestamp: "2026-07-08T09:00:00Z" });

  assert(res.ok === true, "same-state webhook safe");
  assert(res.data.messagesUpdated === 0, "same-state event is a no-op");
  assert(db.communication_messages[0].delivered_at === "2026-07-08T04:00:00Z", "original timestamp preserved");
});

check("FIX7-f. delivered before sent handling safe (late sent event ignored)", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-trans-1", provider: "mock", provider_message_id: "p-msg-trans-1", status: "accepted",
    lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString(),
  }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());

  await postWebhook(s, { event_id: "evt-del-first", message_id: "p-msg-trans-1", status: "delivered", timestamp: "2026-07-08T06:00:00Z" });
  assert(db.communication_messages[0].status === "delivered", "should update to delivered");

  await postWebhook(s, { event_id: "evt-sent-later", message_id: "p-msg-trans-1", status: "sent", timestamp: "2026-07-08T07:00:00Z" });
  assert(db.communication_messages[0].status === "delivered", "status must remain delivered (backward transition ignored)");
});

// ============================================================================
// FIX 8 — AUTH FAILURE MUST NOT BECOME DEAD LETTER
// ============================================================================
check("FIX8-a. authentication permanent failure ends as failed", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor({ "client:ca-123": MOCK_DESTINATIONS.PERMANENT_FAILURE }));
  const res = await s.send(authIntent());

  assert(res.ok === true, `dispatch recorded: ${res.ok ? "" : res.error}`);
  assert(res.data.status === "failed", `expected failed, got ${res.data.status}`);
  assert(res.data.attempt_count === 1, "single attempt consumed");
  assert(res.data.max_attempts === 1, "authentication lane is single-shot");
  assert(res.data.next_retry_at === null, "no retry scheduled");
});

check("FIX8-b. authentication RETRYABLE failure still ends as failed, never dead_letter", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor({ "client:ca-123": MOCK_DESTINATIONS.RETRYABLE_FAILURE }));
  const res = await s.send(authIntent());

  assert(res.ok === true, "dispatch recorded");
  assert(res.data.status === "failed", `expected failed, got ${res.data.status}`);
  assert(res.data.status !== "dead_letter", "authentication must never dead-letter");
  assert(res.data.status !== "retry_scheduled", "authentication must never schedule a retry");
});

check("FIX8-c. authentication messages cannot be scheduled or re-dispatched from stored state", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());

  const scheduled = await s.send(authIntent({ scheduled_at: new Date(Date.now() + 60_000).toISOString() }));
  assert(scheduled.ok === false, "scheduling an OTP must be refused");
  assert(scheduled.code === "AUTH_LANE_SCHEDULING_UNSUPPORTED", `got ${scheduled.code}`);
  assert(db.communication_messages.length === 0, "no undeliverable row created");

  db.communication_messages = [{
    id: "msg-auth-stored", provider: "mock", status: "queued", lane: "authentication",
    recipient_type: "client", recipient_id: "ca-123", attempt_count: 0, max_attempts: 1,
    destination_hash: hashDestination(CLIENT_DEST), variables: {}, created_at: new Date().toISOString(),
  }];
  const redispatch = await s.dispatchPersistedMessage("msg-auth-stored");
  assert(redispatch.ok === false, "stored auth message cannot be re-dispatched");
  assert(redispatch.code === "AUTH_LANE_NOT_REDISPATCHABLE", `got ${redispatch.code}`);
});

check("FIX8-d. business exhausted retries end as dead_letter", async () => {
  resetDb();
  const msgRow = {
    id: "msg-exhaust", provider: "mock", status: "retry_scheduled", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-retry", attempt_count: 4, max_attempts: 5,
    idempotency_key: "idem-exhaust-1", destination_hash: hashDestination(MOCK_DESTINATIONS.RETRYABLE_FAILURE),
    destination_masked: "masked", template_key: "vendor_new_lead", variables: {}, metadata: {},
    next_retry_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date().toISOString(),
  };
  db.communication_messages = [msgRow];

  const resolver = resolverFor();
  resolver.set("vendor", "vend-retry", MOCK_DESTINATIONS.RETRYABLE_FAILURE);
  const s = new CommunicationService(new MockWhatsAppProvider(), resolver);

  const res = await s.dispatchPersistedMessage("msg-exhaust");
  assert(res.ok === true, `dispatch recorded: ${res.ok ? "" : res.error}`);
  assert(res.data.status === "dead_letter", `expected dead_letter, got ${res.data.status}`);
  assert(res.data.attempt_count === 5, "attempt count is 5");
  assert(res.data.next_retry_at === null, "no further retry scheduled");
});

check("FIX8-e. business retryable failure with attempts remaining schedules a retry", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor({ "vendor:vend-123": MOCK_DESTINATIONS.RETRYABLE_FAILURE }));
  const res = await s.send(businessIntent());

  assert(res.ok === true, "send call ok");
  assert(res.data.status === "retry_scheduled", `expected retry_scheduled, got ${res.data.status}`);
  assert(res.data.attempt_count === 1, "attempt count incremented to 1");
  assert(res.data.next_retry_at !== null, "next retry date calculated");
});

check("FIX8-f. business permanent failure fails immediately without retry", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor({ "vendor:vend-123": MOCK_DESTINATIONS.PERMANENT_FAILURE }));
  const res = await s.send(businessIntent());

  assert(res.ok === true, "send call ok");
  assert(res.data.status === "failed", `expected failed, got ${res.data.status}`);
  assert(res.data.next_retry_at === null, "no retry scheduled");
});

// ============================================================================
// FIX 1 — RECIPIENT RESOLUTION FOR SCHEDULED / RETRY DELIVERY
// ============================================================================
check("FIX1-a. scheduled message resolves its recipient at dispatch time", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();

  const queued = await s.send(businessIntent({ scheduled_at: scheduledAt, idempotency_key: "idem-sched-1" }));
  assert(queued.ok === true, `queued: ${queued.ok ? "" : queued.error}`);
  assert(queued.data.status === "queued", "scheduled message stays queued");
  assert(queued.data.destination_hash === hashDestination(VENDOR_DEST), "hash bound at enqueue");
  assert(!("destination" in queued.data), "no plaintext destination column persisted");

  // A brand-new process: fresh provider, fresh service, nothing in memory.
  const restartedProvider = new MockWhatsAppProvider();
  const restarted = new CommunicationService(restartedProvider, resolverFor());
  db.communication_messages[0].scheduled_at = new Date(Date.now() - 1000).toISOString();

  const dispatched = await restarted.dispatchPersistedMessage(queued.data.id);
  assert(dispatched.ok === true, `dispatched: ${dispatched.ok ? "" : dispatched.error}`);
  assert(dispatched.data.status === "accepted", `expected accepted, got ${dispatched.data.status}`);
  assert(restartedProvider.getLastSentPayloads()[0].to === VENDOR_DEST, "destination recovered by the resolver");
});

check("FIX1-b. retry dispatch resolves its recipient at dispatch time", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-retry-restart", provider: "mock", status: "retry_scheduled", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", attempt_count: 1, max_attempts: 5,
    idempotency_key: "idem-retry-restart", destination_hash: hashDestination(VENDOR_DEST),
    destination_masked: "+91******3211", template_key: "vendor_new_lead",
    variables: { name: "Keshav Studio" }, metadata: {},
    next_retry_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date().toISOString(),
  }];

  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const res = await s.dispatchPersistedMessage("msg-retry-restart");

  assert(res.ok === true, `retry dispatched: ${res.ok ? "" : res.error}`);
  assert(res.data.status === "accepted", `expected accepted, got ${res.data.status}`);
  assert(res.data.attempt_count === 2, "attempt incremented");
  const [record] = provider.getLastSentPayloads();
  assert(record.to === VENDOR_DEST, "destination resolved without any caller-supplied plaintext");
  assert(record.variables.name === "Keshav Studio", "persisted variables reused on retry");
});

check("FIX1-c. a message not yet due is not dispatched", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-not-due", provider: "mock", status: "retry_scheduled", lane: "business",
    recipient_type: "vendor", recipient_id: "vend-123", attempt_count: 1, max_attempts: 5,
    destination_hash: hashDestination(VENDOR_DEST), variables: {}, template_key: "vendor_new_lead",
    next_retry_at: new Date(Date.now() + 60_000).toISOString(), created_at: new Date().toISOString(),
  }];
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const res = await s.dispatchPersistedMessage("msg-not-due");
  assert(res.ok === false && res.code === "MESSAGE_NOT_DUE", `expected MESSAGE_NOT_DUE, got ${res.code}`);
  assert(provider.getLastSentPayloads().length === 0, "provider not called");
});

check("FIX1-d. unresolvable recipient fails closed and never invents a number", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const emptyResolver = new StaticCommunicationRecipientResolver();
  const s = new CommunicationService(provider, emptyResolver);

  const res = await s.send(businessIntent());
  assert(res.ok === false, "send must fail");
  assert(res.code === "RECIPIENT_NOT_FOUND", `expected RECIPIENT_NOT_FOUND, got ${res.code}`);
  assert(db.communication_messages.length === 0, "no queued row that could never be delivered");
  assert(provider.getLastSentPayloads().length === 0, "provider never called");
});

check("FIX1-e. non-addressable recipient types are rejected", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  for (const recipient_type of ["integration", "system"]) {
    const res = await s.send(businessIntent({ recipient_type, recipient_id: "x" }));
    assert(res.ok === false && res.code === "RECIPIENT_TYPE_UNSUPPORTED", `${recipient_type}: got ${res.code}`);
  }
  const missingId = await s.send(businessIntent({ recipient_id: null }));
  assert(missingId.ok === false && missingId.code === "RECIPIENT_ID_REQUIRED", `got ${missingId.code}`);
});

check("FIX1-f. a recipient whose number changed is not silently re-routed", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-moved", provider: "mock", status: "retry_scheduled", lane: "business",
    recipient_type: "vendor", recipient_id: "vend-123", attempt_count: 1, max_attempts: 5,
    destination_hash: hashDestination("+919111111111"), variables: {}, template_key: "vendor_new_lead",
    next_retry_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date().toISOString(),
  }];
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const res = await s.dispatchPersistedMessage("msg-moved");

  assert(res.ok === false, "dispatch must fail closed");
  assert(res.code === "RECIPIENT_DESTINATION_CHANGED", `expected RECIPIENT_DESTINATION_CHANGED, got ${res.code}`);
  assert(provider.getLastSentPayloads().length === 0, "no message sent to the new number");
  assert(db.communication_messages[0].status === "failed", "message marked failed for the operator");
  assert(db.communication_messages[0].failure_code === "RECIPIENT_DESTINATION_CHANGED", "auditable failure code");
});

check("FIX1-g. supabase resolver reads existing QuickFurno sources", async () => {
  resetDb();
  const r = new SupabaseResolverMod.SupabaseCommunicationRecipientResolver();
  assert(r.resolverKey === "supabase", "resolver identity");

  const client = await r.resolveDestination("client", "ca-123");
  assert(client.ok && client.data === "+919876543210", "client_accounts.phone_e164");

  const vendor = await r.resolveDestination("vendor", "vend-123");
  assert(vendor.ok && vendor.data === "+918876543211", `vendors.whatsapp_number normalized, got ${JSON.stringify(vendor)}`);

  const vendorFallback = await r.resolveDestination("vendor", "vend-no-wa");
  assert(vendorFallback.ok && vendorFallback.data === "+918800000001", "falls back to vendors.phone");

  const vendorBad = await r.resolveDestination("vendor", "vend-bad");
  assert(!vendorBad.ok && vendorBad.code === "RECIPIENT_DESTINATION_INVALID", "malformed WhatsApp number surfaces, no silent escalation");

  const vendorNone = await r.resolveDestination("vendor", "vend-none");
  assert(!vendorNone.ok && vendorNone.code === "RECIPIENT_DESTINATION_MISSING", "missing destination");

  const admin = await r.resolveDestination("admin", "adm-1");
  assert(admin.ok && admin.data === "+919000000001", "profiles.phone for admins");

  const nonAdmin = await r.resolveDestination("admin", "usr-1");
  assert(!nonAdmin.ok && nonAdmin.code === "RECIPIENT_NOT_FOUND", "non-admin profile never resolves as admin");

  const unknown = await r.resolveDestination("client", "ca-missing");
  assert(!unknown.ok && unknown.code === "RECIPIENT_NOT_FOUND", "missing client");

  const system = await r.resolveDestination("system", "anything");
  assert(!system.ok && system.code === "RECIPIENT_TYPE_UNSUPPORTED", "system recipients unsupported");
});

// ============================================================================
// FIX 2 — PROVIDER KEY PROPAGATION
// ============================================================================
check("FIX2-a. providerKey propagates to messages, receipts and delivery events", async () => {
  resetDb();
  const provider = makeNamedProvider("acme-wa");
  const s = new CommunicationService(provider, resolverFor());

  const sent = await s.send(businessIntent({ idempotency_key: "idem-pk-1" }));
  assert(sent.ok === true, `send: ${sent.ok ? "" : sent.error}`);
  assert(sent.data.provider === "acme-wa", `message.provider should be acme-wa, got ${sent.data.provider}`);
  assert(sent.data.provider_message_id === "acme-wa-msg-1", "provider message id from the adapter");

  const rawBody = JSON.stringify({ event_id: "acme-evt-1", message_id: "acme-wa-msg-1", status: "delivered", timestamp: "2026-07-08T08:00:00Z" });
  const signature = `acme-wa:${crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")}`;
  const hook = await s.processWebhook(rawBody, signature, WEBHOOK_SECRET);

  assert(hook.ok === true, `webhook: ${hook.ok ? "" : hook.error}`);
  assert(db.communication_webhook_receipts[0].provider === "acme-wa", "receipt.provider");
  assert(db.communication_delivery_events[0].provider === "acme-wa", "delivery_event.provider");
  assert(db.communication_messages[0].status === "delivered", "state applied under the named provider");
});

check("FIX2-b. provider message ids are scoped to their own provider", async () => {
  resetDb();
  db.communication_messages = [
    { id: "m-a", provider: "acme-wa", provider_message_id: "shared-id", status: "accepted", lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString() },
    { id: "m-b", provider: "mock", provider_message_id: "shared-id", status: "accepted", lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString() },
  ];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  await postWebhook(s, { event_id: "evt-scope", message_id: "shared-id", status: "delivered", timestamp: "2026-07-08T08:00:00Z" });

  assert(db.communication_messages[0].status === "accepted", "the other provider's message is untouched");
  assert(db.communication_messages[1].status === "delivered", "only the mock provider's message advances");
});

check("FIX2-c. no communication service code hardcodes a provider literal", () => {
  const quotedMock = /["'`]mock["'`]/;
  assert(!quotedMock.test(SERVICE_SOURCE), "communicationService.ts must not contain a 'mock' literal");
  assert(!quotedMock.test(ADMIN_SOURCE), "communicationAdminService.ts must not contain a 'mock' literal");
  assert(/providerKey/.test(SERVICE_SOURCE), "service must read provider.providerKey");
});

// ============================================================================
// FIX 9 — CANONICAL PHONE NORMALIZATION
// ============================================================================
check("FIX9-a. canonical equivalent phone formats hash identically", () => {
  const equivalents = [
    "+919876543210", "+91 98765 43210", "+91-98765-43210", "+91 (98765) 43210",
    "+91.98765.43210", "0091 98765 43210", "00919876543210", " +919876543210 ",
  ];
  const hashes = equivalents.map((p) => hashDestination(p));
  assert(new Set(hashes).size === 1, `all equivalents must hash identically: ${JSON.stringify(hashes)}`);

  const normalized = equivalents.map((p) => PhoneMod.normalizePhoneE164(p));
  assert(normalized.every((n) => n.ok && n.e164 === "+919876543210"), "all normalize to canonical E.164");

  const masks = equivalents.map((p) => CommServiceMod.maskDestination(p));
  assert(new Set(masks).size === 1 && masks[0] === "+91******3210", `masking uses the normalized value: ${masks[0]}`);

  assert(hashDestination("+919876543210") !== hashDestination("+919876543211"), "different numbers hash differently");
});

check("FIX9-b. invalid phone rejected, no country guessing", () => {
  const invalid = {
    "9876543210": "PHONE_MISSING_COUNTRY_CODE",     // bare national number — never guessed
    "98765 43210": "PHONE_MISSING_COUNTRY_CODE",
    "": "PHONE_EMPTY",
    "+": "PHONE_EMPTY",
    "+91abc43210": "PHONE_INVALID_CHARACTERS",
    "+0919876543210": "PHONE_INVALID_COUNTRY_CODE",
    "+911": "PHONE_TOO_SHORT",
    "+9198765432101234": "PHONE_TOO_LONG",
  };
  for (const [input, code] of Object.entries(invalid)) {
    const res = PhoneMod.normalizePhoneE164(input);
    assert(res.ok === false, `"${input}" must be rejected`);
    assert(res.code === code, `"${input}" expected ${code}, got ${res.code}`);
    let threw = false;
    try { hashDestination(input); } catch { threw = true; }
    assert(threw, `hashDestination("${input}") must throw`);
  }
  assert(PhoneMod.normalizePhoneE164(null).ok === false, "null rejected");
  assert(PhoneMod.normalizePhoneE164(undefined).ok === false, "undefined rejected");
});

check("FIX9-c. persisted rows carry only the hash and the mask", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  await s.send(businessIntent({ idempotency_key: "idem-mask-1" }));
  const persisted = db.communication_messages[0];

  assert(persisted.destination_hash === hashDestination(VENDOR_DEST), "hash persisted");
  assert(persisted.destination_masked === "+91******3211", `mask persisted, got ${persisted.destination_masked}`);
  assert(!JSON.stringify(persisted).includes(VENDOR_DEST.replace("+", "")), "no plaintext destination anywhere in the row");
});

// ============================================================================
// FIX 12 — CONCURRENCY-SAFE IDEMPOTENCY
// ============================================================================
check("FIX12-a. duplicate idempotency key returns the existing message (fast path)", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const intent = businessIntent({ idempotency_key: "idem-key-dup" });

  const res1 = await s.send(intent);
  const countBefore = db.communication_messages.length;
  const sendsBefore = provider.getLastSentPayloads().length;

  const res2 = await s.send(intent);

  assert(res1.ok === true && res2.ok === true, "both succeed");
  assert(res1.data.id === res2.data.id, "returns exact same message ID");
  assert(db.communication_messages.length === countBefore, "no duplicate row created");
  assert(provider.getLastSentPayloads().length === sendsBefore, "no duplicate dispatch");
});

check("FIX12-b. idempotency insert conflict returns the already-created logical message", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const intent = businessIntent({ idempotency_key: "idem-race-1" });

  // Simulate the race: our SELECT sees nothing, then a concurrent request wins
  // the INSERT before ours lands. The unique constraint is the final authority.
  const competingId = "msg-competitor";
  onNextSelect("communication_messages", () => {
    db.communication_messages.push({
      id: competingId, idempotency_key: "idem-race-1", provider: "mock", status: "accepted",
      lane: "business", channel: "whatsapp", recipient_type: "vendor", recipient_id: "vend-123",
      destination_hash: hashDestination(VENDOR_DEST), destination_masked: "+91******3211",
      template_key: "vendor_new_lead", attempt_count: 1, max_attempts: 5, next_retry_at: null,
      provider_message_id: "mock-msg-000001-competitor", variables: {}, metadata: {},
      accepted_at: new Date().toISOString(), sent_at: null, created_at: new Date().toISOString(),
    });
  });

  const res = await s.send(intent);

  assert(res.ok === true, `insert conflict must not surface as an error: ${res.ok ? "" : res.code}`);
  assert(res.data.id === competingId, `must return the winner's message, got ${res.data.id}`);
  assert(db.communication_messages.length === 1, `no duplicate row, got ${db.communication_messages.length}`);
});

check("FIX12-c. no duplicate dispatch occurs from idempotency race handling", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());

  onNextSelect("communication_messages", () => {
    db.communication_messages.push({
      id: "msg-winner", idempotency_key: "idem-race-2", provider: "mock", status: "accepted",
      lane: "business", channel: "whatsapp", recipient_type: "vendor", recipient_id: "vend-123",
      destination_hash: hashDestination(VENDOR_DEST), destination_masked: "+91******3211",
      template_key: "vendor_new_lead", attempt_count: 1, max_attempts: 5, next_retry_at: null,
      provider_message_id: "mock-msg-000001-winner", variables: {}, metadata: {},
      accepted_at: new Date().toISOString(), sent_at: null, created_at: new Date().toISOString(),
    });
  });

  const res = await s.send(businessIntent({ idempotency_key: "idem-race-2" }));

  assert(res.ok === true, "race resolves to success");
  assert(provider.getLastSentPayloads().length === 0, "the losing request must NOT dispatch a second message");
  assert(db.communication_delivery_events.length === 0, "no extra delivery events");
});

check("FIX12-d. the mock database enforces real unique constraints", async () => {
  resetDb();
  db.communication_messages.push({ id: "m1", idempotency_key: "dupe-key", provider: "mock" });

  // Direct insert of a conflicting idempotency key must produce 23505.
  const { error } = await supabaseMod.adminClient()
    .from("communication_messages")
    .insert({ idempotency_key: "dupe-key", provider: "mock" })
    .select("*")
    .single();

  assert(error !== null, "harness must reject a duplicate idempotency key");
  assert(error.code === "23505", `expected 23505, got ${error.code}`);
  assert(db.communication_messages.length === 1, "the conflicting row was not inserted");

  // NULL values never conflict, matching PostgreSQL.
  db.communication_webhook_receipts = [];
  const a = await supabaseMod.adminClient().from("communication_webhook_receipts")
    .insert({ provider: "mock", provider_event_id: null, payload_hash: "h1", signature_valid: false, processing_status: "rejected" }).select("*").single();
  const b = await supabaseMod.adminClient().from("communication_webhook_receipts")
    .insert({ provider: "mock", provider_event_id: null, payload_hash: "h2", signature_valid: false, processing_status: "rejected" }).select("*").single();
  assert(a.error === null && b.error === null, "distinct payload hashes with null event ids both insert");

  const c = await supabaseMod.adminClient().from("communication_webhook_receipts")
    .insert({ provider: "mock", provider_event_id: null, payload_hash: "h1", signature_valid: false, processing_status: "rejected" }).select("*").single();
  assert(c.error?.code === "23505", "the rejected payload-hash index still enforces uniqueness");

  // The same payload hash under a VALID signature belongs to the other index.
  const d = await supabaseMod.adminClient().from("communication_webhook_receipts")
    .insert({ provider: "mock", provider_event_id: "e1", payload_hash: "h1", signature_valid: true, processing_status: "verified" }).select("*").single();
  assert(d.error === null, "partial indexes are partitioned by signature_valid");
});

// ============================================================================
// HARDENING 1 — ATOMIC DISPATCH CLAIM
// ============================================================================
function seedDispatchableMessage(id = "msg-claim") {
  db.communication_messages = [{
    id, provider: "mock", status: "queued", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination_source: "recipient_reference",
    attempt_count: 0, max_attempts: 5, next_retry_at: null, scheduled_at: null,
    idempotency_key: `idem-${id}`, destination_hash: hashDestination(VENDOR_DEST),
    destination_masked: "+91******3211", template_key: "vendor_new_lead",
    variables: { name: "Keshav Studio" }, metadata: {}, created_at: new Date().toISOString(),
  }];
  return db.communication_messages[0];
}

check("H1-a. two workers racing the same message produce exactly one provider invocation", async () => {
  resetDb();
  seedDispatchableMessage("msg-claim");

  const providerA = new MockWhatsAppProvider();
  const providerB = new MockWhatsAppProvider();
  const workerA = new CommunicationService(providerA, resolverFor());
  const workerB = new CommunicationService(providerB, resolverFor());

  // Both workers read the row as `queued`. Worker B wins the compare-and-set and
  // completes its whole dispatch in the window before worker A's UPDATE filters.
  onNextUpdate("communication_messages", async () => {
    await workerB.dispatchPersistedMessage("msg-claim");
  });

  const a = await workerA.dispatchPersistedMessage("msg-claim");

  const invocations = providerA.getLastSentPayloads().length + providerB.getLastSentPayloads().length;
  assert(invocations === 1, `exactly one provider invocation required, got ${invocations}`);
  assert(providerA.getLastSentPayloads().length === 0, "the losing worker must not call the provider");
  assert(providerB.getLastSentPayloads().length === 1, "the winning worker sends exactly once");

  assert(a.ok === false, "the losing worker returns a safe failure, not a duplicate send");
  assert(a.code === "MESSAGE_ALREADY_CLAIMED", `expected MESSAGE_ALREADY_CLAIMED, got ${a.code}`);

  assert(db.communication_messages.length === 1, "no duplicate ledger row");
  assert(db.communication_messages[0].status === "accepted", "the winner's outcome stands");
  assert(db.communication_messages[0].attempt_count === 1, "exactly one attempt consumed");
});

check("H1-b. a stale read cannot claim a message another worker already moved", async () => {
  resetDb();
  const row = seedDispatchableMessage("msg-stale");
  const staleRead = { ...row };          // caller believes it is still `queued`
  row.status = "dispatching";            // the database says otherwise

  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const res = await s.dispatchMessage(staleRead, { providerTemplateName: "vendor_new_lead" });

  assert(res.ok === false && res.code === "MESSAGE_ALREADY_CLAIMED", `expected MESSAGE_ALREADY_CLAIMED, got ${res.code}`);
  assert(provider.getLastSentPayloads().length === 0, "provider must not be called");
  assert(db.communication_messages[0].status === "dispatching", "the other worker's claim is untouched");
});

check("H1-c. an already-dispatching message can never be re-claimed", async () => {
  resetDb();
  const row = seedDispatchableMessage("msg-inflight");
  row.status = "dispatching";

  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const res = await s.dispatchMessage({ ...row }, { providerTemplateName: "vendor_new_lead" });

  assert(res.ok === false && res.code === "MESSAGE_ALREADY_CLAIMED", `expected MESSAGE_ALREADY_CLAIMED, got ${res.code}`);
  assert(provider.getLastSentPayloads().length === 0, "provider must not be called");
});

check("H1-d. a failed pre-flight cannot clobber a row another worker has claimed", async () => {
  resetDb();
  seedDispatchableMessage("msg-clobber");

  const providerA = new MockWhatsAppProvider();
  const providerB = new MockWhatsAppProvider();
  // Worker A's resolver is empty, so its destination pre-flight fails and it tries
  // to mark the message `failed` — while worker B has already claimed it.
  const workerA = new CommunicationService(providerA, new StaticCommunicationRecipientResolver());
  const workerB = new CommunicationService(providerB, resolverFor());

  onNextUpdate("communication_messages", async () => {
    await workerB.dispatchPersistedMessage("msg-clobber");
  });

  const a = await workerA.dispatchPersistedMessage("msg-clobber");

  assert(a.ok === false, "worker A fails closed");
  assert(db.communication_messages[0].status === "accepted", "worker B's successful dispatch is not overwritten by A's failure");
  assert(db.communication_messages[0].failure_code === null, "no failure recorded over a successful send");
  assert(providerB.getLastSentPayloads().length === 1, "exactly one send");
});

check("H1-e. the claim is a compare-and-set on id AND expected status", () => {
  assert(!/updateMessageState/.test(SERVICE_SOURCE), "the non-atomic updateMessageState helper must be gone");
  const claim = SERVICE_SOURCE.match(/claimMessageForDispatch[\s\S]*?\.select\("\*"\);/);
  assert(claim, "claimMessageForDispatch must exist");
  assert(/\.eq\("id", message\.id\)/.test(claim[0]), "claim must constrain the message id");
  assert(/\.eq\("status", message\.status\)/.test(claim[0]), "claim must constrain the expected current status");
  assert(/claimed\.length !== 1/.test(SERVICE_SOURCE), "claim must verify exactly one row was claimed");
});

// ============================================================================
// HARDENING 2 — PROVIDER EXCEPTION RECOVERY
// ============================================================================
const NEVER_PERSIST = ["sk_live", "Bearer", "Authorization", "AKIA", "raw_payload", "otp", "123456", "9876543210"];

function assertNoStrandedDispatching() {
  for (const m of db.communication_messages) {
    assert(m.status !== "dispatching", `message ${m.id} was stranded in dispatching`);
  }
}

check("H2-a. authentication provider exception ends as failed", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor({ "client:ca-123": MOCK_DESTINATIONS.THROW_TRANSIENT }));
  const res = await s.send(authIntent());

  assert(res.ok === true, `the throw must be normalized, not propagated: ${res.ok ? "" : res.error}`);
  assert(res.data.status === "failed", `expected failed, got ${res.data.status}`);
  assert(res.data.status !== "retry_scheduled" && res.data.status !== "dead_letter", "auth never retries or dead-letters");
  assert(res.data.failure_code === "MOCK_TRANSIENT_TRANSPORT", `expected the adapter's code, got ${res.data.failure_code}`);
  assert(res.data.attempt_count === 1, "the attempt was consumed");
  assertNoStrandedDispatching();
});

check("H2-b. business transient provider exception schedules a retry", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor({ "vendor:vend-123": MOCK_DESTINATIONS.THROW_TRANSIENT }));
  const res = await s.send(businessIntent());

  assert(res.ok === true, "throw normalized");
  assert(res.data.status === "retry_scheduled", `expected retry_scheduled, got ${res.data.status}`);
  assert(res.data.next_retry_at !== null, "backoff scheduled");
  assert(res.data.failure_code === "MOCK_TRANSIENT_TRANSPORT", `got ${res.data.failure_code}`);
  assertNoStrandedDispatching();
});

check("H2-c. a raw transport-code exception (ECONNRESET) is treated as transient", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor({ "vendor:vend-123": MOCK_DESTINATIONS.THROW_TRANSPORT }));
  const res = await s.send(businessIntent());

  assert(res.ok === true, "throw normalized");
  assert(res.data.status === "retry_scheduled", `expected retry_scheduled, got ${res.data.status}`);
  assert(res.data.failure_code === "ECONNRESET", `expected ECONNRESET, got ${res.data.failure_code}`);
  assertNoStrandedDispatching();
});

check("H2-d. business exhausted transient exception ends as dead_letter", async () => {
  resetDb();
  db.communication_messages = [{
    id: "msg-throw-exhaust", provider: "mock", status: "retry_scheduled", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-throw", destination_source: "recipient_reference",
    attempt_count: 4, max_attempts: 5, scheduled_at: null,
    next_retry_at: new Date(Date.now() - 1000).toISOString(),
    idempotency_key: "idem-throw-exhaust", destination_hash: hashDestination(MOCK_DESTINATIONS.THROW_TRANSIENT),
    destination_masked: "+15******0003", template_key: "vendor_new_lead",
    variables: {}, metadata: {}, created_at: new Date().toISOString(),
  }];
  const resolver = resolverFor();
  resolver.set("vendor", "vend-throw", MOCK_DESTINATIONS.THROW_TRANSIENT);

  const s = new CommunicationService(new MockWhatsAppProvider(), resolver);
  const res = await s.dispatchPersistedMessage("msg-throw-exhaust");

  assert(res.ok === true, "throw normalized");
  assert(res.data.status === "dead_letter", `expected dead_letter, got ${res.data.status}`);
  assert(res.data.attempt_count === 5, "final attempt consumed");
  assert(res.data.next_retry_at === null, "no further retry");
  assertNoStrandedDispatching();
});

check("H2-e. an explicitly permanent provider exception ends as failed", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor({ "vendor:vend-123": MOCK_DESTINATIONS.THROW_PERMANENT }));
  const res = await s.send(businessIntent());

  assert(res.ok === true, "throw normalized");
  assert(res.data.status === "failed", `expected failed, got ${res.data.status}`);
  assert(res.data.next_retry_at === null, "permanent errors never retry");
  assert(res.data.failure_code === "MOCK_PERMANENT_REJECTION", `got ${res.data.failure_code}`);
  assertNoStrandedDispatching();
});

check("H2-f. an unclassified exception never leaks secrets and is never retried", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor({ "vendor:vend-123": MOCK_DESTINATIONS.THROW_LEAKY }));
  const res = await s.send(businessIntent());

  assert(res.ok === true, "throw normalized");
  assert(res.data.status === "failed", `an unprovable delivery must never be retried; got ${res.data.status}`);
  assert(res.data.failure_code === "PROVIDER_EXCEPTION", `got ${res.data.failure_code}`);

  const persisted = JSON.stringify(db.communication_messages[0]);
  for (const secret of NEVER_PERSIST) {
    assert(!persisted.includes(secret), `"${secret}" must never reach the ledger`);
  }
  assert(!persisted.includes(MOCK_LEAKY_EXCEPTION_MESSAGE), "the raw exception text must never be persisted");
  assert(/Exception text withheld/.test(res.data.failure_reason_sanitized), "the reason states the text was withheld");
  assertNoStrandedDispatching();
});

check("H2-g. no exception path ever strands a message in dispatching", async () => {
  for (const destination of [
    MOCK_DESTINATIONS.THROW_TRANSIENT, MOCK_DESTINATIONS.THROW_PERMANENT,
    MOCK_DESTINATIONS.THROW_TRANSPORT, MOCK_DESTINATIONS.THROW_LEAKY,
  ]) {
    resetDb();
    const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor({ "vendor:vend-123": destination }));
    await s.send(businessIntent());
    assert(db.communication_messages.length === 1, "row written");
    assertNoStrandedDispatching();
  }
});

check("H2-h. exception classification is deterministic and conservative", () => {
  const { classifyProviderException, ProviderDispatchError, transientProviderError, permanentProviderError } = ProviderErrorMod;

  assert(classifyProviderException(transientProviderError("X_CODE", "m")).retryable === true, "explicit transient");
  assert(classifyProviderException(permanentProviderError("Y_CODE", "m")).retryable === false, "explicit permanent");
  assert(classifyProviderException(transientProviderError("X_CODE", "m")).code === "X_CODE", "adapter code preserved");

  const econn = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  assert(classifyProviderException(econn).retryable === true, "known transport code is transient");
  assert(classifyProviderException(econn).code === "ECONNRESET", "transport code preserved");

  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert(classifyProviderException(abort).retryable === true, "AbortError is transient");

  // Anything we cannot prove failed in transit must NOT be retried.
  assert(classifyProviderException(new TypeError("x is not a function")).retryable === false, "adapter bug never retried");
  assert(classifyProviderException(new TypeError("x")).code === "PROVIDER_EXCEPTION", "unclassified code");
  assert(classifyProviderException("just a string").retryable === false, "non-Error throw handled");
  assert(classifyProviderException(null).code === "PROVIDER_EXCEPTION", "null throw handled");

  // A hostile code that is not identifier-shaped must not be persisted verbatim.
  const hostile = Object.assign(new Error("x"), { code: "Bearer sk_live_abc; DROP TABLE" });
  assert(classifyProviderException(hostile).code === "PROVIDER_EXCEPTION", "non-identifier code rejected");
  const hostileTyped = new ProviderDispatchError("Bearer sk_live_abc", "m", false);
  assert(classifyProviderException(hostileTyped).code === "PROVIDER_EXCEPTION", "non-identifier adapter code rejected");
});

check("H2-i. describeProviderException emits only allowlisted identifiers", () => {
  const { describeProviderException } = ProviderErrorMod;
  const leaky = new Error(MOCK_LEAKY_EXCEPTION_MESSAGE);
  const described = describeProviderException(leaky, "PROVIDER_EXCEPTION");
  for (const secret of NEVER_PERSIST) {
    assert(!described.includes(secret), `"${secret}" must not appear in the description`);
  }
  assert(described === "Provider adapter threw Error (PROVIDER_EXCEPTION). Exception text withheld: it may embed provider secrets.",
    `unexpected description: ${described}`);
});

check("H2-j. a failed outcome write releases the claim instead of stranding it", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());

  // The provider accepts, then the ledger write for `accepted` blows up.
  failNextUpdate("communication_messages", { code: "08006", message: "connection failure" }, (u) => u.status === "accepted");

  const res = await s.send(businessIntent());

  assert(res.ok === false, "the recording failure surfaces");
  assert(provider.getLastSentPayloads().length === 1, "the message really was sent");
  const row = db.communication_messages[0];
  assert(row.status === "failed", `claim must be released as failed, got ${row.status}`);
  assert(row.failure_code === "DISPATCH_RECORDING_FAILED", `got ${row.failure_code}`);
  assertNoStrandedDispatching();
});

// ============================================================================
// HARDENING 3 — FIRST-TIME CLIENT OTP BOOTSTRAP (EPHEMERAL AUTH DESTINATION)
// ============================================================================
check("H3-a. first-time client auth OTP succeeds with no client_accounts row", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  // An EMPTY resolver: there is no client_accounts row to resolve, by construction.
  const s = new CommunicationService(provider, new StaticCommunicationRecipientResolver());

  const res = await s.send(authIntent({
    recipient_id: null,
    destination_source: ephemeralAuthDestination("+91 98765 43210"),
  }));

  assert(res.ok === true, `first-time OTP must send: ${res.ok ? "" : res.code}`);
  assert(res.data.status === "accepted", `expected accepted, got ${res.data.status}`);
  assert(res.data.destination_source === "ephemeral_auth_destination", "source recorded for audit");
  assert(provider.getLastSentPayloads()[0].to === "+919876543210", "normalized E.164 reached the provider");
  assert(provider.getLastSentPayloads()[0].lane === "authentication", "auth lane used");
});

check("H3-b. the ephemeral plaintext destination is absent from the persisted message", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), new StaticCommunicationRecipientResolver());
  await s.send(authIntent({
    recipient_id: null,
    variables: { otp: "123456" },
    destination_source: ephemeralAuthDestination("+919876543210"),
  }));

  const persisted = db.communication_messages[0];
  assert(persisted.destination_hash === hashDestination("+919876543210"), "hash persisted");
  assert(persisted.destination_masked === "+91******3210", `mask persisted, got ${persisted.destination_masked}`);
  assert(!("destination" in persisted), "no plaintext destination column");

  const serialized = JSON.stringify(persisted);
  assert(!serialized.includes("919876543210"), "no plaintext destination anywhere in the row");
  assert(!serialized.includes("+91 98765 43210"), "no formatted plaintext either");
  assert(!serialized.includes("123456"), "no OTP value");
  assert(Object.keys(persisted.variables).length === 0, "auth lane persists no variables");
});

check("H3-c. a business intent with an ephemeral destination is rejected", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());

  const res = await s.send(businessIntent({ destination_source: ephemeralAuthDestination(VENDOR_DEST) }));

  assert(res.ok === false, "business must never use an arbitrary direct destination");
  assert(res.code === "EPHEMERAL_DESTINATION_AUTH_LANE_ONLY", `got ${res.code}`);
  assert(db.communication_messages.length === 0, "no row created");
  assert(provider.getLastSentPayloads().length === 0, "provider never called");
});

check("H3-d. a scheduled auth intent with an ephemeral destination is rejected", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), new StaticCommunicationRecipientResolver());

  for (const scheduled_at of [
    new Date(Date.now() + 60_000).toISOString(),
    new Date(Date.now() - 60_000).toISOString(),   // even a past timestamp is refused
  ]) {
    const res = await s.send(authIntent({
      recipient_id: null, scheduled_at,
      destination_source: ephemeralAuthDestination("+919876543210"),
    }));
    assert(res.ok === false, "an ephemeral destination is never schedulable");
    assert(res.code === "EPHEMERAL_DESTINATION_NOT_SCHEDULABLE", `got ${res.code}`);
  }
  assert(db.communication_messages.length === 0, "no row created");
});

check("H3-e. an ephemeral message can never be re-dispatched from stored state", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());

  // The authentication lane guard fires first.
  db.communication_messages = [{
    id: "msg-eph-auth", provider: "mock", status: "queued", lane: "authentication",
    recipient_type: "client", recipient_id: null, destination_source: "ephemeral_auth_destination",
    attempt_count: 0, max_attempts: 1, destination_hash: hashDestination(CLIENT_DEST),
    variables: {}, template_key: "client_login_otp", created_at: new Date().toISOString(),
  }];
  const auth = await s.dispatchPersistedMessage("msg-eph-auth");
  assert(auth.ok === false && auth.code === "AUTH_LANE_NOT_REDISPATCHABLE", `got ${auth.code}`);

  // Defence in depth: even if a row somehow escaped the DB check constraint and
  // claimed a business lane, the destination source alone blocks re-dispatch.
  db.communication_messages = [{
    id: "msg-eph-biz", provider: "mock", status: "retry_scheduled", lane: "business",
    recipient_type: "client", recipient_id: null, destination_source: "ephemeral_auth_destination",
    attempt_count: 1, max_attempts: 5, next_retry_at: new Date(Date.now() - 1000).toISOString(),
    destination_hash: hashDestination(CLIENT_DEST), variables: {}, template_key: "vendor_new_lead",
    created_at: new Date().toISOString(),
  }];
  const biz = await s.dispatchPersistedMessage("msg-eph-biz");
  assert(biz.ok === false && biz.code === "EPHEMERAL_DESTINATION_NOT_REDISPATCHABLE", `got ${biz.code}`);
  assert(provider.getLastSentPayloads().length === 0, "provider never called");
});

check("H3-f. equivalent formatted international numbers produce the same stored hash", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), new StaticCommunicationRecipientResolver());
  const formats = ["+919876543210", "+91 98765 43210", "+91-98765-43210", "0091 98765 43210", "+91 (98765) 43210"];

  for (const [i, destination] of formats.entries()) {
    const res = await s.send(authIntent({
      recipient_id: null, idempotency_key: `idem-eph-${i}`,
      destination_source: ephemeralAuthDestination(destination),
    }));
    assert(res.ok === true, `${destination} must send: ${res.ok ? "" : res.code}`);
  }

  const hashes = new Set(db.communication_messages.map((m) => m.destination_hash));
  const masks = new Set(db.communication_messages.map((m) => m.destination_masked));
  assert(db.communication_messages.length === formats.length, "one row per send");
  assert(hashes.size === 1, `all equivalent formats must store one hash, got ${hashes.size}`);
  assert(masks.size === 1, "all equivalent formats must store one mask");
  assert([...hashes][0] === hashDestination("+919876543210"), "hash is of the canonical E.164 value");
});

check("H3-g. an invalid ephemeral destination is rejected before any row is written", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, new StaticCommunicationRecipientResolver());

  for (const [destination, code] of [
    ["9876543210", "PHONE_MISSING_COUNTRY_CODE"],
    ["", "PHONE_EMPTY"],
    ["+91abc", "PHONE_INVALID_CHARACTERS"],
    ["+0919876543210", "PHONE_INVALID_COUNTRY_CODE"],
  ]) {
    const res = await s.send(authIntent({
      recipient_id: null, idempotency_key: `idem-bad-${destination}`,
      destination_source: ephemeralAuthDestination(destination),
    }));
    assert(res.ok === false, `"${destination}" must be rejected`);
    assert(res.code === code, `"${destination}": expected ${code}, got ${res.code}`);
  }
  assert(db.communication_messages.length === 0, "no rows created");
  assert(provider.getLastSentPayloads().length === 0, "provider never called");
});

check("H3-h. resolved-recipient delivery is unchanged by the ephemeral path", async () => {
  resetDb();
  const provider = new MockWhatsAppProvider();
  const s = new CommunicationService(provider, resolverFor());
  const res = await s.send(businessIntent());

  assert(res.ok === true, "the default path still resolves");
  assert(res.data.destination_source === "recipient_reference", "default source recorded");
  assert(provider.getLastSentPayloads()[0].to === VENDOR_DEST, "resolver still drives business delivery");
});

check("H3-i. migration fences the ephemeral source in the schema", () => {
  assert(normalizedSql.includes("destination_source text not null default 'recipient_reference'"),
    "destination_source column defaults to the resolver path");
  assert(normalizedSql.includes("check (destination_source in ('recipient_reference', 'ephemeral_auth_destination'))"),
    "destination_source vocabulary constrained");
  assert(normalizedSql.includes("check (destination_source = 'recipient_reference' or lane = 'authentication')"),
    "ephemeral is fenced to the authentication lane at the database level");
  assert(normalizedSql.includes("check (destination_source = 'recipient_reference' or scheduled_at is null)"),
    "ephemeral can never be scheduled at the database level");
  assert(!/\bdestination text\b/.test(normalizedSql), "still no plaintext destination column");
});

// ============================================================================
// INTENTS & SECURITY
// ============================================================================
check("I1. valid auth intent persists no OTP", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await s.send(authIntent({ variables: { otp: "123456", text: "OTP is 123456" }, metadata: { client_ip: "127.0.0.1" } }));

  assert(res.ok === true, `should send successfully: ${res.ok ? "" : res.error}`);
  assert(res.data.status === "accepted", "state accepted");

  const persisted = db.communication_messages[0];
  assert(persisted, "message should be persisted");
  assert(persisted.destination_hash === hashDestination(CLIENT_DEST), "hash mismatch");
  assert(persisted.destination_masked === "+91******3210", "mask mismatch");
  assert(Object.keys(persisted.variables).length === 0, "authentication lane persists NO variables");
  assert(!JSON.stringify(persisted).includes("123456"), "no OTP value anywhere in the ledger row");
  assert(persisted.correlation_id === "corr-11", "correlation id retained");
  assert(persisted.max_attempts === 1, "auth lane single-shot");
});

check("I2. valid business intent with policy reference preserved", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await s.send(businessIntent({
    entity_type: "lead", entity_id: "lead-999", correlation_id: "corr-22",
    idempotency_key: "idem-biz-1", priority: "high", policy_decision_id: "policy-dec-44",
    metadata: { trigger: "assignment" },
  }));

  assert(res.ok === true, `send business intent successful: ${res.ok ? "" : res.error}`);
  const persisted = db.communication_messages[0];
  assert(persisted.policy_decision_id === "policy-dec-44", "policy decision id preserved");
  assert(persisted.correlation_id === "corr-22", "correlation id preserved");
  assert(persisted.entity_type === "lead" && persisted.entity_id === "lead-999", "entity binding preserved");
  assert(persisted.variables.name === "Keshav Studio", "business variables preserved");
});

check("I3. missing idempotency key or template rejected", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const noKey = await s.send(businessIntent({ idempotency_key: "" }));
  assert(noKey.ok === false && noKey.code === "VALIDATION", `expected VALIDATION, got ${noKey.code}`);
  const noTemplate = await s.send(businessIntent({ template_key: "" }));
  assert(noTemplate.ok === false && noTemplate.code === "VALIDATION", `expected VALIDATION, got ${noTemplate.code}`);
});

check("I4. secrets stripped from persisted metadata and variables", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  await s.send(businessIntent({
    idempotency_key: "idem-sec-1",
    variables: { name: "Keshav", access_token: "secret-123" },
    metadata: { key: "val", access_token: "secret-123", raw_payload: { nested_secret: "123" } },
  }));

  const persisted = db.communication_messages[0];
  assert(!("access_token" in persisted.metadata), "access_token stripped from metadata");
  assert(!("raw_payload" in persisted.metadata), "raw_payload stripped from metadata");
  assert(persisted.variables.access_token === "[REDACTED]", "secret variable redacted");
  assert(persisted.variables.name === "Keshav", "safe variable preserved");
  assert(!JSON.stringify(persisted).includes("secret-123"), "no secret value persisted");
});

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================
check("TPL1. missing template rejected", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await s.send(businessIntent({ template_key: "missing_template" }));
  assert(res.ok === false, "should reject missing template");
  assert(res.code === "TEMPLATE_NOT_FOUND_OR_INACTIVE", `got ${res.code}`);
});

check("TPL2. draft, disabled and inactive templates rejected", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  for (const [template_key, expected] of [
    ["draft_template", "TEMPLATE_NOT_READY"],
    ["disabled_template", "TEMPLATE_NOT_READY"],
    ["inactive_template", "TEMPLATE_NOT_FOUND_OR_INACTIVE"],
  ]) {
    const res = await s.send(businessIntent({ template_key }));
    assert(res.ok === false, `${template_key} rejected`);
    assert(res.code === expected, `${template_key}: expected ${expected}, got ${res.code}`);
  }
});

check("TPL3. lane mismatch rejected", async () => {
  resetDb();
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const res = await s.send(businessIntent({ template_key: "client_login_otp" }));
  assert(res.ok === false && res.code === "TEMPLATE_LANE_MISMATCH", `got ${res.code}`);
});

// ============================================================================
// ADMIN READ MODELS
// ============================================================================
check("ADM1. overview counts every lifecycle state", async () => {
  resetDb();
  db.communication_messages = [
    { status: "queued" }, { status: "accepted" }, { status: "delivered" }, { status: "read" },
    { status: "failed" }, { status: "dead_letter" }, { status: "retry_scheduled" }, { status: "cancelled" },
  ];
  const res = await AdminServiceMod.getCommunicationOverview();
  assert(res.ok === true, "query overview ok");
  assert(res.data.totalMessages === 8, "total counts correct");
  assert(res.data.queuedCount === 1 && res.data.readCount === 1, "queued/read counted");
  assert(res.data.deadLetterCount === 1 && res.data.failedCount === 1, "failure states counted");
  assert(res.data.retryScheduledCount === 1, "retry scheduled counted");
  assert(res.data.cancelledCount === 1, "cancelled counted");
});

check("ADM2. provider health reflects the active adapter", async () => {
  const res = await AdminServiceMod.getProviderHealthSummary();
  assert(res.ok === true, "query provider health ok");
  assert(res.data.provider === CommServiceMod.getActiveWhatsAppProvider().providerKey, "health provider matches providerKey");
  assert(res.data.status === "healthy", "healthy");
});

check("ADM3. template readiness summary", async () => {
  resetDb();
  const res = await AdminServiceMod.getTemplateReadinessSummary();
  assert(res.ok === true, "tpl summary ok");
  assert(res.data.totalTemplates > 0, "has templates");
  assert(res.data.readinessBreakdown.mock_ready > 0, "has mock_ready templates");
  assert(res.data.readinessBreakdown.draft > 0, "has draft templates");
});

check("ADM4. automation readiness is reported separately from operational enablement", async () => {
  resetDb();
  const res = await AdminServiceMod.getAutomationReadinessSummary();
  assert(res.ok === true, "readiness summary ok");
  assert(res.data.totalAutomations === 5, "all catalog rows returned");
  assert(res.data.readinessBreakdown.wiring_pending === 5, "Phase 5B seeds everything as wiring_pending");
  assert(res.data.readinessBreakdown.active === 0, "nothing is active");
  assert(res.data.operationallyEnabledCount === 0, "nothing is operationally enabled");
  assert(res.data.dispatchableCount === 0, "nothing is dispatchable");

  assert(TypesMod.isAutomationDispatchable({ readiness_status: "active", is_operationally_enabled: true }) === true, "active + enabled is dispatchable");
  assert(TypesMod.isAutomationDispatchable({ readiness_status: "wiring_pending", is_operationally_enabled: true }) === false, "enablement alone is never enough");
  assert(TypesMod.isAutomationDispatchable({ readiness_status: "active", is_operationally_enabled: false }) === false, "readiness alone is never enough");
});

check("ADM5. webhook processing state is observable", async () => {
  resetDb();
  db.communication_messages = [{ id: "m-obs", provider: "mock", provider_message_id: "p-obs", status: "accepted", lane: "business", attempt_count: 1, max_attempts: 5, created_at: new Date().toISOString() }];
  const s = new CommunicationService(new MockWhatsAppProvider(), resolverFor());
  const payload = { event_id: "evt-obs", message_id: "p-obs", status: "delivered", timestamp: "2026-07-08T10:00:00Z" };

  await postWebhook(s, payload);
  await postWebhook(s, payload);
  await postWebhook(s, { event_id: "evt-forged", message_id: "p-obs", status: "read", timestamp: "2026-07-08T11:00:00Z" }, { signature: "sha256=nope" });

  const res = await AdminServiceMod.getWebhookProcessingSummary();
  assert(res.ok === true, "summary ok");
  assert(res.data.totalReceipts === 2, `two receipt rows, got ${res.data.totalReceipts}`);
  assert(res.data.processingBreakdown.processed === 1, "one processed");
  assert(res.data.processingBreakdown.rejected === 1, "one rejected");
  assert(res.data.invalidSignatureCount === 1, "invalid signature counted");
  assert(res.data.duplicateRedeliveryCount === 1, "redelivery counted without a duplicate row");
});

check("ADM6. queued, retry-scheduled, failed and dead-letter surfaces exist", async () => {
  resetDb();
  db.communication_messages = [
    { id: "q1", status: "queued", created_at: "2026-07-08T00:00:00Z" },
    { id: "r1", status: "retry_scheduled", next_retry_at: "2026-07-08T01:00:00Z", created_at: "2026-07-08T00:00:00Z" },
    { id: "f1", status: "failed", created_at: "2026-07-08T00:00:00Z" },
    { id: "d1", status: "dead_letter", created_at: "2026-07-08T00:00:00Z" },
  ];
  const queued = await AdminServiceMod.listQueuedCommunicationMessages();
  const retry = await AdminServiceMod.listRetryScheduledMessages();
  const failed = await AdminServiceMod.listFailedCommunicationMessages();
  const dead = await AdminServiceMod.listDeadLetterMessages();

  assert(queued.ok && queued.data.length === 1 && queued.data[0].id === "q1", "queued surface");
  assert(retry.ok && retry.data.length === 1 && retry.data[0].id === "r1", "retry surface");
  assert(failed.ok && failed.data.length === 2, "failed surface includes dead letters");
  assert(dead.ok && dead.data.length === 1 && dead.data[0].id === "d1", "dead letter surface");
});

// ============================================================================
// STATIC SQL MIGRATION ANALYSIS
// ============================================================================
check("SQL1. communication templates table schema", () => {
  assert(normalizedSql.includes("create table if not exists public.communication_templates"), "communication_templates table check");
  assert(normalizedSql.includes("template_key text not null unique"), "template_key uniqueness check");
  assert(normalizedSql.includes("channel text not null check (channel = 'whatsapp')"), "channel check constraint");
});

check("SQL2. communication messages table schema", () => {
  assert(normalizedSql.includes("create table if not exists public.communication_messages"), "communication_messages table check");
  assert(normalizedSql.includes("idempotency_key text not null unique"), "idempotency_key uniqueness check");
  assert(normalizedSql.includes("destination_hash text not null"), "destination_hash column check");
  assert(normalizedSql.includes("destination_masked text not null"), "destination_masked column check");
  assert(!normalizedSql.includes("otp text") && !normalizedSql.includes("otp_code text"), "security: no plaintext OTP column");
  assert(!/\bdestination text\b/.test(normalizedSql), "security: no plaintext destination column");
  // FIX 2: the schema must not bake in a provider name.
  assert(normalizedSql.includes("provider text not null,"), "provider is explicit, not defaulted");
  assert(!normalizedSql.includes("provider text not null default 'mock'"), "provider must have no 'mock' default");
});

check("SQL3. RLS configurations present", () => {
  for (const table of [
    "communication_templates", "communication_messages", "communication_delivery_events",
    "communication_webhook_receipts", "communication_automation_catalog",
  ]) {
    assert(normalizedSql.includes(`alter table public.${table} enable row level security;`), `RLS enabled ${table}`);
    assert(normalizedSql.includes(`revoke all on public.${table} from anon;`), `revoke anon ${table}`);
    assert(normalizedSql.includes(`revoke all on public.${table} from authenticated;`), `revoke authenticated ${table}`);
  }
});

check("SQL4. least-privilege grants (no delete anywhere)", () => {
  assert(normalizedSql.includes("grant select, insert, update on public.communication_messages to service_role;"), "messages: no delete grant");
  assert(normalizedSql.includes("grant select, insert, update on public.communication_webhook_receipts to service_role;"), "receipts: no delete grant");
  assert(normalizedSql.includes("grant select, insert, update on public.communication_automation_catalog to service_role;"), "catalog: no delete grant");
  assert(!/delete on public\.communication_/.test(normalizedSql), "no delete grant on any communication table");
});

check("SQL5. seeded logical automation keys exist", () => {
  const keys = [
    "client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset",
    "lead_received", "vendor_new_lead", "clarification_request",
    "clarification_reminder", "lead_assignment_alert", "low_credit_warning",
    "recharge_reminder", "client_nurture_followup", "dormant_requirement_reactivation",
    "admin_policy_block_alert", "admin_assignment_failure_alert",
    "admin_provider_outage_alert", "admin_automation_failure_alert",
  ];
  for (const k of keys) assert(normalizedSql.includes(k), `Seeded key ${k} must exist in SQL`);
});

// ============================================================================
// FIX 11 — DELIVERY EVENT IMMUTABILITY (STATIC SQL)
// ============================================================================
check("FIX11-a. delivery-event SQL permissions are append-only", () => {
  assert(normalizedSql.includes("grant select, insert on public.communication_delivery_events to service_role;"),
    "delivery events must grant only SELECT + INSERT");
  assert(!/update on public\.communication_delivery_events/.test(normalizedSql), "no update grant on delivery events");
  assert(!/delete on public\.communication_delivery_events/.test(normalizedSql), "no delete grant on delivery events");
});

check("FIX11-b. delivery events use ON DELETE RESTRICT, never CASCADE", () => {
  assert(normalizedSql.includes("references public.communication_messages(id) on delete restrict"),
    "delivery event FK must be ON DELETE RESTRICT");
  assert(!normalizedSql.includes("on delete cascade"), "no cascade anywhere in the Phase 5B migration");
});

check("FIX11-c. webhook receipt de-duplication indexes are partitioned by signature validity", () => {
  assert(normalizedSql.includes("create unique index if not exists uq_comm_webhook_receipt_provider_event"), "provider event unique index");
  assert(normalizedSql.includes("create unique index if not exists uq_comm_webhook_receipt_payload_verified"), "verified payload unique index");
  assert(normalizedSql.includes("create unique index if not exists uq_comm_webhook_receipt_payload_rejected"), "rejected payload unique index");
  assert(normalizedSql.includes("duplicate_count integer not null default 0"), "duplicate_count column for monitoring");
  assert(normalizedSql.includes("last_duplicate_at timestamptz"), "last_duplicate_at column");
});

// ============================================================================
// FIX 10 — AUTOMATION READINESS VS OPERATIONAL ENABLEMENT (STATIC SQL)
// ============================================================================
check("FIX10-a. automation catalog defaults are readiness-only and not falsely active", () => {
  assert(normalizedSql.includes("is_operationally_enabled boolean not null default false"),
    "operational enablement must default to false");
  assert(!normalizedSql.includes("is_operationally_enabled boolean not null default true"), "must not default to true");
  assert(normalizedSql.includes("readiness_status text not null default 'wiring_pending'"),
    "automation readiness defaults to wiring_pending");
  assert(!normalizedSql.includes("operational_status"), "the ambiguous operational_status column is gone");
  assert(normalizedSql.includes("check (is_operationally_enabled = false or readiness_status = 'active')"),
    "enabling requires readiness = 'active'");

  const readinessValues = ["foundation_ready", "wiring_pending", "mock_ready", "provider_mapping_required", "provider_ready", "active"];
  for (const v of readinessValues) {
    assert(normalizedSql.includes(`'${v}'`), `readiness vocabulary must include ${v}`);
  }
});

check("FIX10-b. automation seed never presents an unwired workflow as live", () => {
  const seed = sql.match(/insert into public\.communication_automation_catalog[\s\S]*?on conflict/i);
  assert(seed, "automation seed block found");
  const block = seed[0];
  assert(!/is_operationally_enabled/i.test(block), "seed must not set is_operationally_enabled");
  assert(!/'active'/.test(block), "no automation may be seeded as active");
  const wiringPending = block.match(/'wiring_pending'/g) ?? [];
  assert(wiringPending.length === 16, `all 16 automations seed as wiring_pending, got ${wiringPending.length}`);
});

// ============================================================================
// EXECUTE CHECKS
// ============================================================================
async function runAll() {
  let passed = 0;
  let failed = 0;
  console.log(`Running Phase 5B Unified Communication Core checks...\n`);

  for (const c of checks) {
    try {
      await c.fn();
      console.log(`PASS ${c.name}`);
      passed++;
    } catch (e) {
      console.log(`FAIL ${c.name}`);
      console.error(e);
      failed++;
    }
  }

  rmSync(outDir, { recursive: true, force: true });

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
