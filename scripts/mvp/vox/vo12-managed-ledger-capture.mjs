#!/usr/bin/env node
// VO12: Assemble privately captured, read-only managed migration statements
// into the existing RC40 verifier's exact schema. Never connects to Supabase,
// executes SQL, replays migrations, stores secrets in Git, or declares release GO.
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,lstatSync,writeFileSync} from "node:fs";
import {resolve,join,basename,relative,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {parseEvidence,renderStatements,CAPTURE_SCHEMA}
 from "./rc40-managed-ledger-reconciler.mjs";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
const ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const VERSION=/^\d{14}$/;
const SHA=/^[a-f0-9]{40}$/;
const SECRET=/postgres(?:ql)?:\/\/[^\s"'@]*:[^\s"'@]+@|eyJ[\w-]{20,}\.[\w-]{10,}\.|sk_(?:live|test)_\w{8,}|PRIVATE KEY-----|SUPABASE_SERVICE_ROLE_KEY\s*[=:]/i;
const MAX=5*1024*1024, MAX_PER_STATEMENT=2*1024*1024;
const digest=value=>createHash("sha256").update(value).digest("hex");
const fail=code=>{throw Error("VO12_"+code)};
const isObj=x=>x&&typeof x==="object"&&!Array.isArray(x);
const isInside=(parent,child)=>{const rel=relative(parent,child);return rel===""||(!rel.startsWith(".."+sep)&&rel!==".."&&!rel.startsWith(sep));};
export function assembleManagedLedger({evidenceText,records,candidateSha,capturedBy}){
 if(!SHA.test(candidateSha||""))fail("CANDIDATE_SHA_INVALID");
 const ev=parseEvidence(evidenceText);
 if(!Array.isArray(records)||records.length>ev.managedOnly.length)fail("RECORD_COUNT_INVALID");
 if(typeof capturedBy!=="string"||capturedBy.trim().length<8||
    capturedBy.length>200)fail("CAPTURE_ORIGIN_REQUIRED");
 const expected=new Map(ev.managedOnly.map(x=>[x.version,x.name]));
 const seen=new Set(),digests=new Map(),entries=[];
 let bytes=0,statementCount=0;
 for(const r of records){
  if(!isObj(r)||!VERSION.test(r.version||"")||
    !expected.has(r.version)||expected.get(r.version)!==r.name||
    seen.has(r.version)||!Array.isArray(r.statements)||!r.statements.length)
   fail("FOREIGN_DUPLICATE_OR_MALFORMED_RECORD");
  if(!r.statements.every(s=>typeof s==="string"&&s.trim()&&
      Buffer.byteLength(s,"utf8")<=MAX_PER_STATEMENT))
   fail("INVALID_STATEMENTS");
  // Even authentic applied SQL can contain credentials or private material.
  // Quarantine it for manual private review rather than placing it in a report.
  if(r.statements.some(s=>SECRET.test(s)))fail("POTENTIAL_SECRET_REQUIRES_PRIVATE_REVIEW");
  const normalized=renderStatements(r.statements);
  if(normalized.length>MAX||bytes+normalized.length>MAX)fail("CAPTURE_OVERSIZED");
  const hash=canonicalSqlDigest(normalized);
  digests.set(hash,[...(digests.get(hash)||[]),r.version]);
  entries.push({version:r.version,name:r.name,statements:r.statements,
   statementsSha256:hash,bytes:normalized.length,aliasOf:null});
  seen.add(r.version);bytes+=normalized.length;statementCount+=r.statements.length;
 }
 entries.sort((a,b)=>a.version.localeCompare(b.version));
 const missing=ev.managedOnly.filter(m=>!seen.has(m.version)).map(m=>m.version);
 const duplicateDigests=[...digests.values()].filter(v=>v.length>1);
 const sourceSet=new Set(ev.entries.map(x=>x.canonicalSha256));
 const exactlyMatched=entries.filter(x=>sourceSet.has(x.statementsSha256)).map(x=>x.version);
 const capture={schema:CAPTURE_SCHEMA,candidateSha,
  capturedBy,captureMethod:"supabase_migrations.schema_migrations.read_only_export",
  readOnly:true,provenanceVerified:false,entries};
 const coverage={schema:"qf.vox.vo12.managed-ledger-capture-status.v1",
  candidateSha,captureMethod:capture.captureMethod,
  expected:ev.managedOnly.length,recorded:entries.length,missing,
  statementCount,bytes,uniqueDigests:digests.size,duplicateDigests,
  exactSourceDigestMatches:exactlyMatched.length,
  exactSourceDigestVersions:exactlyMatched,
  stillRequiresManagedSourceAliasReview:entries.length-exactlyMatched.length,
  provenanceVerified:false,sqlExecuted:false,managedWrites:false,
  restored:false,authCertified:false,releaseGo:false};
 return {capture,coverage};
}
export function run(args,io={log:console.log,err:console.error}){
 const opt={};
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(!["--candidate-sha","--source-dir","--out","--captured-by","--evidence"].includes(key)||
   key in opt||!args[i+1]||args[i+1].startsWith("--")){
    io.err("VO12_USAGE: --candidate-sha <40hex> --source-dir <private dir> --out <private file> --captured-by <source> [--evidence <file>]");
    return 1;
  }
  opt[key]=args[++i];
 }
 if(!opt["--source-dir"]||!opt["--out"]||!opt["--captured-by"]||!opt["--candidate-sha"]){
  io.err("VO12_REQUIRED_ARGS_MISSING");return 1;
 }
 try{
  const dir=resolve(opt["--source-dir"]),out=resolve(opt["--out"]);
  if(isInside(ROOT,dir)||isInside(ROOT,out)||
    isInside(dir,out)||!lstatSync(dir).isDirectory()||
    !out.toLowerCase().endsWith(".json"))fail("PRIVATE_CAPTURE_LOCATION_REQUIRED");
  const filenames=readdirSync(dir).filter(x=>x.endsWith(".json")).sort();
  const records=filenames.map(f=>{
   if(!/^\d{14}\.json$/.test(f))fail("FOREIGN_CAPTURE_FILENAME");
   const path=join(dir,f);
   if(!lstatSync(path).isFile())fail("SYMLINK_OR_NONFILE_CAPTURE");
   if(lstatSync(path).size>MAX)fail("OVERSIZED_CAPTURE_FILE");
   const raw=readFileSync(path,"utf8");
   if(SECRET.test(raw))fail("POTENTIAL_SECRET_REQUIRES_PRIVATE_REVIEW");
   const rec=JSON.parse(raw);
   if(rec.version!==basename(f,".json"))fail("VERSION_FILENAME_MISMATCH");
   return rec;
  });
  const {capture,coverage}=assembleManagedLedger({
   evidenceText:readFileSync(resolve(opt["--evidence"]||
    join(ROOT,"docs/vox/VOX-RC40-SOURCE-SQL-DIGESTS-20261101.json")),"utf8"),
   records,candidateSha:opt["--candidate-sha"],capturedBy:opt["--captured-by"]
  });
  writeFileSync(out,JSON.stringify(capture,null,2)+"\n",{flag:"wx",mode:0o600});
  io.log(JSON.stringify({...coverage,captureSha256:digest(readFileSync(out))}));
  io.log("VO12_PRIVATE_READ_ONLY_CAPTURE_SAVED releaseDecision=HOLD");
  return coverage.missing.length===0?0:2;
 }catch(err){io.err(String(err?.message||err));return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=run(process.argv.slice(2));
