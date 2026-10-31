#!/usr/bin/env node
// RC35 d-db: read-only migration inventory reconciliation.
// Compares an injected managed-ledger inventory with a source SQL inventory by
// version, name (alias semantics) and digest, and emits deterministic blockers.
// No network, credentials, SQL execution, ledger writes or promotion of SQL.
// An alias is only ACCEPTED when digests are supplied by both sides and equal.
// Output is DBA review input; `releaseGo` is always false.
import {readFileSync,writeFileSync,readdirSync} from "node:fs";
import {resolve,join,basename} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const sha=b=>createHash("sha256").update(b).digest("hex");
export const RC35_SCHEMA="qf.vox.rc35.migration-inventory-reconciliation.v1";
const FILE_RE=/^(\d{14})_([\w-]+)\.sql$/;
const BASELINE_NAME=/^qf_mvp_staging_baseline_[0-9a-f]{8}$/;
const DIGEST_RE=/^[0-9a-f]{64}$/;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
// Same normalisation as RC26: staging suffix only proposes an alias candidate.
const normalise=n=>n.replace(/_staging(?:_\d{8})?$/,"");
const tokens=n=>n.split("_").filter(Boolean).length;
const boundarySuffix=(a,b)=>a===b||a.endsWith("_"+b)||b.endsWith("_"+a);

// Digest that tolerates checkout line endings and trailing whitespace only.
export function canonicalSqlDigest(text){
 const t=(Buffer.isBuffer(text)?text.toString("utf8"):String(text)).replace(/\r\n/g,"\n").replace(/\s+$/,"");
 return sha(t+"\n");
}

export function buildSourceInventoryFromDir(dir){
 const files=readdirSync(dir).filter(n=>FILE_RE.test(n)).sort().map(n=>{
  const bytes=readFileSync(join(dir,n));
  return {file:n,sha256:sha(bytes),canonicalSha256:canonicalSqlDigest(bytes)};
 });
 return {schema:"qf.vox.rc35.source-sql-inventory.v1",files};
}

const bad=code=>{throw Error("RC35_"+code)};
const digestOf=v=>{
 if(v===undefined||v===null||v==="")return null;
 if(typeof v!=="string"||!DIGEST_RE.test(v))bad("DIGEST_MALFORMED");
 return v;
};

// Accepts: array | {migrations} | {environments:{staging:{migrations}}} |
// RC26 drift snapshot ({staging_only,common_versions}).
export function normaliseManagedInventory(input){
 let list;
 if(Array.isArray(input))list=input;
 else if(input&&Array.isArray(input.migrations))list=input.migrations;
 else if(input&&input.environments?.staging?.migrations)list=input.environments.staging.migrations;
 else if(input&&Array.isArray(input.staging_only)&&Array.isArray(input.common_versions))
  list=[...input.staging_only,...input.common_versions.map(c=>({version:c.version,name:c.staging_name}))];
 else bad("MANAGED_INVENTORY_SHAPE");
 const seen=new Set();
 const out=list.map(e=>{
  if(!e||!/^\d{14}$/.test(e.version||"")||typeof e.name!=="string"||!e.name)bad("MANAGED_ENTRY_INVALID");
  if(seen.has(e.version))bad("MANAGED_DUPLICATE_VERSION");
  seen.add(e.version);
  return {version:e.version,name:e.name,
   digest:digestOf(e.statementsSha256??e.statements_sha256??e.sha256)};
 });
 return out.sort((a,b)=>cmp(a.version,b.version));
}

export function normaliseSourceInventory(input){
 const list=Array.isArray(input)?input:input&&Array.isArray(input.files)?input.files:bad("SOURCE_INVENTORY_SHAPE");
 const seen=new Set();
 const out=list.map(e=>{
  const raw=typeof e==="string"?e:e?.file??e?.path;
  const file=typeof raw==="string"?basename(raw):"";
  const m=FILE_RE.exec(file);
  if(!m)bad("SOURCE_ENTRY_INVALID");
  if(seen.has(file))bad("SOURCE_DUPLICATE_FILE");
  seen.add(file);
  return {file,version:m[1],name:m[2],
   digests:[digestOf(e?.canonicalSha256),digestOf(e?.sha256)].filter(Boolean)};
 });
 return out.sort((a,b)=>cmp(a.file,b.file));
}

export function reconcileInventories(managedInput,sourceInput){
 const managed=normaliseManagedInventory(managedInput);
 const source=normaliseSourceInventory(sourceInput);
 const blockers=[];
 const block=(code,subject,detail)=>blockers.push({code,subject,detail:detail||""});
 const byVersion=new Map(source.map(s=>[s.version,s]));
 const byName=new Map();
 for(const s of source)byName.set(s.name,[...(byName.get(s.name)||[]),s]);
 const nameCount=new Map();
 for(const m of managed)nameCount.set(m.name,(nameCount.get(m.name)||0)+1);

 // Sources version collisions make version identity ambiguous.
 const versionDup=new Map();
 for(const s of source)versionDup.set(s.version,(versionDup.get(s.version)||0)+1);
 for(const [v,n] of [...versionDup].sort())if(n>1)block("SOURCE_VERSION_COLLISION",v,n+" files share one version");

 const exactFiles=new Set(managed.filter(m=>byVersion.get(m.version)?.name===m.name).map(m=>byVersion.get(m.version).file));
 const claims=new Map();
 const entries=managed.map(m=>{
  let cls,candidates=[];
  const same=byVersion.get(m.version);
  if(same&&same.name===m.name){cls="EXACT_VERSION_AND_NAME";candidates=[same];}
  else if(same){cls="SAME_VERSION_DIFFERENT_NAME";candidates=[same];}
  else if(BASELINE_NAME.test(m.name)){cls="MANAGED_BASELINE_SQUASH";}
  else{
   const exact=byName.get(m.name)||[];
   const norm=normalise(m.name);
   // Ticket-prefix/staging-suffix candidates, never against a file whose own
   // version+name is already in the ledger.
   const loose=exact.length?[]:source.filter(s=>!exactFiles.has(s.file)&&tokens(norm)>=3&&
    tokens(s.name)>=3&&boundarySuffix(norm,s.name));
   candidates=exact.length?exact:loose;
   cls=candidates.length>1?"AMBIGUOUS_ALIAS":candidates.length===1
    ?(exact.length?"ALIAS_RETIMESTAMPED_EXACT_NAME":"ALIAS_NORMALISED_NAME")
    :"MANAGED_ONLY_NO_SOURCE";
  }
  let digestStatus="NOT_APPLICABLE";
  if(candidates.length===1){
   const src=candidates[0];
   if(!m.digest||!src.digests.length)digestStatus="DIGEST_UNAVAILABLE";
   else digestStatus=src.digests.includes(m.digest)?"DIGEST_MATCH":"DIGEST_MISMATCH";
   claims.set(src.file,[...(claims.get(src.file)||[]),m.version]);
  }
  const subject=m.version+" "+m.name;
  if(cls==="SAME_VERSION_DIFFERENT_NAME")block("NAME_MISMATCH_AT_SAME_VERSION",subject,"source "+candidates[0].file);
  if(cls==="AMBIGUOUS_ALIAS")block("AMBIGUOUS_ALIAS",subject,candidates.map(c=>c.file).join(","));
  if(cls==="MANAGED_ONLY_NO_SOURCE")block("MANAGED_ONLY_NO_SOURCE_SQL",subject,"recover statements from ledger");
  if(cls==="MANAGED_BASELINE_SQUASH")block("BASELINE_CONTENT_UNPROVEN",subject,"catalog diff required");
  if(nameCount.get(m.name)>1)block("DUPLICATE_MANAGED_NAME",subject,nameCount.get(m.name)+" ledger rows");
  if(digestStatus==="DIGEST_UNAVAILABLE")block("DIGEST_UNAVAILABLE",subject,"supply statements digest on both sides");
  if(digestStatus==="DIGEST_MISMATCH")block("DIGEST_MISMATCH",subject,"source "+candidates[0].file);
  const accepted=digestStatus==="DIGEST_MATCH"&&nameCount.get(m.name)===1;
  return {version:m.version,name:m.name,class:cls,digestStatus,accepted,
   sourceCandidates:candidates.map(c=>c.file)};
 });
 for(const [file,versions] of [...claims].sort((a,b)=>cmp(a[0],b[0])))
  if(versions.length>1)block("SOURCE_CLAIMED_BY_MULTIPLE_MANAGED_ROWS",file,versions.join(","));

 const matched=new Set(entries.flatMap(e=>e.sourceCandidates));
 const baseline=managed.find(m=>BASELINE_NAME.test(m.name))?.version||null;
 const latest=managed.length?managed[managed.length-1].version:null;
 const sourceOnly=source.filter(s=>!matched.has(s.file)).map(s=>{
  const cls=baseline&&s.version<baseline?"SOURCE_ONLY_PRE_BASELINE_UNVERIFIED"
   :latest&&s.version<=latest?"SOURCE_ONLY_HISTORICAL_GAP":"SOURCE_ONLY_APPEND_CANDIDATE";
  if(cls!=="SOURCE_ONLY_APPEND_CANDIDATE")block(cls==="SOURCE_ONLY_HISTORICAL_GAP"
   ?"SOURCE_HISTORICAL_GAP_UNPROVEN":"SOURCE_PRE_BASELINE_UNPROVEN",s.file,"prove present/absent read-only");
  return {file:s.file,version:s.version,class:cls};
 });

 const tally=l=>l.reduce((o,x)=>(o[x.class]=(o[x.class]||0)+1,o),{});
 const sortKeys=o=>Object.fromEntries(Object.entries(o).sort((a,b)=>cmp(a[0],b[0])));
 blockers.sort((a,b)=>cmp(a.code,b.code)||cmp(a.subject,b.subject)||cmp(a.detail,b.detail));
 const body={
  schema:RC35_SCHEMA,
  releaseGo:false,managedWrites:false,executesSql:false,promotesProtectedSql:false,
  counts:{managed:managed.length,source:source.length,
   managedVersionMatchedInSource:entries.filter(e=>e.class==="EXACT_VERSION_AND_NAME").length,
   managedOnly:entries.filter(e=>e.class!=="EXACT_VERSION_AND_NAME").length,
   sourceOnly:sourceOnly.length,aliasAccepted:entries.filter(e=>e.accepted).length},
  managedClassCounts:sortKeys(tally(entries)),
  sourceOnlyClassCounts:sortKeys(tally(sourceOnly)),
  managedEntries:entries,sourceOnly,blockers,
  reconciled:blockers.length===0
 };
 return Object.freeze({...body,reportSha256:sha(JSON.stringify(body))});
}

const readJson=p=>JSON.parse(readFileSync(resolve(p),"utf8"));
export function runCli(argv,io={log:console.log,err:console.error}){
 const arg=n=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:undefined};
 const managedPath=arg("--managed"),sourcePath=arg("--source"),sourceDir=arg("--source-dir"),out=arg("--out");
 if(!managedPath||(!sourcePath&&!sourceDir)||(sourcePath&&sourceDir)){
  io.err("usage: rc35-migration-inventory-reconcile.mjs --managed <managed.json> (--source <source-inventory.json> | --source-dir <dir>) [--out <report.json>]");
  return 1;
 }
 let report;
 try{
  report=reconcileInventories(readJson(managedPath),sourcePath?readJson(sourcePath):buildSourceInventoryFromDir(resolve(sourceDir)));
 }catch(e){io.err(String(e.message||e));return 1;}
 const text=JSON.stringify(report,null,2)+"\n";
 if(out)writeFileSync(resolve(out),text);else io.log(text.trimEnd());
 return report.reconciled?0:2;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runCli(process.argv.slice(2));
