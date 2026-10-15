import test from "node:test";
import assert from "node:assert/strict";
import {prepareScopedWorkIntent as plan,allowedWorkIntentActions} from "../../../contracts/vox/workIntentPreparation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const context={coreVerified:true,aal:"aal2",isActive:true,actorId:id(1),teamId:id(2),cityId:id(3),role:"staff",isOwner:false};
const item={id:id(4),teamId:context.teamId,cityId:context.cityId,state:"NEW",revision:0,assigneeId:null};
const request={action:"CLAIM",nonce:id(5),expectedRevision:0,reason:""};
const input={context,item,request,now:1792080000000};
const prep=overrides=>plan({...input,...overrides});
test("allowed work actions bounded",()=>assert.deepEqual(allowedWorkIntentActions.sort(),["BLOCK","CLAIM","COMPLETE","ESCALATE","REQUEST_APPROVAL","RESUME","START","WAIT_EXTERNAL"].sort()));
test("planned claim includes only non-executable Core proposal",()=>{
 const r=prep({});
 assert.equal(r.ok,true);assert.equal(r.proposedState,"ASSIGNED");
 assert.equal(r.executionAuthorized,false);
 assert.equal(r.mustReverifyCore,true);assert.equal(r.requiresDatabaseAtomicity,true);
 assert.equal(r.requiresFreshSubjectGrant,true);assert.equal(r.affectsVendorLeadMatching,false);
 assert.equal(r.providerMessagesSent,0);
});
test("default or forged scope fails closed",()=>{
 for(const ctx of [undefined,null,{}, {...context,coreVerified:false},{...context,aal:"aal1"},
   {...context,isActive:false},{...context,isOwner:true},{...context,role:"admin"},{...context,actorId:"invalid"},
   {...context,teamId:id(9)},{...context,cityId:id(9)}]){
  assert.equal(prep({context:ctx}).ok,false,JSON.stringify(ctx));
 }
});
test("rejects stale revision, replay invalid nonce, unknown action and malformed request",()=>{
 for(const change of [{nonce:"bad"},{action:"SEND_WHATSAPP"},{expectedRevision:1},{expectedRevision:-1},{reason:"  "},{reason:"x".repeat(301)}]){
  assert.equal(prep({request:{...request,...change}}).ok,false,JSON.stringify(change));
 }
});
test("claim cannot steal owned item or let Team Leader claim silently",()=>{
 assert.equal(prep({item:{...item,assigneeId:id(6)}}).ok,false);
 assert.equal(prep({context:{...context,role:"team_leader"}}).ok,false);
});
test("start requires actual assignee on matching revision",()=>{
 const next={...item,state:"ASSIGNED",revision:1,assigneeId:context.actorId};
 const r=prep({item:next,request:{...request,action:"START",expectedRevision:1}});
 assert.equal(r.ok,true);assert.equal(r.proposedState,"IN_PROGRESS");
 assert.equal(prep({item:{...next,assigneeId:id(6)},request:{...request,action:"START",expectedRevision:1}}).ok,false);
});
test("only team leader can prepare escalation and must give reason",()=>{
 const req={...request,action:"ESCALATE",reason:"Customer needs supervisor attention"};
 assert.equal(prep({request:req}).ok,false);
 assert.equal(prep({context:{...context,role:"team_leader"},request:req}).ok,true);
 assert.equal(prep({context:{...context,role:"team_leader"},request:{...req,reason:"short"}}).ok,false);
});
test("completion needs in-progress and assignee plus reason",()=>{
 const inProgress={...item,state:"IN_PROGRESS",revision:5,assigneeId:context.actorId};
 const r=prep({item:inProgress,request:{...request,action:"COMPLETE",expectedRevision:5,reason:"Resolved customer issue"}});
 assert.equal(r.ok,true);assert.equal(r.proposedState,"DONE");
 assert.equal(prep({item:{...item,state:"DONE",revision:5},request:{...request,action:"COMPLETE",expectedRevision:5,reason:"Resolved customer issue"}}).ok,false);
});
test("no transitions outside declared state machine",()=>{
 assert.equal(prep({item:{...item,state:"NOT_REAL"}}).ok,false);
 assert.equal(prep({item:{...item,state:"DONE"}}).ok,false);
});
test("no spoofed actor assignment or wrong city",()=>{
 assert.equal(prep({item:{...item,cityId:id(11)}}).ok,false);
 assert.equal(prep({item:{...item,teamId:id(11)}}).ok,false);
 assert.equal(prep({item:{...item,assigneeId:"broken"}}).ok,false);
});
test("invalid clock, null request fail closed",()=>{
 assert.equal(prep({now:0}).ok,false);assert.equal(prep({request:null}).ok,false);
});
