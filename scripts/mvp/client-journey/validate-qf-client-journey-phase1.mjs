import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { evaluateLeadQualification } from "../../../lib/leads/leadQualificationContract.ts";
import { leadWhatsAppDestinationHash } from "../../../lib/leads/leadWhatsAppIdentity.ts";
import {
  buildClarificationRequestVariables,
  buildClarificationReminderVariables,
} from "../../../lib/automation/clientDispatchVariables.ts";
import {
  buildLeadEnrichmentAnswerToken,
  parseLeadEnrichmentReplyToken,
} from "../../../lib/leads/leadEnrichmentWhatsApp.ts";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("PASS", name);
}

const base = {
  name: "Asha Kulkarni",
  phone: "9876543210",
  city: "Pune",
  area: "Kharadi",
  service_required: "Interior Designers",
  share_consent: true,
};

check("minimum capture is accepted but enrichment-required when budget/timeline are missing", () => {
  const q = evaluateLeadQualification(base);
  assert.equal(q.journeyState, "enrichment_required");
  assert.equal(q.completenessStatus, "enrichment_required");
  assert.equal(q.matchReadinessStatus, "needs_enrichment");
  assert.deepEqual(q.enrichmentMissingFields.sort(), ["budget", "timeline"]);
});

check("explicit undecided answers are not treated as missing", () => {
  const q = evaluateLeadQualification({
    ...base,
    budget: "Not sure yet",
    timeline: "Flexible",
  });
  assert.equal(q.completenessStatus, "complete");
  assert.equal(q.fieldStates.budget, "undecided");
  assert.equal(q.fieldStates.timeline, "undecided");
  assert.equal(q.matchReadinessStatus, "not_ready");
});

check("missing area remains a capture blocker", () => {
  const q = evaluateLeadQualification({ ...base, area: "" });
  assert.equal(q.completenessStatus, "incomplete");
  assert.ok(q.missingFields.includes("area"));
  assert.equal(q.matchReadinessStatus, "not_ready");
});

check("Indian national lead phone hashes to the same WhatsApp identity as +91 E.164", () => {
  assert.equal(
    leadWhatsAppDestinationHash("9876543210"),
    leadWhatsAppDestinationHash("+919876543210"),
  );
});

check("clarification request matches approved two-variable provider contract", () => {
  const built = buildClarificationRequestVariables({
    clientName: "Asha",
    outstandingItem: "preferred budget range",
  });
  assert.equal(built.ok, true);
  assert.deepEqual(Object.keys(built.variables).sort(), ["client_name", "outstanding_item"]);
});

check("clarification reminder uses the same two business variables", () => {
  const built = buildClarificationReminderVariables({
    clientName: "Asha",
    outstandingItem: "project timeline",
  });
  assert.equal(built.ok, true);
  assert.deepEqual(Object.keys(built.variables).sort(), ["client_name", "outstanding_item"]);
});

const repo = process.cwd();
const migration = fs.readFileSync(
  path.join(repo, "supabase/migrations/20260927113000_qf_client_journey_phase1_foundation.sql"),
  "utf8",
);
const maintenance = fs.readFileSync(
  path.join(repo, "services/leadEnrichmentMaintenanceService.ts"),
  "utf8",
);
const inbound = fs.readFileSync(
  path.join(repo, "services/leadEnrichmentInboundService.ts"),
  "utf8",
);
const execution = fs.readFileSync(
  path.join(repo, "services/automationClientExecutionService.ts"),
  "utf8",
);
const enrichmentWhatsApp = fs.readFileSync(
  path.join(repo, "lib/leads/leadEnrichmentWhatsApp.ts"),
  "utf8",
);

check("interactive answers stay exact-request scoped", () => {
  assert.match(enrichmentWhatsApp, /const ANSWER_PREFIX = "qfcla1"/);
  assert.match(enrichmentWhatsApp, /requestId: hexToUuid\(parts\[1\]\)/);
  assert.match(enrichmentWhatsApp, /questionIndex: Number\(parts\[2\]\)/);
  assert.match(enrichmentWhatsApp, /optionIndex: Number\(parts\[3\]\)/);
});

check("migration stores privacy-safe destination identity and exact outbound message evidence", () => {
  assert.match(migration, /destination_hash text null/);
  assert.match(migration, /initial_communication_message_id uuid null/);
  assert.match(migration, /reminder_communication_message_id uuid null/);
  assert.match(migration, /reminder_sent_at timestamptz null/);
});

check("reminder requires a proven initial sent/delivered/read message", () => {
  assert.match(execution, /new Set\(\["preview_sent"\]\)/);
  assert.match(execution, /initial_communication_message_id/);
  assert.match(execution, /\["sent", "delivered", "read"\]\.includes/);
});

check("no-response nurture requires sent/delivered/read reminder evidence", () => {
  assert.match(maintenance, /new Set\(\["sent", "delivered", "read"\]\)/);
  assert.match(maintenance, /status: "expired_no_response"/);
  assert.match(maintenance, /journey_state: "nurture"/);
  assert.doesNotMatch(maintenance, /"accepted"\s*,/);
});

check("late replies reactivate the same expired request", () => {
  assert.match(inbound, /"expired_no_response"/);
  assert.match(inbound, /clarification_status: "late_response"/);
  assert.match(inbound, /clarification_last_request_id/);
});

console.log(`QF Client Journey V2 Phase 1: ${passed}/${passed} PASS`);
console.log("QF_CLIENT_JOURNEY_PHASE1_READY");
