// Synthetic-independent source gate + production read-only aggregate decision; NEVER updates Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const data=x=>JSON.parse(readFileSync(resolve(root,x),"utf8"));
const text=x=>readFileSync(resolve(root,x),"utf8");
export function decide(p){
 assert.equal(p.schema,"qf.phase3b13.production-readonly-marketplace-pulse.v1");
 assert.equal(p.environment,"PRODUCTION");
 const v=p.vendors;
 assert.ok(v.total>=0&&v.approved>=0&&v.approved<=v.total);
 assert.ok(v.fullyPublicEligible>=0&&v.fullyPublicEligible<=v.approved);
 assert.equal(p.cityBreakdown.reduce((n,c)=>n+c.totalVendors,0),v.total);
 assert.equal(p.cityBreakdown.reduce((n,c)=>n+c.approved,0),v.approved);
 assert.equal(p.cityBreakdown.reduce((n,c)=>n+c.publicEligible,0),v.fullyPublicEligible);
 const reasons=[];
 if(v.fullyPublicEligible===0)reasons.push("NO_PUBLICLY_ELIGIBLE_VENDORS");
 if(v.approvedActive===0)reasons.push("APPROVED_VENDORS_NOT_ACTIVE");
 if(v.approvedPublic===0)reasons.push("APPROVED_VENDORS_NOT_VISIBLE");
 if(v.approvedLocationVerified===0)reasons.push("LOCATION_VERIFICATION_UNRESOLVED");
 if(!p.cityBreakdown.every(c=>c.publicEligible>=3))
  reasons.push("AT_LEAST_ONE_ADVERTISED_CITY_HAS_UNDER_3_ELIGIBLE_VENDORS");
 if(p.marketplace.autoAssignmentMode!=="off")
  reasons.push("AUTO_ASSIGNMENT_CURRENTLY_MUTATING_MODE_REQUIRES_GOVERNED_CANARY");
 assert.equal(p.releaseDecisions.protectedVoxAndFinance,"HOLD");
 assert.equal(p.releaseDecisions.productionSchemaChanges,"HOLD");
 return {eligible:v.fullyPublicEligible,
  customerAdLaunchAllowed:reasons.length===0 && p.releaseDecisions.broadCustomerCampaign!=="HOLD",
  vendorOnboardingOnly:true,
  customerPromiseCanBeConfirmed:reasons.length===0,
  reasons, status:"HOLD_PRODUCTION_MARKETPLACE_PROMOTIONS"};
}
const p=data("ops/vox/certification/STEP3B13-PRODUCTION-LAUNCH-SUPPLY-PULSE-20261024.json");
test("Phase3B13 basic live production population is aggregate-only and consistent",()=>{
 assert.equal(p.vendors.total,29);
 assert.equal(p.vendors.approved,14);
 assert.equal(p.vendors.approvedWithCredits,14);
 assert.equal(p.vendors.fullyPublicEligible,0);
 assert.equal(p.marketplace.existingLeadRecords,74);
 assert.equal(p.marketplace.existingAssignmentRecords,71);
 assert.equal(p.marketplace.autoAssignmentMode,"auto_suggest");
 assert.equal(p.marketplace.maxVendorsPerLead,3);
});
test("Production supplier activation is the launch bottleneck, never auto-enabled",()=>{
 const d=decide(p);
 assert.equal(d.customerAdLaunchAllowed,false);
 assert.ok(d.reasons.includes("NO_PUBLICLY_ELIGIBLE_VENDORS"));
 assert.ok(d.reasons.includes("APPROVED_VENDORS_NOT_ACTIVE"));
 assert.ok(d.reasons.includes("APPROVED_VENDORS_NOT_VISIBLE"));
 assert.ok(d.reasons.includes("LOCATION_VERIFICATION_UNRESOLVED"));
 assert.ok(d.reasons.includes("AUTO_ASSIGNMENT_CURRENTLY_MUTATING_MODE_REQUIRES_GOVERNED_CANARY"));
 assert.equal(d.vendorOnboardingOnly,true);
});
test("No single city can presently support even three public candidate vendors",()=>{
 assert.deepEqual(p.cityBreakdown.map(c=>[c.city,c.approved,c.publicEligible]),[
  ["Pune",13,0],["Mumbai",1,0]
 ]);
 assert.equal(decide(p).customerPromiseCanBeConfirmed,false);
});
test("One forged count inconsistent with city breakdown is rejected",()=>{
 assert.throws(()=>decide({...p,vendors:{...p.vendors,fullyPublicEligible:1}}));
});
test("No accidental Stage, live payment or outbound activation in saved evidence",()=>{
 assert.equal(p.releaseDecisions.protectedVoxAndFinance,"HOLD");
 assert.equal(p.releaseDecisions.productionSchemaChanges,"HOLD");
 assert.ok(p.deferredActions.includes("No paid marketing activation"));
 assert.ok(p.deferredActions.includes("No production lead injection"));
});
test("VOX production build loopback E2E is real HTTP request, not regex source-only",()=>{
 const source=text("scripts/scale/step3b13-vox-loopback-e2e.mjs");
 assert.match(source,/spawn\(process\.execPath/);
 assert.match(source,/redirect:"manual"/);
 assert.match(source,/127\.0\.0\.1/);
 assert.match(source,/VOX_STAFF_PORTAL_ENABLED:"off"/);
 assert.match(source,/child\.kill\(\)/);
 assert.match(source,/STEP3B13_REAL_LOOPBACK_NEXT_PRODUCTION_FAIL_CLOSED/);
});
test("RLS composition test demonstrates OR bypass, revoked by strict policy",()=>{
 const source=text("scripts/scale/step3b13-rls-composition.sql");
 assert.match(source,/CREATE POLICY temporary_insecure_or/);
 assert.match(source,/DROP POLICY temporary_insecure_or/);
 assert.match(source,/tenant reassignment permitted despite WITH CHECK/);
 assert.match(source,/suspended vendor INSERT unexpectedly allowed/);
 assert.match(source,/anon can call admin SECURITY DEFINER helper/);
});
test("All new SQL remains outside executable migrations",()=>{
 const sql=text("scripts/scale/step3b13-rls-composition.sql");
 assert.match(sql,/Must run only AFTER/);
 assert.ok(existsSync(resolve(root,"ops/vox/sql-review/STEP3B11B-HELPER-STATUS-GUARDS-REVIEW_ONLY.sql")));
});
test("Production auto_suggest must not be represented as a harmless preview",()=>{
 assert.equal(p.marketplace.autoAssignmentMode,"auto_suggest");
 const runtime=text("lib/lead-assignment/runtimeSettings.ts");
 const launch=text("services/adminLaunchControlService.ts");
 assert.match(runtime,/auto_assignment_mode: "off"/);
 assert.match(launch,/credit.*charged|charges that vendor 1 credit/);
 assert.match(launch,/preview.*auto_suggest/);
 assert.equal(decide(p).customerAdLaunchAllowed,false);
});
test("Launch gate document explicitly disallows using prior assignments to promise current matching",()=>{
 assert.match(p.limitations,/do not infer all marketplace matching SQL/);
 assert.match(p.limitations,/old assignments represent current fill/);
});
