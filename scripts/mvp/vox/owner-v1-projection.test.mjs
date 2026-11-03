import test from "node:test";
import assert from "node:assert/strict";
import {projectOwnerVendor360,projectOwnerAcquisition,projectOwnerDesk}
 from "../../../services/vox/ownerWorkspaceProjection.mjs";
const V="11111111-1111-4111-8111-111111111111";
const P="22222222-2222-4222-8222-222222222222";
const T="33333333-3333-4333-8333-333333333333";
test("Owner vendor projection is bounded, sanitizes labels, and drops unrelated CRM/tasks",()=>{
 const view=projectOwnerVendor360({
  vendors:[{id:V,business_name:" Vendor\r\nName ",status:"Approved",verification_status:"Verified",is_active:true,phone:"+911234567890",remaining_credits:9}],
  crm:[{vendor_id:V,onboarding_stage:"Ready"},{vendor_id:P,onboarding_stage:"Secret"}],
  tasks:[{id:T,vendor_id:V,title:"Follow up",status:"open"},{id:P,vendor_id:P,title:"unrelated"}]
 });
 assert.equal(view.schema,"qf.vox.owner.vendor360.v1");
 assert.equal(view.readOnly,true);assert.equal(view.actionsEnabled,false);
 assert.equal(view.vendors.length,1);assert.equal(view.crm.length,1);assert.equal(view.tasks.length,1);
 assert.equal(view.vendors[0].businessName,"Vendor  Name");
 assert.doesNotMatch(JSON.stringify(view),/1234567890|remaining_credits|Secret/);
});
test("Owner acquisition uses canonical Core tasks only, no contact or conversion claims",()=>{
 const view=projectOwnerAcquisition({
  prospects:[{id:P,business_name:"Prospect",do_not_contact:true,human_takeover:true,phone:"+911234567890"}],
  tasks:[{id:T,prospect_id:P,task_type:"Followup",due_at:"2026-11-04T10:00:00Z"},
    {id:V,prospect_id:V,task_type:"unrelated"}]
 });
 assert.equal(view.prospects[0].doNotContact,true);
 assert.equal(view.prospects[0].humanTakeover,true);
 assert.equal(view.tasks.length,1);
 assert.doesNotMatch(JSON.stringify(view),/1234567890|unrelated/);
});
test("Owner Desk excludes non-human conversations and never returns message content",()=>{
 const view=projectOwnerDesk({threads:[{id:T,status:"open",priority:"high",message:"secret"}],
  conversations:[{id:V,subject_type:"vendor",state:"HUMAN",human_takeover:true,
   service_window_expires_at:"2026-11-04T10:00:00Z",message_text:"secret"},
   {id:P,state:"AI",human_takeover:false,raw_message:"secret"}],now:Date.parse("2026-11-03T10:00:00Z")});
 assert.equal(view.humanInbox.length,1);assert.equal(view.humanInbox[0].lane,"ANISHA");
 assert.equal(view.humanInbox[0].serviceWindow,"OPEN");
 assert.equal(view.support.length,1);assert.doesNotMatch(JSON.stringify(view),/secret|message_text/);
});
