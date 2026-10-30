import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const code=readFileSync(resolve(import.meta.dirname,"../../../app/api/vox/v1/work-transitions/route.ts"),"utf8");
let n=0;const check=(name,fn)=>{fn();n++;console.log("PASS",name)};
for(const flag of ["VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_WORK_ACTIONS_ENABLED"]){
 check("cannot mutate without explicit "+flag,()=>assert.ok(code.includes('process.env.'+flag+'!=="staging"')));
}
check("default deny before input parsing",()=>assert.ok(code.indexOf("VOX_WORK_WRITES_DISABLED")<code.indexOf("request.text()")));
check("validated AAL2 through real scoped Staff",()=>assert.match(code,/await getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/));
check("cannot elevate team leader/auditor",()=>assert.match(code,/\["team_leader","auditor"\]/));
check("cannot accept arbitrary JSON fields",()=>assert.match(code,/UNKNOWN_OR_MISSING_FIELDS/));
check("nonce is a UUID and revision integer",()=>{assert.match(code,/!id\(data\.nonce\)/);assert.match(code,/Number\.isSafeInteger\(data\.expectedRevision\)/);});
check("no client actor/team/city in DB parameters",()=>{assert.match(code,/p_actor:scoped\.userId/);assert.doesNotMatch(code,/p_actor:data|p_team:data|p_city:data/);});
check("single dedicated SQL transition RPC",()=>assert.match(code,/\.rpc\("qf_vox_work_transition_candidate_v1"/));
check("successful receipt rejects wrong subject, revision or unexpected state",()=>{assert.match(code,/receipt\.work_item_id!==data\.itemId/);assert.match(code,/receipt\.new_revision!==\(data\.expectedRevision as number\)\+1/);assert.match(code,/INVALID_CORE_RECEIPT/);});
check("no direct provider sends, payment or credits",()=>assert.doesNotMatch(code,/sendWhatsApp|sendMessage\(|\.insert\(|\.update\(|\.delete\(|razorpay|chargeCredit\(/i));
check("no claims of affecting vendor matching or outbound messages",()=>{assert.match(code,/providerMessagesSent:0/);assert.match(code,/affectsVendorLeadMatching:false/);});
check("all reads/extra HTTP methods denied",()=>{for(const v of ["GET","PATCH","PUT","DELETE"])assert.ok(code.includes("export function "+v+"()"));});
check("no-store and bearer separated cache",()=>{assert.match(code,/no-store/);assert.match(code,/vary":"Authorization"/);});
console.log("VOX_GOVERNED_TRANSITION_SOURCE_PASS "+n+"/"+n);
