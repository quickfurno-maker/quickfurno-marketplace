import {readFileSync} from "node:fs";
const file=new URL("../../../ops/vox/certification/TO04C-LIVE-SCHEMA-EVIDENCE.json",import.meta.url);
export function assess(evidence){
 if(!evidence||evidence.schema!=="qf.vox.live-schema-metadata.v1"||
    evidence.releaseAuthorization!==false||evidence.includesUserRows!==false||
    !Array.isArray(evidence.requiredTables)||evidence.requiredTables.length!==16||
    evidence.reviewState!=="UNREVIEWED_RELEASE_HOLD")return {ready:false,reason:"INVALID_EVIDENCE"};
 const names=evidence.requiredTables.map(t=>t.table);
 if(new Set(names).size!==16||evidence.requiredTables.some(t=>
    typeof t.table!=="string"||!Array.isArray(t.columns)||!t.columns.length||
    t.columns.some(c=>typeof c!=="string"||!/^[a-z][a-z0-9_]*$/.test(c))))
   return {ready:false,reason:"INVALID_TABLE_CONTRACT"};
 const e=evidence.environments;
 if(!e?.staging||!e?.production)return {ready:false,reason:"MISSING_ENVIRONMENT"};
 for(const site of [e.staging,e.production]){
  if(!Array.isArray(site.missingRequiredTables)||!Array.isArray(site.observedPresent)||
     site.missingRequiredTables.some(t=>!names.includes(t))||
     site.observedPresent.some(t=>!names.includes(t))||
     new Set([...site.missingRequiredTables,...site.observedPresent]).size!==16)
   return {ready:false,reason:"UNTRUSTWORTHY_INVENTORY"};
 }
 const blockers=[];
 if(e.staging.missingRequiredTables.length)blockers.push("STAGING_VOX_SCHEMA_MISSING");
 if(e.production.missingRequiredTables.length)blockers.push("PRODUCTION_SCHEMA_NOT_CERTIFIED");
 if(evidence.migrationComparison?.stagingOnlyVersionIds!==0||
    evidence.migrationComparison?.productionOnlyVersionIds!==0)blockers.push("MIGRATION_HISTORY_REQUIRES_DBA_REVIEW");
 if(!evidence.dbaApproved||!evidence.restoreVerified)blockers.push("DBA_RESTORE_APPROVAL_MISSING");
 if(!evidence.independentSecurityApproved)blockers.push("SECURITY_APPROVAL_MISSING");
 if(!evidence.realAal2StagingVerified)blockers.push("REAL_AAL2_STAGING_MISSING");
 if(evidence.securityAdvisories?.some(x=>x.reviewRequired===true))blockers.push("SECURITY_ADVISORIES_UNREVIEWED");
 return {ready:false,reason:"RELEASE_HOLD",blockers};
}
const evidence=JSON.parse(readFileSync(file,"utf8"));
const result=assess(evidence);
if(import.meta.url===`file://${process.argv[1]}`){
 process.stdout.write(JSON.stringify(result)+"\n");
 if(process.argv.includes("--release-check"))process.exit(result.ready?0:42);
 else process.exit(result.reason==="INVALID_EVIDENCE"||result.reason==="INVALID_TABLE_CONTRACT"||
   result.reason==="MISSING_ENVIRONMENT"||result.reason==="UNTRUSTWORTHY_INVENTORY"?1:0);
}
