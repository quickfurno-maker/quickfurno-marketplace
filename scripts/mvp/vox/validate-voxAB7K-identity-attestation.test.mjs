import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {inspectAb7kIdentityAttestationGate,evaluateIdentityAttestationSources}
 from "../../../contracts/vox/ab7kIdentityAttestationGate.mjs";
import {publishReviewedEod} from "../../../contracts/vox/ab7gOfficialEodRelease.mjs";
import {suspendCoreStaffGrants} from "../../../contracts/vox/ab7fStaffCoreSuspend.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const overlayPath="ops/vox/identity-attestation-overlay/20261030010000_vox_ab7k_identity_attestation_fail_closed_overlay.sql";
const overlay=readFileSync(resolve(root,overlayPath),"utf8");
const code=sql=>sql.replace(/--[^\n]*/g,"");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const before=inspectAb7kIdentityAttestationGate(root,{includeOverlay:false});
const after=inspectAb7kIdentityAttestationGate(root);

test("gate reads real SQL and never authorizes any identity feature",()=>{
 for(const g of [before,after]){
  assert.equal(g.ok,true,g.reason);
  assert.equal(g.authorized,false);assert.equal(g.releaseReady,false);
  assert.equal(g.databaseEd25519Verification,false);
  assert.equal(Object.keys(g.features).length,4);
  for(const f of Object.values(g.features)){
   assert.equal(f.authorized,false);
   assert.ok(f.reasons.includes("NO_PINNED_ED25519_VERIFICATION_IN_DATABASE"));
   assert.ok(f.reasons.includes("HUMAN_OWNER_TL_AAL2_SIGNOFF_REQUIRED"));
  }
 }
});
test("AB7G and AB7H approvals have NO writer: digest columns are not attestations",()=>{
 for(const k of ["AB7G_EOD_OFFICIAL_RELEASE","AB7H_SIGNED_OPERATOR"]){
  assert.deepEqual(after.features[k].allWriters,[]);
  assert.deepEqual(after.features[k].provenAttestationWriters,[]);
  assert.ok(after.features[k].reasons.includes("NO_PROVEN_NON_SERVICE_ROLE_ATTESTATION_WRITER"));
  assert.equal(after.features[k].unconditionalWriteGuard,true);
 }
 const sql=code(readFileSync(resolve(root,"ops/vox/sql-candidates/20261018100000_vox_ab7g_eod_official_release_candidate.sql"),"utf8"));
 assert.match(sql,/verified_signature_digest\s+text not null check\(verified_signature_digest~'\^\[a-f0-9\]\{64\}\$'\)/);
 assert.doesNotMatch(sql,/ed25519|verify/i);
});
test("service_role/anon/authenticated cannot execute caller-trusting RPCs after overlay",()=>{
 for(const k of ["AB7G_EOD_OFFICIAL_RELEASE","AB7H_SIGNED_OPERATOR","AB7F_CONVERSATION_OPERATOR"]){
  assert.deepEqual(before.features[k].rpcExecutableBy,["service_role"],k+" baseline");
  assert.deepEqual(after.features[k].rpcExecutableBy,[],k);
 }
 assert.equal(after.features.AB7F_CONVERSATION_OPERATOR.reasons.includes("NO_ATTESTATION_TABLE_OR_WRITER"),true);
});
test("service_role can forge ledgers in candidates alone; overlay makes all read-only",()=>{
 assert.ok(before.serviceRoleWritableLedgers.includes("public.vox_ab7f_four_source_eod_candidate_v1"));
 assert.ok(before.serviceRoleWritableLedgers.includes("public.vox_ab7f_staff_suspend_receipts_candidate_v1"));
 assert.ok(before.serviceRoleWritableLedgers.includes("public.vox_ab7f_conversation_operator_receipts_candidate_v1"));
 assert.deepEqual(after.serviceRoleWritableLedgers,[]);
 for(const k of Object.keys(after.features))
  assert.equal(after.features[k].serviceRoleCanWriteApprovals,false);
});
test("AB7J is the only writer; proven only after the null-safe AAL2 fix",()=>{
 const f="AB7F_STAFF_SUSPEND";
 assert.deepEqual(before.features[f].provenAttestationWriters,[]);
 assert.deepEqual(after.features[f].provenAttestationWriters,
  ["public.qf_vox_ab7j_tl_approve_staff_suspend_v1"]);
 // Honest residue: service_role may still call the suspend RPC, but it is bound
 // to an exact AAL2 Owner+TL approval row it cannot create.
 assert.deepEqual(after.features[f].rpcExecutableBy,["service_role"]);
 assert.equal(after.features[f].authorized,false);
});
test("overlay AB7J functions are null-safe and require authenticated role",()=>{
 const sql=code(overlay);
 assert.equal((sql.match(/coalesce\(auth\.jwt\(\)->>'aal',''\)<>'aal2'/g)||[]).length,2);
 assert.equal((sql.match(/coalesce\(auth\.jwt\(\)->>'role',''\)<>'authenticated'/g)||[]).length,2);
 assert.doesNotMatch(sql,/\(auth\.jwt\(\)->>'aal'\)<>/);
 assert.match(sql,/req\.reviewer_id<>me/);assert.match(sql,/req\.owner_id=me/);
 assert.match(sql,/req\.expires_at<=clock_timestamp\(\)/);
 assert.doesNotMatch(sql,/grant execute[^;]*to service_role/i);
});
test("overlay write guard is unconditional, fires for superuser/replica and truncate",()=>{
 const sql=code(overlay);
 assert.match(sql,/raise exception 'AB7K_VERIFIED_ATTESTATION_WRITER_NOT_INSTALLED'/);
 for(const t of ["vox_ab7g_eod_owner_approvals_candidate_v1","vox_ab7h_operator_review_candidate_v1"]){
  assert.match(sql,new RegExp("before insert or update or delete on public\\."+t));
  assert.match(sql,new RegExp("before truncate on public\\."+t));
  assert.match(sql,new RegExp("alter table public\\."+t+"\\s+enable always trigger ab7k_no_verified_writer_row"));
 }
 assert.match(sql,/AB7K_OVERLAY_REQUIRES_AB7F_TO_AB7J_CANDIDATES/);
});
test("analysis is not fooled by comments or a service_role-granted writer",()=>{
 const tbl="public.vox_ab7g_eod_owner_approvals_candidate_v1";
 const sql=`-- insert into ${tbl} grant execute on function public.fake() to authenticated;
create table ${tbl}(a int);
create function public.w() returns void language plpgsql security definer as $$
begin if auth.uid() is null then return; end if; insert into ${tbl}(a) values(1); end;
$$;
grant execute on function public.w() to service_role;`;
 const g=evaluateIdentityAttestationSources([{name:"x.sql",text:sql}]);
 const f=g.features.AB7G_EOD_OFFICIAL_RELEASE;
 assert.deepEqual(f.allWriters,["public.w"]);
 assert.deepEqual(f.provenAttestationWriters,[]);
 assert.equal(f.serviceRoleCanWriteApprovals,true);
 assert.equal(f.authorized,false);
});
test("AB7J candidate original AAL2 check is null-unsafe (regression record)",()=>{
 const sql=code(readFileSync(resolve(root,"ops/vox/sql-candidates/20261018120000_vox_ab7j_two_person_staff_suspend_candidate.sql"),"utf8"));
 assert.equal((sql.match(/\(auth\.jwt\(\)->>'aal'\)<>'aal2'/g)||[]).length,2);
 assert.doesNotMatch(sql,/coalesce\(auth\.jwt/);
});

const base={environment:"staging",enabled:true,reportId:id(1),ownerId:id(2),
 teamLeaderId:id(3),nonce:id(4),sourceDigest:"a".repeat(64)};
function publishHarness(over={}){
 const calls={rpc:0};
 const yes=async()=>true;
 const args={...base,verifyCurrentOwnerAal2:yes,verifyCurrentIndependentTlAal2:yes,
  verifyPinnedApprovalAndSigner:yes,verifyUnmodifiedNativeSources:yes,
  rpc:async()=>{calls.rpc++;return {error:{code:"denied"}};},...over};
 return {calls,run:()=>publishReviewedEod(args)};
}
test("EOD release: self-review, unknown approver, expired approval and replay cause zero side effects",async()=>{
 const self=publishHarness({teamLeaderId:base.ownerId});
 assert.equal((await self.run()).ok,false);assert.equal(self.calls.rpc,0);
 const unknown=publishHarness({verifyCurrentIndependentTlAal2:async()=>false});
 assert.equal((await unknown.run()).reason,"SIGNED_OWNER_RELEASE_EVIDENCE_MISSING");
 assert.equal(unknown.calls.rpc,0);
 const expired=publishHarness({verifyPinnedApprovalAndSigner:async()=>false});
 assert.equal((await expired.run()).official,false);assert.equal(expired.calls.rpc,0);
 const ownerNoAal=publishHarness({verifyCurrentOwnerAal2:async()=>false});
 assert.equal((await ownerNoAal.run()).ok,false);assert.equal(ownerNoAal.calls.rpc,0);
 const thrown=publishHarness({verifyUnmodifiedNativeSources:async()=>{throw Error("x");}});
 assert.equal((await thrown.run()).reason,"OFFICIAL_PUBLICATION_OUTCOME_UNKNOWN");
 assert.equal(thrown.calls.rpc,0);
 const replay=publishHarness();
 const r=await replay.run();
 assert.equal(r.ok,false);assert.equal(r.official,false);assert.equal(replay.calls.rpc,1);
});
test("EOD release: verifier-less call and non-staging are denied before any RPC",async()=>{
 let n=0;
 const r=await publishReviewedEod({...base,rpc:async()=>{n++;return {};}});
 assert.equal(r.ok,false);assert.equal(n,0);
 const prod=publishHarness({environment:"production"});
 assert.equal((await prod.run()).ok,false);assert.equal(prod.calls.rpc,0);
});
function suspendHarness(over={}){
 const calls={rpc:0};const yes=async()=>true;
 const args={environment:"staging",enabled:true,ownerId:id(2),reviewerId:id(3),
  targetId:id(5),teamId:id(6),cityId:id(7),nonce:id(8),
  verifyFreshOwnerAal2:yes,verifyFreshTlAal2:yes,verifySignedIndependentDecision:yes,
  rpc:async()=>{calls.rpc++;return {error:{code:"AB7I_SIGNED_INDEPENDENT_SUSPEND_APPROVAL_MISSING"}};},
  ...over};
 return {calls,run:()=>suspendCoreStaffGrants(args)};
}
test("staff suspend: self-review, unknown approver, expired approval and replay cause zero side effects",async()=>{
 for(const over of [{reviewerId:id(2)},{ownerId:id(5)},{reviewerId:id(5)}]){
  const h=suspendHarness(over);
  assert.equal((await h.run()).ok,false);assert.equal(h.calls.rpc,0);
 }
 for(const k of ["verifyFreshOwnerAal2","verifyFreshTlAal2","verifySignedIndependentDecision"]){
  const h=suspendHarness({[k]:async()=>false});
  assert.equal((await h.run()).reason,"CURRENT_INDEPENDENT_SUSPENSION_DENIED");
  assert.equal(h.calls.rpc,0);
 }
 const replay=suspendHarness();
 const r=await replay.run();
 assert.equal(r.ok,false);assert.equal(r.membershipRevokedVerified,false);
 assert.equal(replay.calls.rpc,1);
});
