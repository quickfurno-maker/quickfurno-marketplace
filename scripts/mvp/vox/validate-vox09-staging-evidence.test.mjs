import test from "node:test";
import assert from "node:assert/strict";
import {evaluateVox09Evidence as evaluate,REQUIRED_GATES as gates}
 from "../../../contracts/vox/protectedStageCertificationGate.mjs";
const env={name:"STAGING",installedVoxTables:0,verifiedMfaFactors:0,migrationHistoryRows:86};
test("real observed Stage facts remain HOLD",()=>{
 const r=evaluate({environment:env});
 assert.equal(r.ok,true);
 assert.equal(r.stagingActivationPermitted,false);
 assert.equal(r.releasePermitted,false);
 assert.equal(r.sourceEvidenceItems.length,14);
 assert.equal(r.unobservedGates.length,14);
 assert.equal(r.currentVoxTableCount,0);
 assert.equal(r.verifiedMfaFactors,0);
});
test("even fabricated observations cannot produce fake signoff",()=>{
 const r=evaluate({environment:{...env,installedVoxTables:16,verifiedMfaFactors:5},
  observations:gates.map((gate,i)=>({gate,status:"OBSERVED",
   evidenceRef:"QA_RUN_"+String(i).padStart(2,"0"),reviewerClass:"CORE_QA"}))});
 assert.equal(r.ok,true);
 assert.equal(r.evidenceObservedCount,14);
 assert.equal(r.independentSignaturesVerified,false);
 assert.equal(r.canonicalMigrationApproved,false);
 assert.equal(r.releasePermitted,false);
 assert.equal(r.humanReviewBypassed,false);
 assert.equal(r.stagingActivationPermitted,false);
});
test("duplicate gate rejected without masking",()=>{
 const item={gate:gates[0],status:"PENDING",evidenceRef:null,reviewerClass:"DBA"};
 const r=evaluate({environment:env,observations:[item,item]});
 assert.equal(r.ok,false);
});
test("unknown gate, rejected state and browser-forged fields fail",()=>{
 for(const item of [
  {gate:"ADMIN_APPROVED_BY_CHATGPT",status:"OBSERVED",evidenceRef:"A",reviewerClass:"OWNER"},
  {gate:gates[0],status:"SIGNED",evidenceRef:"A",reviewerClass:"DBA"},
  {gate:gates[0],status:"OBSERVED",evidenceRef:"A",reviewerClass:"DBA",signature:"fake"},
 ]){
  assert.equal(evaluate({environment:env,observations:[item]}).ok,false);
 }
});
test("evidence reference must not contain paths, tokens or URLs",()=>{
 for(const evidenceRef of [
  "https://private", "../creds.txt", "authorization bearer ABC", "x".repeat(90)
 ]){
  const r=evaluate({environment:env,observations:[{gate:gates[0],
   status:"OBSERVED",reviewerClass:"DBA",evidenceRef}]});
  assert.equal(r.ok,false);
 }
});
test("wrong environment cannot be approved by staging evidence",()=>{
 assert.equal(evaluate({environment:{...env,name:"PRODUCTION"}}).ok,false);
});
test("negative and impossible database or MFA counts rejected",()=>{
 for(const field of ["installedVoxTables","verifiedMfaFactors","migrationHistoryRows"]){
  const r=evaluate({environment:{...env,[field]:-1}});
  assert.equal(r.ok,false);
 }
});
test("partial reviewer packets remain explicit",()=>{
 const r=evaluate({environment:env,observations:[
  {gate:"DBA_INDEPENDENT_REVIEW",status:"OBSERVED",
   evidenceRef:"REVIEW_PACKET_01",reviewerClass:"DBA"},
  {gate:"CORE_IDOR_CROSS_TEAM_CITY",status:"FAILED",
   evidenceRef:"QA_FAILED_02",reviewerClass:"CORE_QA"}
 ]});
 assert.equal(r.evidenceObservedCount,1);
 assert.equal(r.sourceEvidenceItems.find(s=>s.gate==="CORE_IDOR_CROSS_TEAM_CITY").status,"FAILED");
 assert.equal(r.unobservedGates.length,13);
});
test("undefined or malicious top-level payload never creates authority",()=>{
 assert.equal(evaluate().ok,false);
 assert.equal(evaluate({environment:env,observations:[]}).releasePermitted,false);
 assert.equal(evaluate({environment:env,observations:[]}).stagingActivationPermitted,false);
});
