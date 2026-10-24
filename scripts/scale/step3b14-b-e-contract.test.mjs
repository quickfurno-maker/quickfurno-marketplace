import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=x=>readFileSync(resolve(root,x),"utf8");
const paths={
lead:"services/leadService.ts",
match:"services/leadMatchingEngine.ts",
runtime:"lib/lead-assignment/runtimeSettings.ts",
admin:"services/adminLaunchControlService.ts",
home:"components/HomeEnquiryForm.tsx",
modal:"components/ClientEnquiryModal.tsx",
privacy:"app/privacy/page.tsx",
terms:"app/terms/page.tsx",
prices:"app/pricing/page.tsx",
office:"services/adminVendorLocationService.ts",
vendor:"services/vendorAdminService.ts"
};
test("B1 Core server enforces required consent, contact and rate limit before lead insert",()=>{
 const s=read(paths.lead);
 assert.match(s,/input\.share_consent !== true/);
 assert.match(s,/normalizeLeadContactForStorage\(phone\)/);
 assert.match(s,/allowPublicMutation\(/);
 assert.match(s,/scope: "lead-capture"/);
 assert.match(s,/limit: 12/);
});
test("B2 server duplicate check happens before lead insert; duplicate marked for review",()=>{
 const s=read(paths.lead);
 assert.ok(s.indexOf('db.rpc("check_duplicate_lead"')>0);
 assert.ok(s.indexOf('db.rpc("check_duplicate_lead"')<s.indexOf('const basePayload'));
 assert.match(s,/is_duplicate: isDuplicate/);
 assert.match(s,/status: isDuplicate \? "Duplicate" : "New"/);
});
test("B3 canonical matcher checks shutoff before vendor evaluation and credits",()=>{
 const s=read(paths.match),index=s.indexOf('const runtimeSettings = await loadMarketplaceRuntimeSettings');
 assert.ok(index>=0&&s.indexOf('const evaluation = await evaluateVendorsForLead',index)>index);
 assert.match(s,/auto_assignment_mode === "off"/);
 assert.match(s,/credits_debited: false/);
 assert.match(s,/deliveries_created: false/);
});
test("B4 default auto assignment is fail-closed but preview and auto_suggest are not read-only",()=>{
 const s=read(paths.runtime),a=read(paths.admin);
 assert.match(s,/auto_assignment_mode: "off"/);
 assert.match(a,/BOTH run the canonical/);
 assert.match(a,/DOES debit one credit per successful assignment/);
 assert.match(s,/max_vendors_per_lead/);
});
test("C1 both customer entry points require share consent and server submitLead",()=>{
 for(const f of [paths.home,paths.modal]){
  const s=read(f);
  assert.match(s,/submitLead\(/);
  assert.match(s,/shareConsent/);
  assert.match(s,/share_consent:/);
 }
});
test("C2 privacy and terms have canonical URLs, business boundaries",()=>{
 assert.match(read(paths.privacy),/canonical: "\/privacy"/);
 assert.match(read(paths.terms),/canonical: "\/terms"/);
 assert.match(read(paths.terms),/marketplace/i);
 assert.match(read(paths.prices),/redirect\("\/vendors"\)/);
});
test("D1 Google office verification is server authoritative, denies forged coordinates",()=>{
 const s=read(paths.office);
 assert.match(s,/readGoogleOffice\(placeId\)/);
 assert.match(s,/Math\.abs\(browserPoint\.latitude - point\.latitude\)/);
 assert.match(s,/OUTSIDE_SERVICE_AREA/);
 assert.match(s,/location_verification_status: verification\.status/);
});
test("D2 lead activation requires verified office, linked user, zone and positive credits",()=>{
 const s=read(paths.vendor);
 assert.match(s,/activate_leads/);
 assert.match(s,/google_place_id/);
 assert.match(s,/location_verification_status/);
 assert.match(s,/service_zone_id/);
 assert.match(s,/remaining_credits/);
});
test("D3 Aadhaar connector is NOT implemented in the tested production services; block attestation",()=>{
 const names=["services/vendorAdminService.ts","services/vendorService.ts",
  "services/vendorGovernedChangeIntakeService.ts","services/adminVendorLocationService.ts"];
 for(const file of names){
  assert.doesNotMatch(read(file),/aadhaar|Aadhaar|UIDAI|DigiLocker/i);
 }
});
test("E1 user test-data cleanup is never a runnable Supabase migration",()=>{
 const m=readdirSync(resolve(root,"supabase/migrations"));
 assert.equal(m.filter(x=>/step3b14/i.test(x)).length,0);
 const sql=read("scripts/scale/step3b14a-purge-rehearsal.sql");
 assert.match(sql,/LOCAL EPHEMERAL PG17 ONLY/);
 assert.match(sql,/STEP3B14A_LOCAL_PG17_EXACT_COUNT_PURGE_ROLLBACK_FK_SURVIVOR_TEST_PASS/);
});
test("E2 mock cleanup never deletes auth or business config",()=>{
 const s=read("scripts/scale/step3b14a-purge-rehearsal.sql");
 assert.doesNotMatch(s,/DELETE FROM public\.auth_users/i);
 assert.doesNotMatch(s,/DELETE FROM public\.marketplace_runtime_settings/i);
 assert.doesNotMatch(s,/TRUNCATE/i);
});
test("E3 migration count drift is disclosed, not silently fixed to pass",()=>{
 const m=readdirSync(resolve(root,"supabase/migrations")).filter(x=>x.endsWith(".sql")).length;
 const source=read("scripts/mvp/staging/live-migration-ledger.mjs");
 assert.ok(m>0);assert.match(source,/EXPECTED_LIVE_MIGRATION_COUNT/);
 // The independent historical QF-MVP-80.01 strict G05 drift is a known FAIL.
 // Not an authorization to change historical SQL, reduce thresholds or deploy.
 assert.equal(m,162);
 const matcher=read("scripts/mvp/matching/validate-qf-mvp-80-01.mjs");
 assert.match(matcher,/QUARANTINED_FOUNDATION/);
 assert.match(matcher,/createHash\('sha256'\)/);
 assert.match(matcher,/verifiedQuarantine/);
});
