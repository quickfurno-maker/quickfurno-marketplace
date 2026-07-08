import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5B — QuickFurno Unified Communication Core harness.
 * Exercises templates, intents, security, idempotency, state transitions,
 * retries/dead-lettering, webhook processing, mock provider adapters, and admin read models.
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
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/mockWhatsAppProvider.ts",
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
// Set up Mock Database and Supabase Client Interceptor
// ----------------------------------------------------------------------------
const db = {
  communication_templates: [
    { template_key: "client_login_otp", channel: "whatsapp", category: "authentication", description: "OTP for client", version: "1.0", readiness_status: "mock_ready", is_active: true },
    { template_key: "vendor_whatsapp_verify", channel: "whatsapp", category: "authentication", description: "OTP for vendor verify", version: "1.0", readiness_status: "mock_ready", is_active: true },
    { template_key: "vendor_password_reset", channel: "whatsapp", category: "authentication", description: "OTP for reset", version: "1.0", readiness_status: "mock_ready", is_active: true },
    { template_key: "lead_received", channel: "whatsapp", category: "business", description: "Lead confirmation", version: "1.0", readiness_status: "mock_ready", is_active: true },
    { template_key: "vendor_new_lead", channel: "whatsapp", category: "business", description: "New lead", version: "1.0", readiness_status: "mock_ready", is_active: true },
    { template_key: "admin_policy_block_alert", channel: "whatsapp", category: "business", description: "Policy block alert", version: "1.0", readiness_status: "mock_ready", is_active: true },
    { template_key: "draft_template", channel: "whatsapp", category: "business", description: "Draft", version: "1.0", readiness_status: "draft", is_active: true },
    { template_key: "disabled_template", channel: "whatsapp", category: "business", description: "Disabled", version: "1.0", readiness_status: "disabled", is_active: true },
    { template_key: "inactive_template", channel: "whatsapp", category: "business", description: "Inactive", version: "1.0", readiness_status: "mock_ready", is_active: false },
  ],
  communication_messages: [],
  communication_delivery_events: [],
  communication_webhook_receipts: [],
  communication_automation_catalog: [
    { automation_key: "client_login_otp", category: "otp", lane: "authentication", channel: "whatsapp", is_operationally_enabled: true, template_key: "client_login_otp" },
    { automation_key: "vendor_whatsapp_verify", category: "otp", lane: "authentication", channel: "whatsapp", is_operationally_enabled: true, template_key: "vendor_whatsapp_verify" },
    { automation_key: "vendor_password_reset", category: "otp", lane: "authentication", channel: "whatsapp", is_operationally_enabled: true, template_key: "vendor_password_reset" },
    { automation_key: "lead_received", category: "notification", lane: "business", channel: "whatsapp", is_operationally_enabled: true, template_key: "lead_received" },
    { automation_key: "vendor_new_lead", category: "notification", lane: "business", channel: "whatsapp", is_operationally_enabled: true, template_key: "vendor_new_lead" },
  ],
};

// Simple Mock Query Builder matching Supabase Client API
class MockQueryBuilder {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.limitVal = null;
    this.action = "select"; // "select" | "insert" | "update"
    this.actionData = null;
  }

  select(fields) {
    return this;
  }

  order(col, options) {
    return this;
  }

  limit(n) {
    this.limitVal = n;
    return this;
  }

  eq(col, val) {
    this.filters.push((item) => item[col] === val);
    return this;
  }

  in(col, vals) {
    this.filters.push((item) => vals.includes(item[col]));
    return this;
  }

  or(exp) {
    const parts = exp.split(",");
    this.filters.push((item) => {
      return parts.some((p) => {
        const [field, op, val] = p.split(".");
        if (op === "eq") return String(item[field]) === String(val);
        return false;
      });
    });
    return this;
  }

  insert(row) {
    this.action = "insert";
    this.actionData = row;
    return this;
  }

  update(updates) {
    this.action = "update";
    this.actionData = updates;
    return this;
  }

  maybeSingle() {
    return this.single();
  }

  async single() {
    const { data, error } = await this.execute();
    const result = Array.isArray(data) ? data[0] : data;
    return { data: result || null, error };
  }

  async execute() {
    let list = db[this.table] || [];

    if (this.action === "insert") {
      const records = Array.isArray(this.actionData) ? this.actionData : [this.actionData];
      const inserted = [];
      for (const r of records) {
        const dbRow = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r };
        db[this.table].push(dbRow);
        inserted.push(dbRow);
      }
      return { data: Array.isArray(this.actionData) ? inserted : inserted[0], error: null };
    }

    if (this.action === "update") {
      for (const f of this.filters) {
        list = list.filter(f);
      }
      for (const item of list) {
        Object.assign(item, this.actionData, { updated_at: new Date().toISOString() });
      }
      return { data: list, error: null };
    }

    // Default select
    for (const f of this.filters) {
      list = list.filter(f);
    }
    if (this.limitVal !== null) {
      list = list.slice(0, this.limitVal);
    }
    return { data: list, error: null };
  }

  async then(resolve) {
    const { data, error } = await this.execute();
    return resolve({ data, count: Array.isArray(data) ? data.length : 0, error });
  }
}

// Intercept modules
const requireFromBuild = createRequire(`${outDir}/`);

// Mock the lib/supabase.ts client exporter
const supabaseMod = requireFromBuild("./lib/supabase.js");
supabaseMod.adminClient = () => {
  return {
    from: (table) => new MockQueryBuilder(table),
  };
};

const CommServiceMod = requireFromBuild("./services/communicationService.js");
const AdminServiceMod = requireFromBuild("./services/communicationAdminService.js");
const MockProviderMod = requireFromBuild("./lib/communication/providers/mockWhatsAppProvider.js");

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const MIGRATION = "supabase/migrations/20260708000170_unified_communication_core.sql";
const sql = readFileSync(MIGRATION, "utf8");
const normalizedSql = sql.toLowerCase().replace(/\s+/g, " ");

// ============================================================================
// PROVIDER CONTRACT & MOCK SIMULATIONS
// ============================================================================
check("P1. mock provider success", async () => {
  const p = new MockProviderMod.MockWhatsAppProvider();
  const res = await p.sendTemplateMessage("+919999999999", "lead_received", { name: "Keshav" });
  assert(res.accepted === true, "should accept template message");
  assert(res.providerMessageId !== null, "message ID should be generated");
  assert(res.provider === "mock", "provider name mismatch");
  assert(res.normalizedStatus === "accepted", "should return accepted status");
});

check("P2. mock provider retryable failure", async () => {
  const p = new MockProviderMod.MockWhatsAppProvider();
  const res = await p.sendTemplateMessage("+919999fail-retry99", "lead_received", { name: "Keshav" });
  assert(res.accepted === false, "should reject");
  assert(res.retryable === true, "should be retryable");
  assert(res.errorCode === "RATE_LIMIT_EXCEEDED", "rate limit error code");
});

check("P3. mock provider permanent failure", async () => {
  const p = new MockProviderMod.MockWhatsAppProvider();
  const res = await p.sendTemplateMessage("+919999fail-permanent99", "lead_received", { name: "Keshav" });
  assert(res.accepted === false, "should reject");
  assert(res.retryable === false, "should be permanent");
  assert(res.errorCode === "INVALID_DESTINATION_NUMBER", "invalid number error");
});

check("P4. provider health check", async () => {
  const p = new MockProviderMod.MockWhatsAppProvider();
  const res = await p.healthCheck();
  assert(res.provider === "mock", "provider name incorrect");
  assert(res.status === "healthy", "should be healthy");
  assert(res.reachable === true, "reachable true");
  assert(res.configured === true, "configured true");
});

check("P5. webhook signature mock verification", () => {
  const p = new MockProviderMod.MockWhatsAppProvider();
  assert(p.verifyWebhookSignature("{}", "mock-valid-signature", "secret"), "should verify signature");
  assert(!p.verifyWebhookSignature("{}", "invalid-signature", "secret"), "should reject invalid signature");
});

check("P6. webhook payload normalization", () => {
  const p = new MockProviderMod.MockWhatsAppProvider();
  const events = p.normalizeWebhook({
    event_id: "evt-111",
    message_id: "msg-222",
    status: "delivered",
    timestamp: "2026-07-08T12:00:00Z",
    metadata: { key: "value" }
  });
  assert(events.length === 1, "normalize exactly 1 event");
  assert(events[0].providerEventId === "evt-111", "eventId mismatch");
  assert(events[0].providerMessageId === "msg-222", "messageId mismatch");
  assert(events[0].normalizedEventType === "delivered", "eventType mismatch");
  assert(events[0].occurredAt === "2026-07-08T12:00:00Z", "timestamp mismatch");
});

// ============================================================================
// INTENTS & SECURITY
// ============================================================================
check("I1. valid auth intent", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_messages = [];
  const intent = {
    type: "client_login_otp",
    lane: "authentication",
    channel: "whatsapp",
    recipient_type: "client",
    recipient_id: "ca-123",
    destination: "+919876543210",
    template_key: "client_login_otp",
    variables: { otp: "123456", text: "OTP is 123456" },
    entity_type: null,
    entity_id: null,
    correlation_id: "corr-11",
    idempotency_key: "idem-auth-1",
    priority: "critical",
    scheduled_at: null,
    policy_decision_id: null,
    metadata: { client_ip: "127.0.0.1" },
  };

  const res = await s.send(intent);
  assert(res.ok === true, "should send successfully: " + (res.ok ? "" : res.error));
  assert(res.data.status === "accepted", "state accepted");
  
  // Verify in mock DB
  const persisted = db.communication_messages[0];
  assert(persisted, "message should be persisted");
  assert(persisted.destination_hash === CommServiceMod.hashDestination("+919876543210"), "hash mismatch");
  assert(persisted.destination_masked === "+91******3210", "mask mismatch");

  // Authentication lane variable rules:
  // Persistent variable columns must strip plaintext secrets (OTP value)
  assert(!persisted.variables.otp || persisted.variables.otp === "[REDACTED]", "persisted variables must not contain plain OTP");
  assert(!persisted.variables.text || persisted.variables.text === "[REDACTED]", "persisted variables must redact secrets");
});

check("I2. valid business intent with policy reference preserved", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_messages = [];
  const intent = {
    type: "vendor_new_lead",
    lane: "business",
    channel: "whatsapp",
    recipient_type: "vendor",
    recipient_id: "vend-123",
    destination: "+918876543211",
    template_key: "vendor_new_lead",
    variables: { name: "Keshav Studio", budget: "₹5L" },
    entity_type: "lead",
    entity_id: "lead-999",
    correlation_id: "corr-22",
    idempotency_key: "idem-biz-1",
    priority: "high",
    scheduled_at: null,
    policy_decision_id: "policy-dec-44",
    metadata: { trigger: "assignment" },
  };

  const res = await s.send(intent);
  assert(res.ok === true, "send business intent successful: " + (res.ok ? "" : res.error));
  const persisted = db.communication_messages[0];
  assert(persisted.policy_decision_id === "policy-dec-44", "policy decision id preserved");
  assert(persisted.correlation_id === "corr-22", "correlation id preserved");
  assert(persisted.entity_type === "lead" && persisted.entity_id === "lead-999", "entity binding preserved");
  
  // Business lane variables can be logged (since no OTP/auth secret exists)
  assert(persisted.variables.name === "Keshav Studio", "business variables preserved");
});

check("I3. invalid recipient destination check", async () => {
  const s = new CommServiceMod.CommunicationService();
  const res = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "",
    template_key: "vendor_new_lead", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-fail-1", priority: "low",
    scheduled_at: null, policy_decision_id: null, metadata: {}
  });
  assert(res.ok === false, "empty destination rejected");
});

check("I4. secrets stripped from persisted metadata", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_messages = [];
  const res = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+919999999999",
    template_key: "vendor_new_lead", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-sec-1", priority: "low",
    scheduled_at: null, policy_decision_id: null,
    metadata: { key: "val", access_token: "secret-123", raw_payload: { nested_secret: "123" } }
  });
  
  const persisted = db.communication_messages[0];
  assert(!("access_token" in persisted.metadata), "access_token stripped");
  assert(!("nested_secret" in (persisted.metadata.raw_payload || {})), "nested secret stripped");
});

// ============================================================================
// IDEMPOTENCY
// ============================================================================
check("ID1. duplicate idempotency key returns existing message", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_messages = [];

  const intent1 = {
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+919876543211",
    template_key: "vendor_new_lead", variables: { msg: "hi" },
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-key-dup", priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
  };

  const res1 = await s.send(intent1);
  const countBefore = db.communication_messages.length;
  
  const res2 = await s.send(intent1);
  const countAfter = db.communication_messages.length;

  assert(res1.ok === true && res2.ok === true, "both succeed");
  assert(res1.data.id === res2.data.id, "returns exact same message ID");
  assert(countBefore === countAfter, "no duplicate row created");
});

// ============================================================================
// STATUS STATE MACHINE TRANSITIONS
// ============================================================================
check("T1. allowed transitions verify", () => {
  assert(CommServiceMod.isValidTransition("queued", "dispatching"), "queued -> dispatching");
  assert(CommServiceMod.isValidTransition("dispatching", "accepted"), "dispatching -> accepted");
  assert(CommServiceMod.isValidTransition("accepted", "sent"), "accepted -> sent");
  assert(CommServiceMod.isValidTransition("sent", "delivered"), "sent -> delivered");
  assert(CommServiceMod.isValidTransition("delivered", "read"), "delivered -> read");
  
  // failed path
  assert(CommServiceMod.isValidTransition("dispatching", "failed"), "dispatching -> failed");
  assert(CommServiceMod.isValidTransition("failed", "retry_scheduled"), "failed -> retry_scheduled");
  assert(CommServiceMod.isValidTransition("retry_scheduled", "dispatching"), "retry_scheduled -> dispatching");
  
  // dead letter path
  assert(CommServiceMod.isValidTransition("retry_scheduled", "dead_letter"), "retry_scheduled -> dead_letter");
});

check("T2. backwards and terminal transitions rejected", () => {
  assert(!CommServiceMod.isValidTransition("read", "sent"), "read -> sent rejected");
  assert(!CommServiceMod.isValidTransition("delivered", "queued"), "delivered -> queued rejected");
  assert(!CommServiceMod.isValidTransition("dead_letter", "accepted"), "dead_letter -> accepted rejected");
});

check("T3. delivered before sent handling safe", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_messages = [
    { id: "msg-trans-1", provider_message_id: "p-msg-trans-1", status: "accepted", lane: "business", attempt_count: 1, created_at: new Date().toISOString() }
  ];
  db.communication_webhook_receipts = [];

  // delivered webhook arrives first
  await s.processWebhook({
    event_id: "evt-del-first",
    message_id: "p-msg-trans-1",
    status: "delivered",
    timestamp: new Date().toISOString(),
  }, "mock-valid-signature");
  
  assert(db.communication_messages[0].status === "delivered", "should update to delivered");

  // sent webhook arrives later
  await s.processWebhook({
    event_id: "evt-sent-later",
    message_id: "p-msg-trans-1",
    status: "sent",
    timestamp: new Date().toISOString(),
  }, "mock-valid-signature");

  assert(db.communication_messages[0].status === "delivered", "status must remain delivered (ignore backward transition)");
});

// ============================================================================
// RETRIES & DEAD LETTER MODEL
// ============================================================================
check("R1. retryable failure schedules retry (business lane)", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_messages = [];
  
  const res = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+91fail-retry",
    template_key: "vendor_new_lead", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-retry-1", priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
  });

  assert(res.ok === true, "send call ok");
  assert(res.data.status === "retry_scheduled", "status retry_scheduled: expected retry_scheduled, got " + res.data.status);
  assert(res.data.attempt_count === 1, "attempt count incremented to 1");
  assert(res.data.next_retry_at !== null, "next retry date calculated");
});

check("R2. permanent error does not retry", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_messages = [];
  
  const res = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+91fail-permanent",
    template_key: "vendor_new_lead", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-retry-2", priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
  });

  assert(res.ok === true, "send call ok");
  assert(res.data.status === "failed", "permanent error fails immediately");
  assert(res.data.attempt_count === 1, "attempt count 1");
  assert(res.data.next_retry_at === null || res.data.next_retry_at === undefined, "no retry scheduled");
});

check("R3. dead letter when attempts exhausted", async () => {
  const s = new CommServiceMod.CommunicationService();
  
  const msgRow = {
    id: "msg-exhaust",
    status: "retry_scheduled",
    lane: "business",
    channel: "whatsapp",
    recipient_type: "vendor",
    recipient_id: "vend-123",
    attempt_count: 4,
    max_attempts: 5,
    idempotency_key: "idem-exhaust-1",
    destination_hash: "hash",
    destination_masked: "masked",
    template_key: "vendor_new_lead",
    provider: "mock",
    variables: {},
    metadata: {},
    created_at: new Date().toISOString()
  };
  
  db.communication_messages = [msgRow];

  // Test the dispatcher directly on the seeded record at attempt_count = 4
  const res = await s.dispatchMessage(msgRow, "+91fail-retry", {}, "vendor_new_lead");

  assert(res.ok === true, "succeeds");
  assert(res.data.status === "dead_letter", "transitions to dead_letter once max attempts reached: got " + res.data.status);
  assert(res.data.attempt_count === 5, "attempt count is 5");
});

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================
check("TPL1. template exists check", async () => {
  const s = new CommServiceMod.CommunicationService();
  const res = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+919876543210",
    template_key: "missing_template", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-tpl-1", priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
  });
  assert(res.ok === false, "should reject missing template");
  assert(res.code === "TEMPLATE_NOT_FOUND_OR_INACTIVE", "correct error mapping: expected TEMPLATE_NOT_FOUND_OR_INACTIVE, got: " + res.code);
});

check("TPL2. disabled and draft template validation", async () => {
  const s = new CommServiceMod.CommunicationService();
  const res1 = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+919876543210",
    template_key: "draft_template", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-tpl-2", priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
  });
  assert(res1.ok === false, "draft templates rejected");

  const res2 = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+919876543210",
    template_key: "disabled_template", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-tpl-3", priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
  });
  assert(res2.ok === false, "disabled templates rejected");

  const res3 = await s.send({
    type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "vend-123", destination: "+919876543210",
    template_key: "inactive_template", variables: {},
    entity_type: null, entity_id: null, correlation_id: null,
    idempotency_key: "idem-tpl-4", priority: "normal",
    scheduled_at: null, policy_decision_id: null, metadata: {},
  });
  assert(res3.ok === false, "inactive templates rejected");
});

// ============================================================================
// WEBHOOK RECEIPTS & WEBHOOK SECURITY
// ============================================================================
check("W1. signature check enforced", async () => {
  const s = new CommServiceMod.CommunicationService();
  const res = await s.processWebhook({ event_id: "evt-1" }, "invalid-sig");
  assert(res.ok === false, "should reject webhook with invalid signature");
});

check("W2. duplicate receipt deduplication", async () => {
  const s = new CommServiceMod.CommunicationService();
  db.communication_webhook_receipts = [];

  const payload = { event_id: "evt-dup-11", status: "delivered", message_id: "mock-1" };
  const res1 = await s.processWebhook(payload, "mock-valid-signature");
  const countBefore = db.communication_webhook_receipts.length;

  const res2 = await s.processWebhook(payload, "mock-valid-signature");
  const countAfter = db.communication_webhook_receipts.length;

  assert(res1.ok === true && res2.ok === true, "both succeed");
  assert(countAfter === countBefore + 1, "second receipt logged as duplicate in catalog index");
  assert(db.communication_webhook_receipts[1].processing_status === "duplicate", "status marked duplicate");
});

// ============================================================================
// ADMIN READ MODELS
// ============================================================================
check("ADM1. get overview counts", async () => {
  db.communication_messages = [
    { status: "accepted" },
    { status: "delivered" },
    { status: "read" },
    { status: "failed" },
    { status: "dead_letter" },
  ];
  const res = await AdminServiceMod.getCommunicationOverview();
  assert(res.ok === true, "query overview ok");
  assert(res.data.totalMessages === 5, "total counts correct");
  assert(res.data.readCount === 1, "readCount 1");
  assert(res.data.deadLetterCount === 1, "deadLetterCount 1");
  assert(res.data.failedCount === 1, "failedCount 1");
});

check("ADM2. get provider health stable", async () => {
  const res = await AdminServiceMod.getProviderHealthSummary();
  assert(res.ok === true, "query provider health ok");
  assert(res.data.provider === "mock", "provider mock");
  assert(res.data.status === "healthy", "healthy");
});

check("ADM3. template readiness summary", async () => {
  const res = await AdminServiceMod.getTemplateReadinessSummary();
  assert(res.ok === true, "tpl summary ok");
  assert(res.data.totalTemplates > 0, "has templates");
  assert(res.data.readinessBreakdown.mock_ready > 0, "has mock_ready templates");
  assert(res.data.readinessBreakdown.draft > 0, "has draft templates");
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
});

check("SQL3. RLS configurations present", () => {
  assert(normalizedSql.includes("alter table public.communication_templates enable row level security;"), "RLS enabled templates");
  assert(normalizedSql.includes("alter table public.communication_messages enable row level security;"), "RLS enabled messages");
  assert(normalizedSql.includes("alter table public.communication_delivery_events enable row level security;"), "RLS enabled delivery events");
  assert(normalizedSql.includes("alter table public.communication_webhook_receipts enable row level security;"), "RLS enabled receipts");
  assert(normalizedSql.includes("alter table public.communication_automation_catalog enable row level security;"), "RLS enabled catalog");
});

check("SQL4. revokes anon and authenticated permissions", () => {
  assert(normalizedSql.includes("revoke all on public.communication_messages from anon;"), "revoke anon messages");
  assert(normalizedSql.includes("revoke all on public.communication_messages from authenticated;"), "revoke auth messages");
  assert(normalizedSql.includes("grant select, insert, update, delete on public.communication_messages to service_role;"), "grant service_role messages");
});

check("SQL5. seeded logical automation keys exist", () => {
  const keys = [
    "client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset",
    "lead_received", "vendor_new_lead", "clarification_request",
    "clarification_reminder", "lead_assignment_alert", "low_credit_warning",
    "recharge_reminder", "client_nurture_followup", "dormant_requirement_reactivation",
    "admin_policy_block_alert", "admin_assignment_failure_alert",
    "admin_provider_outage_alert", "admin_automation_failure_alert"
  ];
  for (const k of keys) {
    assert(normalizedSql.includes(k), `Seeded key ${k} must exist in SQL`);
  }
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
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll();
