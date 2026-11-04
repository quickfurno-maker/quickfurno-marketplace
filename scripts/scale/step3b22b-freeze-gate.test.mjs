import test from "node:test";
import assert from "node:assert/strict";
import {checkMaintenanceFreeze,REQUIRED_EXTERNAL_SERVICES,STAGING_PROJECT,KNOWN_STAGING_BOUND_CONTAINERS} from "./step3b22b-freeze-gate.mjs";
const now="2026-11-03T16:10:00Z";
const counts=()=>({
 registeredWorkers:1,acceptingWorkers:0,workerInFlight:0,recentHeartbeat5m:0,
 conversationOutboxPending:0,jarvisTurnOutboxPending:0,
 outboundEnabledPolicies:0,webhookEnabledPolicies:0
});
const good=()=>({
 projectRef:STAGING_PROJECT,environment:"staging",
 observedAt:"2026-11-03T16:09:00Z",counts:counts(),
 operatorId:"operator-001",
 windowStartsAt:"2026-11-03T16:05:00Z",
 windowEndsAt:"2026-11-03T16:20:00Z",
 externalStops:REQUIRED_EXTERNAL_SERVICES.map(service=>({
  service,confirmedStopped:true,evidenceSha256:"a".repeat(64),
  observedAt:"2026-11-03T16:09:00Z"
 })),
 stagingDockerInventory:{
  source:"read_only_docker_inspect",inventoryComplete:true,
  evidenceSha256:"b".repeat(64),observedAt:"2026-11-03T16:09:00Z",
  containers:KNOWN_STAGING_BOUND_CONTAINERS.map(name=>({name,stagingRefPresent:true,state:"exited"}))
 }
});
test("B1 absent evidence holds",()=>{
 const r=checkMaintenanceFreeze({},now);
 assert.equal(r.decision,"HOLD");assert.equal(r.executable,false);
});
test("B2 synthetic complete freeze evidence can only require further independent release",()=>{
 const r=checkMaintenanceFreeze(good(),now);
 assert.equal(r.decision,"FREEZE_EVIDENCE_PRESENT_INDEPENDENT_RELEASE_REQUIRED");
 assert.equal(r.executable,false);
});
test("B3 row counts from Staging alone never prove a freeze",()=>{
 const e=good();e.externalStops=[];
 assert.equal(checkMaintenanceFreeze(e,now).decision,"HOLD");
});
test("B4 active in-flight, provider and outbox entries deny independently",()=>{
 for(const key of ["acceptingWorkers","workerInFlight","recentHeartbeat5m",
 "conversationOutboxPending","jarvisTurnOutboxPending","outboundEnabledPolicies","webhookEnabledPolicies"]){
  const e=good();e.counts[key]=1;
  assert.ok(checkMaintenanceFreeze(e,now).blockers.includes("ACTIVE_WORK_DETECTED:"+key),key);
 }
});
test("B5 stale and future snapshots deny",()=>{
 for(const observedAt of ["2026-11-03T16:00:00Z","2026-11-03T16:11:00Z","bad"]){
  const e=good();e.observedAt=observedAt;
  assert.equal(checkMaintenanceFreeze(e,now).decision,"HOLD");
 }
});
test("B6 external stop proof needs every service and a recent digest",()=>{
 for(const field of ["service","confirmedStopped","evidenceSha256","observedAt"]){
  const e=good();
  e.externalStops[0][field]=field==="confirmedStopped"?false:"invalid";
  assert.equal(checkMaintenanceFreeze(e,now).decision,"HOLD",field);
 }
});
test("B7 wrong Staging project, absent operator or expired window deny",()=>{
 for(const patch of [{projectRef:"other"},{operatorId:""},{windowEndsAt:"2026-11-03T16:09:00Z"}]){
  assert.equal(checkMaintenanceFreeze({...good(),...patch},now).decision,"HOLD");
 }
});
test("B8 negative pending count fails closed",()=>{
 const e=good();e.counts.workerInFlight=-1;
 assert.ok(checkMaintenanceFreeze(e,now).blockers.includes("COUNT_INVALID:workerInFlight"));
});
test("B9 a confirmed Staging-bound Core or VOX container still running blocks freeze",()=>{
 for(const name of KNOWN_STAGING_BOUND_CONTAINERS){
  const e=good();e.stagingDockerInventory.containers.find(x=>x.name===name).state="running";
  assert.ok(checkMaintenanceFreeze(e,now).blockers.includes("STAGING_CONTAINER_ACTIVE:"+name),name);
 }
});
test("B10 a newly discovered Staging-bound container must also be stopped",()=>{
 const e=good();e.stagingDockerInventory.containers.push({
  name:"future-staging-worker",stagingRefPresent:true,state:"running"
 });
 assert.ok(checkMaintenanceFreeze(e,now).blockers.includes("STAGING_CONTAINER_ACTIVE:future-staging-worker"));
});
test("B11 stale, incomplete, or misattributed VPS inventory blocks",()=>{
 for(const patch of [
  {inventoryComplete:false},{evidenceSha256:"bad"},
  {observedAt:"2026-11-03T16:00:00Z"},{source:"unknown"}
 ]){
  const e=good();Object.assign(e.stagingDockerInventory,patch);
  assert.ok(checkMaintenanceFreeze(e,now).blockers.includes("STAGING_DOCKER_INVENTORY_UNVERIFIED"));
 }
});
test("B12 known Staging-bound container must be present with confirmed Staging scope",()=>{
 const e=good();e.stagingDockerInventory.containers.pop();
 assert.ok(checkMaintenanceFreeze(e,now).blockers.includes(
   "STAGING_CONTAINER_MISSING:qf-vox-20261102-mfa-ui-test"));
 const f=good();f.stagingDockerInventory.containers[0].stagingRefPresent=false;
 assert.ok(checkMaintenanceFreeze(f,now).blockers.includes(
   "STAGING_CONTAINER_TARGET_UNVERIFIED:qf-core-staging"));
});
