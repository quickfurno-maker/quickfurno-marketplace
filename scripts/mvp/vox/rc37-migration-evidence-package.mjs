#!/usr/bin/env node
// RC37 d-db: deterministic migration evidence package (offline, read-only).
// Imports a managed ledger export from a local JSON file (never connects), hashes the
// real SQL files on disk, applies explicitly verified aliases and reconciles via RC35.
// Fails closed when SQL is absent/empty. `releaseGo` is always false: the package is
// DBA review input, not a deploy or release authorization. No timestamps in the hash.
import {readFileSync,writeFileSync,readdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {canonicalSqlDigest,reconcileInventories,normaliseManagedInventory} from "./rc35-migration-inventory-reconcile.mjs";

export const RC37_SCHEMA="qf.vox.rc37.migration-evidence-package.v1";
const FILE_RE=/^(\d{14})_([\w-]+)\.sql$/;
const DIGEST_RE=/^[0-9a-f]{64}$/;
const VERSION_RE=/^\d{14}$/;
const sha=b=>createHash("sha256").update(b).digest("hex");
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const bad=code=>{throw Error("RC37_"+code)};
// Credentials must never ride along in a metadata export.
const SECRET_RE=/postgres(?:ql)?:\/\/[^\s"'@]*:[^\s"'@]+@|eyJ[\w-]{20,}\.[\w-]{10,}\.|sk_(?:live|test)_\w{8,}|service_role/i;

// Digest of what the ledger applied: statements normalised to one `;`-terminated line
// each, then canonicalSqlDigest. A source file matches only if its canonical text equals it.
export function canonicalStatementsDigest(statements){
 if(!Array.isArray(statements)||!statements.length)bad("MANAGED_STATEMENTS_EMPTY");
 const parts=statements.map(s=>{
  if(typeof s!=="string")bad("MANAGED_STATEMENT_INVALID");
  const t=s.replace(/\r\n/g,"\n").trim().replace(/;+\s*$/,"").trim();
  if(!t)bad("MANAGED_STATEMENT_EMPTY");
  return t+";";
 });
 return canonicalSqlDigest(parts.join("\n"));
}

// Source side: real bytes from disk only. Empty/whitespace-only SQL is rejected.
export function buildSourceEvidenceFromDir(dir){
 const names=readdirSync(dir).filter(n=>FILE_RE.test(n)).sort();
 if(!names.length)bad("SOURCE_SQL_ABSENT");
 const files=names.map(n=>{
  const text=readFileSync(join(dir,n),"utf8");
  if(!text.trim())bad("SOURCE_SQL_EMPTY:"+n);
  const canonical=text.replace(/\r\n/g,"\n").replace(/\s+$/,"")+"\n";
  return {file:n,canonicalSha256:canonicalSqlDigest(text),canonicalBytes:Buffer.byteLength(canonical)};
 });
 return {files};
}

// Managed side: read-only import of an export file. Entries need `statements` (array of
// SQL strings, as in supabase_migrations.schema_migrations) or an explicit digest.
export function importManagedLedger(text){
 if(SECRET_RE.test(text))bad("SECRET_IN_INPUT");
 let input;try{input=JSON.parse(text);}catch{bad("MANAGED_JSON_INVALID");}
 const list=Array.isArray(input)?input:Array.isArray(input?.migrations)?input.migrations
  :input?.environments?.staging?.migrations;
 if(!Array.isArray(list))bad("MANAGED_LEDGER_SHAPE");
 const entries=list.map(e=>{
  const base={version:e?.version,name:e?.name};
  if(e&&e.statements!==undefined){
   return {...base,statementsSha256:canonicalStatementsDigest(e.statements),
    digestBasis:"LEDGER_STATEMENTS",statementCount:e.statements.length};
  }
  const d=e?.statementsSha256??e?.statements_sha256;
  if(d!==undefined&&d!==null&&d!==""){
   if(!DIGEST_RE.test(d))bad("DIGEST_MALFORMED");
   return {...base,statementsSha256:d,digestBasis:"DECLARED_DIGEST",statementCount:null};
  }
  return {...base,digestBasis:"NONE",statementCount:null};
 });
 normaliseManagedInventory(entries); // shape/duplicate validation
 return entries.sort((a,b)=>cmp(a.version,b.version));
}

// Alias file: [{managedVersion,sourceFile,managedSha256,sourceSha256,verifiedBy,basis}].
// An alias is honoured only when both recorded digests equal the recomputed ones.
export function validateAliases(aliasInput,managed,sourceFiles){
 const list=aliasInput===undefined?[]:Array.isArray(aliasInput)?aliasInput:aliasInput?.aliases;
 if(!Array.isArray(list))bad("ALIAS_SHAPE");
 const mByV=new Map(managed.map(m=>[m.version,m]));
 const sByF=new Map(sourceFiles.map(s=>[s.file,s]));
 const seenV=new Set(),seenF=new Set(),out=[];
 for(const a of list){
  if(!a||!VERSION_RE.test(a.managedVersion||"")||!FILE_RE.test(a.sourceFile||""))bad("ALIAS_ENTRY_INVALID");
  for(const k of ["verifiedBy","basis"])if(typeof a[k]!=="string"||!a[k].trim())bad("ALIAS_ATTESTATION_MISSING");
  if(seenV.has(a.managedVersion)||seenF.has(a.sourceFile))bad("ALIAS_DUPLICATE");
  seenV.add(a.managedVersion);seenF.add(a.sourceFile);
  const m=mByV.get(a.managedVersion),s=sByF.get(a.sourceFile);
  if(!m)bad("ALIAS_MANAGED_UNKNOWN");
  if(!s)bad("ALIAS_SOURCE_UNKNOWN");
  if(!m.statementsSha256)bad("ALIAS_MANAGED_DIGEST_ABSENT");
  if(!DIGEST_RE.test(a.managedSha256||"")||!DIGEST_RE.test(a.sourceSha256||""))bad("DIGEST_MALFORMED");
  if(a.managedSha256!==m.statementsSha256||a.sourceSha256!==s.canonicalSha256||m.statementsSha256!==s.canonicalSha256)
   bad("ALIAS_DIGEST_UNVERIFIED");
  out.push({managedVersion:a.managedVersion,managedName:m.name,sourceFile:a.sourceFile,
   sha256:s.canonicalSha256,verifiedBy:a.verifiedBy.trim(),basis:a.basis.trim()});
 }
 return out.sort((a,b)=>cmp(a.managedVersion,b.managedVersion));
}

export function buildEvidencePackage({managedText,sourceDir,aliasInput}){
 const managed=importManagedLedger(managedText);
 const source=buildSourceEvidenceFromDir(sourceDir);
 const aliases=validateAliases(aliasInput,managed,source.files);
 const aliasMap=new Map(aliases.map(a=>[a.managedVersion,a.sourceFile]));
 const report=reconcileInventories(managed,source,aliasMap);
 const missingStatements=managed.filter(m=>m.digestBasis!=="LEDGER_STATEMENTS").map(m=>m.version);
 const evidenceBlockers=missingStatements.map(v=>({code:"MANAGED_SQL_NOT_IMPORTED",subject:v,
  detail:"no ledger statements; digest is "+(managed.find(m=>m.version===v).digestBasis==="NONE"?"absent":"declared only")}));
 const body={
  schema:RC37_SCHEMA,
  releaseGo:false,goStatus:"NO_GO_EVIDENCE_ONLY",
  managedWrites:false,executesSql:false,connectsToManaged:false,promotesProtectedSql:false,
  requiresIndependentDbaDecision:true,
  counts:{managed:managed.length,sourceFiles:source.files.length,verifiedAliases:aliases.length,
   managedWithImportedStatements:managed.length-missingStatements.length},
  managed:managed.map(m=>({version:m.version,name:m.name,digestBasis:m.digestBasis,
   statementCount:m.statementCount,statementsSha256:m.statementsSha256??null})),
  source:source.files,
  verifiedAliases:aliases,
  reconciliation:report,
  evidenceBlockers,
  evidenceComplete:report.reconciled&&!evidenceBlockers.length
 };
 return Object.freeze({...body,packageSha256:sha(JSON.stringify(body))});
}

// Re-derive from the same inputs and compare to a stored package.
export function verifyEvidencePackage(stored,args){
 const fresh=buildEvidencePackage(args);
 if(stored?.schema!==RC37_SCHEMA)bad("PACKAGE_SCHEMA");
 if(stored.releaseGo!==false)bad("PACKAGE_GO_FORBIDDEN");
 const {packageSha256,...body}=stored;
 if(sha(JSON.stringify(body))!==packageSha256)bad("PACKAGE_TAMPERED");
 if(fresh.packageSha256!==packageSha256)bad("PACKAGE_STALE_VS_INPUTS");
 return fresh;
}

const USAGE="usage: rc37-migration-evidence-package.mjs --managed <ledger-export.json> --source-dir <dir> [--aliases <aliases.json>] [--out <package.json>] [--verify <package.json>]";
export function runCli(argv,io={log:console.log,err:console.error}){
 const arg=n=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:undefined};
 const [mp,sd,ap,out,vp]=["--managed","--source-dir","--aliases","--out","--verify"].map(arg);
 if(!mp||!sd){io.err(USAGE);return 1;}
 try{
  const args={managedText:readFileSync(resolve(mp),"utf8"),sourceDir:resolve(sd),
   aliasInput:ap?JSON.parse(readFileSync(resolve(ap),"utf8")):undefined};
  const pkg=vp?verifyEvidencePackage(JSON.parse(readFileSync(resolve(vp),"utf8")),args):buildEvidencePackage(args);
  const text=JSON.stringify(pkg,null,2)+"\n";
  if(out&&!vp)writeFileSync(resolve(out),text);else if(!vp)io.log(text.trimEnd());
  else io.log("RC37 package verified: "+pkg.packageSha256);
  return pkg.evidenceComplete?0:2; // 0 = evidence complete (still never a GO)
 }catch(e){io.err(String(e.message||e));return 1;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runCli(process.argv.slice(2));
