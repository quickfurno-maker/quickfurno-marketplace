import test from "node:test";import assert from "node:assert/strict";
import {projectScopedClientCaseList as project} from "../../../contracts/vox/verifiedClientCasePreview.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-16T11:00:00Z");
const scope={userId:id(1),teamId:id(2),cityId:id(3),role:"support_agent",
 canReadContent:true,canMutate:false,verifiedDepartments:["client_success"]};
const create=()=>({
 scope,grants:[{auth_user_id:id(1),scope_kind:"conversation",object_id:id(7),
  expires_at:"2026-10-17T11:00:00Z",revoked_at:null}],
 conversations:[{id:id(7),subject_type:"client",subject_id:id(5),
  assigned_actor:"RIYA",state:"OPEN",human_takeover:false,revision:3,
  updated_at:"2026-10-16T10:00:00Z"}],
 leads:[{id:id(5),service_zone_id:id(8),google_place_id:"ChIJ8AUExamplePlaceID",
  location_verification_status:"verified",latitude:18.53,longitude:73.85}],
 zones:[{id:id(8),city_id:id(3),is_active:true}],now
});
const run=x=>project(x??create());
test("actual current client-project object grant + Google lead city, read only",()=>{
 const r=run();assert.equal(r.ok,true);assert.equal(r.items.length,1);
 assert.equal(r.items[0].agent,"RIYA");assert.equal(r.items[0].revision,3);
 assert.equal(r.canReadTranscript,false);assert.equal(r.canSendReply,false);
 assert.equal(r.canTakeover,false);assert.equal(r.providerMessagesSent,0);
});
test("independently current reviewed department required",()=>{
 for(const s of [{...scope,verifiedDepartments:[]},
  {...scope,role:"team_leader"},
  {...scope,canMutate:true},
  {...scope,cityId:id(98)}]){
  assert.equal(run({...create(),scope:s}).ok,false);
 }
});
test("revoked, expired, reassigned or foreign conversation is denied",()=>{
 for(const change of [{revoked_at:"2026-10-16T10:00:00Z"},
 {expires_at:"2026-10-16T10:00:00Z"},{auth_user_id:id(99)},
 {object_id:id(99)}]){
  const f=create();f.grants[0]={...f.grants[0],...change};
  assert.equal(run(f).ok,false);
 }
});
test("invalid Google place, coords or wrong city service zone denied",()=>{
 for(const patch of [{google_place_id:"typed address"},
  {location_verification_status:"unverified"},
  {latitude:500},{longitude:NaN},{service_zone_id:id(6)}]){
  const f=create();f.leads[0]={...f.leads[0],...patch};
  assert.equal(run(f).ok,false);
 }
 const f=create();f.zones[0].city_id=id(99);
 assert.equal(run(f).ok,false);
});
test("unknown actor state, wrong client subject and missing lead fail closed",()=>{
 for(const patch of [{assigned_actor:"SYSTEM"},{subject_type:"vendor"},
  {subject_id:id(99)},{human_takeover:true},
  {state:"HUMAN",assigned_actor:"RIYA"}]){
  const f=create();f.conversations[0]={...f.conversations[0],...patch};
  assert.equal(run(f).ok,false);
 }
});
test("no raw client PII and no provider messages",()=>{
 const body=JSON.stringify(run());
 for(const needle of ["google_place_id","latitude","longitude","phone","name",
  "destination_hash","contact","messagePayload"]){
  assert.equal(body.includes('"'+needle+'"'),false);
 }
});
test("no project case or object grant is never false authorized send",()=>{
 const f=create();f.grants=[];f.conversations=[];f.leads=[];f.zones=[];
 const r=run(f);assert.equal(r.ok,true);assert.equal(r.items.length,0);
 assert.equal(r.totalKnown,false);assert.equal(r.canSendReply,false);
});
test("real route requires Core AAL2+department+current object scope and reads no messages",async()=>{
 const {readFileSync}=await import("node:fs");
 const p=readFileSync(new URL("../../../app/api/vox/v1/riya-client-cases/route.ts",import.meta.url),"utf8");
 for(const n of ["getVerifiedScopedStaff","verifiedDepartments","client_success",
 "vox_staff_object_scopes_v1","google_place_id","communication_conversations",
 "marketplace_service_zones"])assert.equal(p.includes(n),true);
 assert.doesNotMatch(p,/select\(".*sealed_destination|communication_messages"/);
});
test("existing quarantined grant activation excludes client subjects, so launch remains held",async()=>{
 const {readFileSync}=await import("node:fs");
 const p=readFileSync(new URL("../../../ops/vox/quarantined-migrations/legacy-20261014/20261014030000_vox_v1_approved_grant_finalizer.sql",import.meta.url),"utf8");
 assert.match(p,/c\.subject_type in \('prospect','vendor'\)/);
 assert.doesNotMatch(p,/c\.subject_type in \('prospect','vendor','client'\)/);
 // DBA/AppSec must approve canonical client subject issuance before any Stage install.
});
