import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { evaluateLeadQualification } from "../../../lib/leads/leadQualificationContract.ts";
import { BUDGETS, TIMELINES } from "../../../lib/config.ts";
import { leadWhatsAppDestinationHash } from "../../../lib/leads/leadWhatsAppIdentity.ts";
import {
  buildClarificationRequestVariables,
  buildClarificationReminderVariables,
} from "../../../lib/automation/clientDispatchVariables.ts";
import { CLIENT_DISPATCH_REGISTRY } from "../../../lib/automation/clientDispatchRegistry.ts";
import { sourceKeysFor } from "../../../lib/communication/businessTemplateVariables.ts";
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

const budgetFitCode = fs.readFileSync(
  path.join(process.cwd(), "lib/lead-quality/budgetFit.ts"),
  "utf8",
);

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

check("canonical form choices expose not-decided budget and future/flexible timelines", () => {
  assert.ok(BUDGETS.includes("Not decided"));
  assert.ok(TIMELINES.includes("1–2 months"));
  assert.ok(TIMELINES.includes("2–3 months"));
  assert.ok(TIMELINES.includes("3+ months"));
  assert.ok(TIMELINES.includes("Flexible / not sure"));
});

check("not-decided budget is complete data but earns no budget-fit quality boost", () => {
  const q = evaluateLeadQualification({
    ...base,
    budget: "Not decided",
    timeline: "1–2 months",
  });
  assert.equal(q.fieldStates.budget, "undecided");
  assert.equal(q.completenessStatus, "complete");
  assert.match(budgetFitCode, /not decided/);
  assert.match(
    budgetFitCode,
    /maxRupees == null[\s\S]{0,180}hasBudget: false[\s\S]{0,180}points: 0/,
  );
});

check("natural undecided budget text is treated as answered without inventing a value", () => {
  const q = evaluateLeadQualification({
    ...base,
    budget: "Budget depends on the design",
    timeline: "Flexible / not sure",
  });
  assert.equal(q.fieldStates.budget, "undecided");
  assert.equal(q.fieldStates.timeline, "undecided");
  assert.equal(q.completenessStatus, "complete");
  assert.match(budgetFitCode, /depends on/);
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

check("clarification provider binding is explicit and positional", () => {
  assert.deepEqual(sourceKeysFor("clarification_request"), [
    "client_name",
    "outstanding_item",
  ]);
});

check("initial ask and +24h reminder both select the approved Utility request template", () => {
  assert.equal(
    CLIENT_DISPATCH_REGISTRY["client.requirement_collection"].templateKey,
    "clarification_request",
  );
  assert.equal(
    CLIENT_DISPATCH_REGISTRY["client.missing_information_reminder"].templateKey,
    "clarification_request",
  );
  assert.notEqual(
    CLIENT_DISPATCH_REGISTRY["client.missing_information_reminder"].templateKey,
    "clarification_reminder",
  );
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
const stagingQualificationMapping = fs.readFileSync(
  path.join(
    repo,
    "supabase/staging-history/qf-client-journey-phase1-qualification-mapping.sql",
  ),
  "utf8",
);
const productionTemplateOperator = fs.readFileSync(
  path.join(
    repo,
    "scripts/mvp/client-journey/create-production-clarification-template-once.mjs",
  ),
  "utf8",
);
const envExample = fs.readFileSync(path.join(repo, ".env.example"), "utf8");

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

check("Phase 2 Riya qualification lane is kill-switched and preserves Core authority", () => {
  assert.match(envExample, /QF_JARVIS_RIYA_QUALIFICATION_ENABLED=false/);
  assert.match(inbound, /QF_JARVIS_RIYA_QUALIFICATION_ENABLED/);
  assert.match(inbound, /enqueueRiyaQualificationTurn/);
  assert.match(inbound, /turn_purpose: "lead_qualification"/);
  assert.match(inbound, /assigned_actor: "RIYA"/);
  assert.match(inbound, /const allowedOptions = options\.map/);
  assert.match(inbound, /options\?\.find\(\(candidate\) => candidate\.value === input\.value\)/);
  assert.match(inbound, /responseSource: "riya"/);
  assert.match(inbound, /response_source: input\.responseSource/);
  assert.match(inbound, /mapClarificationAnswerToLeadField/);
});

check("staging qualification mapping is exact, inactive and utility-only", () => {
  assert.match(stagingQualificationMapping, /qf_clarification_request_v2/);
  assert.match(stagingQualificationMapping, /1374658884649762/);
  assert.match(stagingQualificationMapping, /'approved', 'unknown', '1\.0'/);
  assert.match(stagingQualificationMapping, /'utility'/);
  assert.match(stagingQualificationMapping, /now\(\), false/);
  assert.match(stagingQualificationMapping, /QF_PHASE1_MARKETING_REMINDER_MAPPING_FORBIDDEN/);
  assert.match(stagingQualificationMapping, /QF_PHASE1_STAGING_META_MUST_REMAIN_DISABLED/);
  assert.doesNotMatch(
    stagingQualificationMapping,
    /values\s*\(\s*'clarification_reminder'/i,
  );
});

check("production template operator is one-shot, Core-only and send-incapable", () => {
  assert.match(productionTemplateOperator, /EXPECTED_WABA_ID = "27861262223494153"/);
  assert.match(productionTemplateOperator, /EXPECTED_PHONE_NUMBER_ID = "1333595106493545"/);
  assert.match(productionTemplateOperator, /TARGET_NAME = "qf_clarification_request_v2"/);
  assert.match(productionTemplateOperator, /TARGET_CATEGORY = "UTILITY"/);
  assert.match(productionTemplateOperator, /TARGET_FINGERPRINT =/);
  assert.match(productionTemplateOperator, /method: "POST"/);
  assert.match(productionTemplateOperator, /\/message_templates/);
  assert.doesNotMatch(
    productionTemplateOperator.replaceAll("message_templates", ""),
    /\/messages\b/,
  );
  assert.doesNotMatch(productionTemplateOperator, /method:\s*"(PUT|PATCH|DELETE)"/);
});

console.log(`QF Client Journey V2 Phase 1: ${passed}/${passed} PASS`);
console.log("QF_CLIENT_JOURNEY_PHASE1_READY");
