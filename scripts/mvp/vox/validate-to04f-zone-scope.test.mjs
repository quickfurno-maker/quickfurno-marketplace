import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deriveCanonicalCityVendorIds as select} from "../../../contracts/vox/canonicalZoneGate.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const city=id(1),otherCity=id(2),granted=id(11),unauthorized=id(12);
const valid={cityId:city,grantedVendorIds:[granted],
 vendors:[{id:granted,service_zone_id:id(31)}],
 zones:[{id:id(31),city_id:city,is_active:true}]};
test("one current vendor+canonical active city zone is allowed",()=>{
 assert.deepEqual(select(valid),{ok:true,ids:[granted]});
});
test("foreign city, disabled zone or no source zone gives no vendor IDs",()=>{
 assert.deepEqual(select({...valid,zones:[{...valid.zones[0],city_id:otherCity}]}).ok,false);
 assert.deepEqual(select({...valid,zones:[{...valid.zones[0],is_active:false}]}).ok,false);
 assert.deepEqual(select({...valid,zones:[]}),{ok:true,ids:[]});
});
test("no grant expansion, forged vendor/duplicate rows or future client source",()=>{
 assert.equal(select({...valid,vendors:[{id:unauthorized,service_zone_id:id(31)}]}).ok,false);
 assert.equal(select({...valid,vendors:[valid.vendors[0],valid.vendors[0]]}).ok,false);
 assert.equal(select({...valid,zones:[valid.zones[0],valid.zones[0]]}).ok,false);
 assert.equal(select({...valid,grantedVendorIds:[granted,granted]}).ok,false);
});
test("multiple explicitly granted vendors verified in a large city without enumerating it",()=>{
 const grantedIds=Array.from({length:200},(_,i)=>id(1000+i));
 const input={cityId:city,grantedVendorIds:grantedIds,
  vendors:grantedIds.map((vendor,i)=>({id:vendor,service_zone_id:id(3000+i)})),
  zones:grantedIds.slice(0,170).map((_,i)=>({id:id(3000+i),city_id:city,is_active:true}))};
 const r=select(input);
 assert.equal(r.ok,true);assert.equal(r.ids.length,170);
 assert.deepEqual(r.ids,grantedIds.slice(0,170));
});
const route=readFileSync(new URL("../../../app/api/vox/v1/work-queue/route.ts",import.meta.url),"utf8");
test("Core queries scoped vendors FIRST then their zones, never all city zones",()=>{
 const vendorStart=route.indexOf('const vendorRows=scope.vendorIds.length?');
 const zonesStart=route.indexOf('const zones=scopedZoneIds.length?');
 assert.ok(vendorStart>0&&zonesStart>vendorStart);
 assert.match(route,/\.in\("id",\[\.\.\.scope\.vendorIds\]\)/);
 assert.match(route,/\.in\("id",scopedZoneIds\)/);
 assert.match(route,/deriveCanonicalCityVendorIds\(/);
 assert.match(route,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED/);
 assert.match(route,/getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 assert.doesNotMatch(route,/\.insert\(|\.update\(|\.delete\(|inviteUserByEmail/);
});
