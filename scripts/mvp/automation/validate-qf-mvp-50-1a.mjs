#!/usr/bin/env node
/**
 * QF-MVP-50.1A — Unified Action Contract + Jarvis Provision validator.
 * Offline only. No DB, network, provider, env mutation or n8n execution.
 */

import {
  AUTOMATION_CONTRACT_VERSION,
  AUTOMATION_REQUEST_SOURCES,
  AUTOMATION_RESULT_CLASSIFICATIONS,
  buildAutomationJobEnvelope,
  createActionCorrelationId,
  createActionIdempotencyKey,
  findForbiddenAutomationField,
  isAutomaticRetryAllowed,
  isTerminalAutomationResult,
  validateCoreActionRequestEnvelope,
} from "../../../lib/automation/actionContract.ts";
import {
  AUTOMATION_ACTION_REGISTRY,
  AUTOMATION_ACTION_TYPES,
  canSourceRequestAction,
  getWorkflowFamilyForAction,
} from "../../../lib/automation/actionRegistry.ts";

const results = [];
const record = (name, ok, detail = "") =>
  results.push({ name, ok: Boolean(ok), detail });

record("01 contract version is pinned to v1", AUTOMATION_CONTRACT_VERSION === 1);
record(
  "02 request-source vocabulary contains exactly the six reviewed sources",
  JSON.stringify(AUTOMATION_REQUEST_SOURCES) ===
    JSON.stringify(["core", "admin", "system", "jarvis", "riya", "anisha"]),
);
record(
  "03 result vocabulary is closed",
  JSON.stringify(AUTOMATION_RESULT_CLASSIFICATIONS) ===
    JSON.stringify([
      "success",
      "retryable_failure",
      "definitive_failure",
      "uncertain",
    ]),
);
record(
  "04 exactly 14 launch action types are registered",
  AUTOMATION_ACTION_TYPES.length === 14 &&
    new Set(AUTOMATION_ACTION_TYPES).size === AUTOMATION_ACTION_TYPES.length,
);

for (const actionType of AUTOMATION_ACTION_TYPES) {
  const def = AUTOMATION_ACTION_REGISTRY[actionType];
  record(
    `05 registry identity matches for ${actionType}`,
    def?.actionType === actionType,
  );
  const retired = actionType === "vendor.response_reminder";
  record(
    retired
      ? `06 retired action is requestable by nobody: ${actionType}`
      : `06 core/admin/system may request ${actionType}`,
    retired
      ? AUTOMATION_REQUEST_SOURCES.every((source) => !canSourceRequestAction(source, actionType))
      : ["core", "admin", "system"].every((source) => canSourceRequestAction(source, actionType)),
  );
}

for (const campaignAction of [
  "campaign.execute_batch",
  "campaign.execute_recipient",
]) {
  record(
    `07 agents cannot request ${campaignAction}`,
    ["jarvis", "riya", "anisha"].every(
      (source) => !canSourceRequestAction(source, campaignAction),
    ),
  );
}

record(
  "08 Jarvis/Riya/Anisha have no automation trigger authority",
  ["jarvis", "riya", "anisha"].every((source) =>
    AUTOMATION_ACTION_TYPES.every((actionType) => !canSourceRequestAction(source, actionType)),
  ),
);
record(
  "09 Core owns standard clarification triggers",
  canSourceRequestAction("core", "client.requirement_collection") &&
    canSourceRequestAction("core", "client.missing_information_reminder"),
);
record(
  "10 bounded client connection assurance is Core-only and vendor chasing is retired",
  ["core", "admin", "system"].every((source) =>
    canSourceRequestAction(source, "client.transactional_followup"),
  ) &&
    ["jarvis", "riya", "anisha"].every((source) =>
      !canSourceRequestAction(source, "client.transactional_followup"),
    ) &&
    AUTOMATION_REQUEST_SOURCES.every((source) =>
      !canSourceRequestAction(source, "vendor.response_reminder"),
    ),
);
record(
  "11 workflow families are separated",
  getWorkflowFamilyForAction("client.lead_confirmation") === "client_whatsapp" &&
    getWorkflowFamilyForAction("vendor.lead_offer") === "vendor_whatsapp" &&
    getWorkflowFamilyForAction("campaign.execute_batch") === "campaign_execution",
);

const forbiddenFixtures = [
  { force_send: true },
  { nested: { ignoreConsent: true } },
  { nested: { bypass_suppression: true } },
  { nested: { phone: "9999999999" } },
  { nested: { recipient: "somebody" } },
  { nested: { template_key: "anything" } },
  { nested: { provider_account_id: "override" } },
  { nested: { credit_delta: 1 } },
  { nested: { assign_vendor_ids: ["v1"] } },
  { nested: { desired_status: "sent" } },
  { nested: { retry_anyway: true } },
  { nested: { accessToken: "secret" } },
];

for (const [index, fixture] of forbiddenFixtures.entries()) {
  record(
    `12.${index + 1} forbidden executor authority fixture is rejected`,
    Boolean(findForbiddenAutomationField(fixture)),
  );
}

record(
  "13 safe identifier-only context is accepted",
  findForbiddenAutomationField({
    leadId: "lead-1",
    assignmentId: "assignment-1",
    campaignId: "campaign-1",
    snapshotId: "snapshot-1",
    reasonCode: "FOLLOWUP_DUE",
  }) === null,
);

const idempotency = createActionIdempotencyKey({
  actionType: "client.requirement_collection",
  entityType: "lead",
  entityId: "11111111-1111-1111-1111-111111111111",
  evidenceId: "followup-001",
});
record(
  "14 idempotency key is deterministic and scoped",
  idempotency ===
    "qf_action_v1:client.requirement_collection:lead:11111111-1111-1111-1111-111111111111:followup-001",
);
record(
  "15 correlation ID is deterministic",
  createActionCorrelationId({
    entityType: "lead",
    entityId: "11111111-1111-1111-1111-111111111111",
  }) === "qf_corr_v1:lead:11111111-1111-1111-1111-111111111111",
);

const request = {
  contractVersion: 1,
  requestId: "request-001",
  actionType: "client.requirement_collection",
  entityType: "lead",
  entityId: "11111111-1111-1111-1111-111111111111",
  source: "core",
  requestedBy: { actorType: "core_service", actorId: "quickfurno-core" },
  requestedAt: "2026-08-01T12:00:00.000Z",
  idempotencyKey: idempotency,
  correlationId: "qf_corr_v1:lead:11111111-1111-1111-1111-111111111111",
  safeContext: {
    leadId: "11111111-1111-1111-1111-111111111111",
    reasonCode: "FOLLOWUP_DUE",
  },
};

record(
  "16 a safe Core request envelope validates but is not itself authorization",
  validateCoreActionRequestEnvelope(request).ok,
);

let unauthorizedBlocked = false;
try {
  buildAutomationJobEnvelope(
    {
      request,
      authorization: { decision: "rejected" },
    },
    "job-001",
  );
} catch (error) {
  unauthorizedBlocked =
    error instanceof Error && error.message === "CORE_AUTHORIZATION_REQUIRED";
}
record(
  "17 an un-authorized/rejected request cannot become an n8n job",
  unauthorizedBlocked,
);

const job = buildAutomationJobEnvelope(
  {
    request,
    authorization: {
      decision: "authorized",
      authorizationId: "auth-001",
      authorizedAt: "2026-08-01T12:00:01.000Z",
      authorizedBy: {
        actorType: "core_service",
        actorId: "automation-authority",
      },
      reasonCode: "CORE_POLICY_ALLOWED",
    },
  },
  "job-001",
);

record(
  "18 authorized job preserves provenance without turning source into permission",
  job.source === "core" &&
    job.actionRequestId === "request-001" &&
    job.authorizedBy.actorType === "core_service",
);
record(
  "19 authorized job carries no destination/template/provider override",
  findForbiddenAutomationField(job.safeContext) === null &&
    !Object.prototype.hasOwnProperty.call(job, "recipient") &&
    !Object.prototype.hasOwnProperty.call(job, "template") &&
    !Object.prototype.hasOwnProperty.call(job, "providerAccountId"),
);
record(
  "20 automatic retry is allowed only for retryable_failure",
  isAutomaticRetryAllowed("retryable_failure") &&
    !isAutomaticRetryAllowed("success") &&
    !isAutomaticRetryAllowed("definitive_failure") &&
    !isAutomaticRetryAllowed("uncertain"),
);
record(
  "21 uncertain is terminal and never auto-retry",
  isTerminalAutomationResult("uncertain") &&
    !isAutomaticRetryAllowed("uncertain"),
);
record(
  "22 retryable_failure is the only non-terminal execution classification",
  !isTerminalAutomationResult("retryable_failure") &&
    ["success", "definitive_failure", "uncertain"].every((value) =>
      isTerminalAutomationResult(value),
    ),
);

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"} ${result.name}${
      result.detail ? ` — ${result.detail}` : ""
    }`,
  );
}

console.log("");
console.log(`QF-MVP-50.1A: ${results.length - failed.length}/${results.length} PASS`);

if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QF_MVP_50_1A_UNIFIED_ACTION_CONTRACT_READY");
}
