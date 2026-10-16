// Internal immutable EVIDENCE INDEX, not human-signed release authority.
// Only accepts scoped, traceable source and test digests. No secrets/PII.
const SHA40=/^[a-f0-9]{40}$/i,SHA256=/^[a-f0-9]{64}$/i;
const suites=["DB_SQL_REPLAY","AUTH_NEGATIVES","RIYA_CONSENT",
 "FOUR_SOURCE_EOD","OUTBOX_REPLAY","AGNI_PRIVATE_TRANSPORT","RELEASE_HOLD"];
const deny=reason=>Object.freeze({ok:false,reason,
 reviewerHandoffEligible:false,protectedStagingPermitted:false,
 productionPermitted:false});
const entries=o=>o&&typeof o==="object"&&!Array.isArray(o);
export function indexInternalReleaseEvidence({heads,results,archive,now=Date.now()}={}){
 if(!entries(heads)||Object.keys(heads).sort().join("|")!=="agni|core|jarvis"||
   Object.values(heads).some(v=>typeof v!=="string"||!SHA40.test(v))||
   new Set(Object.values(heads)).size!==3||!Array.isArray(results)||
   results.length!==suites.length||!Number.isSafeInteger(now)||now<=0)
  return deny("PINNED_SOURCE_HEADS_AND_ALL_SUITES_REQUIRED");
 const seen=new Set(),normalized=[];
 for(const x of results){
  if(!entries(x)||Object.keys(x).sort().join("|")!==
   "environment|evidenceSha256|executedAtMs|status|suite"||
   !suites.includes(x.suite)||seen.has(x.suite)||
   x.environment!=="ISOLATED"||x.status!=="PASS"||
   typeof x.evidenceSha256!=="string"||!SHA256.test(x.evidenceSha256)||
   !Number.isSafeInteger(x.executedAtMs)||
   x.executedAtMs>now+30000||x.executedAtMs<now-7*86400000)
   return deny("UNVERIFIED_OR_NONISOLATED_QA_EVIDENCE");
  seen.add(x.suite);
  normalized.push(Object.freeze({suite:x.suite,status:x.status,
   sha256:x.evidenceSha256.toLowerCase(),environment:"ISOLATED"}));
 }
 if(seen.size!==suites.length)return deny("MISSING_REQUIRED_QA_SUITE");
 if(!entries(archive)||Object.keys(archive).sort().join("|")!==
   "hashSha256|scope|verifiedOfflineRestore"||
   archive.scope!=="PUBLIC_AUTH_STORAGE_MIGRATION_HISTORY_NOT_FULL"||
   !SHA256.test(archive.hashSha256)||archive.verifiedOfflineRestore!==true)
  return deny("EXACT_STAGING_ARCHIVE_SCOPE_REQUIRED");
 return Object.freeze({ok:true,manifestSchema:"qf.vox.l10.internal-evidence-index.v1",
  heads:Object.freeze({...heads}),evidence:Object.freeze(normalized),
  archiveHashSha256:archive.hashSha256.toLowerCase(),
  fullConsistentManagedBackupProven:false,independentReviewVerified:false,
  reviewerHandoffEligible:true,protectedStagingPermitted:false,
  productionPermitted:false,requiresProtectedStageAal2AndFullE2E:true});
}
export const requiredSuites=suites;
