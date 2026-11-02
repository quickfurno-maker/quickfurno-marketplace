import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {selectCurrentEodReferences as references,
 verifyCurrentEodCanonicalProof as canonical}
 from "../../../contracts/vox/currentEodCanonicalProof.mjs";
import {projectCurrentCoreWorkEod} from "../../../contracts/vox/coreWorkEodPreview.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),role:"support_agent",
 canReadContent:true,canMutate:false,prospectIds:[id(10)],vendorIds:[id(11)],
 supportThreadIds:[id(12)]};
const work=(n,kind,sourceId,extra={})=>({id:id(n),team_id:scope.teamId,
 city_id:scope.cityId,source_kind:kind,source_id:sourceId,revision:3,...extra});
const rows=[work(31,"prospect",id(10)),work(32,"vendor",id(11)),
 work(33,"support_thread",id(12),{related_vendor_id:id(11)})];
const evidence={prospects:[{id:id(10),city_id:scope.cityId}],
 vendors:[{id:id(11),service_zone_id:id(21)}],
 zones:[{id:id(21),city_id:scope.cityId,is_active:true}],
 threads:[{id:id(12),vendor_id:id(11)}]};
const proof=(more={})=>{
 const s=more.scope??scope,w=more.workItems??rows;
 const refs=more.references??references({scope:s,workItems:w});
 return canonical({scope:s,workItems:w,references:refs,
  ...evidence,...more});
};
test("canonical multi-lane EOD proof allows only current granted Core subjects",()=>{
 const r=references({scope,workItems:rows});
 assert.equal(r.ok,true);
 assert.deepEqual(r.prospectIds,[id(10)]);
 assert.deepEqual(r.vendorIds,[id(11)]);
 assert.deepEqual(r.supportThreadIds,[id(12)]);
 const c=proof();
 assert.equal(c.ok,true);
 assert.deepEqual(c.verifiedSourceIds,{prospect:[id(10)],vendor:[id(11)],
  support_thread:[id(12)]});
 assert.equal(JSON.stringify(c).includes("phone"),false);
});
test("no work events produces a bounded true-empty but PARTIAL read-only preview",()=>{
 const r=references({scope,workItems:[]});
 assert.equal(r.ok,true);
 const c=canonical({scope,workItems:[],references:r,
  prospects:[],vendors:[],zones:[],threads:[]});
 assert.equal(c.ok,true);
 const report=projectCurrentCoreWorkEod({scope,workItems:[],events:[],
  verifiedSourceIds:c.verifiedSourceIds,businessDate:"2026-10-16"});
 assert.equal(report.ok,true);
 assert.equal(report.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.equal(report.canSubmit,false);assert.equal(report.canExport,false);
 assert.equal(report.providerMessagesSent,0);
});
test("actual own actor event gives partial counts only, no subject details",()=>{
 const ev={id:id(40),work_item_id:id(32),actor_id:scope.userId,event_type:"START",
  from_revision:1,to_revision:2,created_at:"2026-10-16T05:30:00Z"};
 const out=projectCurrentCoreWorkEod({scope,workItems:rows,events:[ev],
  verifiedSourceIds:proof().verifiedSourceIds,businessDate:"2026-10-16"});
 assert.equal(out.ok,true);assert.equal(out.eventsIncluded,1);
 assert.equal(out.counts.starts,1);
 assert.equal(out.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.equal(JSON.stringify(out).includes(id(11)),false);
 assert.equal(out.canSubmit,false);
});
test("reject unverified AAL1/owner/Team Leader and excessive work sets",()=>{
 for(const mutated of [{canReadContent:false},{canMutate:true},{role:"team_leader"},
  {role:"auditor"},{role:"admin"},{userId:id(19)},{teamId:"forged"}]){
  const sc={...scope,...mutated};
  const r=references({scope:sc,workItems:rows});
  if(mutated.userId===id(19))assert.equal(r.ok,true);
  else if(mutated.role==="admin"||mutated.teamId==="forged"||
    mutated.canReadContent===false||mutated.canMutate===true||
    mutated.role==="team_leader"||mutated.role==="auditor")assert.equal(r.ok,false);
 }
 assert.equal(references({scope,workItems:Array.from({length:101},()=>rows[0])}).ok,false);
});
test("duplicate grants, unknown entity, duplicate rows or wrong city/team fail closed",()=>{
 const cases=[
  {scope:{...scope,prospectIds:[id(10),id(10)]}},
  {workItems:[rows[0],rows[0]]},
  {workItems:[{...rows[1],city_id:id(99)}]},
  {workItems:[{...rows[1],team_id:id(99)}]},
  {workItems:[{...rows[1],source_kind:"client"}]},
  {workItems:[{...rows[1],source_id:id(99)}]},
  {workItems:[{...rows[1],revision:-1}]}
 ];
 for(const row of cases){
  const result=references({scope:row.scope??scope,workItems:row.workItems??rows});
  assert.equal(result.ok,false,JSON.stringify(row));
 }
});
test("support threads require BOTH own thread and underlying vendor grants",()=>{
 assert.equal(references({scope:{...scope,vendorIds:[]},workItems:[rows[2]]}).ok,false);
 assert.equal(references({scope,workItems:[{...rows[2],related_vendor_id:id(99)}]}).ok,false);
 assert.equal(references({scope,workItems:[{...rows[2],related_vendor_id:null}]}).ok,false);
});
test("reject missing foreign or disabled vendor zones and forged vendor",()=>{
 for(const variant of [
  {zones:[]},
  {zones:[{...evidence.zones[0],city_id:id(99)}]},
  {zones:[{...evidence.zones[0],is_active:false}]},
  {vendors:[]},
  {vendors:[{...evidence.vendors[0],service_zone_id:id(23)}]},
  {vendors:[...evidence.vendors,{id:id(99),service_zone_id:id(21)}]},
  {zones:[...evidence.zones,...evidence.zones]},
 ]) assert.equal(proof(variant).ok,false,JSON.stringify(variant));
});
test("reject forged prospect and wrong-city canonical verification",()=>{
 for(const variant of [
  {prospects:[]},
  {prospects:[{...evidence.prospects[0],city_id:id(99)}]},
  {prospects:[{id:id(90),city_id:scope.cityId}]},
  {prospects:[...evidence.prospects,...evidence.prospects]}
 ])assert.equal(proof(variant).ok,false,JSON.stringify(variant));
});
test("reject foreign vendor support association, missing threads and wrong proof",()=>{
 for(const variant of [
  {threads:[]},
  {threads:[{...evidence.threads[0],vendor_id:id(99)}]},
  {threads:[{id:id(99),vendor_id:id(11)}]},
  {threads:[...evidence.threads,...evidence.threads]},
  {workItems:[...rows.slice(0,2),{...rows[2],related_vendor_id:id(99)}]},
 ])assert.equal(proof(variant).ok,false,JSON.stringify(variant));
 const original=references({scope,workItems:rows});
 for(const r of [
  {...original,prospectIds:[id(99)]},
  {...original,vendorIds:[]},
  {...original,supportThreadIds:[]},
  {...original,vendorIds:[id(11),id(11)]},
 ])assert.equal(proof({references:r}).ok,false,JSON.stringify(r));
});
test("read-only route requires all four flags and AAL2; fails closed on query params",()=>{
 const src=readFileSync(new URL("../../../app/api/vox/v1/eod-preview/route.ts",import.meta.url),"utf8");
 for(const marker of ["VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED",
  "VOX_WORK_QUEUE_READ_ENABLED","VOX_EOD_PREVIEW_ENABLED",
  "getVerifiedScopedStaff(request.headers.get(\"authorization\"))",
  "url.search||url.hash","CURRENT_AAL2_STAFF_REQUIRED",
  "timeZone:\"Asia/Kolkata\"","UNSUPPORTED_EOD_FILTER",
  "cache-control","private, no-store","vary"])
  assert.ok(src.includes(marker),marker);
 assert.doesNotMatch(src,/inviteUserByEmail|sendWhatsApp|sendMessage\(/);
});
test("Core-only query filters by exact actor and 24h IST before LIMIT and denies overflow",()=>{
 const s=readFileSync(new URL("../../../app/api/vox/v1/eod-preview/route.ts",import.meta.url),"utf8");
 assert.match(s,/from\("vox_work_events_candidate_v1"\)/);
 assert.match(s,/\.eq\("actor_id",scope\.userId\)/);
 assert.match(s,/\.gte\("created_at",dayStart\.toISOString\(\)\)/);
 assert.match(s,/\.lt\("created_at",dayEnd\.toISOString\(\)\)/);
 assert.match(s,/\.limit\(101\)/);
 assert.match(s,/log\.data\.length>100/);
 assert.match(s,/lookup\.data\.length!==ids\.length/);
 assert.match(s,/selectCurrentEodReferences\(\{/);
 assert.match(s,/verifyCurrentEodCanonicalProof\(\{/);
 assert.match(s,/projectCurrentCoreWorkEod\(\{/);
 assert.doesNotMatch(s,/SELECT \*|\.select\("\*"\)|client_phone|customer_email/);
});
test("every mutating verb is always 405, no report submission/broker/send",()=>{
 const src=readFileSync(new URL("../../../app/api/vox/v1/eod-preview/route.ts",import.meta.url),"utf8");
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.ok(src.includes('export function '+method+'(){return send({ok:false,error:"READ_ONLY"},405);}'));
 assert.doesNotMatch(src,/\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.send\(/);
});
