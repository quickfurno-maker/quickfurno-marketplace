import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const code=readFileSync(resolve(import.meta.dirname,"../../../app/api/vox/v1/owner-approval-queue/route.ts"),"utf8");
let ok=0;const check=(label,fn)=>{fn();ok++;console.log("PASS",label);};
for(const f of ["VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED","VOX_OWNER_APPROVALS_READ_ENABLED"])
 check(f+" must opt in",()=>assert.ok(code.includes('process.env.'+f+'!=="staging"')));
check("deny unverified owner",()=>assert.match(code,/if\(!owner\)return reply\(\{ok:false,error:"OWNER_AAL2_REQUIRED"\},403\)/));
check("verify owner before and after SQL read",()=>assert.equal((code.match(/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/g)||[]).length,2));
check("filter queries refused",()=>assert.match(code,/if\(u\.search\|\|u\.hash\)/));
check("only pending initial revision",()=>{
 assert.match(code,/\.eq\("state","PENDING"\)\.eq\("revision",0\)/);
 assert.match(code,/\.neq\("requester_id",owner\)/);
});
check("bounded queue",()=>assert.match(code,/\.limit\(16\)/));
check("no contact PII",()=>assert.doesNotMatch(code,/\.select\("[^"]*(email|phone|token|password)[^"]*"/i));
check("validate every result",()=>assert.match(code,/QUEUE_RECORD_UNTRUSTED/));
check("canonical action-target combinations only",()=>{
 for(const x of ['AAROHI_FOLLOWUP:"prospect"','VENDOR_PROFILE_CHANGE:"vendor"','SUPPORT_REPLY:"support_thread"'])assert.ok(code.includes(x));
 assert.match(code,/actionTarget\[r\.action_kind\]!==r\.target_kind/);
});
check("never approve or execute",()=>{
 assert.match(code,/canApprove:false/);
 assert.match(code,/canExecute:false/);
 assert.doesNotMatch(code,/\.rpc\(|\.insert\(|\.update\(|\.delete\(|sendWhatsApp/);
});
for(const v of ["POST","PUT","PATCH","DELETE"])check(v+" denies mutations",()=>assert.match(code,new RegExp("export function "+v+"\\(\\)\\{return reply\\(\\{ok:false,error:\"REVIEW_NOT_ENABLED\"\\},405\\)")));
check("private no-store and separated bearer",()=>{
 assert.match(code,/no-store/);
 assert.match(code,/vary":"Authorization"/);
});
console.log("VOX_OWNER_APPROVALS_READ_CONTRACT_PASS "+ok+"/"+ok);
