import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildAosV2CanonicalSnapshot,
  deriveAosV2LeadDecisions,
  deriveAosV2LeadRecommendation,
} from "../../../lib/aos/v2/leadIntelligence.ts";
import {
  AOS_V2_AGENT_CAPABILITIES,
  AOS_V2_OPERATIONAL_AGENT_COUNT,
  AOS_V2_AGENT_COUNT,
} from "../../../lib/aos/v2/agentCapabilities.ts";
import { isCertifiedAosProposalAction } from "../../../lib/aos/v2/proposalPolicy.ts";
import {
  resolveConversationTriggerDecision,
} from "../../../lib/automation/conversationTriggerPolicy.ts";
import {
  QUICKFURNO_LEAD_GENERATION_BOUNDARY,
  QUICKFURNO_PLATFORM_BOUNDARY,
} from "../../../lib/aos/v2/architectureBoundary.ts";

const ROOT = process.cwd();
let failures = 0;
function check(name, condition) {
  const ok = Boolean(condition);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures += 1;
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
const quality = {
  contact_score: 20,
  location_score: 20,
  requirement_score: 25,
  intent_score: 20,
  fraud_penalty: 0,
  total_score: 85,
  location_confidence: 4,
  score_class: "A+",
  hard_block_reason: null,
  recommended_action: "auto_distribute",
  score_breakdown: {},
};
const base = {
  lead: {
    leadId: "11111111-1111-4111-8111-111111111111",
    city: "Pune",
    area: "Kharadi",
    serviceRequired: "Interiors",
    budget: "8-12L",
    isDuplicate: false,
    shareConsent: true,
  },
  quality,
  coreMatch: null,
};
const ready = deriveAosV2LeadRecommendation(base);
check("AOS recommends Core-owned ready state", ready.key === "lead_ready_for_distribution");
check("Ready state proposes no duplicate automation", ready.suggestedActionType === null);

const matched = deriveAosV2LeadRecommendation({
  ...base,
  coreMatch: { status: "matched", eligibleVendorCount: 5, selectedVendorIds: ["v1", "v2"] },
});
check("Matched lead remains advisory", matched.key === "matching_completed");
check("Matched lead creates no duplicate action", matched.suggestedActionType === null);

const duplicate = deriveAosV2LeadRecommendation({
  ...base,
  lead: { ...base.lead, isDuplicate: true },
});
check("Duplicate lead is held", duplicate.key === "duplicate_hold");

const noConsent = deriveAosV2LeadRecommendation({
  ...base,
  lead: { ...base.lead, shareConsent: false },
});
check("Missing consent is held", noConsent.key === "consent_hold");

const decisions = deriveAosV2LeadDecisions(base);
check("Nexus authority guard exists", decisions.some((d) => d.agentKey === "QF-AOS-NexusKernel" && d.decision === "core_authority_preserved"));
check("LeadLens observes Core score", decisions.some((d) => d.agentKey === "QF-AOS-LeadLens" && d.metadata.totalScore === 85));
const snapshot = buildAosV2CanonicalSnapshot(base);
check("Canonical snapshot excludes phone", !JSON.stringify(snapshot).toLowerCase().includes("phone"));
check("Canonical snapshot excludes raw message", !JSON.stringify(snapshot).toLowerCase().includes("message"));

check("Registry contains exactly the seven canonical AOS agents", AOS_V2_AGENT_COUNT === 7);
check("All seven canonical AOS agents are operational", AOS_V2_OPERATIONAL_AGENT_COUNT === 7 && AOS_V2_AGENT_CAPABILITIES.every((a) => a.state === "operational"));
check("Every AOS agent is advisory only", AOS_V2_AGENT_CAPABILITIES.every((a) => a.authority === "advisory_only"));
check("Every AOS agent blocks direct n8n", AOS_V2_AGENT_CAPABILITIES.every((a) => a.directN8n === false));
check("Every AOS agent blocks business writes", AOS_V2_AGENT_CAPABILITIES.every((a) => a.businessWrites === false));
check("Every AOS agent excludes customer conversation", AOS_V2_AGENT_CAPABILITIES.every((a) => a.customerConversation === false));
check("Every AOS agent excludes post-delivery commercial management", AOS_V2_AGENT_CAPABILITIES.every((a) => a.postDeliveryCommercialManagement === false));
check("QuickFurno Core is the integration hub", QUICKFURNO_PLATFORM_BOUNDARY.core.integrationHub === true);
check("Jarvis is customer care via Core only", QUICKFURNO_PLATFORM_BOUNDARY.jarvis.role === "customer_conversation_and_care" && QUICKFURNO_PLATFORM_BOUNDARY.jarvis.integration === "future_via_quickfurno_core");
check("n8n is execution not business authority", QUICKFURNO_PLATFORM_BOUNDARY.n8n.role === "authorized_execution_orchestration" && QUICKFURNO_PLATFORM_BOUNDARY.n8n.businessAuthority === false);
check("QuickFurno responsibility ends after delivery plus bounded connection assurance", QUICKFURNO_LEAD_GENERATION_BOUNDARY.responsibilityEndsAt === "delivery_plus_bounded_connection_assurance" && QUICKFURNO_LEAD_GENERATION_BOUNDARY.connectionAssurance.vendorResponseWindowHours === 24 && QUICKFURNO_LEAD_GENERATION_BOUNDARY.connectionAssurance.maxClientAutomatedMessages === 5);
check("Post-delivery commercial management is outside QuickFurno", QUICKFURNO_LEAD_GENERATION_BOUNDARY.postDeliveryCommercialManagement === false);
check("Quotation/site visit/negotiation/project execution are vendor-client owned", ["quotation", "site_visit", "negotiation", "project_execution", "commercial_outcome"].every((item) => QUICKFURNO_LEAD_GENERATION_BOUNDARY.vendorClientOwns.includes(item)));

check("Transactional follow-up is NOT proposal-certified", !isCertifiedAosProposalAction("client.transactional_followup"));
check("Lead confirmation is NOT proposal-certified", !isCertifiedAosProposalAction("client.lead_confirmation"));
check("Vendor lead offer is NOT proposal-certified", !isCertifiedAosProposalAction("vendor.lead_offer"));
check("Campaign execution is NOT proposal-certified", !isCertifiedAosProposalAction("campaign.execute_recipient"));

check("Core owns standard requirement collection", resolveConversationTriggerDecision({ origin: "core_rule", actionType: "client.requirement_collection" }) === "core_standard_authority");
check("Core owns the standard missing-information reminder", resolveConversationTriggerDecision({ origin: "core_rule", actionType: "client.missing_information_reminder" }) === "core_standard_authority");
check("AOS intelligent clarification requires Core review", resolveConversationTriggerDecision({ origin: "aos_recommendation", actionType: "client.requirement_collection" }) === "core_review_required");
check("Jarvis is never trigger authority", resolveConversationTriggerDecision({ origin: "jarvis", actionType: "client.requirement_collection" }) === "jarvis_not_trigger_authority");
check("Architecture says conversation results return to Core", QUICKFURNO_PLATFORM_BOUNDARY.conversationTriggering.resultAuthority === "quickfurno_core");
check("Architecture says n8n handoff happens only after Core authorization", QUICKFURNO_PLATFORM_BOUNDARY.conversationTriggering.executionHandoff === "n8n_after_core_authorization");

const migration = read("supabase/migrations/20260912040000_qf_aos_v2_intelligence.sql");
for (const table of ["aos_runs", "aos_agent_logs", "aos_recommendations", "aos_agent_memory", "aos_audit_logs"]) {
  check(`Migration creates ${table}`, migration.includes(`public.${table}`));
}
for (const forbidden of [
  "create table public.domain_events",
  "create table public.workflow_instances",
  "create table public.workflow_tasks",
  "create table public.outbox_events",
  "create table public.idempotency_records",
]) {
  check(`Migration does not resurrect ${forbidden.split(".").pop()}`, !migration.toLowerCase().includes(forbidden));
}
check("Migration retires legacy AOS n8n router", migration.includes("Legacy AOS -> n8n Master Preview Router retired"));
check("Action proposals seed OFF", /aos_v2_action_proposals'[\s\S]*?false[\s\S]*?'off'/.test(migration));

check("AOS tables revoke PUBLIC/anon/authenticated before least-privilege grants", /revoke all on table public\.aos_runs from public, anon, authenticated/.test(migration));
check("AOS service_role has no DELETE grant", !/grant[^;]*delete[^;]*to service_role/i.test(migration));

const scopeMigration = read("supabase/migrations/20260912050000_qf_lead_generation_scope_lock.sql");
const clientProducerBody = scopeMigration.match(/create or replace function public\.qf_produce_client_status_actions\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
const vendorProducerBody = scopeMigration.match(/create or replace function public\.qf_produce_vendor_assignment_actions\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
check("Successor migration retires client sales follow-up", Boolean(clientProducerBody) && !clientProducerBody.includes("client.transactional_followup"));
check("Successor migration retires vendor response reminders", Boolean(vendorProducerBody) && !vendorProducerBody.includes("vendor.response_reminder"));
check("Successor migration preserves lead delivery notification", vendorProducerBody.includes("vendor.lead_offer"));
check("Successor migration preserves generic pre-delivery status update", scopeMigration.includes("client.lead_status_update"));
check("Successor migration guards downstream commercial statuses", ["Contacted", "Site Visit Scheduled", "Quotation Sent", "Converted", "Won", "Lost"].every((status) => scopeMigration.includes(status)));

const n8nSync = read("lib/aos/sync/n8nSyncService.ts");
const queueBlock = n8nSync.slice(n8nSync.indexOf("export async function queueEventForN8n"), n8nSync.indexOf("export function getN8nWorkflowMap"));
check("Legacy queueEventForN8n cannot call transport", !queueBlock.includes("sendEventToN8n("));
check("Legacy queue reports retired", queueBlock.includes("retired"));

for (const route of ["events", "failure", "process-lead", "whatsapp-status"]) {
  const src = read(`app/api/aos/${route}/route.ts`);
  check(`Legacy /api/aos/${route} is retired`, src.includes("status: 410"));
}
const leadService = read("services/leadService.ts");
const matchingIndex = leadService.indexOf("runAutoLeadMatchingForLead(data.id)");
const aosIndex = leadService.indexOf("runAosV2LeadIntelligence({");
check("AOS runs after canonical matching path", matchingIndex >= 0 && aosIndex > matchingIndex);
check("AOS lead intelligence is non-blocking", leadService.includes("void runAosV2LeadIntelligence({"));
check("Legacy lead-created AOS bridge removed from Core lead service", !leadService.includes("emitLeadCreatedEvent"));
check("Legacy clarification AOS bridge removed from Core lead service", !leadService.includes("emitLeadClarificationRequiredEvent"));

const clientExecution = read("services/automationClientExecutionService.ts");
check("Generic/legacy transactional follow-up is runtime terminal no-send", clientExecution.includes("CONNECTION_ACTION_KEY_RE") && clientExecution.includes("conn_") && clientExecution.includes("QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE"));
check("Downstream commercial statuses are runtime terminal no-send", clientExecution.includes("POST_DELIVERY_LEAD_STATUSES") && ["Contacted", "Site Visit Scheduled", "Quotation Sent", "Converted", "Won", "Lost"].every((status) => clientExecution.includes(`"${status}"`)));

const proposal = read("services/aosV2ProposalService.ts");
check("AOS proposal service never authorizes requests", !proposal.includes("authorizeAutomationActionRequest"));
check("AOS proposal service never creates jobs", !proposal.includes("createAutomationJob("));
check("AOS proposal service writes requested state only", proposal.includes('decisionStatus: "requested"'));

if (failures > 0) {
  console.error(`\nAOS V2 validation failed: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nAOS V2 validation passed.");
