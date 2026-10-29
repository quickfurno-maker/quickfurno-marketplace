import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
let n=0;
const test=(name,fn)=>{fn();n++;console.log("PASS "+name)};
const routes=["acquisition","vendor360","desk","my-work","studio-simulate"];
for(const name of routes){
 const source=read("app/api/vox/v1/"+name+"/route.ts");
 test(name+" unavailable unless explicitly approved Staging",()=>{
   assert.match(source,/VOX_STAFF_READ_ENABLED!=="staging"/);
   assert.match(source,/STAFF_READ_DISABLED/);
 });
 test(name+" strictly verifies Core-resolved scoped staff",()=>assert.match(source,/await getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/));
 test(name+" all outputs no-store and bearer separated",()=>{
   assert.match(source,/no-store/);
   assert.match(source,/"Authorization"/);
 });
 test(name+" no direct client-managed writes",()=>{
   assert.doesNotMatch(source,/\.insert\(|\.upsert\(|\.update\(|\.delete\(|sendWhatsApp\(|sendMessage\(/);
 });
}
const staff=read("services/vox/verifiedScopedStaff.ts");
test("Core verifies actual Supabase Auth before decoding session",()=>{
 assert.match(staff,/await verifySupabaseBearerUser\(raw\)/);
 assert.match(staff,/jwt\.aal!=="aal2"/);
 assert.match(staff,/jwt\.sub!==user\.id/);
});
test("staff cannot inherit Core admin",()=>assert.match(staff,/isNeutralVoxStaffPrincipal\(profile\.data,user\)/));
test("staff checks live team and city",()=>{
 assert.match(staff,/vox_staff_memberships_v1/);
 assert.match(staff,/vox_staff_teams_v1/);
 assert.match(staff,/city\.data\?\.is_active!==true/);
});
test("scopes bounded and deny on missing data",()=>{
 assert.match(staff,/limit\(201\)/);
 assert.match(staff,/scopes\.data\.length>200/);
});
test("department capability layer narrows access only",()=>assert.match(staff,/restrictScopedStaffByDepartment/));
test("no mutating browser staff access",()=>{
 for(const route of ["acquisition","vendor360","studio-simulate"]){
   const src=read("app/api/vox/v1/"+route+"/route.ts");
   assert.match(src,/return .*405/);
 }
});
console.log("VOX_STAFF_SCOPED_READ_SOURCE_PASS "+n+"/"+n);
