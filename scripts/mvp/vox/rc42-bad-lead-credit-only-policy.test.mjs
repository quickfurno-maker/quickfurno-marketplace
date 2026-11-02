import test from "node:test";
import assert from "node:assert/strict";
import {BAD_LEAD_CREDIT_ONLY_POLICY as POLICY,preflightBadLeadCreditOnly as review,
 isAllowedBadLeadRecoveryAction as allowed} from "../../../lib/vox/creditOnlyBadLeadPolicy.mjs";
const REPORT="11111111-1111-4111-8111-111111111111",VENDOR="22222222-2222-4222-8222-222222222222";
const ASSIGNMENT="33333333-3333-4333-8333-333333333333",ACTOR="44444444-4444-4444-8444-444444444444";
const report={id:REPORT,vendor_id:VENDOR,lead_assignment_id:ASSIGNMENT,status:"Approved",recovery_status:"pending"};
const assignment={id:ASSIGNMENT,vendor_id:VENDOR,credit_deducted:true,lifecycle_status:"delivered"};
const fn=(r=report,a=assignment,actorId=ACTOR)=>review({report:r,assignment:a,actorId});
test("bad-lead is exactly one LEAD credit, never cash, wallet money or automatic replacement",()=>{
 assert.equal(POLICY.credits,1);
 for(const k of ["cashRefundAllowed","monetaryWalletCreditAllowed","automaticReplacementAllowed"])assert.equal(POLICY[k],false);
 assert.equal(POLICY.action,"restore_credit");
 assert.equal(allowed("restore_credit"),true);assert.equal(allowed("reject"),true);
 for(const a of ["replace","restore_credit_and_replace","refund_money","money_credit","grant_2","",null])
  assert.equal(allowed(a),false);
});
test("human-approved original consumption qualifies only for atomically guarded review",()=>{
 const out=fn();assert.equal(out.canApply,true);assert.equal(out.leadCredits,1);
 assert.equal(out.status,"eligible_for_atomic_review");
 assert.match(out.reason,/DB_LOCKED/);
 assert.equal(out.cashRefundAllowed,false);
 assert.equal(out.automaticReplacementAllowed,false);
 assert.equal(Object.isFrozen(out),true);
});
test("unverified or forged actor, other vendor or assignment never qualifies",()=>{
 for(const a of ["","actor",null,"55555555-5555-4555-8555-555555555555z"])
  assert.equal(fn(report,assignment,a).canApply,false);
 assert.equal(fn({...report,vendor_id:ACTOR}).reason,"VENDOR_ASSIGNMENT_MISMATCH");
 assert.equal(fn({...report,lead_assignment_id:ACTOR}).canApply,false);
 assert.equal(fn(report,{...assignment,vendor_id:ACTOR}).canApply,false);
 assert.equal(fn(null,assignment).canApply,false);
});
test("pending, rejected, already applied or zero deducted credits cannot mint a second credit",()=>{
 for(const status of ["Pending","Rejected",""])assert.equal(fn({...report,status}).canApply,false);
 assert.equal(fn({...report,recovery_status:"applied"}).status,"already_applied");
 assert.equal(fn(report,{...assignment,credit_deducted:false}).reason,"ORIGINAL_CREDIT_NOT_CONSUMED");
 assert.equal(fn(report,{...assignment,lifecycle_status:"cancelled"}).canApply,false);
});
test("the preflight is inert and only the database may enforce once-per-assignment",()=>{
 assert.equal("balance" in fn(),false);
 assert.equal("payment" in fn(),false);
 assert.equal(fn().reason,"REQUIRES_DB_LOCKED_ONCE_PER_ASSIGNMENT");
});
