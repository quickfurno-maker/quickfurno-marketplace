#!/usr/bin/env node
// RC40 d-db: deterministic OFFLINE reconciler between the RC40 source-only digest evidence (107 files)
// and an independently captured managed-Staging migration ledger (31 managed-only versions).
// It accepts REAL captured ledger statements (bytes + digest), recomputes every digest itself, and
// matches each managed-only version to source-only files by exact digest or by a declared, verified alias.
// Forged digests, duplicates, ambiguous claims, unknown versions, wrong candidate sha and secrets are
// rejected (throw, exit 1). Missing captures are NOT rejected: they yield status INCOMPLETE plus a
// machine-readable missing-original-SQL list with ONE template per absent managed version. Templates
// carry null placeholders only; no SQL is ever invented. No DB/network/env access, no SQL execution.
// `releaseGo` and `approvalClaimed` are always false. No timestamps are emitted or hashed.
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {resolve,join,dirname,basename} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {RC40_SCHEMA} from "./rc40-source-sql-digest-collector.mjs";

export const RECONCILE_SCHEMA="qf.vox.rc40.managed-ledger-reconciliation.v1";
export const CAPTURE_SCHEMA="qf.vox.rc40.managed-ledger-capture.v1";
export const MISSING_SCHEMA="qf.vox.rc40.missing-original-sql.v1";
export const CAPTURE_METHODS=Object.freeze(["supabase_migrations.schema_migrations.read_only_export","supabase_cli.migration_list.read_only_export"]);
const here=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(here,"../../..");
export const DEFAULT_EVIDENCE=join(repoRoot,"docs/vox/VOX-RC40-SOURCE-SQL-DIGESTS-20261101.json");
const FILE_RE=/^(\d{14})_[A-Za-z0-9_.-]+\.sql$/;
const VERSION=/^\d{14}$/,HEX64=/^[0-9a-f]{64}$/,SHA40=/^[0-9a-f]{40}$/;
const SECRET_RE=/postgres(?:ql)?:\/\/[^\s"'@]*:[^\s"'@]+@|eyJ[\w-]{20,}\.[\w-]{10,}\.|sk_(?:live|test)_\w{8,}|PRIVATE KEY-----|SUPABASE_SERVICE_ROLE_KEY\s*[=:]/i;
const sha=b=>createHash("sha256").update(b).digest("hex");
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const bad=code=>{throw Error("RC40R_"+code)};

function parseJson(text,code){
 if(typeof text!=="string")bad(code);
 if(SECRET_RE.test(text))bad("SECRET_IN_INPUT");
 try{return JSON.parse(text);}catch{return bad(code);}
}

// Managed ledger statements rendered to one deterministic byte string: each statement trimmed,
// terminated with ";" and joined by "\n". The capturer's declared digest must equal this rendering.
export function renderStatements(statements){
 return Buffer.from(statements.map(s=>{const t=s.trim();return t.endsWith(";")?t:t+";";}).join("\n")+"\n","utf8");
}

export function parseEvidence(text){
 const e=parseJson(text,"EVIDENCE_UNPARSEABLE");
 if(!isObj(e)||e.schema!==RC40_SCHEMA||!HEX64.test(e.evidenceSha256||""))bad("EVIDENCE_SCHEMA");
 const {evidenceSha256,...body}=e;
 if(sha(JSON.stringify(body))!==evidenceSha256)bad("EVIDENCE_TAMPERED");
 if(e.releaseGo!==false||e.managedWrites!==false||e.connectsToManaged!==false)bad("EVIDENCE_NOT_OFFLINE");
 if(!Array.isArray(e.entries)||!Array.isArray(e.managedOnly))bad("EVIDENCE_SHAPE");
 if(e.entries.length!==e.counts?.collected||e.managedOnly.length!==e.driftCounts?.stagingOnly)bad("EVIDENCE_COUNTS");
 const files=new Set(),digests=new Set();
 for(const s of e.entries){
  if(!isObj(s)||!FILE_RE.test(s.file||"")||!HEX64.test(s.canonicalSha256||"")||!HEX64.test(s.sha256||""))bad("EVIDENCE_ENTRY_INVALID");
  if(files.has(s.file))bad("EVIDENCE_DUPLICATE_FILE:"+s.file);
  if(digests.has(s.canonicalSha256))bad("EVIDENCE_DUPLICATE_DIGEST:"+s.file);
  files.add(s.file);digests.add(s.canonicalSha256);
 }
 const sorted=[...e.entries].sort((a,b)=>cmp(a.file,b.file));
 if(sha(sorted.map(s=>s.version+":"+s.canonicalSha256).join("\n"))!==e.sourceOnlyDigestSetSha256)bad("EVIDENCE_DIGEST_SET_MISMATCH");
 const vers=new Set();
 for(const m of e.managedOnly){
  if(!isObj(m)||!VERSION.test(m.version||"")||typeof m.name!=="string"||!m.name)bad("EVIDENCE_MANAGED_INVALID");
  if(m.sqlDigest!==null)bad("EVIDENCE_MANAGED_DIGEST_PRESENT");
  if(vers.has(m.version))bad("EVIDENCE_MANAGED_DUPLICATE_VERSION:"+m.version);
  vers.add(m.version);
 }
 return e;
}

// One template per managed-only version that still lacks its original SQL. Placeholders are null.
export function missingTemplate(m,candidateSha){
 return {version:m.version,name:m.name,
  requiredInput:"original applied statements for managed migration "+m.version+" ("+m.name+") from an independent read-only ledger capture",
  template:{version:m.version,name:m.name,statements:null,statementsSha256:null,bytes:null,aliasOf:null,candidateSha}};
}

function parseCapture(text,candidateSha,managedByVersion){
 const c=parseJson(text,"CAPTURE_UNPARSEABLE");
 if(!isObj(c)||c.schema!==CAPTURE_SCHEMA||!Array.isArray(c.entries))bad("CAPTURE_SCHEMA");
 if(c.candidateSha!==candidateSha)bad("CANDIDATE_SHA_MISMATCH");
 if(typeof c.capturedBy!=="string"||!c.capturedBy.trim())bad("CAPTURE_CAPTURED_BY_MISSING");
 if(!CAPTURE_METHODS.includes(c.captureMethod))bad("CAPTURE_METHOD_NOT_ALLOWED");
 if(c.readOnly!==true)bad("CAPTURE_NOT_READ_ONLY");
 const seenV=new Set(),seenD=new Map(),out=[];
 for(const r of c.entries){
  if(!isObj(r)||!VERSION.test(r.version||""))bad("CAPTURE_ENTRY_INVALID");
  const m=managedByVersion.get(r.version);
  if(!m)bad("CAPTURE_UNKNOWN_VERSION:"+r.version);
  if(r.name!==m.name)bad("CAPTURE_NAME_MISMATCH:"+r.version);
  if(seenV.has(r.version))bad("CAPTURE_DUPLICATE_VERSION:"+r.version);
  seenV.add(r.version);
  if(!Array.isArray(r.statements)||!r.statements.length||!r.statements.every(s=>typeof s==="string"&&s.trim()))bad("CAPTURE_STATEMENTS_INVALID:"+r.version);
  const bytes=renderStatements(r.statements),canonical=canonicalSqlDigest(bytes);
  if(!HEX64.test(r.statementsSha256||"")||r.statementsSha256!==canonical)bad("CAPTURE_DIGEST_FORGED:"+r.version);
  if(r.bytes!==bytes.length)bad("CAPTURE_BYTES_MISMATCH:"+r.version);
  if(seenD.has(canonical))bad("CAPTURE_DUPLICATE_DIGEST:"+seenD.get(canonical)+","+r.version);
  seenD.set(canonical,r.version);
  let alias=null;
  if(r.aliasOf!==undefined&&r.aliasOf!==null){
   if(!Array.isArray(r.aliasOf)||!r.aliasOf.length)bad("CAPTURE_ALIAS_INVALID:"+r.version);
   alias=r.aliasOf.map(a=>{
    if(!isObj(a)||!FILE_RE.test(a.file||"")||!HEX64.test(a.canonicalSha256||""))bad("CAPTURE_ALIAS_INVALID:"+r.version);
    return {file:a.file,canonicalSha256:a.canonicalSha256};
   });
   if(new Set(alias.map(a=>a.file)).size!==alias.length)bad("CAPTURE_ALIAS_DUPLICATE_FILE:"+r.version);
  }
  out.push({version:r.version,name:m.name,canonical,bytes:bytes.length,alias});
 }
 return {entries:out,sha256:sha(text)};
}

export function reconcileManagedLedger({evidenceText,captureText,candidateSha}){
 if(!SHA40.test(candidateSha||""))bad("CANDIDATE_SHA_INVALID");
 const ev=parseEvidence(evidenceText);
 const managedByVersion=new Map(ev.managedOnly.map(m=>[m.version,m]));
 const bySrcDigest=new Map(ev.entries.map(s=>[s.canonicalSha256,s.file]));
 const srcByFile=new Map(ev.entries.map(s=>[s.file,s]));
 const cap=captureText===undefined?{entries:[],sha256:null}:parseCapture(captureText,candidateSha,managedByVersion);

 const claims=new Map(); // source file -> managed version
 const claim=(file,version)=>{
  if(claims.has(file))bad("AMBIGUOUS_SOURCE_CLAIM:"+file+" by "+claims.get(file)+","+version);
  claims.set(file,version);
 };
 const matches=[];
 for(const m of cap.entries){
  const exactFile=bySrcDigest.get(m.canonical);
  if(exactFile&&m.alias)bad("AMBIGUOUS_EXACT_AND_ALIAS:"+m.version);
  let files;
  if(exactFile){files=[exactFile];}
  else if(m.alias){
   for(const a of m.alias){
    const s=srcByFile.get(a.file);
    if(!s)bad("ALIAS_FILE_NOT_SOURCE_ONLY:"+a.file);
    if(s.canonicalSha256!==a.canonicalSha256)bad("ALIAS_DIGEST_FORGED:"+a.file);
   }
   files=m.alias.map(a=>a.file);
  }else bad("MANAGED_ENTRY_UNMATCHED:"+m.version);
  for(const f of files)claim(f,m.version);
  matches.push({managedVersion:m.version,managedName:m.name,statementsCanonicalSha256:m.canonical,statementsBytes:m.bytes,
   matchType:exactFile?"EXACT":"ALIAS",
   sourceFiles:files.sort(cmp).map(f=>({file:f,canonicalSha256:srcByFile.get(f).canonicalSha256}))});
 }
 matches.sort((a,b)=>cmp(a.managedVersion,b.managedVersion));
 const captured=new Set(cap.entries.map(m=>m.version));
 const missingManaged=ev.managedOnly.filter(m=>!captured.has(m.version)).sort((a,b)=>cmp(a.version,b.version));
 const unmatchedSource=ev.entries.map(s=>s.file).filter(f=>!claims.has(f)).sort(cmp);
 const complete=!missingManaged.length&&!unmatchedSource.length;

 const body={
  schema:RECONCILE_SCHEMA,
  status:complete?"RECONCILED_COMPLETE":"INCOMPLETE",
  releaseGo:false,approvalClaimed:false,
  connectsToManaged:false,executesSql:false,managedWrites:false,readsSecrets:false,guessesManagedSql:false,
  candidateSha,
  sourceEvidenceSha256:ev.evidenceSha256,
  sourceOnlyDigestSetSha256:ev.sourceOnlyDigestSetSha256,
  captureSha256:cap.sha256,
  counts:{managedOnly:ev.managedOnly.length,managedMatched:matches.length,managedMissing:missingManaged.length,
   sourceOnly:ev.entries.length,sourceMatched:claims.size,sourceUnmatched:unmatchedSource.length},
  matches,
  missingManagedVersions:missingManaged.map(m=>m.version),
  unmatchedSourceFiles:unmatchedSource,
  note:"Evidence reconciliation only. Not a deploy plan, not an approval and not a GO; digests prove byte identity, not capture authenticity."
 };
 const report=Object.freeze({...body,reconciliationSha256:sha(JSON.stringify(body))});
 const mbody={schema:MISSING_SCHEMA,candidateSha,sourceEvidenceSha256:ev.evidenceSha256,
  count:missingManaged.length,items:missingManaged.map(m=>missingTemplate(m,candidateSha))};
 const missing=Object.freeze({...mbody,missingSha256:sha(JSON.stringify(mbody))});
 return {report,missing};
}

const VALUE_FLAGS=new Set(["evidence","capture","candidate-sha","out","missing-out"]);
const USAGE="usage: rc40-managed-ledger-reconciler.mjs --candidate-sha <40hex> --out <report.json> --missing-out <missing.json> [--evidence <rc40-evidence.json>] [--capture <ledger-capture.json>] [--require-complete]";
// Exit 0 complete, 2 incomplete (report + missing list written), 1 rejection or usage error.
export function runCli(argv,io={log:console.log,err:console.error}){
 const o={};let requireComplete=false;
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==="--require-complete"){requireComplete=true;continue;}
  if(!a.startsWith("--")||!VALUE_FLAGS.has(a.slice(2))||argv[i+1]===undefined||argv[i+1].startsWith("--")||o[a.slice(2)]!==undefined){io.err(USAGE);return 1;}
  o[a.slice(2)]=argv[++i];
 }
 if(!o.out||!o["missing-out"]||!o["candidate-sha"]){io.err(USAGE);return 1;}
 const outs=[resolve(o.out),resolve(o["missing-out"])];
 if(outs[0]===outs[1]||outs.some(p=>!p.toLowerCase().endsWith(".json")||existsSync(p))){io.err("RC40R_OUT_INVALID_OR_EXISTS: refusing to overwrite");return 1;}
 try{
  const rd=p=>readFileSync(resolve(p),"utf8").replace(/^﻿/,"");
  const {report,missing}=reconcileManagedLedger({evidenceText:rd(o.evidence||DEFAULT_EVIDENCE),
   captureText:o.capture?rd(o.capture):undefined,candidateSha:o["candidate-sha"]});
  if(requireComplete&&report.status!=="RECONCILED_COMPLETE")bad("RECONCILIATION_INCOMPLETE:"+report.counts.managedMissing+"_MANAGED_MISSING_"+report.counts.sourceUnmatched+"_SOURCE_UNMATCHED");
  writeFileSync(outs[0],JSON.stringify(report,null,2)+"\n",{flag:"wx"});
  writeFileSync(outs[1],JSON.stringify(missing,null,2)+"\n",{flag:"wx"});
  io.log("RC40 reconciliation "+report.status+": "+outs[0]+" sha256="+report.reconciliationSha256+" managedMissing="+report.counts.managedMissing+" sourceUnmatched="+report.counts.sourceUnmatched+" missingList="+basename(outs[1]));
  return report.status==="RECONCILED_COMPLETE"?0:2;
 }catch(e){io.err(String(e.message||e));return 1;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runCli(process.argv.slice(2));
