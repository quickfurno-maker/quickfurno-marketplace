import {createHash, verify} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildFinanceReviewManifest} from "./financePay4bSqlReview.mjs";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const sha=x=>createHash("sha256").update(x).digest("hex");
const FILES=Object.freeze([
 "app/api/webhooks/razorpay/vendor-package/route.ts",
 "services/financeV2WebhookJournal.ts",
 "services/financeV2InboxWorker.ts",
 "services/financeV2Scope.ts",
 "services/vox/verifiedStaffBearer.ts",
 "services/vox/verifiedScopedStaff.ts",
 "app/api/vox/v1/finance-orders/route.ts",
 "app/api/vox/v1/finance-case-review/route.ts",
 "apps/vox-web/app/finance/page.tsx"
]);
export function buildPay4c4UnsignedReleaseBill({root=ROOT,commitSha}={}){
 if(typeof commitSha!=="string"||!/^[a-f0-9]{40}$/.test(commitSha))
  throw Error("PAY4C4_COMMIT_REQUIRED");
 const sql=buildFinanceReviewManifest({root});
 if(!sql.checksPassed||sql.candidateCount!==12)
  throw Error("PAY4C4_SQL_MANIFEST_DRIFT");
 const files=FILES.map(file=>{
  const bytes=readFileSync(path.join(root,file));
  return {file,bytes:bytes.length,sha256:sha(bytes)};
 });
 const canonical={schema:"qf.finance.pay4c4.release-bill.v1",
  target:"Staging",claimedGitCommit:commitSha,
  files,sqlCandidates:sql.hashes.map(({filename,bytes,sha256,ordinal})=>({
   filename,bytes,sha256,ordinal})),
  executionPermitted:false,featureFlagsDefaultOff:true};
 const payload=JSON.stringify(canonical);
 return Object.freeze({payload,sha256:sha(payload),fileCount:files.length,
  sqlCount:sql.candidateCount,gitCommitCryptographicallyVerified:false,
  signingKeyAvailable:false,artifactBuilt:false,
  deployAllowed:false,releaseStatus:"HOLD"});
}
export function verifyPay4c4DetachedSignature({bill,signatureBase64,publicKeyPem,expectedDigest}={}){
 if(!bill||typeof bill.payload!=="string"||
    typeof signatureBase64!=="string"||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64)||
    typeof publicKeyPem!=="string"||typeof expectedDigest!=="string"||
    !/^[a-f0-9]{64}$/.test(expectedDigest))
  return Object.freeze({signatureValid:false,digestMatched:false,
   isApprovedStagingBuild:false,deployAllowed:false});
 const actual=sha(bill.payload);
 if(actual!==expectedDigest||actual!==bill.sha256)
  return Object.freeze({signatureValid:false,digestMatched:false,
   isApprovedStagingBuild:false,deployAllowed:false});
 let valid=false;
 try{valid=verify(null,Buffer.from(bill.payload),publicKeyPem,
       Buffer.from(signatureBase64,"base64"));}
 catch{return Object.freeze({signatureValid:false,digestMatched:true,
       isApprovedStagingBuild:false,deployAllowed:false});}
 // A detached signature proves only possession of that key; without
 // trusted release-chain pinning and external approvals it permits NO deploy.
 return Object.freeze({signatureValid:valid,digestMatched:true,
  trustedReleaseKeyPinned:false,sourceCommitVerifiedAgainstGit:false,
  independentDbaApproved:false,independentAppsecApproved:false,
  stagingBackupVerified:false,isApprovedStagingBuild:false,deployAllowed:false});
}
