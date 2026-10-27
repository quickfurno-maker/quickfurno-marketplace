import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deriveCanonicalCityVendorIds} from "../../../contracts/vox/canonicalZoneGate.mjs";
const root=new URL("../../../",import.meta.url),read=p=>readFileSync(new URL(p,root),"utf8");
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
test("Staff Desk and My Work verify exact vendor ID rows, THEN their active city zones",()=>{
 for(const path of ["app/api/vox/v1/desk/route.ts","app/api/vox/v1/my-work/route.ts"]){
  const src=read(path);
  const v=src.indexOf('const vendors=await db.from("vendors")');
  const z=src.indexOf('const zones=zoneIds.length?');
  assert.ok(v>=0&&z>v,path);
  assert.match(src,/\.in\("id",\[\.\.\.scope\.vendorIds\]\)/);
  assert.match(src,/\.in\("id",zoneIds\)/);
  assert.match(src,/deriveCanonicalCityVendorIds\(/);
  assert.doesNotMatch(src,/\.select\("id"\)\.eq\("city_id",scope\.cityId\)\.eq\("is_active",true\)\.limit\(201\)/);
  assert.doesNotMatch(src,/\.insert\(|\.update\(|inviteUserByEmail|sendWhatsApp\(/);
 }
});
test("200 valid Staff vendors in a >200 zone city are not hidden by city-wide truncation",()=>{
 const granted=Array.from({length:200},(_,i)=>uuid(1000+i));
 const vendors=granted.map((id,i)=>({id,service_zone_id:uuid(3000+i)}));
 const zones=vendors.map((v)=>({id:v.service_zone_id,city_id:uuid(1),is_active:true}));
 const r=deriveCanonicalCityVendorIds({cityId:uuid(1),grantedVendorIds:granted,vendors,zones});
 assert.equal(r.ok,true);assert.equal(r.ids.length,200);
});
test("foreign city, inactive zone and forged vendor never expand Core grants",()=>{
 const base={cityId:uuid(1),grantedVendorIds:[uuid(2)],
  vendors:[{id:uuid(2),service_zone_id:uuid(3)}],
  zones:[{id:uuid(3),city_id:uuid(1),is_active:true}]};
 assert.deepEqual(deriveCanonicalCityVendorIds(base),{ok:true,ids:[uuid(2)]});
 assert.deepEqual(deriveCanonicalCityVendorIds({...base,zones:[]}),{ok:true,ids:[]});
 assert.equal(deriveCanonicalCityVendorIds({...base,zones:[{...base.zones[0],city_id:uuid(4)}]}).ok,false);
 assert.equal(deriveCanonicalCityVendorIds({...base,zones:[{...base.zones[0],is_active:false}]}).ok,false);
 assert.equal(deriveCanonicalCityVendorIds({...base,vendors:[{...base.vendors[0],id:uuid(4)}]}).ok,false);
});
test("Team Operations links to existing independent Core-authorized previews, not chat sends",()=>{
 const page=read("apps/vox-web/app/team/page.tsx");
 for(const path of ["/acquisition","/vendor360","/service-desk","/team/work-queue"])
  assert.ok(page.includes('href:"'+path+'"'));
 assert.match(page,/fetchStaffOverview\(\)/);
 assert.match(page,/admin\.ok\?<section/);
 assert.match(page,/Actions disabled pending certification/);
});
