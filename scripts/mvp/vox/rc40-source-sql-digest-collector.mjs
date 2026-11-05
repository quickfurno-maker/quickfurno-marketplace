#!/usr/bin/env node
// RC40 d-db: deterministic OFFLINE source-SQL digest collector for the managed-Staging drift's
// source-only set. For every source-only file named in the read-only drift record it hashes the
// real bytes on disk (raw + canonical sha256), cross-checks any supplied dry-run/predeploy digest
// evidence, and emits append-only machine-readable evidence JSON. It opens no connection, reads no
// env/secrets, executes no SQL, writes nothing but the single --out file (created exclusively, never
// overwritten) and never guesses managed SQL: managed-only versions are recorded by name only with a
// null digest. `releaseGo` is always false. No timestamps are emitted or hashed.
import {readFileSync,readdirSync,writeFileSync,existsSync} from "node:fs";
import {resolve,join,dirname,basename} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {protectedDigestIndex,PROTECTED_ROOTS} from "./rc38-migration-staged-dryrun.mjs";
import {pendingClass} from "./d-db-release-preflight.mjs";
import {validatePinnedVendorPendingFiles} from "./rc-launch-vendor-pending-source-addendum.mjs";

export const RC40_SCHEMA="qf.vox.rc40.source-sql-digest-evidence.v1";
export const EXPECTED_SCHEMA="qf.vox.rc40.source-sql-expected-digests.v1";
const DRIFT_SCHEMA="qf.vox.staging-migration-drift/read-only-v1";
const MIGRATIONS_SCHEMA="qf.vox.rc38.migration-digests.v1";
const RC38_PLAN_SCHEMA="qf.vox.rc38.staged-migration-dryrun.v1";
const here=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(here,"../../..");
const FILE_RE=/^(\d{14})_[A-Za-z0-9_.-]+\.sql$/;
const HEX64=/^[0-9a-f]{64}$/;
// service_role is deliberately not matched: legitimate SQL grants mention it, and SQL bodies are never scanned.
const SECRET_RE=/postgres(?:ql)?:\/\/[^\s"'@]*:[^\s"'@]+@|eyJ[\w-]{20,}\.[\w-]{10,}\.|sk_(?:live|test)_\w{8,}|PRIVATE KEY-----|SUPABASE_SERVICE_ROLE_KEY\s*[=:]/i;
const sha=b=>createHash("sha256").update(b).digest("hex");
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const bad=code=>{throw Error("RC40_"+code)};

function parseJson(text,code){
 if(typeof text!=="string")bad(code);
 if(SECRET_RE.test(text))bad("SECRET_IN_INPUT");
 try{return JSON.parse(text);}catch{return bad(code);}
}

// Drift record: strict shape, count self-consistency, unique well-formed filenames.
export function parseDrift(text){
 const d=parseJson(text,"DRIFT_UNPARSEABLE");
 if(!isObj(d)||d.schema!==DRIFT_SCHEMA)bad("DRIFT_SCHEMA");
 if(d.production_touched!==false||d.managed_writes!==false)bad("DRIFT_NOT_READ_ONLY");
 if(!Array.isArray(d.source_only)||!Array.isArray(d.staging_only)||!Array.isArray(d.common_versions))bad("DRIFT_SHAPE");
 if(d.source_only.length!==d.source_only_count)bad("DRIFT_SOURCE_ONLY_COUNT");
 if(d.staging_only.length!==d.staging_only_count)bad("DRIFT_STAGING_ONLY_COUNT");
 if(d.common_versions.length!==d.common_version_count)bad("DRIFT_COMMON_COUNT");
 if(d.source_only_count+d.common_version_count!==d.source_sql_count)bad("DRIFT_SOURCE_TOTAL");
 const files=d.source_only;
 for(const f of files)if(typeof f!=="string"||!FILE_RE.test(f))bad("DRIFT_FILENAME_INVALID");
 if(new Set(files).size!==files.length)bad("DUPLICATE_SOURCE_ONLY_FILE");
 const versions=files.map(f=>f.match(FILE_RE)[1]);
 if(new Set(versions).size!==versions.length)bad("DUPLICATE_SOURCE_ONLY_VERSION");
 const commonFiles=d.common_versions.map(c=>c?.source_filename);
 for(const f of commonFiles)if(typeof f!=="string"||!FILE_RE.test(f))bad("DRIFT_COMMON_FILENAME_INVALID");
 if(commonFiles.some(f=>files.includes(f)))bad("DRIFT_SOURCE_ONLY_OVERLAPS_COMMON");
 return {files:[...files].sort(cmp),commonFiles:new Set(commonFiles),
  managedOnly:d.staging_only.map(s=>({version:String(s.version),name:String(s.name)})).sort((a,b)=>cmp(a.version,b.version)),
  counts:{sourceOnly:d.source_only_count,stagingOnly:d.staging_only_count,common:d.common_version_count,sourceSql:d.source_sql_count}};
}

// Expected-digest evidence, normalised to Map(file -> digest). Accepts:
//  - rc40 list   {schema:EXPECTED_SCHEMA, entries:[{file,sha256}]}
//  - predeploy   {schema:rc38.migration-digests.v1, migrations:[{version,forwardSha256}]}
//  - rc38 plan   {schema:rc38.staged-migration-dryrun.v1, stages:[{file,forwardSha256}]}
export function parseExpected(text,fileByVersion){
 if(text===undefined)return {byFile:new Map(),sources:[]};
 const e=parseJson(text,"EXPECTED_UNPARSEABLE");
 if(!isObj(e))bad("EXPECTED_SHAPE");
 let rows;
 if(e.schema===EXPECTED_SCHEMA&&Array.isArray(e.entries))rows=e.entries.map(r=>({file:r?.file,sha256:r?.sha256}));
 else if(e.schema===MIGRATIONS_SCHEMA&&Array.isArray(e.migrations))
  rows=e.migrations.map(r=>({file:fileByVersion.get(String(r?.version)),sha256:r?.forwardSha256}));
 else if(e.schema===RC38_PLAN_SCHEMA&&Array.isArray(e.stages))rows=e.stages.map(r=>({file:r?.file,sha256:r?.forwardSha256}));
 else bad("EXPECTED_SCHEMA");
 const byFile=new Map();
 for(const r of rows){
  if(typeof r.file!=="string"||!FILE_RE.test(r.file))bad("EXPECTED_FILE_NOT_SOURCE_ONLY");
  if(!HEX64.test(r.sha256||""))bad("EXPECTED_DIGEST_MALFORMED");
  if(byFile.has(r.file))bad("EXPECTED_DUPLICATE");
  byFile.set(r.file,r.sha256);
 }
 return {byFile,sources:[e.schema]};
}

const listSql=dir=>{
 try{return readdirSync(dir,{withFileTypes:true}).filter(d=>d.isFile()&&/\.sql$/i.test(d.name)).map(d=>d.name).sort(cmp);}
 catch{return bad("SOURCE_DIR_UNREADABLE");}
};

export function collectSourceSqlDigests({driftText,sourceDir,expectedText,prevText,repoRootDir=repoRoot,protectedRoots=PROTECTED_ROOTS,
  requireComplete=false}){
 const drift=parseDrift(driftText);
 const fileByVersion=new Map(drift.files.map(f=>[f.match(FILE_RE)[1],f]));
 const present=new Set(listSql(sourceDir));
 const accounted=new Set([...drift.files,...drift.commonFiles]);
 // Validate seven exact post-capture Pending SQL byte hashes. Do not modify
  // historic RC40 read-only managed source evidence or allow unknown extras.
  let addon;
  try{addon=validatePinnedVendorPendingFiles({
   names:[...present].filter(n=>FILE_RE.test(n)),sourceDir,allowAbsent:true,
  });}catch{return bad("UNTRUSTED_PENDING_VENDOR_SOURCE_ADDENDUM");}
  const addonNames=new Set(addon.files);
  const extra=[...present].filter(f=>!accounted.has(f)&&!addonNames.has(f));
 if(extra.length)bad("EXTRA_SOURCE_FILE:"+extra.join(","));
 const missing=drift.files.filter(f=>!present.has(f));
 if(missing.length)bad("MISSING_SOURCE_FILE:"+missing.join(","));

 const expected=parseExpected(expectedText,fileByVersion);
 for(const f of expected.byFile.keys())if(!drift.files.includes(f))bad("EXPECTED_FILE_NOT_SOURCE_ONLY");

 const idx=protectedDigestIndex(repoRootDir,protectedRoots);
 const entries=drift.files.map(file=>{
  const bytes=readFileSync(join(sourceDir,file));
  if(!bytes.length)bad("EMPTY_SOURCE_FILE:"+file);
  const canonical=canonicalSqlDigest(bytes),raw=sha(bytes);
  if(idx.has(canonical)||pendingClass("supabase/migrations/"+file))bad("PROTECTED_OR_QUARANTINED_DIGEST:"+file);
  const exp=expected.byFile.get(file);
  let attestation="UNATTESTED";
  if(exp){
   if(exp===canonical)attestation="MATCHES_CANONICAL";
   else if(exp===raw)attestation="MATCHES_RAW";
   else bad("EXPECTED_DIGEST_MISMATCH:"+file);
  }
  return {file,version:file.match(FILE_RE)[1],bytes:bytes.length,sha256:raw,canonicalSha256:canonical,attestation};
 });
 const byDigest=new Map();
 for(const e of entries)byDigest.set(e.canonicalSha256,[...(byDigest.get(e.canonicalSha256)||[]),e.file]);
 for(const fs of byDigest.values())if(fs.length>1)bad("DUPLICATE_DIGEST:"+fs.join(","));

 const unattested=entries.filter(e=>e.attestation==="UNATTESTED").map(e=>e.file);
 if(requireComplete&&unattested.length)bad("EVIDENCE_INCOMPLETE:"+unattested.length+"_UNATTESTED");

 // Append-only chain: a previous evidence file may only be extended; no overlapping digest may change.
 let prevSha=null;
 if(prevText!==undefined){
  const p=parseJson(prevText,"PREV_UNPARSEABLE");
  if(!isObj(p)||p.schema!==RC40_SCHEMA||!HEX64.test(p.evidenceSha256||""))bad("PREV_INVALID");
  const {evidenceSha256,...pbody}=p;
  if(sha(JSON.stringify(pbody))!==evidenceSha256)bad("PREV_TAMPERED");
  const cur=new Map(entries.map(e=>[e.file,e.canonicalSha256]));
  for(const pe of p.entries||[]){
   if(!cur.has(pe.file))bad("PREV_ENTRY_REMOVED:"+pe.file);
   if(cur.get(pe.file)!==pe.canonicalSha256)bad("PREV_DIGEST_CHANGED:"+pe.file);
  }
  prevSha=evidenceSha256;
 }

 const body={
  schema:RC40_SCHEMA,releaseGo:false,
  connectsToManaged:false,executesSql:false,managedWrites:false,readsSecrets:false,guessesManagedSql:false,
  appendOnly:true,prevEvidenceSha256:prevSha,
  driftCounts:drift.counts,
  sourceOnlyDigestSetSha256:sha(entries.map(e=>e.version+":"+e.canonicalSha256).join("\n")),
  counts:{collected:entries.length,attested:entries.length-unattested.length,unattested:unattested.length},
  complete:unattested.length===0,
  expectedEvidenceSchemas:expected.sources,
  entries,
  unattestedFiles:unattested,
  managedOnly:drift.managedOnly.map(m=>({...m,sqlDigest:null,note:"NOT_GUESSED: managed statements require a reviewed ledger export"}))
 };
 return Object.freeze({...body,evidenceSha256:sha(JSON.stringify(body))});
}

const VALUE_FLAGS=new Set(["drift","source-dir","expected","prev","out"]);
const USAGE="usage: rc40-source-sql-digest-collector.mjs --out <new-evidence.json> [--drift <drift.json>] [--source-dir <dir>] [--expected <digests.json>] [--prev <evidence.json>] [--require-complete]";
export const DEFAULT_DRIFT=join(repoRoot,"docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json");
export const DEFAULT_SOURCE_DIR=join(repoRoot,"supabase/migrations");

export function runCli(argv,io={log:console.log,err:console.error},opts={}){
 const o={};let requireComplete=false;
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==="--require-complete"){requireComplete=true;continue;}
  if(!a.startsWith("--")||!VALUE_FLAGS.has(a.slice(2))||argv[i+1]===undefined||argv[i+1].startsWith("--")||o[a.slice(2)]!==undefined){io.err(USAGE);return 1;}
  o[a.slice(2)]=argv[++i];
 }
 if(!o.out){io.err(USAGE);return 1;}
 const outPath=resolve(o.out);
 if(existsSync(outPath)){io.err("RC40_OUT_EXISTS: refusing to overwrite "+basename(outPath));return 1;}
 try{
  const rd=p=>readFileSync(resolve(p),"utf8");
  const ev=collectSourceSqlDigests({driftText:rd(o.drift||DEFAULT_DRIFT),sourceDir:resolve(o["source-dir"]||DEFAULT_SOURCE_DIR),
   expectedText:o.expected?rd(o.expected):undefined,prevText:o.prev?rd(o.prev):undefined,requireComplete,...opts});
  writeFileSync(outPath,JSON.stringify(ev,null,2)+"\n",{flag:"wx"}); // exclusive create: never overwrites, even on a race
  io.log("RC40 evidence written: "+outPath+" sha256="+ev.evidenceSha256+" collected="+ev.counts.collected+" unattested="+ev.counts.unattested);
  return 0;
 }catch(e){io.err(String(e.message||e));return 1;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runCli(process.argv.slice(2));
