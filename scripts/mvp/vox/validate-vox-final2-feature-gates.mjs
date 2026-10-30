// FINAL-2 Track E — source feature gate inventory (NEVER activation).
// Print a reproducible, reviewed source matrix. All live runtime claims remain HOLD.
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const spec=Object.freeze([
 ["Owner overview","overview","apps/vox-web/app/operations","owner",false],
 ["Staff management","staff-directory","apps/vox-web/app/team","scoped",false],
 ["Vendor 360","vendor360","apps/vox-web/app/vendor360","scoped",false],
 ["Service Desk","desk","apps/vox-web/app/service-desk","scoped",false],
 ["Aarohi CRM","acquisition","apps/vox-web/app/acquisition","scoped",false],
 ["Automation Studio","studio-catalog","apps/vox-web/app/studio","owner",false],
 ["Staff work transitions","work-transitions","apps/vox-web/app/operations","scoped",true],
 ["Internal staff chat","staff-chat","apps/vox-web/app/team","scoped",true],
 ["Staff permissions","staff-grants","apps/vox-web/app/team","owner",true],
 ["Official EOD","official-eod-publish","apps/vox-web/app/operations","owner",true],
 ["VOX Finance","finance","apps/vox-web/app/finance","scoped",true]
]);
function makeRow([feature,route,ui,identity,mutates]){
 const api=resolve(root,"app/api/vox/v1",route,"route.ts");
 const exists=existsSync(api),web=existsSync(resolve(root,ui));
 const src=exists?readFileSync(api,"utf8"):"";
 const flags=[...new Set(src.match(/process\.env\.(VOX_[A-Z0-9_]+)/g)?.map(x=>x.split(".").pop())??[])].sort();
 const blocked=route==="official-eod-publish"&&src.includes("VERIFIED_APPROVAL_WRITER_INSTALLED=false");
 const verifiedAuth=src.includes("verifyVoxOwnerBearer")||src.includes("getVerifiedScopedStaff");
 const noStore=src.includes("no-store");
 return {feature,apiRoute:route,identity,mutates,sourcePresent:exists,uiPresent:web,
  verifiedAuthInSource:verifiedAuth,noStoreInSource:noStore,requiredFlags:flags,
  activationHardOff:blocked,
  sourceStatus:!exists?"SOURCE_ROUTE_MISSING":!web?"UI_SOURCE_MISSING":
   !verifiedAuth||!noStore?"SOURCE_SECURITY_REVIEW_REQUIRED":
   blocked?"HARD_OFF_SOURCE_ONLY":"SOURCE_PRESENT_NOT_MANAGED_ACCEPTED",
  managedStagingAccepted:false,productionReady:false};
}
export const auditFinal2FeatureGates=()=>Object.freeze(spec.map(makeRow));
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const rows=auditFinal2FeatureGates();
 console.log(JSON.stringify({schema:"qf.vox.final2.feature-activation-readiness.v1",
  sourceOnly:true,releaseDecision:"HOLD",routeCount:rows.length,rows},null,2));
}
