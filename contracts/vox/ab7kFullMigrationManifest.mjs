import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {join,resolve} from "node:path";
const sha=x=>createHash("sha256").update(x).digest("hex");
/** Full VOX source inventory; NEVER authorize managed DB changes. */
export function inspectAb7kFullVoxSources(repoRoot){
 try{
  if(typeof repoRoot!=="string"||!repoRoot)throw Error("INVALID_ROOT");
  const stages=[
   {kind:"QUARANTINED_FOUNDATION",path:"ops/vox/quarantined-migrations/legacy-20261014",expected:7},
   {kind:"UNINSTALLED_CANDIDATE",path:"ops/vox/sql-candidates",expected:23}
  ];
  const files=[];
  for(const stage of stages){
   const dir=resolve(repoRoot,stage.path);
   const names=readdirSync(dir).filter(n=>/^\d{14}_[\w-]+\.sql$/.test(n)).sort();
   if(names.length!==stage.expected)throw Error("MISSING_OR_EXTRA_MIGRATION_CANDIDATE");
   for(const name of names){
    const bytes=readFileSync(join(dir,name));
    const sql=bytes.toString("utf8").toLowerCase();
    if(!sql.includes("begin;")||!sql.includes("commit;")||
       bytes.byteLength<150)throw Error("NOT_TRANSACTIONAL_SOURCE");
    files.push(Object.freeze({order:files.length+1,stage:stage.kind,
     path:stage.path+"/"+name,sha256:sha(bytes),bytes:bytes.length,
     managedInstalled:false}));
   }
  }
  const index=n=>files.findIndex(x=>x.path.includes(n));
  const base=index("20261014010000_vox_v1_scoped_staff_authority.sql");
  const tl=index("20261014050000_vox_v1_team_leader_review_policy.sql");
  const grant=index("20261015010000_vox_to02b_staff_department_governance.sql");
  const final=index("20261018120000_vox_ab7j_two_person_staff_suspend_candidate.sql");
  if(!(base>=0&&base<tl&&tl<grant&&grant<final))
    throw Error("UNREVIEWED_FOUNDATION_ORDER");
  const listing=files.map(x=>x.order+"|"+x.path+"|"+x.sha256).join("\n");
  return Object.freeze({
   ok:true,installedInStaging:false,canApply:false,releaseReady:false,
   quarantinedFoundationCount:7,uninstalledCandidateCount:23,
   totalFiles:30,manifestDigest:sha(Buffer.from(listing)),
   files:Object.freeze(files),
   explicitStopReasons:Object.freeze([
    "STAGING_MIGRATION_VERSION_ALIASES_REQUIRE_INDEPENDENT_RECONCILIATION",
    "QUARANTINED_7_FILE_FOUNDATION_REQUIRES_DBA_APPSEC_SIGNOFF",
    "ONLY_SYNTHETIC_CORE_BASE_SCHEMA_TESTED",
    "NO_APPROVED_DOWN_MIGRATION_OR_DATABASE_RESTORE_CERTIFICATION",
    "NO_GENUINE_INDEPENDENT_FIRST_TEAM_LEADER_AAL2",
    "NO_AUTHENTICATED_PROTECTED_STAGING_END_TO_END"
   ])
  });
 }catch(e){
  return Object.freeze({ok:false,canApply:false,releaseReady:false,
   reason:e instanceof Error?e.message:"UNKNOWN_SOURCE_FAILURE"});
 }
}
