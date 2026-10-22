import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectPay4aMigrationInventory} from "./audit-finance-pay4a-migration.mjs";
import {inspectManagedMigrationObservation} from "./financePay4c0ManagedHistory.mjs";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const legacy="20261014010000_vox_v1_scoped_staff_authority.sql";
const observed="ops/finance/PAY4C0-READONLY-MANAGED-MIGRATION-EVIDENCE-20261022.json";
export function reconcileFinanceMigrationForReview({root=ROOT,exists=fs.existsSync}={}){
 const pinned=inspectPay4aMigrationInventory({root});
 const observation=inspectManagedMigrationObservation(path.join(root,observed));
 const original=path.join(root,"supabase/migrations",legacy);
 const quarantine=path.join(root,"ops/vox/quarantined-migrations/legacy-20261014",legacy);
 const runnableLegacy=exists(original);
 const sourcePresent=exists(quarantine);
 const versions=observation.observedCounts??[];
 const expectedAbsence=observation.ok&&versions.length===2&&
  versions.every(v=>v===86);
 const findings=[];
 if(!pinned.ok)findings.push("PINNED_LEGACY_HASH_OR_CANDIDATE_DRIFT");
 if(!sourcePresent)findings.push("QUARANTINE_SOURCE_NOT_FOUND");
 if(runnableLegacy)findings.push("UNAPPROVED_SQL_MOVED_INTO_MIGRATIONS");
 if(!expectedAbsence)findings.push("REMOTE_LIST_SNAPSHOT_INVALID");
 return Object.freeze({
  schema:"qf.finance.pay4c2.migration-issue.v1",
  sourceIntegrityOk:findings.length===0,findings,
  legacyVersion:"20261014010000",pinnedSha256:pinned.ledgerHash,
  quarantineShaMatches:pinned.quarantinedHash===pinned.ledgerHash,
  oldValidatorStatus:"BLOCKED_EXPECTS_QUARANTINED_SQL_IN_RUNNABLE_TREE",
  deployedLegacyVersionObserved:false,
  financeCandidatesDeployedObserved:false,
  independentRemoteSchemaVerified:false,
  historicalMigrationReconciliationApproved:false,
  runnableSqlAltered:false,copyQuarantinedSqlAllowed:false,
  releaseStatus:"HOLD",
  requiredFix:"INDEPENDENT_DBA_RECONCILE_CANONICAL_INVENTORY_WITH_LIVE_DB; NO_FAKE_VERSIONS",
  migrationDeploymentAuthorized:false
 });
}
