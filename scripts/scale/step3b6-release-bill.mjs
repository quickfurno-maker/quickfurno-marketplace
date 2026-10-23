// Step3B6-D source-only hash bill, NOT a signing or deployment implementation.
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const SHA=x=>createHash("sha256").update(x).digest("hex").toUpperCase();
export const PINNED_RC1="06267c094e9aad9d55bbeef80ac955968c5b75be";
export const BILL_FILES=Object.freeze([
 ...["A-DBA-MIGRATION-DECISIONS","B-APPSEC-RLS-DECISION-MATRIX","C-OWNER-IDENTITY-ACCEPTANCE","D-RELEASE-ROLLBACK-PACKAGE","E-CONTINUOUS-QA","F-PAYMENTS-TEST-ACCEPTANCE"].map(x=>"docs/finance/STEP3B6-"+x+"-20261023.md"),
 "docs/finance/sql-review/STEP3B6-POLICY-MATRIX-READONLY.sql",
 "ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json",
 "scripts/scale/step3b6-ledger-register.mjs",
 "scripts/scale/validate-step3b6-source-gates.mjs",
 "scripts/scale/step3b6-source-gates.test.mjs",
 "scripts/mvp/payments/step3b6-offline-finance.test.mjs",
 "supabase/migrations/20261006113720_phase22_identity_portability.sql",
 "scripts/owner-superadmin-transition-plan.mjs",
 "scripts/grant-superadmin.mjs"
]);
export function buildStep3b6HashBill({root=ROOT}={}){
 const files=BILL_FILES.map(path=>({path,sha256:SHA(readFileSync(resolve(root,path))),sizeBytes:readFileSync(resolve(root,path)).length}));
 const phase22=files.find(x=>x.path.startsWith("supabase/migrations/"));
 assert.equal(phase22.sha256,"6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA");
 return {schema:"qf.step3b6.unsigned.source-bill.v1",baseCommit:PINNED_RC1,
  files,sourceDigest:SHA(JSON.stringify(files)),signatureValid:false,
  trustedReleaseKeyPinned:false,actualHeadCommitVerified:false,
  independentDbaApproved:false,independentAppsecApproved:false,ownerAuthorizedStaging:false,
  managedMigrationAuthorized:false,privilegedAuthAuthorized:false,paymentsAuthorized:false,
  releaseStatus:"HOLD"};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const bill=buildStep3b6HashBill();
 const target=resolve(ROOT,"ops/vox/certification/STEP3B6-UNSIGNED-SOURCE-BILL-20261023.json");
 writeFileSync(target,JSON.stringify(bill,null,2)+"\n");
 console.log("STEP3B6_UNSIGNED_RELEASE_BILL "+bill.files.length+" sources "+bill.sourceDigest+" RELEASE HOLD");
}
