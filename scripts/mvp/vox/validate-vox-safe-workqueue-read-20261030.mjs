import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const queue=read("app/api/vox/v1/work-queue/route.ts");
const catalog=read("app/api/vox/v1/staff-capability-catalog/route.ts");
let count=0;
function check(label,fn){fn();++count;console.log("PASS",label)}
for(const [label,code,gate] of [["queue",queue,"VOX_WORK_QUEUE_READ_ENABLED"],["catalog",catalog,"VOX_MULTI_DEPARTMENT_CATALOG_ENABLED"]]){
 check(label+" has top-level opt-in Staff flag",()=>assert.match(code,/VOX_STAFF_READ_ENABLED!=="staging"/));
 check(label+" has existing Staff grants opt-in",()=>assert.match(code,/VOX_STAFF_GRANTS_ENABLED!=="staging"/));
 check(label+" has its own feature gate",()=>assert.ok(code.includes('process.env.'+gate+'!=="staging"')));
 check(label+" returns unavailable on flag off",()=>assert.match(code,/STAFF_READ_DISABLED"},503/));
 check(label+" private no-store",()=>assert.match(code,/private, no-store/));
 check(label+" uses Authorization-separated cache",()=>assert.match(code,/vary":"Authorization"/));
 check(label+" no direct mutation",()=>assert.doesNotMatch(code,/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|sendWhatsApp\(/));
}
check("queue requires department intersection",()=>assert.match(queue,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"/));
check("queue requires real current AAL2 staff",()=>assert.match(queue,/await getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/));
check("queue excludes leader/auditor content role",()=>assert.match(queue,/scope\.role==="team_leader"\|\|scope\.role==="auditor"/));
check("queue verifies city and vendor zone",()=>{assert.match(queue,/deriveCanonicalCityVendorIds/);assert.match(queue,/CANONICAL_ZONE_PROOF_FAILED/);});
check("queue bounded to explicit assigned/unassigned objects",()=>{assert.match(queue,/selectScopedWorkCandidates/);assert.match(queue,/\.limit\(25\)/);});
check("queue revalidates staff scope after read",()=>assert.equal((queue.match(/unchangedAuthorizedStaffScope\(scope,refreshed\)/g)||[]).length,2));
check("queue denies mutation methods",()=>{for(const m of ["POST","PATCH","PUT","DELETE"])assert.match(queue,new RegExp("export function "+m+"\\(\\)\\{return send\\(\\{ok:false,error:\"READ_ONLY\"\\},405\\)"));});
check("catalog requires verified Owner AAL2",()=>assert.match(catalog,/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/));
check("catalog explicitly lacks activation/invitations",()=>{assert.match(catalog,/canInvite:false/);assert.match(catalog,/canActivate:false/);});
check("catalog rejects every write method",()=>{assert.match(catalog,/const denied=\(\)=>send\(\{ok:false,error:"GOVERNED_CORE_ACTION_NOT_IMPLEMENTED"\},405\)/);for(const m of ["POST","PUT","PATCH","DELETE"])assert.ok(catalog.includes('export const '+m+'=denied;'));});
console.log("VOX_SAFE_WORK_QUEUE_AND_CATALOG_PASS "+count+"/"+count);
