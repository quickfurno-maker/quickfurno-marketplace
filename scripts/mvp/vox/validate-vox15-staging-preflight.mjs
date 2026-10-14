import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const read=(f)=>readFileSync(resolve(ROOT,f));
const hash=b=>createHash("sha256").update(b).digest("hex");
const normalized=b=>Buffer.from(b.toString("utf8").replace(/\r\n/g,"\n").replace(/\r/g,"\n"),"utf8");
const prefix="supabase/migrations/";
const exact=[
 "20261014010000_vox_v1_scoped_staff_authority.sql",
 "20261014020000_vox_v1_staff_review_workflow.sql",
 "20261014030000_vox_v1_approved_grant_finalizer.sql",
 "20261014040000_vox_v1_staff_emergency_revocation.sql",
 "20261014050000_vox_v1_team_leader_review_policy.sql",
 "20261014060000_vox_operational_intent_review.sql",
 "20261014070000_vox_approved_followup_executor.sql"
];
const evidence="FIRST_PARTY_SUPABASE_MCP_LIST_MIGRATIONS_2026-10-14_VOX_NOT_APPLIED";
const ledger=JSON.parse(read("supabase/staging-history/qf-post-g1-migration-ledger-20260929.json").toString("utf8"));
function validate(records,files=exact){
 if(!Array.isArray(records)||records.length!==exact.length||files.length!==exact.length)return false;
 for(let i=0;i<exact.length;i++){
  const f=exact[i],r=records[i];
  if(files[i]!==f||r?.filename!==f||r.version!==f.slice(0,14)||
   r.name!==f.slice(15,-4)||r.path!==prefix+f||
   r.evidence!==evidence||
   r.exactVersionPresence?.staging!==false||
   r.exactVersionPresence?.production!==false)return false;
  if(r.canonicalSha256!==hash(normalized(read(prefix+f))))return false;
 }
 return true;
}
const rows=ledger.records.filter(r=>r.version.startsWith("20261014")&&r.name.startsWith("vox_"));
assert.equal(validate(rows),true,"VOX15_PIN_OR_MIGRATION_DRIFT");
let rejects=0;
for(const broken of [
 rows.slice(1),
 rows.map((r,i)=>i===0?{...r,canonicalSha256:"0".repeat(64)}:r),
 rows.map((r,i)=>i===1?{...r,exactVersionPresence:{staging:true,production:false}}:r),
 rows.map((r,i)=>i===2?{...r,evidence:"SOURCE_GUESS"}:r),
 [rows[1],rows[0],...rows.slice(2)],
 [...rows,{...rows[0],version:"20261014080000"}],
]){
 assert.equal(validate(broken),false,"UNSAFE_PIN_MUTANT_WAS_ACCEPTED");
 rejects++;
}
const gated=[
 ["app/api/vox/v1/agent-subject-access/route.ts","VOX_AGENT_SUBJECT_AUTH_ENABLED"],
 ["app/api/vox/v1/support-task/route.ts","VOX_SUPPORT_INTERNAL_TASKS_ENABLED"],
 ["app/api/vox/v1/execute-followup/route.ts","VOX_APPROVED_FOLLOWUP_EXECUTION_ENABLED"],
 ["app/api/vox/v1/action-intents/route.ts","VOX_OPERATIONAL_INTENTS_ENABLED"]
];
for(const [file,flag] of gated){
 const src=read(file).toString("utf8");
 assert(src.includes("process.env."+flag+'!=="staging"'),"GATE_NOT_DEFAULT_OFF "+flag);
}
const web=read("apps/vox-web/.env.example").toString("utf8");
for(const key of ["VOX_SUPPORT_TASK_UI_ENABLED","VOX_VENDOR_TASK_UI_ENABLED",
 "VOX_OPERATIONAL_REVIEW_UI_ENABLED"]){
 assert(new RegExp("^"+key+"=disabled$","m").test(web),"UNSAFE_WEB_ENV_SAMPLE "+key);
}
const id=hash(Buffer.from(rows.map(r=>r.version+":"+r.canonicalSha256).join("|")));
const json=Object.freeze({schema:"qf.vox.staging.source-preflight.v1",releaseStatus:"HOLD",
 sourceOnly:true,databaseMigrationAuthorized:false,productionPromotionAuthorized:false,
 migrationCount:rows.length,orderedVersions:rows.map(r=>r.version),
 migrationSetSha256:id,mutationGuardsRejected:rejects,
 reason:"REQUIRES_SIGNED_STAGING_BACKUP_RESTORE_AUTH_AND_RUNBOOK"});
if(process.argv.includes("--json"))console.log(JSON.stringify(json,null,2));
else console.log("VOX15_SOURCE_STAGING_PREFLIGHT_PASS pins="+rows.length+
 " guards="+rejects+" setSha256="+id+" RELEASE_STATUS=HOLD");
