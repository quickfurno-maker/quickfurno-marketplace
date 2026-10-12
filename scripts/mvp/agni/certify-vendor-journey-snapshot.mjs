// VL-03 — real Core AGNI snapshot with isolated canonical table fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const source=fs.readFileSync(path.join(root,"services/agniOwnerSnapshotService.ts"),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fixtures={
  leads:[],payments:[],lead_assignments:[],cities:[{is_active:true}],
  vendors:[
    {id:"a",status:"Approved",user_id:null,service_zone_id:null,accepting_leads:true,location_verification_status:"unverified",remaining_credits:4,is_active:true},
    {id:"b",status:"Approved",user_id:"auth",service_zone_id:"zone",accepting_leads:false,location_verification_status:"verified",remaining_credits:1,is_active:true},
    {id:"c",status:"Pending",user_id:null,service_zone_id:null,accepting_leads:false,location_verification_status:"provisional",remaining_credits:0,is_active:false},
  ],
  vendor_profile_change_requests:[{request_type:"office_location_change",status:"pending"}],
  marketplace_service_zones:[{is_active:true,matching_enabled:true,boundary:null}],
  vendor_package_orders:[{paid_at:"2026-10-12",activated_at:null},{paid_at:null,activated_at:null}],
};
let failed=null;
const seen=new Set();
function builder(table){
  assert.ok(Object.hasOwn(fixtures,table),"Unexpected table "+table);
  const predicates=[];
  const q={
    select(f,o){assert.equal(f,"id");assert.equal(o?.count,"exact");assert.equal(o?.head,true);return this;},
    eq(k,v){predicates.push(row=>row[k]===v);return this;},
    is(k,v){predicates.push(row=>row[k]===v);return this;},
    not(k,operator,v){assert.equal(operator,"is");predicates.push(row=>row[k]!==v);return this;},
    lte(k,v){predicates.push(row=>row[k]<=v);return this;},
    gte(k,v){predicates.push(row=>row[k]>=v);return this;},
    in(k,values){predicates.push(row=>values.includes(row[k]));return this;},
    then(resolve,reject) {
      seen.add(table);
      return Promise.resolve(table===failed?{count:null,error:{code:"DB_DOWN"}}:
        {count:fixtures[table].filter(row=>predicates.every(p=>p(row))).length,error:null}).then(resolve,reject);
    },
  };
  return q;
}
const mocks={
  "server-only":{},
  "@/lib/supabase":{adminClient:()=>({from:builder})},
  "@/services/adminOperationsService":{getOperationsOverview:async()=>({overallHealth:"HEALTHY",unavailableSubsystems:0,subsystems:[],attentionIncidents:[]})},
};
const m={exports:{}};
new Function("module","exports","require",code)(m,m.exports,(key)=>{
  assert.ok(Object.hasOwn(mocks,key),"Unmocked import "+key);
  return mocks[key];
});

const one=await m.exports.getAgniOwnerQuickFurnoSnapshot(new Date("2026-10-13T00:00:00Z"));
const expected={
  vendors_approved_without_login:1,
  vendors_approved_without_service_zone:1,
  vendors_accepting_leads_without_service_zone:1,
  vendor_google_offices_verified:1,
  vendor_google_offices_provisional:1,
  vendor_office_change_reviews_pending:1,
  active_matching_zones_missing_polygon:1,
  vendor_paid_orders_not_activated:1,
};
let checks=0;
assert.equal(one.protocol,"qf.agni.owner-snapshot.response.v1");
for(const [key,val] of Object.entries(expected)){
  assert.deepEqual(one.metrics[key],{status:"AVAILABLE",value:val},key);
  console.log("PASS exact aggregated fact",key);
  checks++;
}
assert.equal(seen.size,Object.keys(fixtures).length);
checks++;console.log("PASS all source tables queried without details");
const json=JSON.stringify(one);
assert.ok(!json.includes("ChIJ")&&!json.includes("phone")&&!json.includes("email")&&!json.includes("auth")&&!json.includes('"id":"a"'));
checks++;console.log("PASS no vendor ID/PII/payment payload in owner snapshot");
failed="vendor_profile_change_requests";
const degraded=await m.exports.getAgniOwnerQuickFurnoSnapshot(new Date("2026-10-13T00:00:00Z"));
assert.deepEqual(degraded.metrics.vendor_office_change_reviews_pending,{status:"UNAVAILABLE",value:null});
assert.deepEqual(degraded.metrics.vendors_approved_without_login,{status:"AVAILABLE",value:1});
checks++;console.log("PASS unavailable source is UNKNOWN, not false zero; healthy counts survive");
assert.ok(Object.isFrozen(degraded.metrics) && Object.isFrozen(degraded));
checks++;console.log("PASS immutable read-only output");
console.log("VL-03 Core AGNI vendor readiness:",checks+"/12 PASS");
