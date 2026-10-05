#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20261005160000_scale_phase12_horizontal_worker_claims.sql",
);
const jarvis = read("services/jarvisWhatsAppGatewayService.ts");
const conversation = read("services/conversationalWhatsAppService.ts");
const transport = read("worker/conversationTransportWorker.ts");
const automation = read("worker/nativeAutomationWorker.ts");
const matching = read(
  "scripts/scale/certify-matching-concurrency-postgres.mjs",
);
const durable = read("scripts/scale/certify-durable-jobs-postgres.mjs");

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
    console.log("PASS", name);
  } catch (error) {
    checks.push({ name, ok: false });
    console.error(
      "FAIL",
      name,
      error instanceof Error ? error.message : String(error),
    );
  }
}

check(
  "conversation outbox has a shared one-claim-per-conversation fence",
  () => {
    assert.match(
      migration,
      /communication_conversation_outbox_one_claim_per_conversation/,
    );
    assert.match(migration, /where status = 'claimed'/);
  },
);
check(
  "Jarvis turn outbox has a shared one-claim-per-conversation fence",
  () => {
    assert.match(
      migration,
      /communication_jarvis_turn_outbox_one_claim_per_conversation/,
    );
  },
);
check("both durable claims use SKIP LOCKED and head-of-line checks", () => {
  assert.ok((migration.match(/skip locked/gi) ?? []).length >= 2);
  assert.ok(
    (
      migration.match(
        /row\(prior\.created_at, prior\.id\) < row\(work\.created_at, work\.id\)/gi,
      ) ?? []
    ).length >= 2,
  );
});
check("Jarvis feature lanes are filtered before a turn is claimed", () => {
  assert.match(migration, /p_allow_conversation/);
  assert.match(migration, /p_allow_qualification/);
});
check("QuickFurno Jarvis dispatch uses the atomic claim RPC", () => {
  assert.match(jarvis, /qf_claim_jarvis_turn_outbox_v1/);
  assert.doesNotMatch(
    jarvis,
    /\.select\("id"\)[\s\S]{0,500}communication_jarvis_turn_outbox/,
  );
});
check("provider reply dispatch uses the atomic claim RPC", () => {
  assert.match(conversation, /qf_claim_conversation_outbox_v1/);
  assert.match(
    conversation,
    /dispatchConversationalOutbox\(String\(id\), true\)/,
  );
});
check("native automation no longer owns conversational transport", () => {
  assert.doesNotMatch(
    automation,
    /jarvisWhatsAppGatewayService|conversationalWhatsAppService/,
  );
});
check("transport can isolate provider outbound from Jarvis ingress", () => {
  assert.match(transport, /QF_CONVERSATION_TRANSPORT_LANES/);
  assert.match(transport, /provider-outbound/);
  assert.match(transport, /jarvis-ingress/);
  assert.match(transport, /conversation-provider-outbound/);
  assert.match(transport, /conversation-jarvis-ingress/);
});
check(
  "automation supports independent client/vendor/campaign/system/background lanes",
  () => {
    assert.match(automation, /QF_NATIVE_AUTOMATION_LANES/);
    for (const lane of [
      "client",
      "vendor",
      "campaigns",
      "system",
      "background",
    ]) {
      assert.ok(automation.includes(`"${lane}"`));
    }
  },
);
check("worker heartbeats remain replica-addressable", () => {
  assert.match(transport, /scaleWorkerId/);
  assert.match(automation, /writeScaleWorkerHeartbeat/);
});
check(
  "existing N-way matching fairness and credit certification remains part of Phase 12 evidence",
  () => {
    assert.match(matching, /qf_assign_lead_vendors_v2/);
    assert.match(matching, /remaining_credits/);
  },
);
check(
  "existing exactly-once durable job certification remains part of Phase 12 evidence",
  () => {
    assert.match(durable, /exactlyOneEffect/);
    assert.match(
      durable,
      /exactly one concurrent scheduler replica must acquire/,
    );
  },
);

const failed = checks.filter((item) => !item.ok);
console.log(
  `\nPhase 12 QuickFurno contract: ${checks.length - failed.length}/${checks.length} PASS`,
);
if (failed.length) process.exit(1);
