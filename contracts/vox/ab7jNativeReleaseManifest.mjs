/** Reproducible, READ-ONLY package for DBA review.
 * SHA256 is computed over exact candidate SQL bytes; no database writes.
 */
import {createHash} from "node:crypto";
import {readFileSync,existsSync} from "node:fs";
import {resolve,join} from "node:path";
const names=Object.freeze([
"20261018070000_vox_ab7f_conversation_atomic_operator_candidate.sql",
"20261018080000_vox_ab7f_staff_atomic_suspend_candidate.sql",
"20261018090000_vox_ab7f_four_source_eod_persist_candidate.sql",
"20261018100000_vox_ab7g_eod_official_release_candidate.sql",
"20261018110000_vox_ab7h_signed_operator_atomic_candidate.sql"
]);
const hex=/^[a-f0-9]{64}$/;
export function readAb7jSourceManifest(repoRoot){
 if(typeof repoRoot!=="string"||!repoRoot)return {ok:false,reason:"INVALID_REPO_ROOT"};
 const folder=resolve(repoRoot,"ops","vox","sql-candidates");
 const entries=[];
 try{
  for(const name of names){
   const full=join(folder,name);
   const bytes=readFileSync(full);
   const source=bytes.toString("utf8");
   const sha256=createHash("sha256").update(bytes).digest("hex");
   if(!hex.test(sha256)||!source.includes("revoke all")||
     !source.includes("service_role")||
     !source.includes("commit;"))return {ok:false,reason:"UNREVIEWED_SQL_CANDIDATE"};
   entries.push(Object.freeze({name,sha256,bytes:bytes.byteLength,
    requiresIndependentDbReview:true,managedInstalled:false}));
  }
  const aggregate=createHash("sha256").update(
   entries.map(x=>x.name+":"+x.sha256).join("\n")).digest("hex");
  // No approved rollback artifact exists yet: never issue a false 'ready'.
  return Object.freeze({
   ok:true,schemaSourceComplete:true,releaseReady:false,canApply:false,
   exactCandidateCount:entries.length,candidateDigest:aggregate,
   candidates:Object.freeze(entries),
   requiredBeforeManagedStaging:["DBA_APPROVED_ROLLBACK",
    "CURRENT_STAGING_PERMISSION_RECONCILIATION",
    "SIGNED_INDEPENDENT_APPSEC_REVIEW","FIRST_TL_AAL2",
    "SIGNED_OWNER_GO","PROTECTED_STAGING_E2E"],
   noDatabaseChanges:true
  });
 }catch{return {ok:false,reason:"MISSING_REQUIRED_CANDIDATE",releaseReady:false,canApply:false};}
}
