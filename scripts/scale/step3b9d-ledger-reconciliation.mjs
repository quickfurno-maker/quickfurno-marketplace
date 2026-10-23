// 3B-9D metadata-only: correlate frozen managed migration statement SHA-256 with 104 differences.
// These hashes do not constitute SQL recovery, replay authorization, or equivalent database schemas.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const get=p=>JSON.parse(readFileSync(resolve(ROOT,p),"utf8"));
const ledger="ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json";
const stg="ops/vox/certification/STEP3B9D-STAGING-LEDGER-FINGERPRINTS-20261023.json";
const prod="ops/vox/certification/STEP3B9D-PRODUCTION-LEDGER-FINGERPRINTS-20261023.json";
const hist="ops/vox/certification/STEP3B9D-GIT-HISTORY-PROVENANCE-20261023.json";
export function reconcileMetadata(l=get(ledger),s=get(stg),p=get(prod),h=get(hist)){
 assert.equal(l.records.length,104);
 assert.equal(s.schema,"qf.vox.step3b9d.managed-ledger-sha256-metadata.v1");
 assert.equal(p.schema,s.schema);
 assert.equal(s.environment,"STAGING");assert.equal(p.environment,"PRODUCTION");
 assert.equal(s.rows.length,86);assert.equal(p.rows.length,86);
 assert.equal(h.counts.amongPreviouslyNotRunnableStillMissing,72);
 const sm=new Map(),pm=new Map();
 for(const [rows,target] of [[s.rows,sm],[p.rows,pm]])for(const x of rows){
  assert.ok(/^[0-9]{14}$/.test(x.version));
  assert.ok(!target.has(x.version),"duplicate migration ledger version");
  assert.ok(Number.isInteger(x.statement_count)&&x.statement_count>=0);
  assert.ok(x.sql_ledger_sha256===null||/^[a-f0-9]{64}$/.test(x.sql_ledger_sha256));
  assert.equal(!!x.sql_ledger_sha256,x.statement_count>0);
  target.set(x.version,x);
 }
 const dba=l.records.map(x=>{
  const m=(x.environment==="STAGING_ONLY"?sm:pm).get(x.version);
  assert.ok(m,"DBA version missing in managed metadata: "+x.version);
  return {version:x.version,environment:x.environment,name:x.name,
    runnableSqlSourceInCurrentGit:x.versionInRunnableSource,
    managedLedgerStatementCount:m.statement_count,
    managedLedgerFingerprint:m.sql_ledger_sha256,
    managedLedgerStatementArrayPresent:m.statement_count>0,
    rawSqlBodyExported:false,
    action:x.versionInRunnableSource?"COMPARE_GIT_SOURCE_TO_LEDGER":
      "RECOVER_ORIGINAL_SQL_FROM_APPROVED_BACKUP_OR_MANAGED_LEDGER",
    sqlSemanticReview:"UNREVIEWED",independentDbaSigned:false,
    authorizationToReplay:false};
 });
 const shared=[];
 for(const [v,x] of sm){
  const y=pm.get(v);
  if(!y)continue;
  const status=x.statement_count===0&&y.statement_count===0?"BOTH_NO_SQL_STORED":
    x.sql_ledger_sha256===y.sql_ledger_sha256?"MATCHING_LEDGER_SQL_FINGERPRINT":
    "DIVERGENT_SQL_FOR_SAME_VERSION";
  shared.push({version:v,stagingName:x.name,productionName:y.name,status,
    stagingSqlSha256:x.sql_ledger_sha256,productionSqlSha256:y.sql_ledger_sha256,
    independentSemanticEquivalence:"UNREVIEWED",reviewer:null,
    explicitlyApproved:false});
 }
 shared.sort((a,b)=>a.version.localeCompare(b.version));
 const counts={
  totalDivergent:104,notRunnableInGit:dba.filter(x=>!x.runnableSqlSourceInCurrentGit).length,
  missingGitButLedgerStatementsPresent:dba.filter(x=>!x.runnableSqlSourceInCurrentGit&&x.managedLedgerStatementArrayPresent).length,
  missingGitAndLedgerStatements:dba.filter(x=>!x.runnableSqlSourceInCurrentGit&&!x.managedLedgerStatementArrayPresent).length,
  sharedVersions:shared.length,
  sharedSqlHashMatch:shared.filter(x=>x.status==="MATCHING_LEDGER_SQL_FINGERPRINT").length,
  sharedSqlHashDifferent:shared.filter(x=>x.status==="DIVERGENT_SQL_FOR_SAME_VERSION").length,
  sharedBothNoSql:shared.filter(x=>x.status==="BOTH_NO_SQL_STORED").length,
  stagingVersionsWithStatements:s.rows.filter(x=>x.statement_count>0).length,
  productionVersionsWithStatements:p.rows.filter(x=>x.statement_count>0).length};
 assert.deepEqual(counts,{totalDivergent:104,notRunnableInGit:72,
  missingGitButLedgerStatementsPresent:72,missingGitAndLedgerStatements:0,sharedVersions:34,
  sharedSqlHashMatch:26,sharedSqlHashDifferent:7,sharedBothNoSql:1,
  stagingVersionsWithStatements:85,productionVersionsWithStatements:85});
 return {schema:"qf.vox.step3b9d.metadata-recovery-evidence.v1",
  observed:"2026-10-23 managed Supabase SELECT-only SQL metadata",counts,
  divergentVersions:dba,sharedVersions:shared,
  safety:"SQL array presence is a lead for controlled recovery; hashes are not the original SQL. Do not export ledger statements to GitHub, Notion or logs; independently verify bodies/secret content before secure evidence collection.",
  independentDbaApproval:false,sqlRecoveryCompleted:false,actualRestoreCertified:false,
  stagingMigrationAuthorized:false,productionMigrationAuthorized:false,
  releaseStatus:"HOLD"};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=reconcileMetadata();
 writeFileSync(resolve(ROOT,"ops/vox/certification/STEP3B9D-LEDGER-RECONCILIATION-20261023.json"),
  JSON.stringify(result,null,2)+"\n");
 console.log("STEP3B9D_LEDGER_RECONCILIATION "+JSON.stringify(result.counts));
}
