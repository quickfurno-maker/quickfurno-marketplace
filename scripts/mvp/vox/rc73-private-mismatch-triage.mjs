#!/usr/bin/env node
// PRIVATE managed-SQL human review packet. Verified SQL never leaves private RAM;
// output contains ONLY pre-existing migration version/name, SOURCE file names,
// bounded structural scores. A candidate is NOT a semantic/DDL alias approval.
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {reviewSqlTokens} from "./rc57-private-lexical-reconciliation.mjs";
import {assessPrivateCapture} from "./rc52-private-managed-sql-assessment.mjs";
import {parseEvidence,DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const bad=()=>{throw Error("RC73_PRIVATE_REVIEW_INVALID");};
const w=t=>String(t).toLowerCase().replace(/^\d{14}_/,"").replace(/_staging(?:_\d{8})?$/,"")
 .split(/[_\-]+/).filter(x=>x.length>=3&&!["sql","migration","qf","vox","v1"].includes(x));
const tokenSequence=s=>reviewSqlTokens(s.trim().replace(/;\s*$/,""));
const tokenSet=s=>new Set(tokenSequence(s).split("\u001f").filter(x=>x.length>2));
const percent=(a,b)=>{
 if(!a.size||!b.size)return 0;
 let shared=0;for(const v of a)if(b.has(v))shared++;
 return Math.round(100*2*shared/(a.size+b.size));
};
export function rankHumanCandidates(managed,sources){
 if(!managed||typeof managed.name!=="string"||typeof managed.sql!=="string"||
    !Array.isArray(sources)||sources.length>300||managed.sql.length>250000)bad();
 const text=tokenSet(managed.sql),title=new Set(w(managed.name));
 const seen=new Set();
 const scores=sources.map(s=>{
  if(!s||typeof s.file!=="string"||!/^\d{14}_[\w.-]+\.sql$/.test(s.file)||
     seen.has(s.file)||typeof s.sql!=="string"||
     !/^[a-f0-9]{64}$/.test(s.canonicalSha256||"")||
     canonicalSqlDigest(s.sql)!==s.canonicalSha256)bad();
  seen.add(s.file);
  const sqlTokenSimilarityPercent=percent(text,tokenSet(s.sql));
  const nameTokenSimilarityPercent=percent(title,new Set(w(s.file.replace(/\.sql$/,""))));
  return {sourceFile:s.file,sqlTokenSimilarityPercent,nameTokenSimilarityPercent,
   exactOrderedTokenSequence:tokenSequence(managed.sql)===tokenSequence(s.sql),
   weightedReviewScore:Math.round(sqlTokenSimilarityPercent*0.7+nameTokenSimilarityPercent*0.3)};
 }).filter(x=>x.sqlTokenSimilarityPercent>=20||x.nameTokenSimilarityPercent>=40);
 scores.sort((a,b)=>b.weightedReviewScore-a.weightedReviewScore||
  a.sourceFile.localeCompare(b.sourceFile));
 return scores.slice(0,3);
}
export function privateReviewPacket({privateDir,candidateSha}){
 if(!/^[a-f0-9]{40}$/.test(candidateSha||""))bad();
 const evidenceText=readFileSync(DEFAULT_EVIDENCE,"utf8"),evidence=parseEvidence(evidenceText);
 const a=assessPrivateCapture({privateDir,candidateSha,evidenceText});
 if(a.withOriginalSql!==31||a.secondReadContentDigestsVerified!==31||
    a.sqlStatementCount!==851||a.exactSourceMatched!==24||
    a.sourceFilesStillUnmatched!==85||a.duplicateCanonicalSqlVersions.length!==2||
    a.reviewEntries.filter(e=>!e.exactSourceFile).length!==7||
    a.releaseGo!==false||a.managedWrites!==false)bad();
 const sources=evidence.entries.map(s=>({
  file:s.file,canonicalSha256:s.canonicalSha256,
  sql:readFileSync(resolve(root,"supabase/migrations",s.file),"utf8")
 }));
 const unresolved=a.reviewEntries.filter(x=>!x.exactSourceFile);
 const results=unresolved.map(row=>{
  if(row.statementCount!==1)return {
   managedVersion:row.version,managedName:row.name,statementCount:row.statementCount,
   assessment:"COMPOSITE_BASELINE_ISOLATED_RESTORE_REQUIRED",candidates:[]
  };
  const file=join(privateDir,row.version+".json");
  const original=JSON.parse(readFileSync(file,"utf8"));
  if(original.version!==row.version||original.name!==row.name||
    !Array.isArray(original.statements)||original.statements.length!==1)bad();
  return {managedVersion:row.version,managedName:row.name,statementCount:1,
   assessment:"STRUCTURAL_AND_FILENAME_CANDIDATES_ONLY_NOT_ALIAS",
   candidates:rankHumanCandidates({name:row.name,sql:original.statements[0]},sources)};
 });
 if(results.length!==7||results.some(x=>x.assessment.includes("APPROVED")))bad();
 return {
  schema:"qf.vox.rc73.private-managed-discrepancy-triage.v1",
  capturedManagedVersionsVerified:31,secondReadVerified:31,
  exactSourceMatches:24,managedDiscrepancies:7,
  unrecognizedSourceMigrations:85,duplicateCanonicalVersionPairs:2,
  results,rawSqlPrinted:false,sourceSqlPrinted:false,
  sourceDiffsAndSemanticAliasesApproved:false,
  isolatedFullRestoreCertified:false,independentDbaApproved:false,releaseGo:false,
  managedSqlWrites:false,productionChanges:false,
  interpretation:"HEURISTIC_SHORTLIST_FOR_INDEPENDENT_DBA_REVIEW_ONLY"
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)bad();
  const result=privateReviewPacket({
   privateDir:process.argv[2],candidateSha:process.argv[3]});
  console.log(JSON.stringify(result,null,2));
  console.log("RC73_MANAGED_DISCREPANCY_TRIAGE_RELEASE_HOLD");
  process.exitCode=2;
 }catch{console.error("RC73_PRIVATE_REVIEW_INVALID_OR_UNVERIFIED");process.exitCode=1;}
}
