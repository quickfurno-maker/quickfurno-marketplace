// PAY-4A independent-preparation audit. Never copies SQL or changes migration truth.
import {createHash} from "node:crypto";
import {readFileSync,existsSync,readdirSync} from "node:fs";
import path from "node:path";
const LEGACY="20261014010000_vox_v1_scoped_staff_authority.sql";
const QUARANTINE="ops/vox/quarantined-migrations/legacy-20261014/"+LEGACY;
const LEDGER="supabase/staging-history/qf-post-g1-migration-ledger-20260929.json";
const HEX=/^[0-9a-f]{64}$/;
function sha(bytes){return createHash("sha256").update(Buffer.from(bytes.toString("utf8").replace(/\r\n?/g,"\n"))).digest("hex");}
export function inspectPay4aMigrationInventory({root,read=readFileSync,exists=existsSync}={}){
 const issues=[];
 if(typeof root!=="string"||!path.isAbsolute(root))return Object.freeze({ok:false,issues:["ROOT_INVALID"]});
 const p=x=>path.join(root,x);
 let record,quarantinedHash=null,ledgerHash=null;
 try {
  const ledger=JSON.parse(read(p(LEDGER),"utf8"));
  if(ledger.databaseMutationAuthorized!==false||ledger.productionDeploymentAuthorized!==false)
   issues.push("LEDGER_MUTATION_AUTHORITY_UNSAFE");
  record=ledger.records?.find(x=>x.filename===LEGACY);
  if(!record||record.version!=="20261014010000"||!HEX.test(record.canonicalSha256))
   issues.push("LEGACY_VERSION_LEDGER_MISSING");
  else{
   ledgerHash=record.canonicalSha256;
   if(record.exactVersionPresence?.staging!==false||
      record.exactVersionPresence?.production!==false)
    issues.push("LEDGER_REMOTE_APPLICATION_UNEXPECTED");
  }
 }catch {issues.push("LEDGER_UNREADABLE");}
 try{quarantinedHash=sha(read(p(QUARANTINE)));
  if(quarantinedHash!==ledgerHash)issues.push("QUARANTINED_SQL_HASH_DRIFT");
 }catch{issues.push("QUARANTINED_SQL_MISSING");}
 if(exists(p("supabase/migrations/"+LEGACY)))issues.push("UNAPPROVED_SQL_IN_RUNNABLE_TREE");
 const finance="ops/finance/sql-candidates";
 try {
  const files=readdirSync(p(finance)).filter(x=>x.endsWith(".sql"));
  if(!files.length)issues.push("FINANCE_CANDIDATES_MISSING");
  for(const f of files){
   if(!/^20\d{12}_finance_v2_pay\d[a-z]?_/.test(f))issues.push("CANDIDATE_FILENAME_INVALID");
   if(exists(p("supabase/migrations/"+f)))issues.push("FINANCE_CANDIDATE_IN_RUNNABLE_TREE");
  }
 }catch {issues.push("FINANCE_CANDIDATE_INVENTORY_UNREADABLE");}
 return Object.freeze({ok:issues.length===0,sourceIntegrityVerified:issues.length===0,
  quarantinedLegacy:QUARANTINE,legacyVersion:"20261014010000",
  quarantinedHash,ledgerHash,locallyRunnable:false,stagingInstalled:false,
  productionInstalled:false,canDeploy:false,requiresDBAReview:true,
  legacyValidatorNeedsInventoryReconciliation:true,issues:Object.freeze(issues)});
}
