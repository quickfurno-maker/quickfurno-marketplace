// VL-02 governed opt-in to lead acceptance. Actual Core service with mock DB.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fs.readFileSync(path.join(root, "services/vendorAdminService.ts"), "utf8");
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const user = "22222222-2222-4222-8222-222222222222";
const id = "11111111-1111-4111-8111-111111111111";
const base = {
  id, status:"Approved", is_active:true, accepting_leads:false,
  user_id:user, google_place_id:"ChIJVerifiedPlace000000",
  location_verification_status:"verified", service_zone_id:"zone-1",
  office_latitude:18.55, office_longitude:73.93,
  city:"Pune",remaining_credits:5, total_credits:5,
};
let row={...base};
let enabledCities=[{name:"Pune",serviceZoneId:"zone-1"}];
let writes=[];
let rejectCAS=false;
const db = {
  from(table) {
    if(table==="audit_logs") return {insert:async()=>({error:null})};
    assert.equal(table,"vendors");
    let update=null;
    let filters={};
    return {
      select() {return this;},
      eq(k,v) {filters[k]=v;return this;},
      order() {return this;},
      maybeSingle:async()=>({data:row.id===filters.id?{...row}:null,error:null}),
      update(x) {update=x;return this;},
      then(resolve,reject) {
        if(update) {
          if(!rejectCAS && Object.entries(filters).every(([k,v])=>row[k]===v)){
            writes.push(update);
            Object.assign(row,update);
          }
          return Promise.resolve({data:rejectCAS?[]:[{id}],error:null}).then(resolve,reject);
        }
        return Promise.resolve({data:[{...row}],error:null}).then(resolve,reject);
      },
    };
  },
  rpc:async()=>({data:null,error:null}),
};
const mocks={
  "../lib/supabase":{adminClient:()=>db},
  "../lib/vendors/vendorEligibility":{evaluateVendorEligibility:()=>({eligible:false})},
  "./vendorCreditWalletService":{applyVendorCreditDelta:async()=>null},
  "../lib/locations/cityService":{getActiveCities:async()=>enabledCities},
  "../lib/geo/canonicalCoordinate":{
    normalizeCoordinate:(a,b)=>typeof a==="number"&&typeof b==="number"&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180?{latitude:a,longitude:b}:null,
  },
};
const m={exports:{}};
new Function("module","exports","require",code)(m,m.exports,(key)=>{if(!(key in mocks))throw Error(key);return mocks[key];});
const api=m.exports;
async function check(name,patch,allow,lock=false){
  row={...base,...patch}; writes=[]; enabledCities=[{name:"Pune",serviceZoneId:"zone-1"}]; rejectCAS=lock;
  const res=await api.setVendorStatusAction(id,"activate_leads","Superadmin",user);
  assert.equal(res.ok,allow,name);
  assert.equal(writes.length,allow?1:0,name+" no unauthorized write");
  console.log("PASS",name);
}
await check("verified and login-linked vendor with credits may enable leads",{},true);
await check("unlinked vendor rejected",{user_id:null},false);
await check("unverified vendor rejected",{location_verification_status:"unverified"},false);
await check("missing Google Place rejected",{google_place_id:null},false);
await check("missing service zone rejected",{service_zone_id:null},false);
await check("zero credits rejected",{remaining_credits:0},false);
await check("unapproved vendor rejected",{status:"Pending"},false);
await check("inactive vendor rejected",{is_active:false},false);
await check("concurrent verification change rejects CAS",{},false,true);
console.log("VL-02 governed lead acceptance functional checks: 9/9 PASS");
