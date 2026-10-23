import test from "node:test";
import assert from "node:assert/strict";
import {resolveScopedStaff,filterHumanConversations} from "../../../contracts/vox/scopedStaff.mjs";
import {normalizeAgentSubjectAccess,hasHumanCoreConversation} from "../../../contracts/vox/agentSubjectAccess.mjs";
import {projectStaffServiceDesk} from "../../../contracts/vox/serviceDesk.mjs";
import {projectProspectVendor} from "../../../contracts/vox/vendorProjection.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-23T08:00:00Z");
const user=id(1),team=id(2),city=id(3),prospect=id(4),vendor=id(5),conversation=id(6),thread=id(7);
const member=(role="vendor_success_agent")=>({auth_user_id:user,is_active:true,revoked_at:null,
 staff_role:role,team_id:team,expires_at:"2026-10-24T00:00:00Z"});
const group={id:team,is_active:true,city_id:city};
const grant=(kind,obj)=>({auth_user_id:user,scope_kind:kind,object_id:obj,revoked_at:null,
 expires_at:"2026-10-24T00:00:00Z"});
const grants=[grant("prospect",prospect),grant("vendor",vendor),grant("conversation",conversation),grant("support_thread",thread)];
const staff=(role="vendor_success_agent",changes={})=>resolveScopedStaff({userId:user,identityVerified:true,
 membership:member(role),team:group,grants,...changes,now});
const human=(subjectType,subject)=>({id:conversation,subject_type:subjectType,subject_id:subject,
 state:"HUMAN",human_takeover:true,revision:1,updated_at:"2026-10-23T07:00:00Z"});
test("I1 vendor Staff scoped identity -> Anisha human handover -> sanitized desk only",()=>{
 const scope=staff();assert.ok(scope);assert.deepEqual(scope.vendorIds,[vendor]);assert.deepEqual(scope.prospectIds,[]);
 const access=normalizeAgentSubjectAccess({agent:"ANISHA",subjectType:"vendor",subjectId:vendor,revision:1},scope);
 assert.ok(access);assert.equal(hasHumanCoreConversation([human("vendor",vendor)],access,scope),true);
 const res=projectStaffServiceDesk({threads:[{id:thread,vendor_id:vendor,status:"open",priority:"normal",created_at:"2026-10-23T07:00:00Z"}],
  conversations:[human("vendor",vendor)],context:scope,verifiedVendorIds:scope.vendorIds,now});
 assert.equal(res.mode,"READ_ONLY");assert.equal(res.support.length,1);assert.equal(res.humanInbox.length,1);
 assert.equal(res.humanInbox[0].lane,"ANISHA");assert.equal(res.humanInbox[0].canReply,false);assert.equal(res.humanInbox[0].canSendTemplate,false);
});
test("I2 acquisition Staff -> Aarohi prospect only; Core vendor linkage needs active attestation",()=>{
 const scope=staff("acquisition_agent");
 assert.deepEqual(scope.prospectIds,[prospect]);assert.deepEqual(scope.vendorIds,[]);
 const access=normalizeAgentSubjectAccess({agent:"AAROHI",subjectType:"prospect",subjectId:prospect,revision:1},scope);
 assert.ok(access);assert.equal(hasHumanCoreConversation([human("prospect",prospect)],access,scope),true);
 assert.equal(normalizeAgentSubjectAccess({agent:"ANISHA",subjectType:"vendor",subjectId:vendor,revision:1},scope),null);
 const base=projectProspectVendor({prospect:{id:prospect,business_name:"A Prospect",prospect_stage:"qualified",area:"Pune"}});
 assert.equal(base.identityLinked,false);assert.equal(base.vendor,null);
 assert.throws(()=>projectProspectVendor({prospect:{id:prospect},vendor:{id:vendor},coreAttestation:{verified:false}}));
 const linked=projectProspectVendor({prospect:{id:prospect},vendor:{id:vendor,business_name:"Vendor"},
  coreAttestation:{verified:true,source:"quickfurno-core",state:"ACTIVE",prospectId:prospect,vendorId:vendor}});
 assert.equal(linked.identityLinked,true);assert.equal(linked.paymentConfirmed,undefined);
});
test("I3 revoke Staff membership/expired city team/grant => no scoped content and no agent handover",()=>{
 for(const changes of [
 {membership:{...member(),is_active:false}},
 {membership:{...member(),revoked_at:"2026-10-23T07:00:00Z"}},
 {membership:{...member(),expires_at:"2026-10-22T00:00:00Z"}},
 {team:{...group,is_active:false}},
 {identityVerified:false}
 ])assert.equal(staff("vendor_success_agent",changes),null);
 const revoked=staff("vendor_success_agent",{grants:grants.map(x=>({...x,revoked_at:"2026-10-23T07:00:00Z"}))});
 assert.deepEqual(revoked.vendorIds,[]);assert.deepEqual(revoked.conversationIds,[]);
 assert.equal(normalizeAgentSubjectAccess({agent:"ANISHA",subjectType:"vendor",subjectId:vendor,revision:1},revoked),null);
});
test("I4 forged tenant, foreign conversation, AI-owned state, stale revision never passes human checks",()=>{
 const scope=staff();const req={agent:"ANISHA",subjectType:"vendor",subjectId:vendor,revision:1};
 const ok=normalizeAgentSubjectAccess(req,scope);assert.ok(ok);
 assert.equal(hasHumanCoreConversation([human("vendor",id(80))],ok,scope),false);
 assert.equal(hasHumanCoreConversation([{...human("vendor",vendor),id:id(90)}],ok,scope),false);
 assert.equal(hasHumanCoreConversation([{...human("vendor",vendor),state:"OPEN"}],ok,scope),false);
 assert.equal(hasHumanCoreConversation([{...human("vendor",vendor),revision:2}],ok,scope),false);
 const foreign=projectStaffServiceDesk({conversations:[human("vendor",id(88))],context:scope,
 verifiedVendorIds:scope.vendorIds,now});assert.equal(foreign.humanInbox.length,0);
});
test("I5 filter is metadata only, never converts a human handover into send authority",()=>{
 const scope=staff(),rows=[human("vendor",vendor),{...human("client",id(9)),id:id(10)}];
 const filtered=filterHumanConversations(rows,scope,[],[vendor]);
 assert.equal(filtered.length,1);
 assert.equal(filtered[0].subject_type,"vendor");
 assert.equal(Object.hasOwn(filtered[0],"message"),false);
});
