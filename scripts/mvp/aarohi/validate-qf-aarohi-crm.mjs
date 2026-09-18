import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  QFJ_AAROHI_OPERATION_KINDS,
  QFJ_AAROHI_PROJECTION_PATH,
  QFJ_AAROHI_PROJECTION_PROTOCOL,
  QFJ_AAROHI_PROJECTION_SIGNING_DOMAIN,
  parseQfjAarohiProjectionRequest,
} from "../../../lib/jarvis/aarohiProjectionContract.ts";
import { aarohiPermissionsForRole, hasAarohiPermission } from "../../../lib/aarohi/permissions.ts";

const ROOT = process.cwd();
const MIGRATION = "supabase/migrations/20260917000000_aarohi_acquisition_crm_foundation.sql";
const MANIFEST = "supabase/staging-history/qf-mvp-staging-history-manifest.json";
let passed = 0;

function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const migration = read(MIGRATION);
const handoffBridge = read("supabase/migrations/20260918093000_aarohi_anisha_vendor_crm_handoff.sql");
const manifest = JSON.parse(read(MANIFEST));
const stagingCertification = read("docs/QF-AAROHI-ACQUISITION-CRM-STAGING-CERTIFICATION.md");
const productionCertification = read("docs/QF-AAROHI-ANISHA-VENDOR-CRM-PRODUCTION-CERTIFICATION.md");
const route = read("app/api/internal/jarvis/aarohi-projection/route.ts");
const projectionService = read("services/jarvisAarohiProjectionService.ts");
const actions = read("app/admin/aarohi/actions.ts");
const layout = read("app/admin/aarohi/layout.tsx");
const crmService = read("services/aarohiCrmService.ts");
const request = {
  protocol: QFJ_AAROHI_PROJECTION_PROTOCOL,
  version: 1,
  caller: "qf-jarvis",
  audience: "quickfurno-core",
  requestId: "aarohi-test-1",
  issuedAt: "2026-09-17T08:30:00.000Z",
  tenantId: "quickfurno",
  operations: [{
    operationId: "discover-1",
    kind: "DISCOVER_PROSPECT",
    payload: { businessName: "Example Studio", citySlug: "pune" },
  }],
};

test("projection protocol identity is exact", () => {
  assert.equal(QFJ_AAROHI_PROJECTION_PROTOCOL, "qfj.aarohi.projection");
  assert.equal(QFJ_AAROHI_PROJECTION_PATH, "/api/internal/jarvis/aarohi-projection");
  assert.equal(QFJ_AAROHI_PROJECTION_SIGNING_DOMAIN, "qfj.aarohi.projection.http.sig.v1");
});
test("closed operation vocabulary excludes Core business authority", () => {
  assert.deepEqual([...QFJ_AAROHI_OPERATION_KINDS], ["DISCOVER_PROSPECT","SOURCE_OBSERVED","CHANNEL_OBSERVED","CONVERSATION_PROJECT","TASK_PROJECT","SCORE_PROJECT","IDENTITY_MATCH_RECOMMENDED","EVENT_APPEND"]);
  assert.equal(QFJ_AAROHI_OPERATION_KINDS.some((k) => /VENDOR|PAYMENT|PACKAGE|SEND|ACTIVAT/i.test(k)), false);
});
test("valid projection request parses", () => assert.ok(parseQfjAarohiProjectionRequest(request)));
test("unknown top-level key is rejected", () => assert.equal(parseQfjAarohiProjectionRequest({ ...request, extra: true }), null));
test("wrong caller is rejected", () => assert.equal(parseQfjAarohiProjectionRequest({ ...request, caller: "browser" }), null));
test("duplicate operation ids are rejected", () => assert.equal(parseQfjAarohiProjectionRequest({ ...request, operations: [request.operations[0], request.operations[0]] }), null));
test("invalid prospect UUID is rejected", () => assert.equal(parseQfjAarohiProjectionRequest({ ...request, operations: [{ operationId:"x",kind:"TASK_PROJECT",prospectId:"bad",payload:{} }] }), null));
test("more than fifty operations is rejected", () => assert.equal(parseQfjAarohiProjectionRequest({ ...request, operations: Array.from({ length: 51 }, (_,i) => ({ operationId:`op-${i}`,kind:"EVENT_APPEND",payload:{} })) }), null));
test("unknown admin role has no Aarohi access", () => assert.equal(aarohiPermissionsForRole("Unknown").size, 0));
test("support admin cannot mutate acquisition state", () => {
  assert.equal(hasAarohiPermission("Support Admin", "aarohi.view"), true);
  assert.equal(hasAarohiPermission("Support Admin", "aarohi.manage"), false);
  assert.equal(hasAarohiPermission("Support Admin", "aarohi.suppress"), false);
});
test("sales admin has acquisition permissions", () => {
  assert.equal(hasAarohiPermission("Sales Admin", "aarohi.manage"), true);
  assert.equal(hasAarohiPermission("Sales Admin", "aarohi.review_identity"), true);
  assert.equal(hasAarohiPermission("Sales Admin", "aarohi.manage_campaigns"), true);
});
test("Aarohi admin layout enforces view permission", () => {
  assert.match(layout, /hasAarohiPermission\(session\.adminRole,"aarohi\.view"\)/);
  assert.match(layout, /redirect\("\/admin\/login\?error=unauthorized"\)/);
});
test("server actions enforce named permissions", () => {
  for (const permission of ["aarohi.manage","aarohi.suppress","aarohi.takeover","aarohi.review_identity","aarohi.manage_campaigns"]) {
    assert.match(actions, new RegExp(permission.replace(".", "\\.")));
  }
  assert.match(actions, /sensitiveBudget/);
});

test("migration is explicitly pre-acquisition only", () => {
  assert.match(migration, /PRE-ACQUISITION ONLY/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.vendors\b/i);
  assert.doesNotMatch(migration, /update\s+public\.vendors\b/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.vendors\b/i);
});
test("browser roles have no direct Aarohi table authority", () => {
  assert.match(migration, /revoke all on public\.%I from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on public\.%I to service_role/);
});
test("acquisition events are append-only to service role", () => {
  assert.match(migration, /revoke update, delete on public\.aarohi_events from service_role/);
  assert.match(migration, /grant select, insert on public\.aarohi_events to service_role/);
});
test("suppression is fail-closed and cancels outbound tasks", () => {
  assert.match(migration, /do_not_contact=true, ai_paused=true/);
  assert.match(migration, /prospect_stage='SUPPRESSED'/);
  assert.match(migration, /task_type in \('CALL','FOLLOW_UP','WHATSAPP'\)/);
});
test("human takeover pauses Aarohi and owns the prospect", () => {
  assert.match(migration, /human_takeover=p_takeover/);
  assert.match(migration, /ai_paused=case when p_takeover then true else ai_paused end/);
  assert.match(migration, /human_owner=case when p_takeover then p_actor_id else null end/);
});
test("Core handoff requires canonical active verified vendor", () => {
  assert.match(migration, /coalesce\(v_vendor\.status,''\) <> 'Approved'/);
  assert.match(migration, /coalesce\(v_vendor\.is_active,false\) is not true/);
  assert.match(migration, /lower\(coalesce\(v_vendor\.verification_status,''\)\) <> 'verified'/);
});
test("Core handoff requires confirmed package payment", () => {
  assert.match(migration, /vendor_packages vp/);
  assert.match(migration, /vendor_package_orders vo/);
  assert.match(migration, /canonical_package_payment_not_confirmed/);
  assert.match(migration, /agent_owner='ANISHA'/);
});
test("Aarohi completion starts the Anisha Vendor CRM relationship", () => {
  assert.match(handoffBridge, /insert into public\.vendor_crm_profiles/);
  assert.match(handoffBridge, /acquisition_source='AAROHI'/);
  assert.match(handoffBridge, /acquisition_owner='ANISHA'/);
  assert.match(handoffBridge, /aarohi_prospect_id/);
  assert.match(handoffBridge, /aarohi_handoff_id/);
  assert.match(handoffBridge, /insert into public\.vendor_internal_notes/);
  assert.match(handoffBridge, /agent_owner='ANISHA'/);
});
test("Aarohi to Anisha bridge does not create Core vendors or payments", () => {
  assert.match(handoffBridge, /canonical_package_payment_not_confirmed/);
  assert.doesNotMatch(handoffBridge, /insert\s+into\s+public\.vendors\b/i);
  assert.doesNotMatch(handoffBridge, /insert\s+into\s+public\.payments\b/i);
});
test("identity merge requires human review and is forbidden after handoff", () => {
  assert.match(migration, /status <> 'RECOMMENDED'/);
  assert.match(migration, /identity_merge_after_handoff_forbidden/);
  assert.match(migration, /identity\.match_confirmed/);
});
test("Jarvis projection route is disabled by default", () => {
  assert.match(route, /QF_JARVIS_AAROHI_PROJECTION_ENABLED/);
  assert.match(route, /!=="true"/);
  assert.match(route, /return reply\(503,\{error:"service_unavailable"\}\)/);
});
test("Jarvis projection route is body-size bounded and signed", () => {
  assert.match(route, /MAX_BODY_BYTES=65_536/);
  assert.match(route, /request\.arrayBuffer\(\)/);
  assert.match(route, /verifyQfjSignedRequestSignature/);
  assert.match(route, /parseQfjVerificationKeys/);
  assert.match(route, /authentication_failed/);
});
test("Jarvis projection applies only through the isolated Aarohi service", () => {
  assert.match(route, /applyJarvisAarohiProjection/);
  assert.doesNotMatch(route, /adminClient|\.(?:from|rpc)\s*\(\s*["']/);
});
test("projection service is tenant-bound and replay-aware", () => {
  assert.match(projectionService, /tenant_id.*quickfurno/);
  assert.match(projectionService, /jarvis\.op\.\$\{op\.operationId\}/);
  assert.match(projectionService, /status:"REPLAY"/);
  assert.match(projectionService, /deterministicUuid/);
});
test("projection service strips sensitive event-data keys", () => {
  assert.match(projectionService, /message\|body\|content\|text\|transcript\|secret\|token\|password\|phone\|email\|address/);
  assert.match(projectionService, /safeData\(/);
});
test("projection service has no vendor, payment, package, send, or provider mutation path", () => {
  assert.doesNotMatch(projectionService, /from\("vendors"\).*\.(?:insert|upsert|update|delete)/s);
  assert.doesNotMatch(projectionService, /from\("payments"\).*\.(?:insert|upsert|update|delete)/s);
  assert.doesNotMatch(projectionService, /from\("vendor_package_orders"\).*\.(?:insert|upsert|update|delete)/s);
  assert.doesNotMatch(projectionService, /META_ACCESS_TOKEN|WHATSAPP_TOKEN|sendWhatsApp|provider.*send/i);
});
test("overview uses the handoff completion timestamp", () => {
  assert.match(crmService, /count\(db\.from\("aarohi_handoffs"\),"completed_at"\)/);
});
test("CRM service reads Core truth instead of writing vendor/payment authority", () => {
  assert.match(crmService, /from\("vendors"\)\.select/);
  assert.match(crmService, /from\("vendor_packages"\)\.select/);
  assert.match(crmService, /from\("vendor_package_orders"\)\.select/);
  assert.match(crmService, /from\("payments"\)\.select/);
  assert.doesNotMatch(crmService, /from\("vendors"\)\.(?:insert|upsert|update|delete)/);
  assert.doesNotMatch(crmService, /from\("payments"\)\.(?:insert|upsert|update|delete)/);
});

test("all Aarohi admin surfaces exist", () => {
  for (const p of [
    "app/admin/aarohi/page.tsx","app/admin/aarohi/discovery/page.tsx","app/admin/aarohi/pipeline/page.tsx",
    "app/admin/aarohi/prospects/page.tsx","app/admin/aarohi/prospects/[id]/page.tsx","app/admin/aarohi/conversations/page.tsx",
    "app/admin/aarohi/inbox/page.tsx","app/admin/aarohi/tasks/page.tsx","app/admin/aarohi/campaigns/page.tsx",
    "app/admin/aarohi/analytics/page.tsx","app/admin/aarohi/settings/page.tsx",
  ]) assert.equal(fs.existsSync(path.join(ROOT, p)), true, p);
});

test("foundation migration is certified on staging and production", () => {
  const pin = manifest.stagingAppliedPostAnchorMigrations.find((x) => x.version === "20260917000000");
  assert.ok(pin);
  assert.equal(pin.operationalStatus, "APPLIED_TO_STAGING");
  assert.equal(pin.appliedToStaging, true);
  assert.equal(pin.appliedExactlyOnceToStaging, true);
  assert.equal(pin.independentRemoteRelistVerified, true);
  assert.equal(pin.appliedToProduction, true);
  assert.equal(pin.productionVersionStatus, "PRESENT_IN_PRODUCTION_HISTORY");
  assert.equal(pin.productionHistoryVersionPresent, true);
  assert.equal(pin.productionAarohiSchemaPresent, true);
  assert.equal(pin.requiresSeparateProductionDeploymentGate, false);
  assert.equal(manifest.pendingPostAnchorMigrations.some((x) => x.version === "20260917000000"), false);
});
test("Aarohi to Anisha handoff migration is certified on staging and production", () => {
  const pin = manifest.stagingAppliedPostAnchorMigrations.find((x) => x.version === "20260918093000");
  assert.ok(pin);
  assert.equal(pin.operationalStatus, "APPLIED_TO_STAGING");
  assert.equal(pin.appliedToStaging, true);
  assert.equal(pin.appliedExactlyOnceToStaging, true);
  assert.equal(pin.stagingRemoteVersionStatus, "PRESENT_IN_STAGING_HISTORY");
  assert.equal(pin.independentRemoteRelistVerified, true);
  assert.equal(pin.appliedToProduction, true);
  assert.equal(pin.productionVersionStatus, "PRESENT_IN_PRODUCTION_HISTORY");
  assert.equal(pin.productionHistoryVersionPresent, true);
  assert.equal(pin.productionAppliedExactlyOnce, true);
  assert.equal(pin.productionBridgeColumnsVerified, 6);
  assert.equal(pin.productionHandoffRpcVerified, true);
  assert.equal(pin.productionEvidencePath, "docs/QF-AAROHI-ANISHA-VENDOR-CRM-PRODUCTION-CERTIFICATION.md");
  assert.equal(pin.requiresSeparateProductionDeploymentGate, false);
  assert.match(productionCertification, /QF_AAROHI_ANISHA_VENDOR_CRM_PRODUCTION_APPLIED_AND_VERIFIED/);
  assert.match(productionCertification, /PRODUCTION_APPLIED_VERIFIED/);
  assert.equal(manifest.pendingPostAnchorMigrations.some((x) => x.version === "20260918093000"), false);
  const canonical = handoffBridge.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const hash = crypto.createHash("sha256").update(Buffer.from(canonical,"utf8")).digest("hex");
  assert.equal(pin.sha256, hash);
});
test("staging certification evidence is pinned", () => {
  const pin = manifest.stagingAppliedPostAnchorMigrations.find((x) => x.version === "20260917000000");
  assert.equal(pin.appliedEvidenceMarker, "QF_AAROHI_ACQUISITION_CRM_S1_STAGING_MIGRATION_APPLIED_AND_VERIFIED");
  assert.equal(pin.evidencePath, "docs/QF-AAROHI-ACQUISITION-CRM-STAGING-CERTIFICATION.md");
  assert.match(stagingCertification, /remote migrations:\s*\*\*41\*\*/i);
  assert.match(stagingCertification, /pending migrations:\s*\*\*0\*\*/i);
  assert.match(stagingCertification, /STAGING_APPLIED_VERIFIED_PRODUCTION_UNTOUCHED/);
});
test("manifest hash matches canonical migration bytes", () => {
  const pin = manifest.stagingAppliedPostAnchorMigrations.find((x) => x.version === "20260917000000");
  const canonical = migration.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const hash = crypto.createHash("sha256").update(Buffer.from(canonical,"utf8")).digest("hex");
  assert.equal(pin.sha256, hash);
});
console.log(`QF Aarohi Acquisition CRM guard: ${passed}/${passed} PASS`);
