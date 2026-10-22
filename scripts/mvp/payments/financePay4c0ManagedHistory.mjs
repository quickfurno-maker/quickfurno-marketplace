import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {financeSourceManifest} from "./financePay4bSqlReview.mjs";
const hash=x=>createHash("sha256").update(x).digest("hex");
export function inspectManagedMigrationObservation(filepath){
 let record;
 try {record=JSON.parse(readFileSync(filepath,"utf8"));}
 catch {return Object.freeze({ok:false,reason:"EVIDENCE_UNAVAILABLE",deploy:false});}
 const rows=record.environmentRows;
 const valid=record.schema==="qf.finance.pay4c0.managed-history-observation.v1"&&
  record.source==="Connected Supabase list_migrations read-only"&&
  record.managedWritesPerformed===false&&record.managedMigrationAuthorized===false&&
  record.independentDbaApproved===false&&record.ownerGo===false&&
  Array.isArray(rows)&&rows.length===2&&
  rows[0]?.environment==="QuickFurno Staging"&&
  rows[1]?.environment==="QuickFurno Production"&&
  rows.every(row=>row.migrationCount===86&&
   row.financeV2MigrationPresent===false&&
   row.quarantinedVoxMigrationPresent===false&&
   /^[0-9]{14}$/.test(row.firstVersion)&&/^[0-9]{14}$/.test(row.lastVersion));
 return Object.freeze({ok:valid&&financeSourceManifest.checksPassed,
  sourceObservationDigest:hash(JSON.stringify(record)),sqlCandidates:financeSourceManifest.candidateCount,
  observedCounts:valid?[86,86]:[],
  actualRemoteSqlHashVerified:false,reviewerApproved:false,
  deploy:false,needsIndependentDba:true});
}
