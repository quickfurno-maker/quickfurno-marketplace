import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { humanTextExperience } from "../../../lib/jarvis/whatsAppExperience.ts";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log("PASS", name); }
  catch (error) { failed += 1; console.error("FAIL", name, error instanceof Error ? error.message : String(error)); }
}

await test("human reply experience is structurally HUMAN", () => {
  const experience = humanTextExperience("We are checking this for you.");
  assert.equal(experience.actor, "HUMAN");
  assert.equal(experience.kind, "text");
  assert.equal(experience.heading, "QuickFurno Team");
});

await test("human replies require an active HUMAN takeover and exact revision", () => {
  const service = read("services/conversationalWhatsAppService.ts");
  assert.match(service, /conversation\.state !== "HUMAN"/);
  assert.match(service, /conversation\.human_takeover !== true/);
  assert.match(service, /conversation\.assigned_actor !== "HUMAN"/);
  assert.match(service, /Number\(conversation\.revision\) !== input\.expectedRevision/);
  assert.match(service, /input\.source === "HUMAN" && experience\.actor !== "HUMAN"/);
  assert.match(service, /source: "HUMAN"/);
});

await test("human replies still use encrypted idempotent conversation outbox", () => {
  const service = read("services/conversationalWhatsAppService.ts");
  assert.match(service, /queueConversationExperience\(\{/);
  assert.match(service, /qf\.whatsapp\.human\.reply\.v1/);
  assert.match(service, /sealConversationValue/);
  assert.match(service, /communication_conversation_outbox/);
  assert.match(service, /service_window_closed/);
  assert.match(service, /authorizeConversationalWhatsAppConsent/);
  assert.match(service, /CONSENT_SUPPRESSED/);
  assert.doesNotMatch(service, /activeSuppression/);
});

await test("return-to-AI derives actor only from trusted subject type", () => {
  const service = read("services/conversationalWhatsAppService.ts");
  assert.match(service, /subjectType === "client" \? "RIYA"/);
  assert.match(service, /subjectType === "vendor" \? "ANISHA"/);
  assert.match(service, /subjectType === "prospect" \? "AAROHI"/);
  assert.match(service, /if \(!actor\) return \{ ok: false, reason: "conversation_not_sendable" \}/);
  assert.match(service, /account\.jarvis_access_mode !== "proposal_only"/);
  assert.match(service, /human_takeover: false/);
  assert.match(service, /assigned_actor: actor/);
  assert.match(service, /revision,/);
});

await test("release never replays an old inbound turn into Jarvis", () => {
  const service = read("services/conversationalWhatsAppService.ts");
  const releaseStart = service.indexOf("export async function releaseHumanConversationToAi");
  const release = service.slice(releaseStart, service.indexOf("export type JarvisWhatsAppReplyClaimResult", releaseStart));
  assert.doesNotMatch(release, /communication_jarvis_turn_outbox.*insert/s);
  assert.doesNotMatch(release, /communication_jarvis_turn_outbox.*upsert/s);
  assert.match(release, /HUMAN_RELEASE_REVISION_ADVANCED/);
  assert.match(release, /status: "superseded"/);
});

await test("Superadmin is the only Human Desk action authority", () => {
  const actions = read("app/actions.ts");
  for (const fn of ["humanWhatsAppReplyFromForm", "humanWhatsAppReleaseToAiFromForm"]) {
    const start = actions.indexOf(`export async function ${fn}`);
    assert.ok(start >= 0);
    const body = actions.slice(start, start + 1800);
    assert.match(body, /requireSuperadmin\(\)/);
  }
  assert.match(actions, /operatorUserId: u\.id/);
});

await test("Human Desk read model is bounded and never exposes destination hash or raw webhook", () => {
  const service = read("services/whatsAppHumanDeskService.ts");
  assert.match(service, /const MAX_QUEUE = 50/);
  assert.match(service, /const MAX_THREAD = 60/);
  assert.match(service, /\.limit\(MAX_QUEUE\)/);
  assert.match(service, /\.limit\(MAX_THREAD\)/);
  assert.doesNotMatch(service, /destination_hash/);
  assert.doesNotMatch(service, /raw_payload|webhook_payload/);
  assert.match(service, /openConversationValue/);
  assert.match(service, /parseSerializedQfWhatsAppExperience/);
});

await test("Human Desk blocks free-form UI when the service window is closed", () => {
  const page = read("app/admin/whatsapp/human-desk/page.tsx");
  assert.match(page, /selected\.canFreeformReply/);
  assert.match(page, /24-hour customer-service window is closed/);
  assert.match(page, /approved WhatsApp template workflow/);
  assert.match(page, /humanWhatsAppReplyFromForm/);
  assert.match(page, /humanWhatsAppReleaseToAiFromForm/);
});

await test("forensic WhatsApp control center remains navigation-only", () => {
  const control = read("components/admin/whatsapp/WhatsAppControlCenter.tsx");
  assert.match(control, /href="\/admin\/whatsapp\/human-desk"/);
  assert.doesNotMatch(control, /humanWhatsAppReplyFromForm|humanWhatsAppReleaseToAiFromForm/);
  assert.doesNotMatch(control, /<form\b/);
});

await test("Human Desk has no direct provider/network authority", () => {
  const page = read("app/admin/whatsapp/human-desk/page.tsx");
  const service = read("services/whatsAppHumanDeskService.ts");
  assert.doesNotMatch(page + service, /MetaCloudWhatsAppProvider|graph\.facebook\.com|fetch\s*\(/);
  assert.doesNotMatch(page + service, /QF_META_|WHATSAPP_ACCESS_TOKEN|Authorization:/);
});

console.log(`SUMMARY assertions=${passed + failed} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
