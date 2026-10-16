// VOX-09B. Deterministic read-only migration ledger comparison, NO
// Supabase connection, DDL or reviewer attestation. Inputs must originate
// from two separately authorized live read-only SQL metadata queries.
// Never embed raw migration SQL or database secrets in generated reports.
const VERSION=/^[0-9]{14}$/;
const MD5=/^[a-f0-9]{32}$/;
const NAME=/^[a-zA-Z][a-zA-Z0-9_\-.]{0,127}$/;
const fail=(reason)=>Object.freeze({ok:false,error:reason,
 approvalGranted:false,releasePermitted:false});
const rowOk=r=>r&&typeof r==="object"&&!Array.isArray(r)&&
 Object.keys(r).sort().join("|")==="bodyMd5|name|version"&&
 typeof r.version==="string"&&VERSION.test(r.version)&&
 typeof r.name==="string"&&NAME.test(r.name)&&
 typeof r.bodyMd5==="string"&&MD5.test(r.bodyMd5);
export function compareVoxMigrationLedgers({staging,production}={}){
 if(!Array.isArray(staging)||!Array.isArray(production)||
  staging.length<1||production.length<1||
  staging.length>500||production.length>500)
  return fail("UNVERIFIED_LEDGER_INPUT");
 const a=new Map(),b=new Map();
 for(const [list,where] of [[staging,a],[production,b]]){
  for(const row of list){
   if(!rowOk(row)||where.has(row.version))return fail("DUPLICATE_OR_UNSAFE_LEDGER_ROW");
   where.set(row.version,row);
  }
 }
 const common=[...a.keys()].filter(v=>b.has(v));
 const stageOnly=[...a.keys()].filter(v=>!b.has(v));
 const prodOnly=[...b.keys()].filter(v=>!a.has(v));
 const contentChanged=common.filter(v=>a.get(v).bodyMd5!==b.get(v).bodyMd5);
 const renamed=common.filter(v=>a.get(v).name!==b.get(v).name);
 const emptyHash="d41d8cd98f00b204e9800998ecf8427e";
 const flags={stagingEmptyBodies:staging.filter(r=>r.bodyMd5===emptyHash).length,
  productionEmptyBodies:production.filter(r=>r.bodyMd5===emptyHash).length};
 // Metadata comparisons cannot establish owners, privileges, RLS, migration
 // ordering, byte-for-byte DDL parity or rollback safety, even if hashes match.
 return Object.freeze({ok:true,schema:"qf.vox09.migration-parity-metadata.v1",
  source:"SEPARATE_CONNECTED_READ_ONLY_SQL",
  stagingRows:a.size,productionRows:b.size,
  commonVersions:common.length,
  stagingOnlyVersions:stageOnly.length,productionOnlyVersions:prodOnly.length,
  sharedSqlDigestMismatches:contentChanged.length,
  sharedNameMismatches:renamed.length,
  ...flags,
  globalPrivilegesReconciled:false,
  canonicalManagedMigrationApproved:false,
  safeToApplySql:false,
  approvalGranted:false,releasePermitted:false,
  reviewerRequirement:"INDEPENDENT_DBA_PLUS_APPSEC"});
}
