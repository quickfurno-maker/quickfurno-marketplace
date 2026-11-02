// No SQL execution, no managed migration mutation: immutable candidate ordering.
// Check the actual source bytes and file paths before any independent DBA review.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
const REQUIRED=Object.freeze([
 "ops/vox/quarantined-migrations/legacy-20261014/20261014010000_vox_v1_scoped_staff_authority.sql",
 "ops/vox/sql-candidates/20261015010000_vox_to02b_staff_department_governance.sql",
 "ops/vox/sql-candidates/20261015020000_vox_to02c_reviewed_department_actions.sql",
 "ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql",
 "ops/vox/sql-candidates/20261016010000_vox08j_eod_partial_review_candidate.sql",
 "ops/vox/sql-candidates/20261016020000_vox08j_staff_team_chat_candidate.sql",
 "ops/vox/sql-candidates/20261016030000_vox08l_staff_work_notifications_candidate.sql",
 "ops/vox/sql-candidates/20261016040000_vox08n_transactional_work_notification_outbox_candidate.sql",
 "ops/vox/sql-candidates/20261016050000_vox08r_internal_outbox_metrics_candidate.sql"
]);
const deny=reason=>Object.freeze({ok:false,reason,approved:false,
  stagingPermitted:false,productionPermitted:false});
export function inspectCanonicalSqlCandidate({rootUrl,readSource=readFileSync,
  expectedHashes}={}){
 if(!(rootUrl instanceof URL)||typeof readSource!=="function")
  return deny("SOURCE_ROOT_OR_READER_MISSING");
 if(expectedHashes!==undefined&&(!Array.isArray(expectedHashes)||
  expectedHashes.length!==REQUIRED.length))return deny("REVIEWER_HASH_LIST_INCOMPLETE");
 const rows=[],seen=new Set(),versions=new Set();
 for(let i=0;i<REQUIRED.length;i++){
  const path=REQUIRED[i],v=path.split("/").at(-1)?.slice(0,14);
  if(!/^\d{14}$/.test(v)||seen.has(path)||versions.has(v))
   return deny("CANONICAL_SQL_CHAIN_COLLISION");
  seen.add(path);versions.add(v);
  let raw;
  try{raw=readSource(new URL(path,rootUrl));}
  catch{return deny("REQUIRED_SQL_SOURCE_MISSING");}
  if(!Buffer.isBuffer(raw)&&typeof raw!=="string")return deny("INVALID_SQL_SOURCE_BYTES");
  const sha256=createHash("sha256").update(raw).digest("hex");
  if(expectedHashes&&expectedHashes[i]!==sha256)
   return deny("PINNED_SQL_HASH_MISMATCH");
  rows.push(Object.freeze({ordinal:i+1,path,version:v,sha256}));
 }
 return Object.freeze({ok:true,sourceOnly:true,sqlCandidates:rows.length,
  canonicalBranch:"TO-02C_REVIEWED_DEPARTMENT_ACTIONS_ONLY",
  alternativeTo02cBranchesIncluded:false,
  files:Object.freeze(rows),approved:false,stagingPermitted:false,
  productionPermitted:false,requiresDBAMigrationHistoryResolution:true,
  requiresCompleteBackupAndIsolatedRollback:true});
}
export const canonicalPaths=REQUIRED;
