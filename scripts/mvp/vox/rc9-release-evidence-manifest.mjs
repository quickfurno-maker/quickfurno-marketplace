// RC9 gated release evidence inventory, NOT a signed/deployable artifact.
// Deterministic SHA256 of source-bound acceptance candidates; no service access.
import {createHash} from "node:crypto";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const candidates=Object.freeze([
 ["core-native","services/vox/rc8PgVendorConversationOperator.ts"],
 ["core-real-pg17","scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs"],
 ["core-sql-review","ops/vox/rc7-review-candidates/20261030020000_vox_rc8_conversation_operator_review_only.sql"],
 ["signed-pending-writer","scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs"],
 ["signed-real-pg17","scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs"],
 ["signed-sql-review","ops/vox/rc7-review-candidates/20261030010000_vox_rc8_signed_intent_transaction_review_only.sql"],
 ["recover-local","scripts/mvp/vox/validate-voxAB7K-recovery-harness-pg17.ps1"],
 ["recover-acl","scripts/mvp/vox/rc8-owner-acl-replay-plan.mjs"],
 ["finance-core-read","app/api/vox/v1/finance/route.ts"],
 ["finance-web","apps/vox-web/app/finance/page.tsx"],
 ["staff-auth-local","scripts/mvp/vox/validate-vox-03-real-local-gotrue-auth.harness.mjs"]
]);
const digest=text=>createHash("sha256").update(text).digest("hex");
export function rc9EvidenceManifest(){
 const files=candidates.map(([purpose,path])=>{
  const file=resolve(root,path);
  if(!existsSync(file))return {purpose,path,status:"MISSING",sha256:null};
  return {purpose,path,status:"SOURCE_PRESENT",sha256:digest(readFileSync(file))};
 });
 const reviewSql=files.filter(x=>x.purpose.endsWith("sql-review"));
 const original=readFileSync(resolve(root,"ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"),"utf8");
 const native=readFileSync(resolve(root,"services/vox/rc8PgVendorConversationOperator.ts"),"utf8");
 const signer=readFileSync(resolve(root,"scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs"),"utf8");
 const gates={
  sourceFilesPresent:files.every(f=>f.status==="SOURCE_PRESENT"),
  canonicalCoreConversationSqlHardOff:original.includes("constraint vox_ab7b_core_conversation_blocked check(source<>'CORE_CONVERSATION')"),
  nativeConversationProductionHardOff:native.includes("RC8_CORE_WRITER_INSTALLED=false"),
  signedApprovalProductionHardOff:signer.includes("RC8_APPROVAL_WRITER_INSTALLED=false"),
  reviewSqlUndeployable:reviewSql.every(x=>x.path.startsWith("ops/vox/rc7-review-candidates/")),
  independentDbaAppsecDecision:false,
  humanOwnerAndTeamLeaderAal2Certified:false,
  humanEd25519KeysEnrolled:false,
  managedRecoveryAndPitrCertified:false,
  managedStagingIntegratedAcceptance:false,
  managedProductionAuthorized:false
 };
 const blockers=Object.entries(gates).filter(([key,value])=>!value&&
  !key.startsWith("source")&&!key.endsWith("HardOff")&&key!=="reviewSqlUndeployable")
  .map(([key])=>key);
 const sourceDigest=digest(files.map(f=>f.purpose+"|"+f.path+"|"+f.sha256).join("\n"));
 return Object.freeze({schema:"qf.vox.rc9.release-evidence.v1",
  mode:"SOURCE_AND_DISPOSABLE_ONLY",releaseDecision:"HOLD",
  signatureStatus:"UNSIGNED_NOT_PRODUCTION_ATTESTED",sourceDigestSha256:sourceDigest,
  gates,blockers,files});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 console.log(JSON.stringify(rc9EvidenceManifest(),null,2));
