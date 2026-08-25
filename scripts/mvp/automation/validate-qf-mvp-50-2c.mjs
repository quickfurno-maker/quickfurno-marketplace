#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.2C — Client Dispatch Authority Contract validator
//
// OFFLINE ONLY. No database, no network, no environment secret, no provider call.
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTOMATION_COMMUNICATION_IDEMPOTENCY_PREFIX,
  CLIENT_AUTOMATION_ACTION_TYPES,
  CLIENT_DISPATCH_REGISTRY,
  buildAutomationCommunicationIdempotencyKey,
  getClientDispatchDefinition,
  isAllowedClientDispatchEntityType,
  isClientAutomationActionType,
} from "../../../lib/automation/clientDispatchRegistry.ts";
import {
  CLIENT_ACTION_VARIABLE_BUILDERS,
  CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS,
  getClientActionVariableBuilder,
} from "../../../lib/automation/clientDispatchVariables.ts";
import {
  AUTOMATION_ACTION_TYPES,
  getWorkflowFamilyForAction,
} from "../../../lib/automation/actionRegistry.ts";
import { buildAutomationJobEnvelope } from "../../../lib/automation/actionContract.ts";
import {
  BUSINESS_TEMPLATE_CONTRACTS,
  BUSINESS_TEMPLATE_KEYS,
  BUSINESS_VARIABLE_BUILDERS,
  buildClientLeadStatusUpdateVariables,
  buildClientMatchingUpdateVariables,
  buildLeadReceivedVariables,
} from "../../../lib/communication/businessTemplateVariables.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * Negative "this logic does not exist" assertions must inspect CODE, not prose. A
 * doc comment that truthfully says "performs no client_accounts lookup" would
 * otherwise satisfy — or violate — the very rule it describes.
 */
const stripJsComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const stripSqlComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const registrySource = read("lib/automation/clientDispatchRegistry.ts");
const variablesSource = read("lib/automation/clientDispatchVariables.ts");
const contractSource = read("lib/automation/actionContract.ts");
const typesSource = read("lib/communication/types.ts");
const resolverSource = read("services/communicationRecipientResolver.ts");
const consentSource = read("services/outboundConsentEnforcementService.ts");
const manifest = JSON.parse(read("docs/provider-manifests/whatsapp-template-submission-manifest.json"));
const packet = JSON.parse(read("docs/provider-manifests/meta-template-submission-packet.json"));
// ---------------------------------------------------------------------------
// HISTORICAL AUTHORITY — QF-MVP-50.2C provider-catalogue facts
//
// Section D asserts what the provider catalogue looked like WHEN 50.2C WAS ACCEPTED:
// 25 templates, no client_transactional_followup candidate, clarification entries still
// unsubmitted drafts. Those were true statements about a completed phase.
//
// Evaluating them against the CURRENT tree was a cross-phase bug. QF-MVP-40 legitimately
// evolved the catalogue afterwards (commit 210f784 added client_transactional_followup as
// a provider candidate; it was later submitted and approved), which is exactly the
// "separately governed readiness task" 50.2C said must happen before real execution could
// stop failing closed. A frozen phase must not veto the evolution it asked for.
//
// So the historical claims are now proven against the historical BYTES, read from the
// 50.2C phase merge head. Current provider truth is owned by the QF-MVP-40 submission,
// remote-state and readiness validators — deliberately NOT re-pinned here, because pinning
// today's count would recreate this same bug on the next legitimate 40-side addition.
// ---------------------------------------------------------------------------
/** QF-MVP-50.2C phase merge head (PR #19). Frozen: it is this phase's own accepted truth. */
const QF_MVP_50_2C_IMPLEMENTATION_HEAD = "e511166119703c6044a73d4629a031a6685a3415";

/** A git failure is a FAILURE, never a silent fallback to the current working tree. */
function gitShowAtHead(relPath) {
  return execFileSync("git", ["show", `${QF_MVP_50_2C_IMPLEMENTATION_HEAD}:${relPath}`],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
function commitExists(sha) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT, stdio: "ignore" }); return true; }
  catch { return false; }
}
function isAncestorOfHead(sha) {
  try { execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT, stdio: "ignore" }); return true; }
  catch { return false; }
}

const MANIFEST_REL = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const PACKET_REL = "docs/provider-manifests/meta-template-submission-packet.json";

/**
 * Loaded ONCE from the frozen head. If the load throws, historicalLoadFailed stays true and
 * every historical assertion fails — there is no `?? current` and no try/catch that falls
 * back to the working tree.
 */
let historicalLoadFailed = true;
let historicalManifestRaw = null;
let historicalPacketRaw = null;
try {
  historicalManifestRaw = gitShowAtHead(MANIFEST_REL);
  historicalPacketRaw = gitShowAtHead(PACKET_REL);
  historicalLoadFailed = false;
} catch {
  historicalLoadFailed = true;
}
const historicalManifest = historicalLoadFailed ? null : JSON.parse(historicalManifestRaw);
const historicalPacket = historicalLoadFailed ? null : JSON.parse(historicalPacketRaw);
const collectEntries = (root) => {
  const out = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      if (node.internal_template_key) out.push(node);
      Object.values(node).forEach(walk);
    }
  })(root);
  return out;
};
const histManifestEntries = historicalManifest ? collectEntries(historicalManifest) : [];
const histPacketEntries = historicalPacket ? collectEntries(historicalPacket) : [];
const histManifestByKey = new Map(histManifestEntries.map((e) => [e.internal_template_key, e]));
const histPacketByKey = new Map(histPacketEntries.map((e) => [e.internal_template_key, e]));
/** Guards every historical assertion: an unloadable history can never read as a pass. */
const hist = (fn) => { if (historicalLoadFailed) return false; try { return fn() === true; } catch { return false; } };

const migrationName = "20260803000000_qf_mvp_50_2c_lead_communication_recipient.sql";
const migration = read(`supabase/migrations/${migrationName}`);
const allSource = registrySource + variablesSource + contractSource;
// Comment-stripped views, used by every negative code assertion below.
const registryCode = stripJsComments(registrySource);
const variablesCode = stripJsComments(variablesSource);
const contractCode = stripJsComments(contractSource);
const resolverCode = stripJsComments(resolverSource);
const migrationCode = stripSqlComments(migration);
const allCode = registryCode + variablesCode + contractCode;
// The two wholly-new 50.2C modules. actionContract.ts is EXCLUDED from the
// authority denylist scan because its own 50.1A FORBIDDEN_KEY_TOKENS list and
// AUTOMATION_REQUEST_SOURCES legitimately name those very tokens as guard rails;
// its narrow 50.2C change is asserted separately (E11).
const newModuleCode = registryCode + variablesCode;
// The exact resolveLead body, so a neighbouring method cannot satisfy its rules.
const leadBody = (() => {
  const i = resolverCode.indexOf("private async resolveLead(");
  if (i === -1) return "";
  const j = resolverCode.indexOf("private async ", i + 10);
  return resolverCode.slice(i, j === -1 ? resolverCode.length : j);
})();

const results = [];
const record = (name, ok) => results.push({ name, ok: Boolean(ok) });

const CLIENT_ACTIONS = [
  "client.lead_confirmation",
  "client.requirement_collection",
  "client.missing_information_reminder",
  "client.matching_update",
  "client.lead_status_update",
  "client.transactional_followup",
];
const EXPECTED_TEMPLATE = {
  "client.lead_confirmation": "lead_received",
  "client.requirement_collection": "clarification_request",
  "client.missing_information_reminder": "clarification_reminder",
  "client.matching_update": "client_matching_update",
  "client.lead_status_update": "client_lead_status_update",
  "client.transactional_followup": "client_transactional_followup",
};
const manifestEntries = [];
(function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk);
  if (node && typeof node === "object") {
    if (node.internal_template_key) manifestEntries.push(node);
    Object.values(node).forEach(walk);
  }
})(manifest);
const packetEntries = [];
(function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk);
  if (node && typeof node === "object") {
    if (node.internal_template_key) packetEntries.push(node);
    Object.values(node).forEach(walk);
  }
})(packet);
const manifestByKey = new Map(manifestEntries.map((e) => [e.internal_template_key, e]));
const packetByKey = new Map(packetEntries.map((e) => [e.internal_template_key, e]));

// ---------------------------------------------------------------------------
// A. EXACT ACTION SCOPE
// ---------------------------------------------------------------------------
record("A01 exactly six client actions", CLIENT_AUTOMATION_ACTION_TYPES.length === 6);
record("A02 action set is exactly the roadmap-50.2 six",
  [...CLIENT_AUTOMATION_ACTION_TYPES].sort().join(",") === [...CLIENT_ACTIONS].sort().join(","));
record("A03 no vendor action present",
  !CLIENT_AUTOMATION_ACTION_TYPES.some((a) => a.startsWith("vendor.")));
record("A04 no campaign action present",
  !CLIENT_AUTOMATION_ACTION_TYPES.some((a) => a.startsWith("campaign.")));
record("A05 every client action exists in the canonical action registry",
  CLIENT_AUTOMATION_ACTION_TYPES.every((a) => AUTOMATION_ACTION_TYPES.includes(a)));
record("A06 registry is total over exactly the six",
  Object.keys(CLIENT_DISPATCH_REGISTRY).length === 6 &&
  CLIENT_ACTIONS.every((a) => Boolean(CLIENT_DISPATCH_REGISTRY[a])));
record("A07 all workflowFamily are client_whatsapp",
  CLIENT_ACTIONS.every((a) => CLIENT_DISPATCH_REGISTRY[a].workflowFamily === "client_whatsapp"));
record("A08 allowedEntityTypes is exactly [lead] for all six",
  CLIENT_ACTIONS.every((a) =>
    CLIENT_DISPATCH_REGISTRY[a].allowedEntityTypes.length === 1 &&
    CLIENT_DISPATCH_REGISTRY[a].allowedEntityTypes[0] === "lead"));
record("A09 recipientStrategy is exactly lead_direct for all six",
  CLIENT_ACTIONS.every((a) => CLIENT_DISPATCH_REGISTRY[a].recipientStrategy === "lead_direct"));
record("A10 communicationLane is business for all six",
  CLIENT_ACTIONS.every((a) => CLIENT_DISPATCH_REGISTRY[a].communicationLane === "business"));
record("A11 consentScope is transactional for all six",
  CLIENT_ACTIONS.every((a) => CLIENT_DISPATCH_REGISTRY[a].consentScope === "transactional"));
record("A12 exact action to template mapping",
  CLIENT_ACTIONS.every((a) => CLIENT_DISPATCH_REGISTRY[a].templateKey === EXPECTED_TEMPLATE[a]));
record("A13 unknown action returns null, never a fallback definition",
  getClientDispatchDefinition("client.not_a_real_action") === null &&
  getClientDispatchDefinition("vendor.lead_offer") === null &&
  getClientDispatchDefinition(undefined) === null &&
  getClientDispatchDefinition({ actionType: "client.lead_confirmation" }) === null);
record("A14 isClientAutomationActionType is closed",
  isClientAutomationActionType("client.lead_confirmation") === true &&
  isClientAutomationActionType("vendor.lead_offer") === false &&
  isClientAutomationActionType("client.") === false);
record("A15 entity gate accepts lead only",
  isAllowedClientDispatchEntityType("client.lead_confirmation", "lead") === true &&
  isAllowedClientDispatchEntityType("client.lead_confirmation", "client_account") === false &&
  isAllowedClientDispatchEntityType("client.lead_confirmation", "vendor") === false &&
  isAllowedClientDispatchEntityType("vendor.lead_offer", "lead") === false);
record("A16 registry object is frozen", Object.isFrozen(CLIENT_DISPATCH_REGISTRY) &&
  CLIENT_ACTIONS.every((a) => Object.isFrozen(CLIENT_DISPATCH_REGISTRY[a])));
record("A17 no prefix-derived family logic in the registry",
  !/startsWith\(|split\(["'`]\.|substring\(/.test(registryCode));
record("A18 no default or fallback entry in the registry source",
  !/default\s*:|\?\?\s*[A-Z_]*DEFAULT|FALLBACK/.test(registryCode));

// ---------------------------------------------------------------------------
// B. ACTION VARIABLES
// ---------------------------------------------------------------------------
record("B01 all six actions have a builder",
  CLIENT_ACTIONS.every((a) => typeof CLIENT_ACTION_VARIABLE_BUILDERS[a] === "function"));
record("B02 builder lookup is closed",
  getClientActionVariableBuilder("client.lead_confirmation") !== null &&
  getClientActionVariableBuilder("vendor.lead_offer") === null &&
  getClientActionVariableBuilder(null) === null);
record("B03 lead_confirmation delegates to the approved lead_received builder",
  CLIENT_ACTION_VARIABLE_BUILDERS["client.lead_confirmation"] === buildLeadReceivedVariables);
record("B04 matching_update delegates to the approved builder",
  CLIENT_ACTION_VARIABLE_BUILDERS["client.matching_update"] === buildClientMatchingUpdateVariables);
record("B05 lead_status_update delegates to the approved builder",
  CLIENT_ACTION_VARIABLE_BUILDERS["client.lead_status_update"] === buildClientLeadStatusUpdateVariables);
record("B06 delegated builders are the very objects 40.12 exposes",
  CLIENT_ACTION_VARIABLE_BUILDERS["client.lead_confirmation"] === BUSINESS_VARIABLE_BUILDERS.lead_received &&
  CLIENT_ACTION_VARIABLE_BUILDERS["client.matching_update"] === BUSINESS_VARIABLE_BUILDERS.client_matching_update &&
  CLIENT_ACTION_VARIABLE_BUILDERS["client.lead_status_update"] === BUSINESS_VARIABLE_BUILDERS.client_lead_status_update);

const reqOk = CLIENT_ACTION_VARIABLE_BUILDERS["client.requirement_collection"](
  { clientName: "Asha", outstandingItem: "preferred budget range" });
const remOk = CLIENT_ACTION_VARIABLE_BUILDERS["client.missing_information_reminder"](
  { clientName: "Asha", outstandingItem: "preferred budget range" });
const folOk = CLIENT_ACTION_VARIABLE_BUILDERS["client.transactional_followup"](
  { clientName: "Asha", leadReference: "QF-LEAD-1001" });
const keysOf = (r) => (r.ok ? Object.keys(r.variables).sort().join(",") : `FAIL:${r.reason}`);

record("B07 requirement_collection emits exactly client_name + outstanding_item",
  keysOf(reqOk) === "client_name,outstanding_item");
record("B08 missing_information_reminder emits exactly client_name + outstanding_item",
  keysOf(remOk) === "client_name,outstanding_item");
record("B09 transactional_followup emits exactly client_name + lead_reference",
  keysOf(folOk) === "client_name,lead_reference");
record("B10 emitted values are the trimmed inputs",
  reqOk.ok && reqOk.variables.client_name === "Asha" &&
  reqOk.variables.outstanding_item === "preferred budget range");

const draftBuilders = ["client.requirement_collection", "client.missing_information_reminder"];
record("B11 missing variable fails closed",
  draftBuilders.every((a) => CLIENT_ACTION_VARIABLE_BUILDERS[a]({ clientName: "Asha" }).ok === false));
record("B12 non-string fails closed (never [object Object])",
  draftBuilders.every((a) =>
    CLIENT_ACTION_VARIABLE_BUILDERS[a]({ clientName: { n: 1 }, outstandingItem: "x" }).ok === false &&
    CLIENT_ACTION_VARIABLE_BUILDERS[a]({ clientName: ["Asha"], outstandingItem: "x" }).ok === false));
record("B13 blank/whitespace fails closed",
  draftBuilders.every((a) =>
    CLIENT_ACTION_VARIABLE_BUILDERS[a]({ clientName: "   ", outstandingItem: "x" }).ok === false));
record("B14 over-length fails closed",
  draftBuilders.every((a) =>
    CLIENT_ACTION_VARIABLE_BUILDERS[a]({ clientName: "a".repeat(201), outstandingItem: "x" }).ok === false));
record("B15 exactly 200 characters is accepted (boundary)",
  CLIENT_ACTION_VARIABLE_BUILDERS["client.requirement_collection"](
    { clientName: "a".repeat(200), outstandingItem: "x" }).ok === true);
record("B16 control characters fail closed",
  ["\n", "\r", "\t"].every((c) =>
    CLIENT_ACTION_VARIABLE_BUILDERS["client.requirement_collection"](
      { clientName: `As${c}ha`, outstandingItem: "x" }).ok === false));
record("B17 extra input fields never leak into the emitted set",
  keysOf(CLIENT_ACTION_VARIABLE_BUILDERS["client.transactional_followup"]({
    clientName: "Asha", leadReference: "QF-LEAD-1001",
    destination: "SYNTHETIC_DESTINATION", templateKey: "other", providerAccountId: "x",
  })) === "client_name,lead_reference");
record("B18 declared draft source keys match the emitted sets",
  CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS.clarification_request.join(",") === "client_name,outstanding_item" &&
  CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS.clarification_reminder.join(",") === "client_name,outstanding_item" &&
  CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS.client_transactional_followup.join(",") === "client_name,lead_reference");
record("B19 draft contract map is frozen and holds exactly three entries",
  Object.isFrozen(CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS) &&
  Object.keys(CLIENT_DRAFT_TEMPLATE_SOURCE_KEYS).length === 3);
record("B20 variable module accepts no destination/template/provider override",
  !/destination|providerAccount|provider_account|templateOverride|phone/i.test(variablesCode));

// ---------------------------------------------------------------------------
// C. QF-MVP-40.12 SEPARATION
// ---------------------------------------------------------------------------
const FIVE = ["lead_received", "client_lead_status_update", "client_matching_update",
  "lead_assignment_alert", "vendor_onboarding_reminder"];
record("C01 BUSINESS_TEMPLATE_CONTRACTS remains exactly five",
  Object.keys(BUSINESS_TEMPLATE_CONTRACTS).length === 5);
record("C02 the five approved ordinary templates are unchanged",
  [...Object.keys(BUSINESS_TEMPLATE_CONTRACTS)].sort().join(",") === [...FIVE].sort().join(","));
record("C03 BUSINESS_TEMPLATE_KEYS remains five", BUSINESS_TEMPLATE_KEYS.length === 5);
record("C04 clarification_request NOT added to the 40.12 registry",
  !("clarification_request" in BUSINESS_TEMPLATE_CONTRACTS));
record("C05 clarification_reminder NOT added to the 40.12 registry",
  !("clarification_reminder" in BUSINESS_TEMPLATE_CONTRACTS));
record("C06 client_transactional_followup NOT added to the 40.12 registry",
  !("client_transactional_followup" in BUSINESS_TEMPLATE_CONTRACTS));
record("C07 40.12 builder map remains five", Object.keys(BUSINESS_VARIABLE_BUILDERS).length === 5);
record("C08 50.2C does not mutate the 40.12 module",
  !/BUSINESS_TEMPLATE_CONTRACTS\s*\[|Object\.assign\(\s*BUSINESS/.test(variablesCode));

// ---------------------------------------------------------------------------
// D. PROVIDER CATALOGUE REMAINS CLOSED
// ---------------------------------------------------------------------------
// ---- G0: the historical authority itself -------------------------------------------
record("D00a the 50.2C implementation head exists",
  commitExists(QF_MVP_50_2C_IMPLEMENTATION_HEAD));
record("D00b the 50.2C implementation head is an ancestor of current HEAD",
  isAncestorOfHead(QF_MVP_50_2C_IMPLEMENTATION_HEAD));
record("D00c the historical manifest and packet loaded from that exact commit",
  historicalLoadFailed === false
  && typeof historicalManifestRaw === "string" && historicalManifestRaw.length > 0
  && typeof historicalPacketRaw === "string" && historicalPacketRaw.length > 0);
record("D00d the historical bytes differ from the current tree, proving no fallback", (() => {
  // If the loader ever silently fell back to the working tree these would be identical,
  // and every historical assertion below would be re-testing today's catalogue again.
  const curManifest = read(MANIFEST_REL);
  const curPacket = read(PACKET_REL);
  return !historicalLoadFailed
    && historicalManifestRaw !== curManifest && historicalPacketRaw !== curPacket;
})());

// ---- HISTORICAL provider-catalogue facts, proven against the frozen head -------------
record("D01 at the 50.2C head the provider manifest held exactly 25 templates",
  hist(() => histManifestEntries.length === 25));
record("D02 at the 50.2C head the submission packet held exactly 25 templates",
  hist(() => histPacketEntries.length === 25));
record("D03 at the 50.2C head client_transactional_followup was NOT a provider candidate",
  hist(() => !histManifestByKey.has("client_transactional_followup")
    && !histPacketByKey.has("client_transactional_followup")));
record("D04 at the 50.2C head no qf_client_transactional_followup provider name existed",
  hist(() => !/qf_client_transactional_followup/.test(historicalManifestRaw + historicalPacketRaw)));
record("D05 at the 50.2C head the P0 clarification_reminder body was as pinned",
  hist(() => histPacketByKey.get("clarification_reminder").creation_payload.components
    .find((c) => c.type === "body").text ===
    "Hi {{1}}, just a reminder from QuickFurno: please share {{2}} so we can complete your match."));
record("D06 at the 50.2C head the P0 clarification_reminder fingerprint was as pinned",
  hist(() => histPacketByKey.get("clarification_reminder").payload_fingerprint ===
    "87c5420a8d97ab4de45e6c34eb0312cf957a9c53b28435cfeb3ffe3ce92f1474"));
record("D07 at the 50.2C head clarification_request/reminder were unsubmitted drafts",
  hist(() => ["clarification_request", "clarification_reminder"].every((k) =>
    histPacketByKey.get(k).local_state.approval_status === "draft" &&
    histPacketByKey.get(k).local_state.submission_state === "DRAFT_NOT_SUBMITTED" &&
    histPacketByKey.get(k).local_state.provider_template_id === null)));
record("D08 at the 50.2C head their binding_readiness was unresolved",
  hist(() => ["clarification_request", "clarification_reminder"].every((k) =>
    histManifestByKey.get(k).binding_contract.binding_readiness === "unresolved")));
// NOTE: there is deliberately NO assertion pinning the CURRENT catalogue count or state.
// Current provider truth belongs to the QF-MVP-40 validators; re-pinning it here would
// recreate the very cross-phase coupling this repair removes.
record("D09 client_nurture_followup remains marketing and is not the followup template",
  manifestByKey.get("client_nurture_followup").category === "marketing" &&
  CLIENT_DISPATCH_REGISTRY["client.transactional_followup"].templateKey !== "client_nurture_followup");
record("D10 50.2C source claims no provider approval or mapping authority",
  !/APPROVED_UNMAPPED|provider_template_id|submission_authorization|mapping_activation/.test(newModuleCode));

// ---------------------------------------------------------------------------
// E. workflowFamily
// ---------------------------------------------------------------------------
record("E01 all 14 registered actions map to exactly one family",
  AUTOMATION_ACTION_TYPES.length === 14 &&
  AUTOMATION_ACTION_TYPES.every((a) =>
    ["client_whatsapp", "vendor_whatsapp", "campaign_execution"].includes(getWorkflowFamilyForAction(a))));
record("E02 the six client actions map to client_whatsapp",
  CLIENT_ACTIONS.every((a) => getWorkflowFamilyForAction(a) === "client_whatsapp"));
record("E03 vendor and campaign families are unchanged",
  getWorkflowFamilyForAction("vendor.lead_offer") === "vendor_whatsapp" &&
  getWorkflowFamilyForAction("campaign.execute_batch") === "campaign_execution");

const authorized = (actionType) => ({
  request: {
    contractVersion: 1, requestId: "11111111-1111-4111-8111-111111111111",
    actionType, entityType: "lead", entityId: "22222222-2222-4222-8222-222222222222",
    source: "core", requestedBy: { actorType: "core_service", actorId: "qf-50-2c-validator" },
    requestedAt: "2026-08-03T00:00:00.000Z",
    idempotencyKey: "qf-50-2c-idem-1", correlationId: "qf-50-2c-corr-1",
    safeContext: { gate: "qf-mvp-50-2c" },
  },
  authorization: {
    decision: "authorized", authorizationId: "33333333-3333-4333-8333-333333333333",
    authorizedBy: { actorType: "core_service", actorId: "qf-50-2c-validator" },
    authorizedAt: "2026-08-03T00:00:01.000Z",
  },
});
const envClient = buildAutomationJobEnvelope(authorized("client.lead_confirmation"),
  "44444444-4444-4444-8444-444444444444");
const envVendor = buildAutomationJobEnvelope(authorized("vendor.lead_offer"),
  "44444444-4444-4444-8444-444444444444");
const envCampaign = buildAutomationJobEnvelope(authorized("campaign.execute_batch"),
  "44444444-4444-4444-8444-444444444444");

record("E04 envelope carries workflowFamily", "workflowFamily" in envClient);
record("E05 envelope family is Core-derived and correct per family",
  envClient.workflowFamily === "client_whatsapp" &&
  envVendor.workflowFamily === "vendor_whatsapp" &&
  envCampaign.workflowFamily === "campaign_execution");
record("E06 envelope remains frozen", Object.isFrozen(envClient));
let unregisteredRejected = false;
try {
  buildAutomationJobEnvelope(authorized("client.not_registered"),
    "44444444-4444-4444-8444-444444444444");
} catch { unregisteredRejected = true; }
record("E07 unregistered action cannot produce an envelope", unregisteredRejected);
record("E08 family is derived from the single registry source, never copied",
  /getWorkflowFamilyForAction\(/.test(contractCode) &&
  !/client_whatsapp/.test(contractCode));
record("E09 no caller-supplied or safeContext family override path",
  !/workflowFamily\s*[:=]\s*(input|request|authorized\.request\.safeContext|args)/.test(contractCode) &&
  !/safeContext.*workflowFamily|workflowFamily.*safeContext/.test(contractCode));
const envOverride = buildAutomationJobEnvelope(
  (() => { const a = authorized("client.lead_confirmation");
    a.request.safeContext = { workflowFamily: "campaign_execution" }; return a; })(),
  "44444444-4444-4444-8444-444444444444");
record("E10 a safeContext workflowFamily cannot override the derived family",
  envOverride.workflowFamily === "client_whatsapp");
record("E11 the actionContract change is confined to the family derivation",
  (contractCode.match(/workflowFamily/g) ?? []).length === 2 &&
  (contractCode.match(/getWorkflowFamilyForAction/g) ?? []).length === 2 &&
  !/fetch\(|adminClient|process\.env|supabase/i.test(contractCode));

// ---------------------------------------------------------------------------
// F. RECIPIENT
// ---------------------------------------------------------------------------
record("F01 CommunicationRecipientType includes lead",
  /\|\s*"lead"/.test(typesSource));
record("F02 lead is not equated with client/vendor/admin in the type",
  !/"lead"\s*\|\s*"client"\s*=|lead\s*=\s*client/.test(typesSource));
record("F03 resolver has an explicit lead branch",
  /case "lead":/.test(resolverCode) && leadBody.length > 0);
record("F04 lead resolver reads public.leads by id",
  /from\("leads"\)[\s\S]{0,120}\.eq\("id", leadId\)/.test(leadBody));
record("F05 lead resolver selects only the phone column, exactly once",
  /from\("leads"\)\s*\n?\s*\.select\("phone"\)/.test(leadBody) &&
  (leadBody.match(/\.select\(/g) ?? []).length === 1);
record("F06 lead resolver uses the canonical normalization path",
  /normalizeResolvedDestination/.test(leadBody));
record("F07 lead resolver has no client_accounts fallback",
  !/client_accounts|vendors|phone_e164/.test(leadBody));
record("F08 lead resolver performs no write",
  !/\.(update|insert|upsert|delete|rpc)\(/.test(leadBody));
record("F09 lead resolver fails closed on missing row / bad phone",
  /RECIPIENT_NOT_FOUND/.test(leadBody) && /RECIPIENT_LOOKUP_FAILED/.test(leadBody));

// ---------------------------------------------------------------------------
// G. CONSENT
// ---------------------------------------------------------------------------
record("G01 lead is NOT a consent principal",
  /CONSENT_PRINCIPAL_TYPES[^\n]*=\s*\[\s*"client",\s*"vendor",\s*"admin"\s*\]/.test(consentSource));
record("G02 consent identity still derives from destinationSource + principal type",
  /destinationSource !== "recipient_reference"/.test(consentSource));
record("G03 destination-hash suppression remains the authority",
  /destinationHash/.test(consentSource));
record("G04 50.2C introduces no consent or suppression bypass",
  !/ignore[_ ]?consent|bypass[_ ]?consent|skip[_ ]?consent|bypass[_ ]?suppression|force[_ ]?send/i.test(newModuleCode));
record("G05 50.2C never asserts a principal for a lead",
  !/CONSENT_PRINCIPAL|identityConfidence|principal/i.test(newModuleCode));
record("G06 marketing is never a 50.2C consent scope",
  !/marketing/i.test(registryCode) &&
  CLIENT_ACTIONS.every((a) => CLIENT_DISPATCH_REGISTRY[a].consentScope === "transactional"));

// ---------------------------------------------------------------------------
// H. IDEMPOTENCY
// ---------------------------------------------------------------------------
const J1 = "44444444-4444-4444-8444-444444444444";
const J2 = "55555555-5555-4555-8555-555555555555";
const A1 = "66666666-6666-4666-8666-666666666666";
const A2 = "77777777-7777-4777-8777-777777777777";
const k11 = buildAutomationCommunicationIdempotencyKey(J1, A1);
record("H01 exact qf_auto_v1:{jobId}:{attemptId} format", k11 === `qf_auto_v1:${J1}:${A1}`);
record("H02 prefix constant matches", AUTOMATION_COMMUNICATION_IDEMPOTENCY_PREFIX === "qf_auto_v1");
record("H03 deterministic for the same pair",
  k11 === buildAutomationCommunicationIdempotencyKey(J1, A1));
record("H04 different attempt yields a different key",
  k11 !== buildAutomationCommunicationIdempotencyKey(J1, A2));
record("H05 different job yields a different key",
  k11 !== buildAutomationCommunicationIdempotencyKey(J2, A1));
record("H06 invalid ids fail closed",
  buildAutomationCommunicationIdempotencyKey("not-a-uuid", A1) === null &&
  buildAutomationCommunicationIdempotencyKey(J1, "") === null &&
  buildAutomationCommunicationIdempotencyKey(null, A1) === null &&
  buildAutomationCommunicationIdempotencyKey(J1, { id: A1 }) === null);
record("H07 key is bounded well under the ledger column", k11.length <= 200 && k11.length === 84);
record("H08 key embeds no destination/template/provider/action authority",
  !/lead|client|template|provider|phone|\+\d/.test(k11));

// ---------------------------------------------------------------------------
// I. MIGRATION
// ---------------------------------------------------------------------------
record("I01 exactly one 50.2C migration file",
  migration.length > 0 && migrationName.startsWith("20260803000000_qf_mvp_50_2c"));
record("I02 migration adds lead to the recipient vocabulary",
  /'client',\s*'vendor',\s*'admin',\s*'lead',\s*'integration',\s*'system'/.test(migrationCode));
record("I03 every previously accepted recipient value is preserved",
  ["client", "vendor", "admin", "integration", "system"].every((v) =>
    new RegExp(`'${v}'`).test(migrationCode)));
record("I04 migration targets communication_messages only",
  /alter table public\.communication_messages/.test(migrationCode) &&
  !/alter table public\.(automation_|leads|vendors|client_accounts|communication_provider)/.test(migrationCode));
record("I05 no ownership/linkage column is added",
  !/client_account_id|user_id|created_by|owner_id/.test(migrationCode));
record("I06 no data write, backfill or seed",
  !/\b(insert into|update\s+public\.|delete from|truncate)\b/i.test(migrationCode));
record("I07 no automation, transport or provider-mapping schema change",
  !/automation_jobs|automation_execution_attempts|automation_transport_requests|communication_provider_template_mappings/.test(migrationCode));
record("I08 forward-only: no historical migration was edited",
  !/drop table|drop column/i.test(migrationCode));
record("I09 migration is transactional", /^begin;/m.test(migrationCode) && /^commit;/m.test(migrationCode));

// ---------------------------------------------------------------------------
// I-R1. FAIL-CLOSED CONSTRAINT DISCOVERY (QF-MVP-50.2C-R1)
//
// Each rule is expressed as a predicate over migration SQL text so the same rule can be
// re-run against a deliberately mutated copy below. A rule that still passes on the
// mutant is not load-bearing and is reported as such.
// ---------------------------------------------------------------------------
const MIG_RULES = {
  resolvesRelationStructurally: (sql) =>
    /to_regclass\('public\.communication_messages'\)/.test(sql) &&
    /v_relid\s+is\s+null/.test(sql),
  resolvesColumnStructurally: (sql) =>
    /pg_attribute/.test(sql) &&
    /attname\s*=\s*'recipient_type'/.test(sql) &&
    /not\s+att\.attisdropped/.test(sql) &&
    /attnum\s*>\s*0/.test(sql),
  matchesConstraintByConkey: (sql) =>
    /con\.conrelid\s*=\s*v_relid/.test(sql) &&
    /con\.contype\s*=\s*'c'/.test(sql) &&
    /con\.conkey\s*=\s*array\[\s*v_recipient_attnum\s*\]::smallint\[\]/.test(sql),
  notTextMatchAuthority: (sql) => !/pg_get_constraintdef/.test(sql),
  noLimitOne: (sql) => !/\blimit\s+1\b/i.test(sql),
  requiresExactlyOne: (sql) =>
    /v_constraint_count\s*=\s*0/.test(sql) && /v_constraint_count\s*>\s*1/.test(sql),
  raisesOnMissing: (sql) => /QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_MISSING/.test(sql),
  raisesOnAmbiguous: (sql) => /QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_AMBIGUOUS/.test(sql),
  raisesOnMissingColumn: (sql) => /QF_MVP_50_2C_RECIPIENT_TYPE_COLUMN_MISSING/.test(sql),
  noPermissiveSkip: (sql) => !/if\s+v_constraint\s+is\s+not\s+null\s+then/i.test(sql),
  noSwallowingHandler: (sql) => !/\bexception\s+when\b/i.test(sql),
  dropOnlyAfterProof: (sql) => {
    const proof = sql.search(/v_constraint_count\s*>\s*1/);
    const drop = sql.search(/drop\s+constraint/i);
    return proof !== -1 && drop !== -1 && proof < drop;
  },
  identifierSafeDrop: (sql) => /format\(\s*\n?\s*'alter table public\.communication_messages drop constraint %I'/.test(sql),
  exactSixValues: (sql) =>
    /check\s*\(recipient_type in \('client', 'vendor', 'admin', 'lead', 'integration', 'system'\)\)/.test(sql),
  namedReplacement: (sql) => /add constraint communication_messages_recipient_type_check/.test(sql),
  noDml: (sql) => !/\b(insert\s+into|update\s+public\.|delete\s+from|truncate|copy\s+public\.)\b/i.test(sql),
  strictNameFetch: (sql) => /into\s+strict\s+v_constraint/.test(sql),
  locksBeforeProof: (sql) => {
    const lock = sql.search(/lock\s+table\s+%s\s+in\s+access\s+exclusive\s+mode/i);
    // Anchor on the ASSIGNMENT, not the DECLARE section where the name first appears.
    const proof = sql.search(/into\s+v_constraint_count/);
    return lock !== -1 && proof !== -1 && lock < proof;
  },
  schemaQualifiedCatalogues: (sql) =>
    /pg_catalog\.pg_attribute/.test(sql) && /pg_catalog\.pg_constraint/.test(sql) &&
    !/\bfrom\s+pg_attribute\b/.test(sql) && !/\bfrom\s+pg_constraint\b/.test(sql),
  residualCheckPostCondition: (sql) =>
    /con\.conkey\s*&&\s*array\[\s*v_recipient_attnum\s*\]::smallint\[\]/.test(sql) &&
    /v_residual_count\s*<>\s*1/.test(sql) &&
    /QF_MVP_50_2C_RECIPIENT_TYPE_RESIDUAL_CONSTRAINT/.test(sql),
  postConditionAfterAdd: (sql) => {
    const add = sql.search(/add constraint communication_messages_recipient_type_check/);
    // Anchor on the ASSIGNMENT, not the DECLARE section where the name first appears.
    const post = sql.search(/into\s+v_residual_count/);
    return add !== -1 && post !== -1 && add < post;
  },
};
const MIG_RULE_LABELS = {
  resolvesRelationStructurally: "R01 resolves communication_messages via to_regclass and guards null",
  resolvesColumnStructurally: "R02 resolves recipient_type attnum structurally from pg_attribute",
  matchesConstraintByConkey: "R03 matches the CHECK by exact single-column conkey",
  notTextMatchAuthority: "R04 pg_get_constraintdef text matching is no longer the authority",
  noLimitOne: "R05 no LIMIT 1 anywhere in the migration",
  requiresExactlyOne: "R06 requires exactly one matching constraint (0 and >1 both handled)",
  raisesOnMissing: "R07 zero-match raises QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_MISSING",
  raisesOnAmbiguous: "R08 multi-match raises QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_AMBIGUOUS",
  raisesOnMissingColumn: "R09 missing recipient_type column raises fail-closed",
  noPermissiveSkip: "R10 no permissive 'if v_constraint is not null then' skip remains",
  noSwallowingHandler: "R11 no exception handler can swallow the failure and continue",
  dropOnlyAfterProof: "R12 the drop happens only after the exact-one proof",
  identifierSafeDrop: "R13 drop uses format('%I', ...) for the identifier",
  exactSixValues: "R14 replacement CHECK holds exactly the six expected values",
  namedReplacement: "R15 replacement constraint is explicitly named",
  noDml: "R16 no INSERT/UPDATE/DELETE/TRUNCATE/COPY",
  strictNameFetch: "R17 constraint name is fetched with INTO STRICT, never a silent first row",
  locksBeforeProof: "R18 the relation is locked before the exact-one proof, not after",
  schemaQualifiedCatalogues: "R19 catalogue reads are schema-qualified against search_path",
  residualCheckPostCondition: "R20 post-condition proves no residual CHECK still gates recipient_type",
  postConditionAfterAdd: "R21 the residual post-condition runs after the replacement is added",
};
for (const [key, fn] of Object.entries(MIG_RULES)) {
  record(MIG_RULE_LABELS[key], fn(migrationCode));
}

// --- mutation self-tests: each mutant must be caught by at least one rule ----
const MIG_MUTANTS = [
  ["M01 permissive skip instead of exact-one",
    (s) => s.replace(/if v_constraint_count = 0 then[\s\S]*?end if;\s*\n\s*if v_constraint_count > 1 then[\s\S]*?end if;/,
      "if v_constraint is not null then\n    null;\n  end if;")],
  ["M02 LIMIT 1 reintroduced",
    (s) => s.replace("and con.conkey = array[v_recipient_attnum]::smallint[];",
      "and con.conkey = array[v_recipient_attnum]::smallint[]\n   limit 1;")],
  ["M03 missing-constraint raise removed",
    (s) => s.replace(/if v_constraint_count = 0 then[\s\S]*?end if;/, "")],
  ["M04 ambiguous-constraint raise removed",
    (s) => s.replace(/if v_constraint_count > 1 then[\s\S]*?end if;/, "")],
  ["M05 back to pg_get_constraintdef text matching",
    (s) => s.replace("con.conkey = array[v_recipient_attnum]::smallint[]",
      "pg_get_constraintdef(con.oid) ilike '%recipient_type%'")],
  ["M06 lead removed from the replacement CHECK",
    (s) => s.replace("'client', 'vendor', 'admin', 'lead', 'integration', 'system'",
      "'client', 'vendor', 'admin', 'integration', 'system'")],
  ["M07 an existing recipient type dropped",
    (s) => s.replace("'client', 'vendor', 'admin', 'lead', 'integration', 'system'",
      "'client', 'vendor', 'lead', 'integration', 'system'")],
  ["M08 identifier interpolated unsafely",
    (s) => s.replace("format(\n    'alter table public.communication_messages drop constraint %I',\n    v_constraint\n  )",
      "'alter table public.communication_messages drop constraint ' || v_constraint")],
  ["M09 swallowing exception handler added",
    (s) => s.replace("end\n$$;", "exception when others then\n    null;\nend\n$$;")],
  ["M10 a data write introduced",
    (s) => s.replace("commit;", "update public.communication_messages set recipient_type = 'lead';\n\ncommit;")],
  ["M11 strict name fetch downgraded to a silent first-row pick",
    (s) => s.replace("into strict v_constraint", "into v_constraint")],
  ["M12 residual-CHECK post-condition removed",
    (s) => s.replace(/select count\(\*\)\s*\n\s*into v_residual_count[\s\S]*?end if;/, "")],
  ["M13 post-condition weakened to allow a residual CHECK",
    (s) => s.replace("v_residual_count <> 1", "v_residual_count < 1")],
  ["M14 lock moved after the exact-one proof",
    (s) => s.replace(/  execute format\('lock table %s in access exclusive mode', v_relid::regclass\);\n/, "")],
  ["M15 catalogue reads de-qualified (search_path exposure)",
    (s) => s.replace(/pg_catalog\.pg_constraint/g, "pg_constraint")],
];
for (const [label, mutate] of MIG_MUTANTS) {
  const mutant = mutate(migrationCode);
  const changed = mutant !== migrationCode;
  const caught = Object.values(MIG_RULES).some((fn) => !fn(mutant));
  record(`R-MUT ${label}`, changed && caught);
}

// ---------------------------------------------------------------------------
// J. NEGATIVE AUTHORITY SCAN
// ---------------------------------------------------------------------------
const BANNED = {
  "access token": /access[_ ]?token/i,
  "Meta credential": /META_ACCESS_TOKEN|graph\.facebook|waba|phone_number_id/i,
  "provider secret": /provider[_ ]?secret|app[_ ]?secret|bearer/i,
  "destination override": /destinationOverride|overrideDestination|recipientOverride/i,
  "template override": /templateOverride|overrideTemplate/i,
  "provider account override": /providerAccountOverride|overrideProviderAccount/i,
  "consent bypass": /bypass[_ ]?consent|ignore[_ ]?consent/i,
  "suppression bypass": /bypass[_ ]?suppression|ignore[_ ]?suppression/i,
  "credit/package mutation": /credit[_ ]?delta|deduct|restoreCredit|package[_ ]?update/i,
  "assignment mutation": /assignVendor|assignment[_ ]?update/i,
  "Jarvis direct execution": /jarvis|riya|anisha/i,
  "provider network call": /fetch\(|axios|httpRequest|https?:\/\//i,
  "attempt completion": /completeAutomationAttempt|qf_complete_automation_attempt/i,
  "retry scheduling": /next_retry_at|nextRetryAt|scheduleRetry/i,
  "stale processing reclaim": /reclaim|stale[_ ]?processing/i,
  "supabase client": /adminClient|supabase|service[_ ]?role/i,
};
for (const [label, re] of Object.entries(BANNED)) {
  record(`J-${label}`, !re.test(newModuleCode));
}

// ---------------------------------------------------------------------------
// H0. HISTORICAL-DECOUPLING MUTATION SELF-TESTS
//
// Each mutant models a way the decoupling could be silently undone — most dangerously by
// re-pointing the frozen head at HEAD, or by letting a failed history load fall back to the
// current tree so the "historical" assertions quietly re-test today's catalogue again.
// Every mutant must be CAUGHT (the corrupted form must evaluate false).
// ---------------------------------------------------------------------------
const validatorSource = read("scripts/mvp/automation/validate-qf-mvp-50-2c.mjs");
const HEAD_SHA = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { return null; }
})();

/** Re-runs the historical fact set against an arbitrary commit. */
const historicalFactsHoldAt = (sha) => {
  try {
    const m = execFileSync("git", ["show", `${sha}:${MANIFEST_REL}`],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const p = execFileSync("git", ["show", `${sha}:${PACKET_REL}`],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const me = collectEntries(JSON.parse(m));
    const pe = collectEntries(JSON.parse(p));
    return me.length === 25 && pe.length === 25
      && !new Map(me.map((e) => [e.internal_template_key, e])).has("client_transactional_followup")
      && !/qf_client_transactional_followup/.test(m + p);
  } catch { return false; }
};

const H_MUT = [
  ["M01 pointing the frozen head at current HEAD is caught",
    () => HEAD_SHA !== null && historicalFactsHoldAt(HEAD_SHA) === false],
  ["M02 pointing the frozen head at the later QF-MVP-40 catalogue commit is caught",
    // 210f784 is exactly where QF-MVP-40 legitimately took the catalogue to 26 and added
    // client_transactional_followup. Re-pointing the frozen head there must NOT satisfy the
    // historical facts — that is what makes this pin load-bearing rather than decorative.
    () => historicalFactsHoldAt("210f78442eff0a2adef6561e6692be97412e9171") === false
      && historicalFactsHoldAt(QF_MVP_50_2C_IMPLEMENTATION_HEAD) === true],
  ["M03 a nonexistent head is caught, never treated as vacuously true",
    () => commitExists("0000000000000000000000000000000000000000") === false
      && historicalFactsHoldAt("0000000000000000000000000000000000000000") === false],
  ["M04 removing the ancestry check is caught",
    () => /isAncestorOfHead\(QF_MVP_50_2C_IMPLEMENTATION_HEAD\)/.test(validatorSource)
      && isAncestorOfHead("0000000000000000000000000000000000000000") === false],
  ["M05 a manifest loader falling back to the current file is caught",
    () => hist(() => historicalManifestRaw === read(MANIFEST_REL)) === false],
  ["M06 a packet loader falling back to the current file is caught",
    () => hist(() => historicalPacketRaw === read(PACKET_REL)) === false],
  ["M07 a failed historical load can never read as a pass", () => {
    // Replicates the guard shape with the failure flag forced true: even a tautology must
    // return false. Also proves the REAL loader has no `?? current` fallback and that a
    // throw sets the flag rather than substituting the working tree.
    const guardWith = (failed) => (fn) => {
      if (failed) return false;
      try { return fn() === true; } catch { return false; }
    };
    const failClosed = guardWith(true)(() => true) === false
      && guardWith(false)(() => true) === true;
    const loader = validatorSource.slice(
      validatorSource.indexOf("let historicalLoadFailed = true;"),
      validatorSource.indexOf("const collectEntries"));
    const noFallback = !/\?\?\s*read\(|\|\|\s*read\(|catch\s*\{[^}]*read\(/.test(loader)
      && /historicalLoadFailed = true;/.test(loader);
    return failClosed && noFallback;
  }],
  ["M08 changing the historical 25 count is caught",
    () => histManifestEntries.length !== 26 && histPacketEntries.length !== 26],
  ["M09 removing the historical client_transactional_followup absence check is caught",
    () => /at the 50\.2C head client_transactional_followup was NOT a provider candidate/
      .test(validatorSource)],
  ["M10 removing the historical qf_client_transactional_followup name check is caught",
    () => /at the 50\.2C head no qf_client_transactional_followup provider name existed/
      .test(validatorSource)],
  ["M11 removing the historical clarification draft-state check is caught",
    () => /at the 50\.2C head clarification_request\/reminder were unsubmitted drafts/
      .test(validatorSource)],
  ["M12 weakening any historical assertion to a floor/range/prefix is caught", () => {
    const dBlock = validatorSource.slice(validatorSource.indexOf('record("D01'),
      validatorSource.indexOf('record("D09'));
    return !/>=|<=|length\s*>|length\s*<|startsWith|\.some\(/.test(dBlock)
      && /=== 25/.test(dBlock);
  }],
  ["M13 no CURRENT catalogue count is pinned anywhere in 50.2C", () => {
    // Pinning today's count would recreate the cross-phase bug this repair removes.
    const dBlock = validatorSource.slice(validatorSource.indexOf('record("D00a'),
      validatorSource.indexOf('record("D09'));
    return !/manifestEntries\.length ===|packetEntries\.length ===/.test(dBlock);
  }],
];
for (const [name, fn] of H_MUT) {
  let caught = false;
  try { caught = fn() === true; } catch { caught = false; }
  record(`H0-${name}`, caught);
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}`);
console.log("");
console.log(`QF-MVP-50.2C: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QF_MVP_50_2C_CLIENT_DISPATCH_AUTHORITY_CONTRACT_READY");
}
