#!/usr/bin/env node
// Private, read-only and non-promotional analysis. NO SQL or credentials printed.
import {readFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {DEFAULT_EVIDENCE,parseEvidence,renderStatements} from "./rc40-managed-ledger-reconciler.mjs";
import {assessPrivateCapture} from "./rc52-private-managed-sql-assessment.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const normalize=s=>String(s).replace(/\r\n/g,"\n").replace(/\s+$/,"")+"\n";
/** Literal, contiguous source bytes are evidence for review, NOT semantic equivalence. */
export function containedSourceFiles(baseline,files){
 const source=normalize(baseline),names=new Set(),embedded=[];
 for(const f of files){
  if(!f||typeof f.file!=="string"||names.has(f.file)||
     typeof f.sql!=="string"||f.sql.trim().length<32||
     !/^[a-f0-9]{64}$/.test(f.digest||"")||
     canonicalSqlDigest(f.sql)!==f.digest)
   throw Error("RC55_SOURCE_UNTRUSTED");
  names.add(f.file);
  const needle=normalize(f.sql).trimEnd();
  if(source.includes(needle))embedded.push(f.file);
 }
 return {sourceFilesChecked:files.length,strictContiguousSourceEmbeds:embedded.sort(),
  notStrictlyEmbedded:files.length-embedded.length,verifiedAliasCount:0,releaseGo:false};
}
export function analyzePrivateBaseline({privateDir,candidateSha}){
 // Requires exact independent connected-Staging ledger second-read verification.
 const text=readFileSync(DEFAULT_EVIDENCE,"utf8"),ev=parseEvidence(text);
 const assessment=assessPrivateCapture({privateDir,candidateSha,evidenceText:text});
 if(assessment.withOriginalSql!==ev.managedOnly.length||
    assessment.secondReadContentDigestsVerified!==ev.managedOnly.length||
    assessment.releaseGo!==false)throw Error("RC55_CAPTURE_NOT_VERIFIED");
 const version="20260722000100",data=[];
 for(let i=1;i<=9;i++){
  const name=version+".part"+String(i).padStart(3,"0")+".json";
  const parsed=JSON.parse(readFileSync(join(privateDir,name),"utf8"));
  if(parsed.version!==version||!Array.isArray(parsed.statements)||
     parsed.from!==data.length+1||parsed.to!==parsed.from+parsed.statements.length-1)
   throw Error("RC55_BASELINE_UNTRUSTED");
  data.push(...parsed.statements);
 }
 const baseline=renderStatements(data).toString("utf8");
 const files=ev.entries.map(x=>{
  const file=resolve(root,"supabase/migrations",x.file);
  const sql=readFileSync(file,"utf8");
  return {file:x.file,digest:x.canonicalSha256,sql};
 });
 const result=containedSourceFiles(baseline,files);
 return {schema:"qf.vox.rc55.private-baseline-literal-containment.v1",
  candidateSha,managedBaselineVersion:version,
  managedStatementCount:data.length,
  managedLedgerSecondReadVerified:assessment.secondReadContentDigestsVerified,
  ...result,semantics:"STRICT_TEXT_SUBSTRING_ONLY_NOT_ALIAS_VERIFICATION",
  noSqlPrinted:true,noMigrationExecuted:true,reviewRequired:true,
  independentDbaApproval:false,managedWrites:false,releaseGo:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)throw Error("RC55_ARGUMENTS_REQUIRED");
  const r=analyzePrivateBaseline({privateDir:process.argv[2],candidateSha:process.argv[3]});
  process.stdout.write(JSON.stringify(r,null,2)+"\nRC55_PRIVATE_BASELINE_REVIEW_ONLY_HOLD\n");
  process.exitCode=2;
 }catch(e){console.error(String(e?.message||e));process.exitCode=1;}
}
