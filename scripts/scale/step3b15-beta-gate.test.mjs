import test from "node:test";
import assert from "node:assert/strict";
import {evaluatePuneBeta} from "../../lib/launch/marketplaceBetaEvidence.ts";
const sha="a".repeat(40);
const vendor=(id,city="Pune",categories=["Plumbing"])=>({
 id,city,categories,approved:true,accepting:true,verifiedIdentity:true,
 verifiedOffice:true,verifiedZone:true,credits:3
});
const good=()=>({
 sourceSha:sha,reviewedSha:sha,ownerApproval:true,
 backupRestoreVerified:true,allTestRecordsRemoved:true,orphanCount:0,
 mode:"auto_suggest",modeObserved:true,approvedCanary:true,
 realCanaryPassed:true,creditLedgerVerified:true,deliveryIdempotencyVerified:true,
 consentVerified:true,customerSupportReady:true,rollbackVerified:true,
 promotedCategories:["Plumbing"],vendors:[vendor("v1"),vendor("v2"),vendor("v3")]
});
test("C01 unknown/empty evidence fails closed with all relevant blockers",()=>{
 const x=evaluatePuneBeta({
 ...good(),sourceSha:"",reviewedSha:null,ownerApproval:false,backupRestoreVerified:false,
 allTestRecordsRemoved:false,orphanCount:null,mode:"unknown",modeObserved:false,
 approvedCanary:false,realCanaryPassed:false,creditLedgerVerified:false,
 deliveryIdempotencyVerified:false,consentVerified:false,
 customerSupportReady:false,rollbackVerified:false,vendors:[]
 });
 assert.equal(x.status,"HOLD");assert.equal(x.advisoryOnly,true);
 assert.ok(x.blockers.length>=7);
});
test("C02 complete synthetic evidence is only ready for final human decision",()=>{
 const x=evaluatePuneBeta(good());
 assert.equal(x.status,"READY_FOR_OWNER_FINAL_DECISION");assert.equal(x.advisoryOnly,true);
 assert.equal(x.byCategory.plumbing,3);
});
test("C03 every mandatory release flag independently blocks launch",()=>{
 const e=good();
 for(const key of ["ownerApproval","backupRestoreVerified","allTestRecordsRemoved",
  "modeObserved","approvedCanary","realCanaryPassed","creditLedgerVerified",
  "deliveryIdempotencyVerified","consentVerified","customerSupportReady","rollbackVerified"]){
  const x=evaluatePuneBeta({...e,[key]:false});
  assert.equal(x.status,"HOLD",key);
 }
});
test("C04 hard hold for missing/incorrect pinned SHA",()=>{
 assert.ok(evaluatePuneBeta({...good(),sourceSha:"abc"}).blockers.includes("EXACT_SHA_OWNER_GO_MISSING"));
 assert.ok(evaluatePuneBeta({...good(),reviewedSha:"b".repeat(40)}).blockers.includes("EXACT_SHA_OWNER_GO_MISSING"));
});
test("C05 off and unobserved assignment mode cannot pass",()=>{
 assert.ok(evaluatePuneBeta({...good(),mode:"off"}).blockers.includes("ASSIGNMENT_OFF"));
 assert.ok(evaluatePuneBeta({...good(),modeObserved:false}).blockers.includes("MODE_NOT_OBSERVED"));
});
test("C06 3 eligible in Pune for one category are NOT 3 in another",()=>{
 const x=evaluatePuneBeta({...good(),promotedCategories:["Plumbing","Carpentry"]});
 assert.equal(x.status,"HOLD");
 assert.equal(x.byCategory.carpentry,0);
});
test("C07 no cross-city vendor counted",()=>{
 const e=good(); e.vendors[2]=vendor("v3","Mumbai");
 const x=evaluatePuneBeta(e);
 assert.equal(x.byCategory.plumbing,2);assert.equal(x.status,"HOLD");
});
test("C08 a duplicate vendor ID cannot inflate three-vendor supply",()=>{
 const e=good();e.vendors[2]=vendor("v2");
 assert.equal(evaluatePuneBeta(e).byCategory.plumbing,2);
});
test("C09 each vendor security precondition independently blocks inclusion",()=>{
 const keys=["approved","accepting","verifiedIdentity","verifiedOffice","verifiedZone"];
 for(const k of keys){
  const e=good();e.vendors[2]={...vendor("v3"),[k]:false};
  assert.equal(evaluatePuneBeta(e).status,"HOLD",k);
 }
});
test("C10 credit zero, fraction, negative and NaN rejected",()=>{
 for(const credits of [0,-1,0.5,NaN,Infinity]){
  const e=good();e.vendors[2]={...vendor("v3"),credits};
  assert.equal(evaluatePuneBeta(e).status,"HOLD",String(credits));
 }
});
test("C11 trim/case normalizes category but duplicate categories block",()=>{
 let e=good();e.promotedCategories=[" PLUMBING "];
 assert.equal(evaluatePuneBeta(e).status,"READY_FOR_OWNER_FINAL_DECISION");
 e.promotedCategories=["Plumbing"," plumbing "];
 assert.ok(evaluatePuneBeta(e).blockers.includes("INVALID_CATEGORY_SCOPE"));
});
test("C12 orphan records block beta regardless of marketing eligibility",()=>{
 const x=evaluatePuneBeta({...good(),orphanCount:1});
 assert.ok(x.blockers.includes("TEST_DATA_NOT_CLEARED"));
});
test("C13 unknown customer/support evidence never infers safe readiness",()=>{
 const e=good();e.customerSupportReady=false;
 assert.ok(evaluatePuneBeta(e).blockers.includes("SUPPORT_ROLLBACK_UNREADY"));
});
