import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {buildStep3b8ReviewPackage} from "./step3b8-review-package.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const json=x=>JSON.parse(readFileSync(resolve(root,x),"utf8"));
const l=json("ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json");
const p=json("ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json");
test("DBA 104 and AppSec 69 tasks remain individually unapproved",()=>{
 const x=buildStep3b8ReviewPackage();assert.equal(x.reviewerQueues.DBA.length,104);
 assert.equal(x.reviewerQueues.AppSec.length,69);
 assert.equal(x.releaseStatus,"HOLD");assert.equal(x.sourceCiPassed,false);
});
test("tampered migration version/row count/false DBA approval fail closed",()=>{
 for(const mutation of [x=>x.records.pop(),x=>x.records[0].version="bad",
  x=>x.records[1].version=x.records[0].version,
  x=>x.independentDbaApproved=true,x=>x.records[0].decision="APPROVED"]){
  const x=structuredClone(l);mutation(x);assert.throws(()=>buildStep3b8ReviewPackage(x,p));
 }
});
test("policy missing, duplicate and fabricated AppSec decision fail closed",()=>{
 for(const mutation of [x=>x.policies.pop(),x=>x.policies[1].id=x.policies[0].id,
 x=>x.signedIndependentAppsec=true,x=>x.policies[0].policyDecision="APPROVED",
 x=>x.policies[0].signedReviewer="fabricated"]){
  const x=structuredClone(p);mutation(x);assert.throws(()=>buildStep3b8ReviewPackage(l,x));
 }
});
test("source plan explicitly cannot grant Staging, Production, real money or Auth privileges",()=>{
 const x=buildStep3b8ReviewPackage();
 for(const key of ["stagingDeploymentAuthorized","productionDeploymentAuthorized","privilegedAuthAuthorized","realMoneyAuthorized","providerTestCertified","ownerAal2Verified"])assert.equal(x[key],false);
});
