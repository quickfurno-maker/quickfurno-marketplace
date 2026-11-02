import test from "node:test";
import assert from "node:assert/strict";
import {queueReviewedStaffLifecycle} from "../../../contracts/vox/ui04StaffLifecycle.mjs";
import {composeCoreVerifiedUnifiedQueue} from "../../../contracts/vox/ui04UnifiedQueue.mjs";
import {projectVerifiedInternalNoticeList,classifyInternalOutboxOutcome}
 from "../../../contracts/vox/ui04InternalNotices.mjs";
import {classifyFourSourceEodStatus,requestOfficialEodAfterSourceCertification,
 requestIndependentEodAcknowledgement} from "../../../contracts/vox/ui04EodReview.mjs";

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T07:00:00Z");
const owner={verifiedByCore:true,aal:"aal2",profileRole:"admin",
 adminRole:"Superadmin",isActive:true,userId:id(1)};
const target={profileRole:null,adminRole:null,principal:"vox_staff",
 isActive:true,userId:id(2)};
const team={teamId:id(3),cityId:id(4),isActive:true};
const cmd={operation:"REQUEST_DEPARTMENT_CHANGE",targetId:target.userId,
 teamId:team.teamId,cityId:team.cityId,reviewerId:id(5),
 nonce:id(6),reason:"Current city operations requires an approved pack",
 expiresAtMs:now+3600_000,expectedRevision:3,packs:["acquisition"]};
function staffArgs(){
 let commits=0;
 const args={environment:"staging",admin:owner,target,team,request:cmd,now,
  verifyCurrentOwner:async()=>true,verifyCurrentTarget:async()=>true,
  verifyEligibleIndependentReviewer:async()=>true,
  createPendingOnce:async p=>{commits++;return {
   requestId:id(9),nonce:p.nonce,state:"PENDING_INDEPENDENT_REVIEW",
   persisted:true,ownerRecheckedInTransaction:true,
   targetRecheckedInTransaction:true,reviewerRecheckedInTransaction:true,
   nonceConsumedInTransaction:true,targetGrantMutated:false,
   invitationSent:false};}};
 return {args,get commits(){return commits}};
}
test("T1 existing neutral Staff department request is staged ONLY for independent review",async()=>{
 const x=staffArgs(),r=await queueReviewedStaffLifecycle(x.args);
 assert.equal(r.ok,true);assert.equal(r.status,"PENDING_INDEPENDENT_REVIEW");
 assert.equal(x.commits,1);assert.equal(r.mutationsAuthorized,false);
 assert.equal(r.mayInvite,false);assert.equal(r.providerMessagesSent,0);
});
test("T1 owner cannot self-review, self-target or use ordinary AAL1",async()=>{
 const mutations=[
  {request:{...cmd,reviewerId:owner.userId}},
  {request:{...cmd,reviewerId:target.userId}},
  {admin:{...owner,aal:"aal1"}},
  {target:{...target,profileRole:"admin"}},
  {admin:{...owner,userId:target.userId}},
  {environment:"production"},
  {request:{...cmd,packs:["owner_admin"]}},
  {request:{...cmd,expectedRevision:-1}},
  {request:{...cmd,reason:"short"}},
  {request:{...cmd,expiresAtMs:now+3000}}
 ];
 for(const patch of mutations){
  const x=staffArgs(),r=await queueReviewedStaffLifecycle({...x.args,...patch});
  assert.equal(r.ok,false,JSON.stringify(patch));assert.equal(x.commits,0);
 }
});
test("T1 suspension and revocation cannot sneak new departments",async()=>{
 for(const op of ["REQUEST_SUSPEND","REQUEST_REVOKE","REQUEST_TEAM_CHANGE"]){
  const x=staffArgs();
  assert.equal((await queueReviewedStaffLifecycle({...x.args,
   request:{...cmd,operation:op,packs:[]}})).ok,true);
  const y=staffArgs();
  assert.equal((await queueReviewedStaffLifecycle({...y.args,
   request:{...cmd,operation:op,packs:["acquisition"]}})).ok,false);
 }
});
test("T1 reject stale Owner, target, reviewer or false transactional receipt",async()=>{
 for(const prop of ["verifyCurrentOwner","verifyCurrentTarget",
   "verifyEligibleIndependentReviewer"]){
  const x=staffArgs();const r=await queueReviewedStaffLifecycle({
   ...x.args,[prop]:async()=>false});
  assert.equal(r.ok,false);assert.equal(x.commits,0);
 }
 for(const field of ["ownerRecheckedInTransaction",
  "targetRecheckedInTransaction","reviewerRecheckedInTransaction",
  "nonceConsumedInTransaction","targetGrantMutated","invitationSent"]){
  const x=staffArgs(),orig=x.args.createPendingOnce;
  const r=await queueReviewedStaffLifecycle({...x.args,
   createPendingOnce:async p=>({...await orig(p),
    [field]:field==="targetGrantMutated"||field==="invitationSent"?true:false})});
  assert.equal(r.ok,false);
 }
});
test("T1 injected transactional nonce store cannot accept replay",async()=>{
 const consumed=new Set(),x=staffArgs();
 const make=async p=>{
  if(consumed.has(p.nonce))throw Error("nonce replay");
  consumed.add(p.nonce);
  return await x.args.createPendingOnce(p);
 };
 const first=await queueReviewedStaffLifecycle({...x.args,createPendingOnce:make});
 const second=await queueReviewedStaffLifecycle({...x.args,createPendingOnce:make});
 assert.equal(first.ok,true);assert.equal(second.ok,false);
});
const scope={userId:id(10),teamId:id(11),cityId:id(12),
 currentAal:"aal2",canReadContent:true,canMutate:false,
 verifiedDepartments:["client_success"]};
const work={ok:true,schema:"qf.vox.work.queue.preview.v1",
 mode:"READ_ONLY",actionsEnabled:false,items:[{
  workItemId:id(13),kind:"prospect",state:"ASSIGNED",revision:2,
  updatedAt:"2026-10-16T15:00:00Z",assignedToMe:true,
  canClaim:false,canTransition:false}]};
const client={ok:true,schema:"qf.vox.client.case.source-readiness.v1",
 mode:"READ_ONLY",canTakeover:false,canReadTranscript:false,canSendReply:false,
 items:[{conversationId:id(14),clientProjectId:id(15),agent:"RIYA",
  caseState:"PAUSED",revision:2,lastUpdated:"2026-10-16T17:00:00Z",
  googleLocationVerified:true,currentCityVerified:true,readOnly:true,
  canReadTranscript:false,canSendReply:false,canTakeover:false}]};
const queueArgs=()=>({scope,workProjection:work,clientProjection:client,
 verifyCurrentScope:async()=>true,verifyProjection:async()=>true,
 verifyCurrentObjectGrant:async()=>true});
test("T2 combines independently verified client and assigned Core work metadata",async()=>{
 const r=await composeCoreVerifiedUnifiedQueue(queueArgs());
 assert.equal(r.ok,true);assert.equal(r.items.length,2);
 assert.equal(r.items[0].subjectKind,"client");
 assert.equal(r.items[1].subjectKind,"prospect");
 assert.equal(r.items[0].canHandover,false);
 assert.equal(r.providerMessagesSent,0);
});
test("T2 fails closed on absent staff client grant, source signature and object scope",async()=>{
 for(const patch of [
  {scope:{...scope,currentAal:"aal1"}},
  {scope:{...scope,verifiedDepartments:[]}},
  {verifyProjection:async()=>false},
  {verifyCurrentScope:async()=>false},
  {verifyCurrentObjectGrant:async()=>false},
  {workProjection:{...work,actionsEnabled:true}},
  {clientProjection:{...client,canTakeover:true}},
  {clientProjection:{...client,items:[{...client.items[0],googleLocationVerified:false}]}},
  {clientProjection:{...client,items:[{...client.items[0],conversationId:id(13)}]}}
 ]){
  const r=await composeCoreVerifiedUnifiedQueue({...queueArgs(),...patch});
  assert.equal(r.ok,false);
 }
});
test("T2 never exposes raw customer or vendor data",async()=>{
 const r=await composeCoreVerifiedUnifiedQueue(queueArgs());
 assert.equal(r.ok,true);
 assert.equal(JSON.stringify(r).includes("phone"),false);
 assert.equal(r.canReply,false);assert.equal(r.canTransition,false);
 const x=await composeCoreVerifiedUnifiedQueue({...queueArgs(),
  workProjection:{...work,items:[{...work.items[0],customer_phone:"1234"}]}});
 assert.equal(x.ok,true);assert.equal(JSON.stringify(x).includes("customer_phone"),false);
});
test("T2 projection bounded to max 25 with stable ordering",async()=>{
 const r=await composeCoreVerifiedUnifiedQueue({...queueArgs(),limit:1});
 assert.equal(r.items.length,1);assert.equal(r.items[0].subjectKind,"client");
 assert.equal((await composeCoreVerifiedUnifiedQueue({...queueArgs(),limit:26})).ok,false);
});
const n={id:id(20),recipientId:scope.userId,teamId:scope.teamId,
 cityId:scope.cityId,workItemId:id(13),type:"WORK_ASSIGNED",
 severity:"ACTION",createdAt:"2026-10-17T06:30:00Z",
 expiresAt:"2026-10-19T10:00:00Z",revision:2,state:"UNREAD"};
const noticeArgs=()=>({scope,rows:[n],now,
 verifyCurrentScope:async()=>true,verifyPersistedNotice:async()=>true});
test("T4 Core signed internal notice projects no provider content",async()=>{
 const r=await projectVerifiedInternalNoticeList(noticeArgs());
 assert.equal(r.ok,true);assert.equal(r.items.length,1);
 assert.equal(r.items[0].canAcknowledge,false);
 assert.equal(r.providerMessagesSent,0);
});
test("T4 cross-user, cross-city, expired, fake sender and dup notifications denied",async()=>{
 for(const patched of [
  {...n,recipientId:id(44)},{...n,cityId:id(45)},
  {...n,expiresAt:"2026-10-16T00:00:00Z"},
  {...n,phone:"+919900000000"},
  {...n,createdAt:"2026-10-19T12:00:00Z"}
 ]){
  assert.equal((await projectVerifiedInternalNoticeList({
   ...noticeArgs(),rows:[patched]})).ok,false);
 }
 assert.equal((await projectVerifiedInternalNoticeList({
  ...noticeArgs(),rows:[n,n]})).ok,false);
 assert.equal((await projectVerifiedInternalNoticeList({
  ...noticeArgs(),verifyPersistedNotice:async()=>false})).ok,false);
});
test("T4 quarantine ambiguous outbox outcomes and dead letters",()=>{
 assert.equal(classifyInternalOutboxOutcome({
  ok:true,source:"CORE_ONLY",totalExternalMessagesSent:0,
  jobsDeadLettered:0,jobsRetried:2,requiresOwnerAlert:false}).ok,true);
 for(const x of [{ok:true,source:"CORE_ONLY",
   totalExternalMessagesSent:1,jobsDeadLettered:0,jobsRetried:0},
  {ok:true,source:"CORE_ONLY",totalExternalMessagesSent:0,
   jobsDeadLettered:1,jobsRetried:0},
  {ok:false,source:"CORE_ONLY",totalExternalMessagesSent:0,
   jobsDeadLettered:0,jobsRetried:0}]){
  const r=classifyInternalOutboxOutcome(x);
  assert.equal(r.ok,false);assert.equal(r.requiresOwnerReview,true);
 }
});
const sources=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const sourceStatus={ok:true,schema:"qf.vox.staff.eod.source-status.v1",
 mode:"READ_ONLY",source:"CORE_CANONICAL_SOURCE_OBSERVATIONS",
 completeness:"INCOMPLETE_NO_SIGNED_ALL_SOURCE_WATERMARKS",
 rollup:null,actionsEnabled:false,canExport:false,
 providerMessagesSent:0,allSourceReady:false,canSubmit:false,
 sources:sources.map(source=>({
  source,readiness:"AVAILABLE",
  eventProvenance:source==="CORE_WORK_LEDGER"?"CORE_WORK_ONLY":"NOT_PROVEN"}))};
test("T5 source-status is explanatory and never an official EOD total",()=>{
 const r=classifyFourSourceEodStatus(sourceStatus);
 assert.equal(r.ok,true);assert.equal(r.rollup,null);
 assert.equal(r.canSubmit,false);assert.equal(r.official,false);
 assert.equal(r.requiresFourSignedWatermarks,true);
});
test("T5 missing, duplicated or fake EOD sources cannot claim readiness",()=>{
 for(const x of [
  {...sourceStatus,sources:sourceStatus.sources.slice(1)},
  {...sourceStatus,sources:[sourceStatus.sources[0],...sourceStatus.sources.slice(0,3)]},
  {...sourceStatus,allSourceReady:true},
  {...sourceStatus,sources:sourceStatus.sources.map(s=>({...s,readiness:"SIGNED_READY"}))}
 ])assert.equal(classifyFourSourceEodStatus(x).ok,false);
});
test("T5 official submit rejects partial snapshots; TL ACK rejects AAL1",async()=>{
 const submit=await requestOfficialEodAfterSourceCertification({
  db:null,scope,businessDate:"2026-10-16",secret:"invalid",
  nonce:id(40),verifyCurrentScope:async()=>true});
 assert.equal(submit.ok,false);assert.equal(submit.official,false);
 const ack=await requestIndependentEodAcknowledgement({
  reviewer:{userId:id(30),teamId:scope.teamId,cityId:scope.cityId,
   role:"team_leader",currentAal:"aal1"},
  reportId:id(50),nonce:id(60),
  verifyCurrentLeader:async()=>true,
  decideInDatabase:async()=>({})});
 assert.equal(ack.ok,false);assert.equal(ack.providerMessagesSent,0);
});
