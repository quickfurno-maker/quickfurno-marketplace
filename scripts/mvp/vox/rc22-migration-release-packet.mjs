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
export function buildRc22MigrationPacket(){
 const names=readdirSync(resolve(root,"supabase/migrations"))
  .filter(p=>/^\d{14}_.+\.sql$/.test(p)).sort();
 if(names.length<100||names.some((v,i)=>i>0&&names[i-1]===v))
  throw Error("MIGRATION_SOURCE_INVENTORY_INCOMPLETE");
 const entries=names.map(name=>({name,sha256:digest(read("supabase/migrations/"+name))}));
 const legacy="supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql";
 const v2="ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql";
 const historical=read(legacy).toString("utf8");
 const candidate=read(v2).toString("utf8");
 if(!entries.some(x=>x.name===legacy.split("/").at(-1))||
    !/\bas \$(?=\r?\n)|^\$;/m.test(historical)||
    !historical.includes("if v_order.provider_order_request_token is distinct from p_request_token then")||
    !candidate.includes("REVIEW ONLY / UNINSTALLED")||
    names.some(n=>/rc17_razorpay|rc18_razorpay/.test(n)))
  throw Error("FINANCE_V1_V2_REVIEW_GATE_CHANGED");
 return Object.freeze({
  schema:"qf-vox-rc22-source-db-handoff-v1",status:"HOLD",releaseGo:false,
  managedDatabaseInspected:false,migrations:{count:entries.length,
   aggregateSha256:digest(Buffer.from(entries.map(e=>e.name+" "+e.sha256).join("\n"))),
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
