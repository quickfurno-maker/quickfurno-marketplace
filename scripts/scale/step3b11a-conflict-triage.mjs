// 3B-11A metadata-only DBA seven-version triage; never retrieve or print raw SQL bodies.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const get=x=>JSON.parse(readFileSync(resolve(ROOT,x),"utf8"));
const base="ops/vox/certification/";
export function buildConflictTriage(recon=get(base+"STEP3B9D-LEDGER-RECONCILIATION-20261023.json"),
 stg=get(base+"STEP3B9D-STAGING-LEDGER-FINGERPRINTS-20261023.json"),
 prod=get(base+"STEP3B9D-PRODUCTION-LEDGER-FINGERPRINTS-20261023.json")){
 assert.equal(recon.schema,"qf.vox.step3b9d.metadata-recovery-evidence.v1");
 assert.equal(recon.counts.sharedSqlHashDifferent,7);
 assert.equal(recon.counts.missingGitButLedgerStatementsPresent,72);
 assert.equal(stg.rows.length,86);assert.equal(prod.rows.length,86);
 const a=new Map(stg.rows.map(x=>[x.version,x])),b=new Map(prod.rows.map(x=>[x.version,x]));
 assert.equal(a.size,86);assert.equal(b.size,86);
 const issues=recon.sharedVersions.filter(x=>x.status==="DIVERGENT_SQL_FOR_SAME_VERSION").map(x=>{
  const s=a.get(x.version),p=b.get(x.version);
  assert.ok(s&&p);assert.equal(s.sql_ledger_sha256,x.stagingSqlSha256);
  assert.equal(p.sql_ledger_sha256,x.productionSqlSha256);
  assert.notEqual(s.sql_ledger_sha256,p.sql_ledger_sha256);
  return {version:x.version,migrationName:x.stagingName,priority:"P0_SEMANTIC_RECONCILIATION",
   staging:{statementCount:s.statement_count,bytes:s.sql_byte_count,rollbackEntries:s.rollback_count,sha256:s.sql_ledger_sha256},
   production:{statementCount:p.statement_count,bytes:p.sql_byte_count,rollbackEntries:p.rollback_count,sha256:p.sql_ledger_sha256},
   equalStatementCount:s.statement_count===p.statement_count,
   equalByteLength:s.sql_byte_count===p.sql_byte_count,
   reviewCheckpoints:["trusted original SQL bodies (confidential)","per-statement semantic diff and DDL/DML provenance",
    "role grants and SECURITY DEFINER side effects","triggers, policy dependencies and data migrations",
    "target live schema consistency","complete recovery including global roles/ACL/PITR and storage"],
   recoveredSqlBodies:false,bodyContentsPublished:false,
   reviewer:null,semanticEquivalence:"UNREVIEWED",approvedForManagedChange:false};
 });
 assert.equal(issues.length,7);
 const empty=recon.sharedVersions.filter(x=>x.status==="BOTH_NO_SQL_STORED");
 assert.equal(empty.length,1);assert.equal(empty[0].version,"20260817000000");
 return {schema:"qf.vox.step3b11a.conflict-triage.v1",sourceBaseline:"593b9dc17970a44ca987108997ae6ab0544dede2",
  issues,sharedEmptyStatementVersion:empty[0].version,
  divergentLedgerOccurrences:104,
  noCurrentGitSourceButManagedLedgerStatements:72,
  recoverableBodiesNeverExported:true,
  allMigrationSemanticsPending:true,
  independentDbaApproval:false,
  managedStagingDdlAuthorized:false,
  productionChangeAuthorized:false,
  releaseStatus:"HOLD",
  limitation:"Statement counts/byte lengths and matching SHA do not prove semantics; original SQL requires confidential qualified independent DBA custody."};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const obj=buildConflictTriage();
 writeFileSync(resolve(ROOT,base+"STEP3B11A-SEVEN-VERSION-DBA-TRIAGE-20261024.json"),JSON.stringify(obj,null,2)+"\n");
 console.log("STEP3B11A_SEVEN_DBA_CONFLICTS "+obj.issues.length+" unreviewed; raw SQL omitted; RELEASE HOLD");
}
