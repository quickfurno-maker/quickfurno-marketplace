#!/usr/bin/env node
// Strict read-only token-equality evidence. No SQL, secrets, aliases or grants printed.
// Treat every lexical match as an unapproved REVIEW CANDIDATE, never semantic proof.
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {parseEvidence,DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
import {assessPrivateCapture} from "./rc52-private-managed-sql-assessment.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const WORD=/[A-Za-z_]/,REST=/[A-Za-z0-9_$]/;
const bad=x=>{throw Error("RC57_"+x)};
export function reviewSqlTokens(sql){
 if(typeof sql!=="string"||sql.length>5e6)bad("SQL_INPUT_INVALID");
 const tokens=[];let i=0;
 while(i<sql.length){
  const c=sql[i],n=sql[i+1];
  if(/\s/.test(c)){i++;continue;}
  if(c==="-"&&n==="-"){i+=2;while(i<sql.length&&sql[i]!=="\n")i++;continue;}
  if(c==="/"&&n==="*"){
   let depth=1;i+=2;
   while(i<sql.length&&depth){
    if(sql.slice(i,i+2)==="/*"){depth++;i+=2;}
    else if(sql.slice(i,i+2)==="*/"){depth--;i+=2;}
    else i++;
   }
   if(depth)bad("UNTERMINATED_COMMENT");
   continue;
  }
  if(c==="'"||c==='"'){
   const quote=c,start=i++;let closed=false;
   while(i<sql.length){
    if(sql[i]===quote){
     if(sql[i+1]===quote){i+=2;continue;}
     i++;closed=true;break;
    }
    i++;
   }
   if(!closed)bad("UNTERMINATED_QUOTE");
   tokens.push(sql.slice(start,i));continue;
  }
  if(c==="$"){
   const m=/^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i,i+80));
   if(m){
    const end=sql.indexOf(m[0],i+m[0].length);
    if(end<0)bad("UNTERMINATED_DOLLAR_LITERAL");
    tokens.push(sql.slice(i,end+m[0].length));
    i=end+m[0].length;continue;
   }
  }
  if(WORD.test(c)){
   const start=i++;
   while(i<sql.length&&REST.test(sql[i]))i++;
   tokens.push(sql.slice(start,i).toLowerCase());continue;
  }
  if(/[0-9]/.test(c)){
   const start=i++;
   while(i<sql.length&&/[A-Za-z0-9_.]/.test(sql[i]))i++;
   tokens.push(sql.slice(start,i));continue;
  }
  tokens.push(c);i++;
 }
 return tokens.join("\u001f");
}
export function lexicalReview(statements,sources,{minTokens=32}={}){
 if(!Array.isArray(statements)||statements.length>2000||
    !Number.isSafeInteger(minTokens)||minTokens<32||minTokens>2000||
    statements.some(s=>typeof s!=="string")||!Array.isArray(sources)||
    sources.length>300)bad("INPUT_INVALID");
 const candidates=statements.map(s=>reviewSqlTokens(s))
   .filter(s=>s.split("\u001f").length>=minTokens);
 const seen=new Set(),matches=[];
 for(const s of sources){
  if(!s||typeof s.file!=="string"||seen.has(s.file)||
     typeof s.sql!=="string"||!/^[a-f0-9]{64}$/.test(s.digest||"")||
     canonicalSqlDigest(s.sql)!==s.digest)bad("SOURCE_DIGEST_UNTRUSTED");
  seen.add(s.file);
  const sourceTokens=reviewSqlTokens(s.sql);
  const n=candidates.filter(t=>sourceTokens.includes(t)).length;
  if(n)matches.push({sourceFile:s.file,strictLexicalFragments:n});
 }
 matches.sort((a,b)=>b.strictLexicalFragments-a.strictLexicalFragments||
  a.sourceFile.localeCompare(b.sourceFile));
 return {sourceFilesChecked:sources.length,managedStatementCount:statements.length,
  eligibleTokenStatements:candidates.length,
  sourceFilesWithStrictTokenFragments:matches.length,
  matches,independentAliasApproved:false,managedWrites:false,releaseGo:false,
  interpretation:"CASE_AND_COMMENT_WHITESPACE_ONLY_NOT_SQL_SEMANTIC_EQUIVALENCE"};
}
export function privateLexicalReview(privateDir,candidateSha){
 const evidenceText=readFileSync(DEFAULT_EVIDENCE,"utf8");
 const ev=parseEvidence(evidenceText);
 const v=assessPrivateCapture({privateDir,candidateSha,evidenceText});
 if(v.withOriginalSql!==31||v.secondReadContentDigestsVerified!==31||
    v.sqlStatementCount!==851||v.releaseGo!==false)bad("PRIVATE_CAPTURE_INVALID");
 const baseline="20260722000100",statements=[];
 for(let i=1;i<=9;i++){
  const o=JSON.parse(readFileSync(join(privateDir,baseline+".part"+
   String(i).padStart(3,"0")+".json"),"utf8"));
  if(o.version!==baseline||o.from!==statements.length+1||
     !Array.isArray(o.statements)||o.to!==o.from+o.statements.length-1)
   bad("PRIVATE_BASELINE_INVALID");
  statements.push(...o.statements);
 }
 if(statements.length!==821)bad("BASELINE_STATEMENT_COUNT");
 const files=ev.entries.map(s=>({file:s.file,digest:s.canonicalSha256,
  sql:readFileSync(resolve(root,"supabase/migrations",s.file),"utf8")}));
 return {schema:"qf.vox.rc57.private-lexical-reconciliation.v1",
  candidateSha,originalVersionsSecondReadVerified:31,
  rawPrivateSqlPrinted:false,...lexicalReview(statements,files)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4||!/^[a-f0-9]{40}$/.test(process.argv[3]))
   bad("EXACT_ARGUMENTS_REQUIRED");
  console.log(JSON.stringify(privateLexicalReview(process.argv[2],process.argv[3]),null,2));
  console.log("RC57_PRIVATE_RECONCILIATION_REVIEW_ONLY_HOLD");
  process.exitCode=2;
 }catch(e){console.error(String(e?.message||e));process.exitCode=1;}
}
