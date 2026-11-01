#!/usr/bin/env node
// Read-only private diagnostic, never canonical alias proof or migration authority.
// No recovered SQL, secrets, snippets or queries are emitted.
import {readFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {parseEvidence,DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
import {assessPrivateCapture} from "./rc52-private-managed-sql-assessment.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
export function exactStatementEvidence(statements,sources,{minBytes=80}={}){
 if(!Array.isArray(statements)||statements.length>2000||
  !Number.isSafeInteger(minBytes)||minBytes<80||minBytes>65536||
  statements.some(s=>typeof s!=="string"))throw Error("RC56_STATEMENT_INPUT_UNTRUSTED");
 if(!Array.isArray(sources)||sources.length>300)throw Error("RC56_SOURCE_INPUT_UNTRUSTED");
 const seen=new Set(),valid=sources.map(f=>{
  if(!f||typeof f.file!=="string"||seen.has(f.file)||
     typeof f.sql!=="string"||!/^[a-f0-9]{64}$/.test(f.digest||"")||
     canonicalSqlDigest(f.sql)!==f.digest)throw Error("RC56_SOURCE_DIGEST_UNTRUSTED");
  seen.add(f.file);return f;
 });
 const eligible=statements.map((sql,index)=>({sql:sql.trim().replace(/;\s*$/,""),index}))
  .filter(x=>Buffer.byteLength(x.sql,"utf8")>=minBytes);
 const review=[];
 for(const f of valid){
  const matched=eligible.filter(x=>f.sql.includes(x.sql));
  if(matched.length)review.push({sourceFile:f.file,exactStatementFragments:matched.length});
 }
 review.sort((a,b)=>b.exactStatementFragments-a.exactStatementFragments||
  a.sourceFile.localeCompare(b.sourceFile));
 return {sourceFilesChecked:valid.length,baselineStatementCount:statements.length,
  eligibleLongBaselineStatements:eligible.length,
  sourceFilesWithAnyLiteralStatementFragment:review.length,
  evidence:review,unmatchedSourceFiles:valid.length-review.length,
  matchMethod:"STRICT_LITERAL_LONG_STATEMENT_FRAGMENT_NOT_SEMANTIC_EQUIVALENCE",
  independentAliasApproved:false,releaseGo:false};
}
export function analyzePrivateStatementEvidence({privateDir,candidateSha}){
 const evidenceText=readFileSync(DEFAULT_EVIDENCE,"utf8"),ev=parseEvidence(evidenceText);
 const verified=assessPrivateCapture({privateDir,candidateSha,evidenceText});
 if(verified.withOriginalSql!==31||verified.secondReadContentDigestsVerified!==31||
    verified.releaseGo!==false)throw Error("RC56_LEDGER_NOT_VERIFIED");
 const v="20260722000100",parts=[];
 for(let i=1;i<=9;i++){
  const o=JSON.parse(readFileSync(join(privateDir,v+".part"+String(i).padStart(3,"0")+".json"),"utf8"));
  if(o.version!==v||o.from!==parts.length+1||!Array.isArray(o.statements)||
     o.to!==o.from+o.statements.length-1)throw Error("RC56_LEDGER_SLICES_INVALID");
  parts.push(...o.statements);
 }
 if(parts.length!==821)throw Error("RC56_BASELINE_COUNT_CHANGED");
 const src=ev.entries.map(x=>({file:x.file,digest:x.canonicalSha256,
   sql:readFileSync(resolve(root,"supabase/migrations",x.file),"utf8")}));
 const result=exactStatementEvidence(parts,src);
 return {schema:"qf.vox.rc56.private-statement-review.v1",candidateSha,
  managedSecondReadVerified:31,...result,
  rawSqlPrinted:false,managedWrites:false,independentDbaApproval:false,releaseGo:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)throw Error("RC56_PRIVATE_DIR_AND_EXACT_SHA_REQUIRED");
  const r=analyzePrivateStatementEvidence({privateDir:process.argv[2],candidateSha:process.argv[3]});
  console.log(JSON.stringify(r,null,2));
  console.log("RC56_PRIVATE_STATEMENT_EVIDENCE_RELEASE=HOLD");
  process.exitCode=2;
 }catch(e){console.error(String(e?.message||e));process.exitCode=1;}
}
