import test from "node:test";
import assert from "node:assert/strict";
import {prepareRiyaHandoverIntent as plan} from "../../../contracts/vox/riyaHandoverPreparation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=1792080000000;
const context={coreVerified:true,aal:"aal2",currentStaffActive:true,isOwner:false,
 department:"client_success",departmentActive:true,staffId:id(1),teamId:id(2),
 cityId:id(3),clientIds:[id(4)]};
const conv={id:id(5),clientId:id(4),projectId:id(6),cityId:id(3),teamId:id(2),
 state:"AI",revision:8,coreSubjectVerified:true,canonicalGoogleLocationVerified:true,
 signedJarvisContextVerified:true,signedContextExpiresAtMs:now+60000,
 providerOwner:"CORE",assignedStaffId:id(1),doNotContact:false,
 consentState:"ALLOWED",human_takeover:false,pausedRiya:false};
const req={action:"REQUEST_TAKEOVER",expectedRevision:8,nonce:id(7),reason:"Customer requested a human"};
const run=(args={})=>plan({context,conversation:conv,request:req,now,...args});
test("valid AAL2-scoped proposal never authorizes pause/reply/send or matching",()=>{
 const v=run();assert.equal(v.ok,true);
 assert.equal(v.proposedState,"TAKEOVER_PENDING");assert.equal(v.executionAuthorized,false);
 assert.equal(v.requiresSignedJarvisPauseAck,true);
 assert.equal(v.providerMessagesSent,0);
 assert.equal(v.maxAdditionalVendorAssignments,0);
 assert.equal(v.affectsVendorLeadMatching,false);
});
test("AAL1, owner, revoked staff, absent client subject grant and city IDOR denied",()=>{
 for(const change of [{aal:"aal1"},{isOwner:true},{currentStaffActive:false},
  {department:"vendor_success"},{departmentActive:false},{clientIds:[]},
  {cityId:id(33)},{teamId:id(44)}])
  assert.equal(run({context:{...context,...change}}).ok,false,JSON.stringify(change));
});
test("Jarvis signed context, expiry, Core source and verified canonical Google location mandatory",()=>{
 for(const change of [{signedJarvisContextVerified:false},
  {signedContextExpiresAtMs:now-1},{signedContextExpiresAtMs:now+400000},
  {providerOwner:"JARVIS"},{coreSubjectVerified:false},
  {canonicalGoogleLocationVerified:false},{clientId:id(555)},
  {assignedStaffId:id(777)},{cityId:id(66)}])
  assert.equal(run({conversation:{...conv,...change}}).ok,false,JSON.stringify(change));
});
test("opt-out, DNC and human stop deny regardless of agent suggestion",()=>{
 for(const change of [{doNotContact:true},{consentState:"REVOKED"},
  {isHumanRequestedStop:true}])
  assert.equal(run({conversation:{...conv,...change}}).ok,false,JSON.stringify(change));
});
test("state machine enforces pending then takeover, no silent AI outbound",()=>{
 const pending={...conv,state:"TAKEOVER_PENDING"};
 const accept={...req,action:"ACCEPT_TAKEOVER"};
 const a=run({conversation:pending,request:accept});
 assert.equal(a.ok,true);assert.equal(a.proposedState,"HUMAN");
 assert.equal(run({conversation:conv,request:accept}).ok,false);
 const human={...conv,state:"HUMAN",human_takeover:true,pausedRiya:true};
 const reply=run({conversation:human,request:{...req,action:"PROPOSE_REPLY"}});
 assert.equal(reply.ok,true);assert.equal(reply.executionAuthorized,false);
 const resumed=run({conversation:human,request:{...req,action:"RELEASE_TO_RIYA"}});
 assert.equal(resumed.ok,true);assert.equal(resumed.proposedState,"AI");
 assert.equal(run({conversation:{...human,pausedRiya:false},request:{...req,action:"RELEASE_TO_RIYA"}}).ok,false);
 assert.equal(run({conversation:{...human,human_takeover:false},request:{...req,action:"PROPOSE_REPLY"}}).ok,false);
});
test("unexpected browser actor payload, stale revision, short reason and invalid nonce denied",()=>{
 for(const payload of [
  {...req,actorId:id(9)},
  {...req,expectedRevision:7},
  {...req,reason:"short"},
  {...req,nonce:"invalid"},
  {...req,action:"SEND_WHATSAPP"}
 ]) assert.equal(run({request:payload}).ok,false);
});
