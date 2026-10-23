// Step3B7 immutable review bill (UNSIGNED, never authorizes managed actions).
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const files=Object.freeze([
 "contracts/vox/step3b7PolicyReview.mjs",
 "lib/payments/step3b7FinanceHistoryPreview.mjs",
 "scripts/scale/step3b7-policy-negative.test.mjs",
 "scripts/scale/step3b7-policy-inventory-audit.mjs",
 "scripts/scale/step3b7-policy-inventory.test.mjs",
 "scripts/scale/step3b7-owner-faults.test.mjs",
 "scripts/scale/validate-step3b7-source-hold.mjs",
 "scripts/mvp/payments/step3b7-finance-history.test.mjs",
 "scripts/mvp/vox/step3b7-integrated-boundaries.test.mjs",
 "docs/finance/STEP3B7-INTERNAL-FINALIZATION-REVIEW-HANDOFF-20261023.md",
 "ops/vox/certification/STEP3B7-STAGING-RLS-READONLY-20261023.json",
 "ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json",
 "supabase/migrations/20261006113720_phase22_identity_portability.sql"
]);
const sha=b=>createHash("sha256").update(b).digest("hex").toUpperCase();
export function buildStep3b7Manifest(){
 const source=files.map(path=>{const buf=readFileSync(resolve(root,path));return {path,bytes:buf.length,sha256:sha(buf)}});
 return {schema:"qf.vox.finance.step3b7.unsigned-review-manifest.v1",
 baseCommit:"034305988bff6409e8c6d4aedd83624002f3cd4b",
 files:source,fileSetSha256:sha(JSON.stringify(source)),
 policyInventorySha256:"39AB07FB84BCE75FAA84B472D608FEAB262F43F05FD27AF60FEE6EE12A5CE5FC",
 independentDbaSigned:false,independentAppsecSigned:false,
 ownerApprovedManagedStaging:false,realAal2Certified:false,
 razorpayProviderTestCertified:false,releaseSignatureValid:false,
 stagingExecutionAuthorized:false,productionExecutionAuthorized:false,
 providerMoneyExecutionAuthorized:false,status:"HOLD"};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=buildStep3b7Manifest();
 writeFileSync(resolve(root,"ops/vox/certification/STEP3B7-UNSIGNED-REVIEW-MANIFEST-20261023.json"),
 JSON.stringify(r,null,2)+"\n");
 console.log("STEP3B7_UNSIGNED_MANIFEST "+r.files.length+" HASHED_SOURCE_FILES "+r.fileSetSha256+" HOLD");
}
