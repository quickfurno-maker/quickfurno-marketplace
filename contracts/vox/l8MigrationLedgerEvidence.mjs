// Normalizes first-party metadata-only Stage-vs-Production ledger diffs.
// Version+NAME comparison cannot prove byte-for-byte SQL equivalence.
const deny=(reason,more={})=>Object.freeze({ok:false,reason,
 humanDBARequired:true,protectedStagingPermitted:false,productionPermitted:false,...more});
const counter=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000;
const label=v=>typeof v==="string"&&/^[a-zA-Z0-9_]{3,160}$/.test(v);
const version=v=>typeof v==="string"&&/^\d{14}$/.test(v);
export function assessHistoricalLedgerDiff(diff){
 if(!diff||diff.protocol!=="qf.vox.readonly-migration-version-name-diff.v1"||
   diff.release_authorized!==false||!diff.counts||
   !Array.isArray(diff.shared_name_different_version)||
   !Array.isArray(diff.shared_version_different_name)||
   !Array.isArray(diff.stage_only_names)||!Array.isArray(diff.prod_only_names))
   return deny("FIRST_PARTY_LEDGER_METADATA_REQUIRED");
 const c=diff.counts;
 const fields=["stage","prod","shared_versions","stage_only_versions","prod_only_versions",
  "shared_names_unique","stage_only_names","prod_only_names"];
 if(fields.some(k=>!counter(c[k]))||
   c.shared_versions+c.stage_only_versions!==c.stage||
   c.shared_versions+c.prod_only_versions!==c.prod||

   diff.shared_name_different_version.some(x=>!x||!label(x.name)||
     !version(x.stage_version)||!version(x.prod_version)||
     x.stage_version===x.prod_version)||
   diff.shared_version_different_name.some(x=>!x||!version(x.version)||
     !label(x.stage_name)||!label(x.prod_name)))
  return deny("MIGRATION_LEDGER_COUNTS_OR_MAPPING_INVALID");
 // Even equal historical VERSION+NAME ledgers cannot attest original SQL bytes.
 const mismatched=c.stage_only_versions+c.prod_only_versions+
  diff.shared_name_different_version.length+
  diff.shared_version_different_name.length;
 return Object.freeze({ok:true,schema:"qf.vox.l8.migration-history-readonly.v1",
  stageCount:c.stage,productionCount:c.prod,sharedVersions:c.shared_versions,
  stageOnlyVersions:c.stage_only_versions,prodOnlyVersions:c.prod_only_versions,
  sameNameDifferentVersion:diff.shared_name_different_version.length,
  sameVersionDifferentName:diff.shared_version_different_name.length,
  versionNameDivergence:mismatched>0,
  sqlBodyParityProven:false,sourceOnly:true,
  humanDBARequired:true,protectedStagingPermitted:false,productionPermitted:false});
}
