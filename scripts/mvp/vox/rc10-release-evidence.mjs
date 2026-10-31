// RC10 protected release evidence extends RC9; remains unsigned and HOLD.
// Do not confuse a SHA256 inventory with an independently signed OCI artifact.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {rc9EvidenceManifest} from "./rc9-release-evidence-manifest.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const entries=Object.freeze([
 ["finance-core-detail","app/api/vox/v1/finance/order/[orderId]/route.ts"],
 ["finance-web-detail","apps/vox-web/app/finance/[orderId]/page.tsx"],
 ["finance-detail-model","contracts/vox/rc10FinanceOrderDetail.mjs"],
 ["finance-detail-regression","scripts/mvp/vox/rc10-finance-order-detail.test.mjs"]
]);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export function createRc10ReleaseEvidence(){
 const base=rc9EvidenceManifest();
 const finance=entries.map(([purpose,path])=>({purpose,path,
  sha256:sha(readFileSync(resolve(root,path)))}));
 const components=[...base.files.map(f=>({purpose:f.purpose,path:f.path,sha256:f.sha256})),...finance];
 const sourceDigestSha256=sha(components.map(f=>f.purpose+"|"+f.path+"|"+f.sha256).join("\n"));
 return Object.freeze({
  schema:"qf.vox.rc10.release-evidence.v1",
  candidate:"PR-450-DRAFT",releaseDecision:"HOLD",
  artifactStatus:"UNSIGNED_SOURCE_INVENTORY_NOT_DEPLOYABLE",
  sourceDigestSha256,components,
  core:base.gates,
  financeDetailFeature:{
   sourcePresent:true,ownerAal2Required:true,
   stagingActivation:false,productionActivation:false,
   paymentAttemptsComplete:false,canCapture:false,canRefund:false,canGrantCredits:false
  },
  requiresIndependentDbaAppsec:true,requiresRealOwnerTlHumanKeys:true,
  requiresManagedRestoration:true,requiresAuthenticatedStagingE2E:true
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 console.log(JSON.stringify(createRc10ReleaseEvidence(),null,2));
