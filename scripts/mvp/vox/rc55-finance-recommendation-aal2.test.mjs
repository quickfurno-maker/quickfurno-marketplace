import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const src=readFileSync(resolve(root,"app/actions.ts"),"utf8");
const between=(from,to)=>src.split(from)[1]?.split(to)[0]??"";
test("bad-lead recommendation and AI suggestion require verified current Owner AAL2",()=>{
 for(const action of [
  between("export const adminRecommendBadLeadRecovery = async (","export const adminGenerateBadLeadRecoveryRecommendation"),
  between("export const adminGenerateBadLeadRecoveryRecommendation = async (","export const adminApplyBadLeadRecovery")
 ]){
  assert.match(action,/asAdmin\(async actor =>/);
  assert.match(action,/rc44VerifiedBadLeadOwner\(actor\)/);
  assert.match(action,/UNAUTHORIZED/);
  assert.ok(action.indexOf("rc44VerifiedBadLeadOwner(actor)")<
   action.indexOf("badLeadRecovery."),"live AAL2 must precede any recommendation");
  assert.doesNotMatch(action,/qf_approve_credit_restoration|qf_apply_bad_lead_recovery_v1/);
 }
});
test("the shared AAL2 helper requires genuine Auth verification matching current admin actor",()=>{
 const helper=between("async function rc44VerifiedBadLeadOwner(actor:string)","export const adminApproveBadLead");
 assert.match(helper,/auth\.getSession\(\)/);
 assert.match(helper,/verifyVoxOwnerBearer\("Bearer "\+session\.access_token\)===actor/);
});
