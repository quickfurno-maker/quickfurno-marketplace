#!/usr/bin/env node
// Deterministic SOURCE-ONLY DBA handoff. No connection, SQL execution, secrets,
// credit, migration or deployment authority. Live catalog comparison is required.
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const digest=b=>createHash("sha256").update(b).digest("hex");
const read=p=>readFileSync(resolve(root,p));
// Human-review binding. A changed, added or deleted historical SQL file must
// trigger an explicit re-review and a deliberate hash-pin update, never GO.
export const RC22_PINNED_SOURCE=Object.freeze({
 count:162,
 aggregateSha256:"f36ee78578c26b9b5a6bcd75c92aeb262504c8186f386ae541bda09826725e3f",
 legacySha256:"bd16bfb3cf28a7c87b579efaae3c6c543eb78e241bb1b03e7ff95075c3e056a8",
 candidateSha256:"6104acdf608236758a2a28d34a8f921c142390040e304f27d5023dc347681e9a"
});
export function rc22AssertUniqueVersions(names){
 if(!Array.isArray(names)||names.some(n=>typeof n!=="string"||!/^\d{14}_.+\.sql$/.test(n)))
  throw Error("MIGRATION_NAME_FORMAT_INVALID");
 const seen=new Set();
 for(const name of names){
  const version=name.slice(0,14);
  if(seen.has(version))throw Error("DUPLICATE_MIGRATION_VERSION_"+version);
  seen.add(version);
 }
 return true;
}
export function buildRc22MigrationPacket(){
 const names=readdirSync(resolve(root,"supabase/migrations"))
  .filter(p=>/^\d{14}_.+\.sql$/.test(p)).sort();
 if(names.length!==RC22_PINNED_SOURCE.count)
  throw Error("MIGRATION_SOURCE_INVENTORY_DRIFT");
 rc22AssertUniqueVersions(names);
 const entries=names.map(name=>({name,sha256:digest(read("supabase/migrations/"+name))}));
 const legacy="supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql";
 const v2="ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql";
 const historical=read(legacy).toString("utf8");
 const candidate=read(v2).toString("utf8");
 const aggregateSha256=digest(Buffer.from(entries.map(e=>e.name+" "+e.sha256).join("\n")));
 if(aggregateSha256!==RC22_PINNED_SOURCE.aggregateSha256||
    digest(read(legacy))!==RC22_PINNED_SOURCE.legacySha256||
    digest(read(v2))!==RC22_PINNED_SOURCE.candidateSha256)
  throw Error("MIGRATION_PINNED_SHA256_DRIFT_REVIEW_REQUIRED");
 if(!entries.some(x=>x.name===legacy.split("/").at(-1))||
    !/\bas \$(?=\r?\n)|^\$;/m.test(historical)||
    !historical.includes("if v_order.provider_order_request_token is distinct from p_request_token then")||
    !candidate.includes("REVIEW ONLY / UNINSTALLED")||
    names.some(n=>/rc17_razorpay|rc18_razorpay/.test(n)))
  throw Error("FINANCE_V1_V2_REVIEW_GATE_CHANGED");
 return Object.freeze({
  schema:"qf-vox-rc22-source-db-handoff-v1",status:"HOLD",releaseGo:false,
  managedDatabaseInspected:false,migrations:{count:entries.length,
   aggregateSha256,
   latest:entries.at(-1).name},
  historicalFinance:{path:legacy,sha256:digest(read(legacy)),
   legacyParserIssue:true,initialNullClaimIssue:true},
  financeCandidate:{path:v2,sha256:digest(read(v2)),installed:false},
  requiredExternalEvidence:[
   "READ_ONLY_MANAGED_MIGRATION_LEDGER_AND_FUNCTION_HASHES",
   "AUTH_STORAGE_VAULT_ROLES_AND_OBJECTS_RESTORE_PARITY",
   "PITR_AND_PHYSICAL_STORAGE_RECOVERY_EVIDENCE",
   "INDEPENDENT_DBA_APPSEC_ADJUDICATION",
   "OWNER_STAGING_GO"
  ]
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 console.log("VOX_RC22_MIGRATION_HANDOFF_HOLD "+JSON.stringify(buildRc22MigrationPacket()));
