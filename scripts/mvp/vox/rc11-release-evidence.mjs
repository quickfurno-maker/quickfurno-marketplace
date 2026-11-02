// RC11 protected source provenance; NOT signed, installed or deployment GO.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRc10ReleaseEvidence} from "./rc10-release-evidence.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const files=Object.freeze([
 ["signer-serialized-revocation","ops/vox/rc7-review-candidates/20261030030000_vox_rc11_signer_revocation_lock_review_only.sql"],
 ["finance-attempt-append-only-sql","ops/vox/rc7-review-candidates/20261030040000_vox_rc11_payment_attempt_audit_review_only.sql"],
 ["finance-real-pg17","scripts/mvp/vox/validate-vox-rc11-real-pg-finance-attempts.mjs"],
 ["finance-timeline-projection","contracts/vox/rc11PaymentAttemptTimeline.mjs"],
 ["finance-evidence-core","app/api/vox/v1/finance/order/[orderId]/attempts/route.ts"],
 ["finance-evidence-ui-regression","scripts/mvp/vox/rc11-finance-attempt-timeline.test.mjs"],
 ["finance-core-bff-updated","apps/vox-web/lib/core.ts"],
 ["finance-order-view-updated","apps/vox-web/app/finance/[orderId]/page.tsx"]
]);
const sha=v=>createHash("sha256").update(v).digest("hex");
export function rc11ReleaseEvidence(){
 const parent=createRc10ReleaseEvidence();
 const delta=files.map(([purpose,path])=>({purpose,path,
  sha256:sha(readFileSync(resolve(root,path)))}));
 const entries=[...parent.components,...delta];
 const manifestHash=sha(entries.map(f=>f.purpose+"|"+f.path+"|"+f.sha256).join("\n"));
 return Object.freeze({schema:"qf.vox.rc11.release-evidence.v1",
  parentDigest:parent.sourceDigestSha256,
  releaseDecision:"HOLD",artifactStatus:"UNSIGNED_NOT_DEPLOYABLE",
  sourceDigestSha256:manifestHash,entries,
  allManagedWritesDisabled:true,
  signedOfficialEodEnabled:false,
  coreConversationCanonicalSourceInstalled:false,
  humanSignerRegistryVerified:false,
  independentDbaAppsecReviewed:false,
  managedRecoveryAndPitrCertified:false,
  managedStagingAllFeaturesAccepted:false,
  productionActivationAuthorized:false,
  financeAttemptEvents:{
   schemaReviewOnly:true,localPg17TestRequired:true,
   managedSourceInstalled:false,approvedWriterRoleInstalled:false,
   allProviderEventsCaptured:false,providerSettlementVerified:false,
   refundsAndCreditsEnabled:false,
   ownerTimelineDefaultDisabled:true
  }});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 console.log(JSON.stringify(rc11ReleaseEvidence(),null,2));
