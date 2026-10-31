#!/usr/bin/env node
// D-DB: deterministic OFFLINE database release preflight (HOLD/GO decision plan).
// Reads ONE local inventory JSON plus local SQL bytes under --root. No network, no
// credentials, no SQL execution, no ledger writes. It emits path+sha256 listings only:
// never SQL text and never an executable command.
//
//   node d-db-release-preflight.mjs --inventory inv.json [--root dir] [--migrations-dir dir] [--out report.json]
//
// Exit: 0 GO, 2 HOLD, 64 usage/forbidden flag, 70 error.
// GO is only possible when every check is clean AND pins, approvals and canonical consent
// evidence are present. P0-6 and the 7 quarantined + 23 candidate + overlay SQL can never GO.
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,writeFileSync,statSync} from "node:fs";
import {dirname,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {scanSqlObjects} from "../../../contracts/vox/rc4ReleasePlan.mjs";
import {lintSqlAcl} from "./d-db-sql-acl-lint.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(here,"../../..");
const sha=b=>createHash("sha256").update(b).digest("hex");
const HEX64=/^[a-f0-9]{64}$/;
const VERSION=/^\d{14}$/;
const MIG_NAME=/^(\d{14})_[\w-]+\.sql$/;
const MAX_SQL_BYTES=5*1024*1024;
export const INVENTORY_SCHEMA="qf.vox.d-db.release-inventory.v1";
export const REPORT_SCHEMA="qf.vox.d-db.release-preflight.v1";
export const APPROVAL_ROLES=Object.freeze(["dba","appsec","owner"]);

// SQL that is pending/quarantined/review-only. It may be hashed and reported, never enabled.
export const PENDING_SQL_PATTERNS=Object.freeze([
 [/(^|\/)ops\/vox\/sql-candidates\//,"CANDIDATE_23"],
 [/(^|\/)ops\/vox\/quarantined-migrations\//,"QUARANTINED_7"],
 [/(^|\/)ops\/vox\/(identity-attestation-overlay|rc4-approval-overlay|rc\d+-review-candidates)\//,"REVIEW_ONLY_OVERLAY"],
 [/(^|\/)ops\/security\/(sql-candidates|tests)\//,"SECURITY_CANDIDATE"],
 [/(^|\/)(?:\d{14}_)?[\w-]*p0[-_]?6[\w-]*\.sql$/i,"P0_6"],
 [/(^|\/)[\w-]*p0[-_]?6[\w-]*\//i,"P0_6"]
]);
// Classify on a normalized path: case-insensitive filesystems (Windows/macOS) and "//" or "./"
// segments resolve to the same file, so they must not slip past the case-sensitive patterns.
const normPending=p=>String(p).replace(/\/+/g,"/").split("/").filter(s=>s!=="."&&s!=="").join("/").toLowerCase();
export const pendingClass=p=>{const n=normPending(p);for(const [re,c] of PENDING_SQL_PATTERNS)if(re.test(n))return c;return null};

// Canonical repo-relative POSIX path only. Empty/"."/".." segments, "//", backslashes, drive
// letters, control characters and "|" are refused: they let two spellings of one file dodge the
// duplicate/dependency checks and make the "order|path|sha" pin preimage ambiguous (a path
// containing "\n2|..." could forge a second pin row).
export const safeRel=p=>typeof p==="string"&&p.length>0&&p.length<=512&&
 !/[\\\x00-\x1f\x7f|:]/.test(p)&&!p.startsWith("/")&&
 p.split("/").every(s=>s!==""&&s!=="."&&s!==".."&&s===s.trim());

export const computeOrderedPin=sources=>
 sha(Buffer.from(sources.map((s,i)=>`${i+1}|${s.path}|${s.sha256}`).join("\n")));

const MANAGED_ENV=["DATABASE_URL","SUPABASE_DB_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ACCESS_TOKEN","PGPASSWORD"];
export const managedCredentialsPresent=(env=process.env)=>
 MANAGED_ENV.filter(k=>typeof env[k]==="string"&&env[k].length>0);

// Roots whose every file is pending/review-only SQL. Their bytes are hashed so a renamed or copied
// pending file cannot pass as a clean plan source.
export const PENDING_SQL_ROOTS=Object.freeze(["ops/vox/sql-candidates","ops/vox/quarantined-migrations",
 "ops/vox/identity-attestation-overlay","ops/vox/rc4-approval-overlay","ops/security/sql-candidates"]);

/** Map<sha256, class> of every pending SQL file under `root`, read locally (no network, no execution). */
export function collectPendingShas(root){
 const m=new Map();
 const walk=(abs,rel)=>{
  let ents;try{ents=readdirSync(abs,{withFileTypes:true})}catch{return}
  for(const e of ents){
   const a=resolve(abs,e.name),r=rel+"/"+e.name;
   if(e.isDirectory())walk(a,r);
   else if(e.isFile()&&/\.sql$/i.test(e.name)){
    try{const b=readFileSync(a);if(b.length&&b.length<=MAX_SQL_BYTES){const h=sha(b);if(!m.has(h))m.set(h,pendingClass(r)||"PENDING")}}catch{}
   }
  }
 };
 for(const d of PENDING_SQL_ROOTS)walk(resolve(root,d),d);
 return m;
}

// A destructive plan file may name {rollback:{path,sha256}}: a canonical, readable, pinned file.
function rollbackOk(rb,readBytes){
 if(!rb||!safeRel(rb.path)||!HEX64.test(rb.sha256||""))return false;
 const b=readBytes(rb.path);
 return Buffer.isBuffer(b)&&b.length>0&&sha(b)===rb.sha256;
}

/**
 * Pure evaluation. `readBytes(path)->Buffer|null` supplies local SQL bytes;
 * `localVersions` (optional array) overrides inventory.localVersions;
 * `pendingShas` (optional Map<sha256,class>) marks byte-identical pending SQL.
 */
export function evaluateReleasePreflight({inventory,readBytes,localVersions,pendingShas}){
 const findings=[];
 const add=(code,severity,detail,path)=>findings.push(Object.freeze({code,severity,detail,...(path?{path}:{})}));
 const inv=inventory;
 const valid=inv&&typeof inv==="object"&&inv.schema===INVENTORY_SCHEMA&&Array.isArray(inv.sources)&&inv.sources.length>0;
 if(!valid){
  add("INVENTORY_INVALID","BLOCK","inventory missing, wrong schema, or sources empty");
  return finish(findings,[],null,null);
 }
 const rows=[];
 const seenPath=new Set(),seenVersion=new Set();
 inv.sources.forEach((s,i)=>{
  const path=s&&s.path;
  if(!s||!safeRel(path)){add("SOURCE_PATH_INVALID","BLOCK",`source #${i+1} has an unsafe or missing path`);return}
  const name=path.split("/").at(-1),m=MIG_NAME.exec(name);
  if(!m){add("SOURCE_NAME_INVALID","BLOCK","file name must be <14-digit version>_<name>.sql",path);return}
  // Case-fold: case-insensitive filesystems resolve differently cased paths to one file.
  const folded=path.toLowerCase();
  if(seenPath.has(folded))add("DUPLICATE_PATH","BLOCK","path appears twice (case-insensitive)",path);
  if(seenVersion.has(m[1]))add("DUPLICATE_VERSION","BLOCK","version appears twice",path);
  seenPath.add(folded);seenVersion.add(m[1]);
  const row={order:i+1,path,version:m[1],pinnedSha256:HEX64.test(s.sha256)?s.sha256:null,
   observedSha256:null,bytes:null,dependsOn:Array.isArray(s.dependsOn)?s.dependsOn:[],
   pending:pendingClass(path)};
  if(!row.pinnedSha256)add("SOURCE_PIN_MISSING","HOLD","sha256 pin absent or malformed",path);
  const buf=readBytes(path);
  if(!Buffer.isBuffer(buf)||buf.length===0||buf.length>MAX_SQL_BYTES)add("SOURCE_MISSING","BLOCK","SQL file unreadable, empty or oversized",path);
  else{
   row.observedSha256=sha(buf);row.bytes=buf.length;row.text=buf.toString("utf8");
   if(row.pinnedSha256&&row.pinnedSha256!==row.observedSha256)
    add("SOURCE_SHA_MISMATCH","BLOCK","on-disk SHA256 differs from pin",path);
   const twin=pendingShas&&pendingShas.get(row.observedSha256);
   if(twin&&!row.pending){row.pending=twin;add("PENDING_SQL_BYTE_IDENTICAL","BLOCK",`bytes are identical to pending ${twin} SQL under a different path`,path)}
   const rb=rollbackOk(s.rollback,readBytes);
   for(const l of lintSqlAcl(row.text)){
    if(l.code==="DESTRUCTIVE_DDL_NEEDS_ROLLBACK"&&rb)continue;
    if(l.code==="P0_6_CONTENT"&&!row.pending)row.pending="P0_6";
    add(l.code,l.severity,l.detail,path);
   }
  }
  if(row.pending)add("PENDING_SQL_NOT_ENABLEABLE","BLOCK",`${row.pending} SQL can never be released by this tool`,path);
  rows.push(row);
 });

 // Ordered pin over the exact ordered list.
 let orderedPin=null;
 if(rows.length===inv.sources.length&&rows.every(r=>r.pinnedSha256)){
  orderedPin=computeOrderedPin(rows.map(r=>({path:r.path,sha256:r.pinnedSha256})));
  if(!HEX64.test(inv.orderedSourcePinSha256||""))add("ORDERED_PIN_UNSET","HOLD","orderedSourcePinSha256 absent or malformed");
  else if(inv.orderedSourcePinSha256!==orderedPin)add("ORDERED_PIN_MISMATCH","BLOCK","ordered list digest differs from orderedSourcePinSha256");
 }else add("ORDERED_PIN_UNSET","HOLD","cannot compute ordered pin: some sources unpinned or invalid");

 // Strictly ascending versions in plan order.
 for(let i=1;i<rows.length;i++)
  if(rows[i].version<=rows[i-1].version)add("VERSION_ORDER_VIOLATION","BLOCK",`version not greater than preceding ${rows[i-1].version}`,rows[i].path);

 // Dependencies: explicit dependsOn plus scanned public.vox_* references.
 const orderOf=new Map(rows.map(r=>[r.path,r.order]));
 const external=new Set(Array.isArray(inv.externalObjects)?inv.externalObjects.filter(x=>typeof x==="string"):[]);
 const firstDef=new Map();
 const scans=new Map();
 for(const r of rows)if(r.text!==undefined){
  const sc=scanSqlObjects(r.text);scans.set(r.path,sc);
  for(const d of sc.defs)if(!firstDef.has(d))firstDef.set(d,r.order);
 }
 for(const r of rows){
  for(const d of r.dependsOn){
   const at=typeof d==="string"?orderOf.get(d):undefined;
   if(at===undefined)add("MISSING_DEPENDENCY","BLOCK","dependsOn entry is not an exact canonical path in the ordered plan",r.path);
   else if(at>=r.order)add("DEPENDENCY_ORDER_VIOLATION","BLOCK",`dependsOn ${d} is not earlier in the plan`,r.path);
  }
  const sc=scans.get(r.path);if(!sc)continue;
  for(const ref of sc.refs){
   const at=firstDef.get(ref);
   if(at===undefined){if(!external.has(ref))add("MISSING_DEPENDENCY","BLOCK",`references public.${ref}, created by no plan file and not declared external`,r.path)}
   else if(at>r.order)add("DEPENDENCY_ORDER_VIOLATION","BLOCK",`references public.${ref} created only by later entry #${at}`,r.path);
  }
 }

 // Ledger diff (local capture only).
 const ledgerDiff=ledgerAnalysis({inv,rows,localVersions,add});

 // Canonical consent must be present, pinned and part of the ordered plan.
 const c=inv.consent&&inv.consent.canonical;
 if(!c||c.present!==true)add("CANONICAL_CONSENT_MISSING","HOLD","canonical consent evidence is absent or present!==true");
 else{
  const row=rows.find(r=>r.path===c.bindingPath);
  if(!row)add("CANONICAL_CONSENT_BINDING_NOT_IN_PLAN","HOLD","consent bindingPath is not in the ordered plan");
  else if(!HEX64.test(c.bindingSha256||"")||c.bindingSha256!==row.observedSha256)
   add("CANONICAL_CONSENT_BINDING_SHA_MISMATCH","BLOCK","consent bindingSha256 differs from on-disk SQL",row.path);
 }

 // Approvals must be non-empty and bound to this exact ordered pin.
 const ap=inv.approvals&&typeof inv.approvals==="object"?inv.approvals:{};
 for(const role of APPROVAL_ROLES){
  const a=ap[role];
  if(!a||typeof a.id!=="string"||!a.id.trim())add("APPROVAL_MISSING","HOLD",`approval ${role} absent`);
  else if(!orderedPin||a.orderedSourcePinSha256!==orderedPin)add("APPROVAL_NOT_BOUND_TO_PIN","HOLD",`approval ${role} is not bound to the current ordered pin`);
 }
 return finish(findings,rows,orderedPin,ledgerDiff);
}

function ledgerAnalysis({inv,rows,localVersions,add}){
 const lg=inv.ledger,versions=lg&&Array.isArray(lg.versions)?lg.versions:null;
 if(!versions){add("LEDGER_EVIDENCE_MISSING","HOLD","no local ledger capture supplied");return null}
 const ledgerSet=new Set();
 for(const v of versions){
  const ver=v&&typeof v==="object"?v.version:v;
  if(typeof ver!=="string"||!VERSION.test(ver)){add("LEDGER_MALFORMED","BLOCK","ledger version is not a 14-digit string");return null}
  if(ledgerSet.has(ver)){add("LEDGER_MALFORMED","BLOCK",`ledger repeats ${ver}`);return null}
  ledgerSet.add(ver);
 }
 const head=[...ledgerSet].sort().at(-1)??"";
 for(const r of rows){
  if(ledgerSet.has(r.version))add("VERSION_ALREADY_IN_LEDGER","BLOCK","plan version already recorded in managed ledger",r.path);
  else if(r.version<=head)add("VERSION_BEHIND_LEDGER_HEAD","BLOCK",`plan version not newer than ledger head ${head}`,r.path);
 }
 const lv=Array.isArray(localVersions)?localVersions:Array.isArray(inv.localVersions)?inv.localVersions:null;
 let stagingOnly=null,sourceOnly=null;
 if(!lv||!lv.every(v=>typeof v==="string"&&VERSION.test(v)))
  add("LOCAL_VERSION_INVENTORY_MISSING","HOLD","local migration version inventory absent; cannot prove ledger parity");
 else{
  const local=new Set(lv);
  stagingOnly=[...ledgerSet].filter(v=>!local.has(v)).sort();
  sourceOnly=[...local].filter(v=>!ledgerSet.has(v)).sort();
  if(stagingOnly.length)add("STAGING_ONLY_VERSION_MISMATCH","HOLD",`${stagingOnly.length} managed ledger version(s) have no local source`);
  if(sourceOnly.length)add("SOURCE_ONLY_VERSION_MISMATCH","HOLD",`${sourceOnly.length} local source version(s) are absent from the managed ledger`);
 }
 return Object.freeze({ledgerCount:ledgerSet.size,ledgerHead:head,
  stagingOnly:stagingOnly&&Object.freeze(stagingOnly),sourceOnly:sourceOnly&&Object.freeze(sourceOnly)});
}

function finish(findings,rows,orderedPin,ledgerDiff){
 const blocked=findings.some(f=>f.severity==="BLOCK");
 const decision=findings.length===0?"GO":"HOLD";
 const entries=rows.map(r=>Object.freeze({order:r.order,path:r.path,version:r.version,
  pinnedSha256:r.pinnedSha256,observedSha256:r.observedSha256,bytes:r.bytes,pending:r.pending}));
 // Ordered plan is only ever published on GO, and then as path+sha only.
 const orderedPlan=decision==="GO"?entries.map(e=>Object.freeze({order:e.order,path:e.path,version:e.version,sha256:e.observedSha256})):null;
 const body={schema:REPORT_SCHEMA,decision,blocked,managedCalls:false,executesSql:false,
  emitsSql:false,emitsCommands:false,orderedSourcePinSha256:orderedPin,
  entries,ledgerDiff,findings:[...findings].sort((a,b)=>(a.code+(a.path||"")<b.code+(b.path||"")?-1:1)),
  orderedPlan,
  forbiddenOperations:Object.freeze(["supabase db push","supabase db push --include-all","supabase migration repair",
   "supabase db reset --linked","apply_migration (managed connector)","blanket migration push","enable P0-6 or 7+23 pending SQL"])};
 return Object.freeze({...body,reportSha256:sha(JSON.stringify(body))});
}

/** Fails closed if a report was edited to claim authority it cannot have. */
export function assertReportNonExecuting(r){
 const bad=x=>{throw Error("DDB_REPORT_CLAIMS_AUTHORITY_"+x)};
 if(!r||r.schema!==REPORT_SCHEMA||r.managedCalls!==false||r.executesSql!==false||r.emitsSql!==false||r.emitsCommands!==false)bad("FLAGS");
 if(r.decision==="GO"&&(r.findings.length||r.entries.some(e=>e.pending)))bad("GO_WITH_FINDINGS");
 if(r.decision!=="GO"&&r.orderedPlan!==null)bad("PLAN_WITHOUT_GO");
 const {reportSha256,...rest}=r;
 if(reportSha256!==sha(JSON.stringify(rest)))bad("HASH");
 return true;
}

// ---- CLI ----
const VALUE_FLAGS=new Set(["inventory","root","migrations-dir","out"]);
const DANGEROUS=/^(apply|execute|push|repair|merge|promote|force|go|yes|db-url|linked|skip-gates|bypass|override|sql|migrate|install)$/i;
export function parseArgs(argv){
 const opt={};
 for(let i=0;i<argv.length;i++){
  const t=argv[i];
  if(!t.startsWith("--"))return {error:"UNEXPECTED_ARGUMENT"};
  const k=t.slice(2);
  if(DANGEROUS.test(k))return {error:`FORBIDDEN_FLAG_--${k}`};
  if(!VALUE_FLAGS.has(k)||i+1>=argv.length||argv[i+1].startsWith("--"))return {error:`UNKNOWN_OR_VALUELESS_FLAG_--${k}`};
  opt[k]=argv[++i];
 }
 return opt.inventory?{opt}:{error:"INVENTORY_REQUIRED"};
}
export function run(argv,{env=process.env}={}){
 const present=managedCredentialsPresent(env);
 if(present.length)return {code:64,stderr:`DDB_PREFLIGHT_REFUSED managed credentials present in environment: ${present.join(",")}\n`};
 const parsed=parseArgs(argv);
 if(parsed.error)return {code:64,stderr:`DDB_PREFLIGHT_USAGE ${parsed.error}\n`};
 const {opt}=parsed;
 const root=resolve(opt.root??repoRoot);
 const inventory=JSON.parse(readFileSync(resolve(opt.inventory),"utf8").replace(/^﻿/,""));
 const readBytes=p=>{
  const abs=resolve(root,p);
  if(abs!==root&&!abs.startsWith(root+sep))return null;
  try{if(!statSync(abs).isFile())return null;return readFileSync(abs)}catch{return null}
 };
 let localVersions;
 if(opt["migrations-dir"]){
  localVersions=readdirSync(resolve(root,opt["migrations-dir"])).map(n=>MIG_NAME.exec(n)?.[1]).filter(Boolean).sort();
 }
 const report=evaluateReleasePreflight({inventory,readBytes,localVersions,pendingShas:collectPendingShas(root)});
 assertReportNonExecuting(report);
 if(opt.out){
  const abs=resolve(opt.out),low=abs.toLowerCase();
  const banned=["supabase","ops","contracts"].map(d=>resolve(repoRoot,d).toLowerCase()+sep);
  if(!low.endsWith(".json")||banned.some(b=>low.startsWith(b)))return {code:64,stderr:"DDB_PREFLIGHT_USAGE OUTPUT_PATH_NOT_ALLOWED\n"};
  writeFileSync(abs,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
 }
 return {code:report.decision==="GO"?0:2,stdout:JSON.stringify(report,null,2)+"\n"};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const r=run(process.argv.slice(2));
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  process.exitCode=r.code;
 }catch(e){
  process.stderr.write(`DDB_PREFLIGHT_ERROR ${e instanceof Error?e.message:String(e)}\n`);
  process.exitCode=70;
 }
}
