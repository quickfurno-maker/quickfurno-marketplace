#!/usr/bin/env node
/**
 * QF-MVP-50.2A fresh n8n dispatcher scaffold validator.
 *
 * Offline/static only. No network, DB, n8n, Meta, Jarvis, credentials or env.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflowPath = path.join(
  ROOT,
  "automation/n8n/QF-MVP-50-01-Core-Job-Dispatcher.workflow.json",
);
const docPath = path.join(
  ROOT,
  "docs/QF-MVP-50-2A-FRESH-N8N-DISPATCHER.md",
);

const workflowText = readFileSync(workflowPath, "utf8");
const doc = readFileSync(docPath, "utf8");
const workflow = JSON.parse(workflowText);

const results = [];
const record = (name, ok) => results.push({ name, ok: Boolean(ok) });
const nodes = workflow.nodes ?? [];
const nodeTypes = nodes.map((node) => node.type);
const nodeNames = nodes.map((node) => node.name);
const serializedNodes = JSON.stringify(nodes);
const allText = workflowText + "\n" + doc;

const forbiddenNodeFragments = [
  "httpRequest",
  "webhook",
  "postgres",
  "supabase",
  "whatsapp",
  "facebookGraphApi",
  "facebook",
  "mysql",
  "mssql",
  "mongoDb",
  "redis",
  "executeCommand",
  "ssh",
  "ftp",
];

const forbiddenSecretTerms = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "META_ACCESS_TOKEN",
  "WHATSAPP_TOKEN",
  "QF_N8N_TO_CORE_HMAC_SECRET=",
  "QF_CORE_TO_N8N_HMAC_SECRET=",
  "Bearer ",
];

// 1. Workflow identity and top-level safety.
record("01 workflow name exact", workflow.name === "QF-MVP-50-01-Core-Job-Dispatcher");
record("02 workflow active is false", workflow.active === false);
record("03 workflow has exactly five nodes", nodes.length === 5);
record("04 workflow has no tags", Array.isArray(workflow.tags) && workflow.tags.length === 0);
record("05 workflow pinData is empty", workflow.pinData && Object.keys(workflow.pinData).length === 0);
record("06 workflow timezone is UTC", workflow.settings?.timezone === "UTC");
record("07 workflow execution order is v1", workflow.settings?.executionOrder === "v1");
record("08 success execution data is not saved", workflow.settings?.saveDataSuccessExecution === "none");
record("09 error execution data remains reviewable", workflow.settings?.saveDataErrorExecution === "all");
record("10 manual executions may be saved for import proof", workflow.settings?.saveManualExecutions === true);

// 2. Exact nodes.
record("11 one schedule trigger exists", nodeTypes.filter((t) => t === "n8n-nodes-base.scheduleTrigger").length === 1);
record("12 schedule trigger uses supported 1.3 export", nodes.some((n) => n.type === "n8n-nodes-base.scheduleTrigger" && n.typeVersion === 1.3));
record("13 schedule cadence is one minute", nodes.some((n) => n.name === "Schedule Trigger — INACTIVE" && n.parameters?.rule?.interval?.[0]?.field === "minutes" && n.parameters?.rule?.interval?.[0]?.minutesInterval === 1));
record("14 one manual trigger exists", nodeTypes.filter((t) => t === "n8n-nodes-base.manualTrigger").length === 1);
record("15 one Code gate exists", nodeTypes.filter((t) => t === "n8n-nodes-base.code").length === 1);
record("16 Code gate uses typeVersion 2", nodes.some((n) => n.type === "n8n-nodes-base.code" && n.typeVersion === 2));
record("17 one no-op terminal exists", nodeTypes.filter((t) => t === "n8n-nodes-base.noOp").length === 1);
record("18 one security sticky note exists", nodeTypes.filter((t) => t === "n8n-nodes-base.stickyNote").length === 1);
record("19 exact schedule node name", nodeNames.includes("Schedule Trigger — INACTIVE"));
record("20 exact manual node name", nodeNames.includes("Manual Trigger — Safe Test"));
record("21 exact gate node name", nodeNames.includes("50.2A Fail-Closed Gate"));
record("22 exact terminal node name", nodeNames.includes("STOP — Network Disabled"));
record("23 exact sticky-note node name", nodeNames.includes("SECURITY — READ BEFORE ACTIVATION"));

// 3. No network or authority nodes.
record("24 no HTTP Request node", !nodeTypes.some((t) => t.includes("httpRequest")));
record("25 no Webhook node", !nodeTypes.some((t) => /webhook/i.test(t)));
record("26 no Supabase node", !nodeTypes.some((t) => /supabase/i.test(t)));
record("27 no Postgres node", !nodeTypes.some((t) => /postgres/i.test(t)));
record("28 no Meta/Facebook node", !nodeTypes.some((t) => /facebook|meta/i.test(t)));
record("29 no WhatsApp node", !nodeTypes.some((t) => /whatsapp/i.test(t)));
record("30 no database node family", !nodeTypes.some((t) => /mysql|mssql|mongo|redis/i.test(t)));
record("31 no command or shell node", !nodeTypes.some((t) => /executeCommand|ssh/i.test(t)));
record("32 no file transfer node", !nodeTypes.some((t) => /ftp|sftp/i.test(t)));
record("33 forbidden network/authority node fragments absent", forbiddenNodeFragments.every((fragment) => !nodeTypes.some((t) => t.toLowerCase().includes(fragment.toLowerCase()))));
record("34 no credentials object anywhere in nodes", !serializedNodes.includes('"credentials"'));
record("35 no authentication parameter anywhere in nodes", !/"authentication"\s*:/.test(serializedNodes));
record("36 no URL parameter anywhere in nodes", !/"url"\s*:/.test(serializedNodes));
record("37 no endpoint hostname embedded", !/https?:\/\//i.test(serializedNodes));

// 4. Fail-closed marker semantics.
const gate = nodes.find((n) => n.name === "50.2A Fail-Closed Gate");
const jsCode = gate?.parameters?.jsCode ?? "";
record("38 gate marks exact phase", jsCode.includes("phase: 'QF-MVP-50.2A'"));
record("39 gate marks exact dispatcher", jsCode.includes("dispatcher: 'QF-MVP-50-01-Core-Job-Dispatcher'"));
record("40 gate transportVersion is 1", jsCode.includes("transportVersion: 1"));
record("41 gate runtime mode is off", jsCode.includes("runtimeMode: 'off'"));
record("42 gate networkEnabled false", jsCode.includes("networkEnabled: false"));
record("43 gate credentialsConfigured false", jsCode.includes("credentialsConfigured: false"));
record("44 gate executable false", jsCode.includes("executable: false"));
record("45 gate safe code exact", jsCode.includes("QF_50_2A_SECURE_TRANSPORT_NOT_WIRED"));
record("46 gate code contains no fetch", !/\bfetch\s*\(/.test(jsCode));
record("47 gate code contains no require/import", !/\brequire\s*\(|\bimport\s*\(/.test(jsCode));
record("48 gate code contains no crypto secret", !/secret|token|password|apikey|api_key/i.test(jsCode));
record("49 gate code contains no phone/recipient/template authority", !/phone|recipient|template|provider|credit|assignment|consent|suppression/i.test(jsCode));

// 5. Exact connection topology.
const connections = workflow.connections ?? {};
record("50 schedule connects only to gate", connections["Schedule Trigger — INACTIVE"]?.main?.[0]?.length === 1 && connections["Schedule Trigger — INACTIVE"].main[0][0]?.node === "50.2A Fail-Closed Gate");
record("51 manual connects only to gate", connections["Manual Trigger — Safe Test"]?.main?.[0]?.length === 1 && connections["Manual Trigger — Safe Test"].main[0][0]?.node === "50.2A Fail-Closed Gate");
record("52 gate connects only to terminal", connections["50.2A Fail-Closed Gate"]?.main?.[0]?.length === 1 && connections["50.2A Fail-Closed Gate"].main[0][0]?.node === "STOP — Network Disabled");
record("53 terminal has no outgoing connection", !connections["STOP — Network Disabled"]);
record("54 sticky note has no connection", !connections["SECURITY — READ BEFORE ACTIVATION"]);
record("55 exactly three connection sources", Object.keys(connections).length === 3);

// 6. No secret material.
record("56 no forbidden secret term appears in workflow JSON", forbiddenSecretTerms.every((term) => !workflowText.includes(term)));
record("57 no 64-char likely secret literal in workflow JSON", !(workflowText.match(/[A-Za-z0-9_\-]{64,}/g) ?? []).some((value) => !value.includes("SECURE_TRANSPORT_NOT_WIRED")));
record("58 no Supabase project ref in workflow JSON", !/(uckafzuochmbvtiodmcl|yqpgcsduqbxulrlzwzap|coilipywdvxklewquqvv)/.test(workflowText));
record("59 no Meta phone/account identifier placeholders", !/phone_number_id|waba|meta_account/i.test(workflowText));
record("60 no legacy n8n shared-secret header", !/x-qf-n8n-secret|new_n8n_secret/i.test(workflowText));

// 7. Historical isolation and docs.
record("61 doc identifies fresh blank-account workflow", doc.includes("fresh n8n account") || doc.includes("fresh account"));
record("62 doc explicitly blocks historical AOS import", doc.includes("Do not import") && doc.includes("QF-n8n-AOS-Master-Preview-Router.workflow.json"));
record("63 doc says workflow inactive/unpublished", /INACTIVE \/ UNPUBLISHED/.test(doc));
record("64 doc says network blocked", doc.includes("**Network:** BLOCKED"));
record("65 doc says credentials none", doc.includes("**Credentials:** NONE"));
record("66 doc forbids secrets in workflow JSON", doc.includes("workflow JSON") && doc.includes("must never be placed directly"));
record("67 doc forbids secret in Code node", doc.includes("Code node source"));
record("68 doc forbids secret in Crypto node parameter", doc.includes("Crypto node `secret` parameter"));
record("69 doc says no HTTP node in this version", doc.includes("There is no HTTP node in this version"));
record("70 doc names 50.2B authenticated handshake next", doc.includes("50.2B") && doc.includes("signed claim-request construction"));
record("71 doc keeps Meta/WhatsApp out", doc.includes("50.2B still will not send Meta/WhatsApp"));
record("72 doc keeps Jarvis outside n8n", doc.includes("Jarvis/Riya/Anisha do not call this n8n workflow"));
record("73 doc exact import artifact path", doc.includes("automation/n8n/QF-MVP-50-01-Core-Job-Dispatcher.workflow.json"));
record("74 doc exact expected fail-closed marker", doc.includes("QF_50_2A_SECURE_TRANSPORT_NOT_WIRED"));

// 8. Source containment properties.
record("75 workflow JSON parses as object", typeof workflow === "object" && workflow !== null && !Array.isArray(workflow));
record("76 all node IDs are UUID-shaped", nodes.every((n) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(n.id)));
record("77 node IDs are unique", new Set(nodes.map((n) => n.id)).size === nodes.length);
record("78 node names are unique", new Set(nodeNames).size === nodeNames.length);
record("79 workflow versionId is UUID-shaped", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workflow.versionId));
record("80 template credential setup explicitly false", workflow.meta?.templateCredsSetupCompleted === false);
record("81 no unknown top-level activation override", !Object.prototype.hasOwnProperty.call(workflow, "published"));
record("82 no workflow staticData state", !Object.prototype.hasOwnProperty.call(workflow, "staticData"));
record("83 no execution/webhook ID baked into workflow", !/webhookId|executionId|instanceId/.test(workflowText));
record("84 sticky note warns keep inactive", nodes.find((n) => n.type === "n8n-nodes-base.stickyNote")?.parameters?.content?.includes("KEEP THIS WORKFLOW INACTIVE / UNPUBLISHED"));
record("85 sticky note forbids HMAC in node parameters", nodes.find((n) => n.type === "n8n-nodes-base.stickyNote")?.parameters?.content?.includes("Do not paste HMAC secrets"));

// 9. Strong negative side-effect vocabulary check on executable nodes only.
const executableNodeText = JSON.stringify(
  nodes
    .filter((n) => n.type !== "n8n-nodes-base.stickyNote")
    .map(({ notes, ...node }) => node),
);
record("86 executable nodes do not mention Supabase", !/supabase/i.test(executableNodeText));
record("87 executable nodes do not mention Meta", !/meta/i.test(executableNodeText));
record("88 executable nodes do not mention WhatsApp", !/whatsapp/i.test(executableNodeText));
record("89 executable nodes do not mention recipient or phone", !/recipient|phone|mobile/i.test(executableNodeText));
record("90 executable nodes do not mention credit or assignment mutation", !/credit|assignment|assignvendor/i.test(executableNodeText));
record("91 executable nodes do not mention provider", !/provider/i.test(executableNodeText));
record("92 executable nodes do not mention consent/suppression", !/consent|suppression/i.test(executableNodeText));
record("93 executable nodes do not contain secret/token words", !/secret|token|password|api.?key/i.test(executableNodeText));

// 10. No accidentally-real transport contract yet.
record("94 workflow contains no x-qf transport headers", !/x-qf-transport-|x-qf-response-/i.test(workflowText));
record("95 workflow contains no Core claim route", !/api\/internal\/automation\/n8n\/claim/i.test(workflowText));
record("96 workflow contains no HMAC algorithm config", !/hmac|sha256/i.test(executableNodeText));
record("97 workflow contains no retryOnFail", !/retryOnFail|maxTries|waitBetweenTries/.test(workflowText));
record("98 workflow contains no continueOnFail", !/continueOnFail/.test(workflowText));
record("99 workflow contains no child workflow execution node", !nodeTypes.some((t) => /executeWorkflow/i.test(t)));
record("100 workflow is import scaffold, not executor", workflow.active === false && !nodeTypes.some((t) => /httpRequest|webhook|executeWorkflow/i.test(t)) && jsCode.includes("networkEnabled: false") && jsCode.includes("executable: false"));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}`);
console.log("");
console.log(`QF-MVP-50.2A: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QF_MVP_50_2A_FRESH_N8N_DISPATCHER_SCAFFOLD_READY");
}
