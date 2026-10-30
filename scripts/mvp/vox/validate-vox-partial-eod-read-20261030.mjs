import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const preview=readFileSync(resolve(root,"app/api/vox/v1/eod-preview/route.ts"),"utf8");
const source=readFileSync(resolve(root,"app/api/vox/v1/eod-source-status/route.ts"),"utf8");
let n=0;const check=(name,fn)=>{fn();n++;console.log("PASS",name)};
for(const [name,src] of [["preview",preview],["source-status",source]]){
 check(name+" requires master Staff flag",()=>assert.match(src,/VOX_STAFF_READ_ENABLED!=="staging"/));
 check(name+" requires staff grants",()=>assert.match(src,/VOX_STAFF_GRANTS_ENABLED!=="staging"/));
 check(name+" requires department enforcement",()=>assert.match(src,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"/));
 check(name+" explicitly opts into EOD preview",()=>assert.match(src,/VOX_EOD_PREVIEW_ENABLED!=="staging"/));
 check(name+" requires real neutral current AAL2",()=>assert.match(src,/await getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/));
 check(name+" revalidates revocation before serving evidence",()=>{
  assert.match(src,/const fresh=await getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
  assert.match(src,/unchangedAuthorizedStaffScope\(scope,fresh\)/);
  assert.match(src,/STAFF_SCOPE_REVOKED/);
 });
 check(name+" no browser selected dates/team/city",()=>assert.match(src,/if\(url\.search\|\|url\.hash\)/));
 check(name+" enforces windowed bounded reads",()=>assert.match(src,/\.limit\(101\)/));
 check(name+" disallows direct writes and provider calls",()=>assert.doesNotMatch(src,/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(|sendWhatsApp|sendMessage\(/));
 check(name+" HTTP methods read only",()=>{for(const v of ["POST","PUT","PATCH","DELETE"])assert.match(src,new RegExp("export function "+v+"\\(\\)"));});
 check(name+" private no-store",()=>assert.match(src,/private, no-store/));
}
check("partial EOD does not claim signed/official report",()=>{assert.match(preview,/always PARTIAL read-only EOD/);assert.doesNotMatch(preview,/canPublish:true|officialEod:true/);});
check("source-status explicitly labels missing agent events NOT_PROVEN",()=>{assert.match(source,/eventProvenance:"NOT_PROVEN"/);assert.match(source,/NEVER a four-system final EOD/);});
check("both use Asia/Kolkata business day",()=>{assert.match(preview,/Asia\/Kolkata/);assert.match(source,/Asia\/Kolkata/);});
console.log("VOX_PARTIAL_EOD_GUARD_SOURCE_PASS "+n+"/"+n);
