import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const get=(file)=>readFileSync(resolve(root,file),"utf8");
let passed=0;
function check(name,fn){fn();passed++;console.log("PASS",name);}
const dir=get("app/api/vox/v1/staff-directory/route.ts");
const rev=get("app/api/vox/v1/staff-review-queue/route.ts");
for(const [name,code,flag] of [
 ["directory",dir,"VOX_STAFF_DIRECTORY_ENABLED"],
 ["review",rev,"VOX_STAFF_REVIEWS_READ_ENABLED"]
]){
 check(name+" requires explicit staff-read gate",()=>assert.match(code,/VOX_STAFF_READ_ENABLED!=="staging"/));
 check(name+" requires staff grants gate",()=>assert.match(code,/VOX_STAFF_GRANTS_ENABLED!=="staging"/));
 check(name+" requires own feature gate",()=>assert.ok(code.includes('process.env.'+flag+'!=="staging"')));
 check(name+" is fail-closed by default",()=>assert.match(code,/503/));
 check(name+" is no-store",()=>assert.match(code,/no-store/));
 check(name+" forbids POST",()=>assert.match(code,/export function POST\(\)\{return send\(\{ok:false/));
 check(name+" forbids PATCH",()=>assert.match(code,/export function PATCH\(\)\{return send\(\{ok:false/));
 check(name+" forbids DELETE",()=>assert.match(code,/export function DELETE\(\)\{return send\(\{ok:false/));
 check(name+" no direct mutation or outbound",()=>assert.doesNotMatch(code,/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(|sendWhatsApp|provider\.send/));
}
check("owner directory checks Supabase AAL2 twice",()=>{
 assert.equal((dir.match(/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/g)||[]).length,2);
});
check("owner roster strips contact details",()=>{
 assert.doesNotMatch(dir,/\.select\("[^"]*(email|phone|token|password)[^"]*"/i);
 assert.match(dir,/previewCount:members\.length/);
});
check("owner roster has bounded cap",()=>assert.match(dir,/limit\(41\)/));
check("team leader reviewer requires current verified scope",()=>{
 assert.match(rev,/await getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 assert.match(rev,/actor\.role!=="team_leader"/);
});
check("team leader queue scoped to exact team",()=>assert.match(rev,/\.eq\("team_id",actor\.teamId\)/));
check("rejects review of self and own request",()=>{
 assert.match(rev,/\.neq\("requested_by",actor\.userId\)/);
 assert.match(rev,/\.neq\("target_profile_id",actor\.userId\)/);
});
check("bounded review payload with no contact fields",()=>{
 assert.match(rev,/\.limit\(16\)/);
 assert.doesNotMatch(rev,/\.select\("[^"]*(email|phone|token|password)[^"]*"/i);
});
console.log("VOX_STAFF_ADMIN_READ_CONTRACT_PASS "+passed+"/"+passed);
