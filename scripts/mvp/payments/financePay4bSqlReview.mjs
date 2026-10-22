import {createHash} from "node:crypto";
import {readFileSync,readdirSync,existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const sha=b=>createHash("sha256").update(b).digest("hex");
const candidateDir=path.join(ROOT,"ops/finance/sql-candidates");
const expected=[
 "20261022090100_finance_v2_pay1_integrity_candidate.sql",
 "20261022090200_finance_v2_pay2_history_candidate.sql",
 "20261022120100_finance_v2_pay3_evidence_candidate.sql",
 "20261022133000_finance_v2_pay3_inbox_candidate.sql",
 "20261022134000_finance_v2_pay3_refund_reservation_candidate.sql",
 "20261022135000_finance_v2_pay3_staff_read_candidate.sql",
 "20261022140000_finance_v2_pay3_settlement_projection_candidate.sql",
 "20261022141000_finance_v2_pay3_webhook_receipt_candidate.sql",
 "20261022142000_finance_v2_pay3_bank_proof_candidate.sql",
 "20261022143000_finance_v2_pay4a_refund_release_candidate.sql",
 "20261022144000_finance_v2_pay4a_vox_cases_candidate.sql",
 "20261022145000_finance_v2_pay4b_inbox_recovery_candidate.sql"
];
export function buildFinanceReviewManifest({root=ROOT,read=readFileSync,list=readdirSync}={}){
 const source=path.join(root,"ops/finance/sql-candidates");
 const files=list(source).filter(f=>f.endsWith(".sql")).sort();
 const issues=[];
 if(JSON.stringify(files)!==JSON.stringify([...expected].sort()))
  issues.push("UNEXPECTED_SQL_SOURCE_INVENTORY");
 const hashes=[];
 for(const filename of expected){
  try{
   const data=read(path.join(source,filename));
   hashes.push({filename,bytes:data.length,sha256:sha(data),ordinal:hashes.length+1});
  }catch{issues.push("MISSING_SQL_SOURCE:"+filename);}
  if(existsSync(path.join(root,"supabase/migrations",filename)))
   issues.push("CANDIDATE_IN_RUNNABLE_TREE:"+filename);
 }
 const noDuplicate=hashes.every((r,i)=>hashes.findIndex(x=>x.filename.slice(0,14)===r.filename.slice(0,14))===i);
 if(!noDuplicate)issues.push("DUPLICATE_MIGRATION_VERSION");
 return Object.freeze({schema:"qf.finance.pay4b.sql-review.v1",candidateCount:hashes.length,
  hashes,checksPassed:issues.length===0,issues,releaseAuthorized:false,
  applySqlAuthorized:false,requiresIndependentDBA:true,requiresIndependentAppSec:true,
  stagingAuthorized:false,productionAuthorized:false,
  rollbackPolicy:"BACKUP_RESTORE_ISOLATED_ONLY_NO_LIVE_DROP"});
}
export const financeSourceManifest=buildFinanceReviewManifest();
