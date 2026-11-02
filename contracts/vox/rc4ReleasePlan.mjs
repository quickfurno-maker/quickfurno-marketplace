import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {RC4_PINS} from "./rc4ReleasePins.mjs";
// RC4 Track E release PLAN builder. Pure inspection: reads bytes, hashes them, reports findings.
// It never executes SQL, never repairs a ledger, never talks to a database or the network, and the
// result can never say canApply or migrationReady. Absence of evidence is always a HOLD.
export const sha256=b=>createHash("sha256").update(b).digest("hex");
const HEX64=/^[a-f0-9]{64}$/;
const SHA40=/^[a-f0-9]{40}$/;
const MIG=/^(\d{14})_[\w-]+\.sql$/;
const VERSION=/^\d{14}$/;

export const FORBIDDEN_COMMAND_PATTERNS=Object.freeze([
 [/\bsupabase\s+db\s+push\b/i,"BLANKET_DB_PUSH"],
 [/\bsupabase\s+migration\s+(repair|up|squash)\b/i,"LEDGER_OR_MIGRATION_MUTATION"],
 [/\bsupabase\s+db\s+(reset|remote)\b/i,"DB_RESET_OR_REMOTE"],
 [/\bsupabase\s+(link|login)\b/i,"MANAGED_PROJECT_LINK"],
 [/\bpsql\b[^\n]*(\s-f\b|\s--file\b|\s-c\b|\s--command\b)/i,"DIRECT_SQL_EXECUTION"],
 [/\bpg_restore\b[^\n]*--(clean|create)\b/i,"DESTRUCTIVE_RESTORE"],
 [/\bgh\s+pr\s+(merge|ready)\b/i,"PR_PROMOTION"],
 [/\bgit\s+(push|merge)\b/i,"GIT_MUTATION"]
]);
/** Returns {allowed:false,code} for any command that would execute SQL, touch the ledger or promote a PR. */
export function classifyCommand(command){
 if(typeof command!=="string"||!command.trim())return Object.freeze({allowed:false,code:"EMPTY_OR_INVALID_COMMAND"});
 for(const [re,code] of FORBIDDEN_COMMAND_PATTERNS)if(re.test(command))return Object.freeze({allowed:false,code});
 return Object.freeze({allowed:false,code:"NO_COMMAND_IS_AUTHORIZED_BY_THIS_PLAN"});
}

/** Read-only file access. Returns null instead of throwing so every miss becomes a finding. */
export function diskReader(root){
 if(typeof root!=="string"||!root)throw new Error("INVALID_ROOT");
 return Object.freeze({
  read:p=>{try{return readFileSync(resolve(root,p))}catch{return null}},
  list:p=>{try{return readdirSync(resolve(root,p))}catch{return null}}
 });
}

const safeRel=p=>typeof p==="string"&&p.length>0&&!p.includes("..")&&!p.includes("\\")&&
 !p.startsWith("/")&&!/^[a-z]:/i.test(p);

/** Strip SQL comments, then extract VOX object definitions and public.vox_* references. */
export function scanSqlObjects(text){
 const src=String(text).replace(/\/\*[\s\S]*?\*\//g,"").replace(/--[^\n]*/g,"").toLowerCase();
 const defs=new Set(),refs=new Set();
 const def=/\bcreate\s+(?:or\s+replace\s+)?(?:unlogged\s+)?(?:table|view|materialized\s+view|function|procedure|type|sequence)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?((?:qf_)?vox_[a-z0-9_]+)/g;
 const ref=/\bpublic\."?((?:qf_)?vox_[a-z0-9_]+)/g;
 for(let m;(m=def.exec(src));)defs.add(m[1]);
 for(let m;(m=ref.exec(src));)refs.add(m[1]);
 return Object.freeze({defs:[...defs].sort(),refs:[...refs].sort()});
}

function validateLedger(ledger,entries,pins,add){
 if(ledger===undefined||ledger===null){add("LEDGER_EVIDENCE_MISSING","HOLD","no read-only Staging ledger evidence supplied");return "MISSING"}
 const versions=Array.isArray(ledger.versions)?ledger.versions:null;
 if(!versions||!versions.every(v=>typeof v==="string"&&VERSION.test(v))){
  add("LEDGER_MALFORMED","BLOCK","ledger.versions must be an array of 14-digit strings");return "BLOCKED"}
 if(ledger.projectRef!==pins.stagingProjectRef){
  add("LEDGER_PROJECT_MISMATCH","BLOCK","ledger evidence is not bound to the authorized Staging project");return "BLOCKED"}
 if(ledger.appliedCount!==versions.length||new Set(versions).size!==versions.length){
  add("LEDGER_INCONSISTENT","BLOCK","appliedCount disagrees with version list or versions repeat");return "BLOCKED"}
 const latest=[...versions].sort().at(-1)??"";
 let state="MATCH";
 if(latest<pins.stagingLedger.latestVersion||versions.length<pins.stagingLedger.appliedCount){
  add("LEDGER_STALE_OLD_VERSION","BLOCK",`ledger ${versions.length}/${latest} is older than pinned ${pins.stagingLedger.appliedCount}/${pins.stagingLedger.latestVersion}`);state="BLOCKED"}
 else if(versions.length!==pins.stagingLedger.appliedCount||latest!==pins.stagingLedger.latestVersion){
  add("LEDGER_DRIFT","HOLD",`live ledger ${versions.length}/${latest} differs from pinned ${pins.stagingLedger.appliedCount}/${pins.stagingLedger.latestVersion}; DBA must re-reconcile and re-pin`);state="DRIFT"}
 const have=new Set(versions);
 for(const e of entries){
  if(!e.version)continue;
  if(have.has(e.version)){add("VERSION_ALREADY_IN_LEDGER","BLOCK","version is already recorded as applied or aliased in Staging",e.path);state="BLOCKED"}
  else if(e.version<=latest){add("VERSION_BEHIND_LEDGER_HEAD","BLOCK",`version is not newer than ledger head ${latest}`,e.path);state="BLOCKED"}
 }
 return state;
}

/**
 * Build the deterministic RC4 plan: P0-6, then 7 quarantined, then 23 candidates, then the review-only
 * overlay. `fs` is {read(relPath)->Buffer|null, list(relDir)->string[]|null}.
 */
export function buildRc4ReleasePlan({fs,pins=RC4_PINS,headSha,ledger}={}){
 const findings=[];
 const add=(code,severity,detail,path)=>findings.push(Object.freeze({code,severity,detail,...(path?{path}:{})}));
 const entries=[],texts=new Map();
 try{
  if(!fs||typeof fs.read!=="function"||typeof fs.list!=="function")throw new Error("INVALID_READER");
  if(typeof headSha!=="string"||!SHA40.test(headSha))add("HEAD_SHA_NOT_SUPPLIED","HOLD","a 40-hex head SHA is required to bind the plan to RC3");
  else if(headSha!==pins.rc3BaseSha)add("BASE_SHA_MISMATCH","BLOCK",`head ${headSha} is not the pinned RC3 base ${pins.rc3BaseSha}`);

  // P0-6 first. PR #435 is not in this tree, so an unpinned slot is a HOLD, never a skip.
  const p=pins.p06;
  if(!p||p.path===null||p.path===undefined){
   entries.push({order:1,stage:"P0_6",path:null,version:null,sha256:null,bytes:null,pinnedSha256:null,status:"UNPINNED"});
   add("P0_6_UNPINNED","HOLD","PR #435 P0-6 source is not present or pinned in this tree; a human must pin path, sha256 and bytes");
  }else addFile(entries,texts,fs,add,{order:1,stage:"P0_6",path:p.path,sha:p.sha256,bytes:p.bytes,pinned:true});

  // The reviewed 7 + 23 from the committed fingerprint, each re-hashed from disk.
  const s=pins.source30;
  const fpBytes=fs.read(s.fingerprintPath);
  let fp=null;
  if(!fpBytes)add("FINGERPRINT_MISSING","BLOCK","reviewed source fingerprint is missing",s.fingerprintPath);
  else{try{fp=JSON.parse(fpBytes.toString("utf8").replace(/^﻿/,""))}catch{add("FINGERPRINT_UNPARSEABLE","BLOCK","fingerprint is not valid JSON",s.fingerprintPath)}}
  let source30Complete=false;
  if(fp){
   if(fp.manifestDigest!==s.manifestDigest)add("FINGERPRINT_DIGEST_PIN_MISMATCH","BLOCK","fingerprint manifestDigest does not equal the pinned digest",s.fingerprintPath);
   const want=s.quarantined.count+s.candidates.count;
   const files=Array.isArray(fp.files)?fp.files:[];
   if(files.length!==want)add("FINGERPRINT_FILE_COUNT","BLOCK",`expected ${want} files, found ${files.length}`,s.fingerprintPath);
   const plan30=[];
   files.forEach((f,i)=>{
    const quarantined=i<s.quarantined.count;
    const stage=quarantined?"QUARANTINED_FOUNDATION":"UNINSTALLED_CANDIDATE";
    const dir=quarantined?s.quarantined.dir:s.candidates.dir;
    const name=typeof f?.path==="string"?f.path.slice(dir.length+1):"";
    if(!f||f.order!==i+1||f.stage!==stage||!safeRel(f.path)||f.path!==`${dir}/${name}`||!MIG.test(name)||!HEX64.test(f.sha256)){
     add("FINGERPRINT_ENTRY_INVALID","BLOCK",`entry ${i+1} has wrong order, stage, path or hash`,s.fingerprintPath);return}
    plan30.push({order:i+2,stage,path:f.path,sha:f.sha256,bytes:f.bytes,pinned:true});
   });
   for(const f of plan30)addFile(entries,texts,fs,add,f);
   // Directory contents must equal the pinned names, in pinned order.
   for(const [dir,count,stage] of [[s.quarantined.dir,s.quarantined.count,"QUARANTINED_FOUNDATION"],[s.candidates.dir,s.candidates.count,"UNINSTALLED_CANDIDATE"]]){
    const listed=fs.list(dir);
    if(!listed){add("SOURCE_DIR_UNREADABLE","BLOCK","cannot list source directory",dir);continue}
    const actual=listed.filter(n=>MIG.test(n)).sort();
    const pinned=plan30.filter(f=>f.stage===stage).map(f=>f.path.slice(dir.length+1));
    for(const n of actual)if(!pinned.includes(n))add("UNEXPECTED_SQL_FILE","BLOCK","SQL file is not in the reviewed fingerprint",`${dir}/${n}`);
    for(const n of pinned)if(!actual.includes(n))add("MISSING_SQL_FILE","BLOCK","reviewed SQL file is absent",`${dir}/${n}`);
    if(actual.length===count&&JSON.stringify(actual)!==JSON.stringify(pinned))add("ORDER_MISMATCH","BLOCK","sorted filenames differ from the pinned order",dir);
   }
   // Independent recomputation: fingerprint and SQL cannot both be swapped consistently.
   const e30=entries.filter(e=>e.order>1&&e.stage!=="REVIEW_ONLY_OVERLAY");
   source30Complete=e30.length===want&&e30.every(e=>e.sha256);
   if(source30Complete){
    const digest=sha256(Buffer.from(e30.map((e,i)=>`${i+1}|${e.path}|${e.sha256}`).join("\n")));
    if(digest!==s.manifestDigest)add("SOURCE30_DIGEST_MISMATCH","BLOCK","recomputed digest of the 30 on-disk files differs from the pin");
   }
  }

  // Review-only overlay, last. Its hash is reported but only a human pin makes it acceptable.
  const o=pins.overlay,opath=`${o.dir}/${o.file}`;
  addFile(entries,texts,fs,add,{order:entries.length+1,stage:"REVIEW_ONLY_OVERLAY",path:opath,sha:o.sha256,bytes:o.bytes,pinned:o.sha256!==null,reviewOnly:true});
  if(o.sha256===null)add("OVERLAY_SHA_UNPINNED","HOLD","overlay sha256 is not pinned by a human; observed hash is reported but not accepted",opath);
  const olist=fs.list(o.dir);
  if(!olist)add("SOURCE_DIR_UNREADABLE","BLOCK","cannot list overlay directory",o.dir);
  else for(const n of olist.filter(n=>MIG.test(n)&&n!==o.file))add("UNEXPECTED_OVERLAY_FILE","BLOCK","unreviewed SQL in overlay directory",`${o.dir}/${n}`);
  if(!entries.some(e=>e.path&&e.path.endsWith(o.requiresPathIncludes)))
   add("OVERLAY_DEPENDENCY_MISSING","BLOCK",`overlay requires ${o.requiresPathIncludes} earlier in the plan`,opath);

  // Versions must be unique and strictly ascending in plan order.
  let prev="";const seen=new Set();
  for(const e of entries){
   if(!e.version)continue;
   if(seen.has(e.version))add("DUPLICATE_VERSION","BLOCK","version appears twice in the plan",e.path);
   else if(e.version<=prev)add("VERSION_ORDER_VIOLATION","BLOCK",`version is not greater than preceding ${prev}`,e.path);
   seen.add(e.version);if(e.version>prev)prev=e.version;
  }

  // Dependent SQL: every public.vox_* reference must be defined by the same or an earlier entry.
  const first=new Map(),scans=new Map();
  for(const e of entries){
   if(!texts.has(e.path))continue;
   const sc=scanSqlObjects(texts.get(e.path));scans.set(e.path,sc);
   for(const d of sc.defs)if(!first.has(d))first.set(d,e.order);
  }
  for(const e of entries){
   const sc=scans.get(e.path);if(!sc)continue;
   for(const r of sc.refs){
    const at=first.get(r);
    if(at===undefined)add("MISSING_DEPENDENCY","BLOCK",`references public.${r}, which no plan file creates`,e.path);
    else if(at>e.order)add("DEPENDENCY_ORDER_VIOLATION","BLOCK",`references public.${r} created only by a later entry (#${at})`,e.path);
   }
  }

  // A plan file inside supabase/migrations would be picked up by a blanket db push.
  const mig=fs.list(pins.migrationsDir);
  if(!mig)add("MIGRATIONS_DIR_UNREADABLE","HOLD","cannot confirm supabase/migrations holds none of the plan files");
  else for(const e of entries){
   const name=e.path?e.path.split("/").at(-1):null;
   if(name&&mig.some(n=>n===name||(e.version&&n.startsWith(e.version+"_"))))
    add("PLAN_FILE_IN_SUPABASE_MIGRATIONS","BLOCK","plan SQL is present in supabase/migrations and could be pushed in bulk",e.path);
  }
 }catch(err){
  add("PLAN_INTERNAL_ERROR","BLOCK",err instanceof Error?err.message:"UNKNOWN");
 }
 const ledgerState=validateLedger(ledger,entries,pins,add);
 const listing=["RC4-PLAN-V1",pins.rc3BaseSha,...entries.map(e=>[e.order,e.stage,e.path??"-",e.sha256??"UNPINNED"].join("|"))].join("\n");
 const planStatus=findings.some(f=>f.severity==="BLOCK")?"FAIL":findings.length?"HOLD":"CONSISTENT";
 return Object.freeze({
  schema:"qf.vox.rc4.release-plan.v1",mode:"PLAN_ONLY",
  executesSql:false,canApply:false,migrationReady:false,
  baseSha:pins.rc3BaseSha,headSha:typeof headSha==="string"?headSha:null,
  planStatus,ledgerState,planDigest:sha256(Buffer.from(listing)),
  entries:Object.freeze(entries.map(e=>Object.freeze(e))),
  findings:Object.freeze(findings),
  rollback:rollbackPlan(entries),
  forbiddenCommands:Object.freeze(["supabase db push","supabase migration repair","supabase db reset","psql -f","git push","gh pr merge"])
 });
}

function addFile(entries,texts,fs,add,f){
 const name=f.path.split("/").at(-1),m=MIG.exec(name);
 const e={order:f.order,stage:f.stage,path:f.path,version:m?m[1]:null,sha256:null,bytes:null,
  pinnedSha256:f.sha??null,status:"PENDING",...(f.reviewOnly?{reviewOnly:true}:{})};
 entries.push(e);
 if(!safeRel(f.path)||!m){e.status="INVALID_PATH";add("INVALID_PLAN_PATH","BLOCK","path is not a safe relative migration filename",f.path);return}
 const bytes=fs.read(f.path);
 if(!bytes){e.status="MISSING";add("FILE_MISSING","BLOCK","planned file cannot be read",f.path);return}
 e.sha256=sha256(bytes);e.bytes=bytes.length;texts.set(f.path,bytes.toString("utf8"));
 const text=texts.get(f.path).toLowerCase();
 if(!text.includes("begin;")||!text.includes("commit;"))add("NOT_TRANSACTIONAL_SOURCE","BLOCK","file lacks an explicit begin; / commit; pair",f.path);
 if(!f.pinned)e.status="UNPINNED";
 else if(e.sha256!==f.sha){e.status="HASH_MISMATCH";add("HASH_MISMATCH","BLOCK",`sha256 ${e.sha256} differs from pinned ${f.sha}`,f.path)}
 else if(f.bytes!==undefined&&f.bytes!==null&&f.bytes!==e.bytes){e.status="BYTES_MISMATCH";add("BYTES_MISMATCH","BLOCK",`size ${e.bytes} differs from pinned ${f.bytes}`,f.path)}
 else e.status="HASH_OK";
}

/** Explicit rollback. There is no authored down SQL: recovery is restoring a verified backup, in reverse order. */
function rollbackPlan(entries){
 return Object.freeze({
  strategy:"RESTORE_FROM_VERIFIED_FULL_FIDELITY_BACKUP",
  downMigrationsAuthored:false,handWrittenDropForbidden:true,executableSql:null,
  reverseOrder:Object.freeze(entries.filter(e=>e.path).map(e=>e.path).reverse()),
  requires:Object.freeze([
   "backup includes owners, ACLs, default privileges and roles",
   "restore rehearsed on a disposable non-managed database with an explained catalog comparison",
   "rollback plan sha256 bound into the DBA-signed backup attestation"
  ])
 });
}
