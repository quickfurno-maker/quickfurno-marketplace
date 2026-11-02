#!/usr/bin/env node
// RC4 Track E release PLAN CLI. PLAN ONLY and always a dry run: it reads local files, prints a report,
// and optionally writes one new .json file. It never connects to a database, never reads credentials or
// environment, never runs SQL, never repairs a ledger, and never merges or promotes a PR.
//
//   node rc4-release-plan.mjs plan     --head-sha <40hex> [--ledger l.json] [--out report.json] [--dry-run]
//   node rc4-release-plan.mjs evaluate --head-sha <40hex> [--ledger l.json] --evidence e.json [--out report.json]
//
// Exit codes: 0 plan emitted (HOLD/consistent, never "ready"), 2 FAIL, 64 usage/forbidden flag, 70 error.
import {readFileSync,writeFileSync} from "node:fs";
import {dirname,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {buildRc4ReleasePlan,diskReader} from "../../../contracts/vox/rc4ReleasePlan.mjs";
import {evaluateRc4Release} from "../../../contracts/vox/rc4ReleaseGates.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const VALUE_FLAGS=new Set(["head-sha","ledger","evidence","out"]);
const BOOL_FLAGS=new Set(["dry-run"]);
const DANGEROUS=/^(apply|execute|push|repair|merge|promote|force|go|yes|db-url|linked|skip-gates|bypass|override|sql|migrate|install)$/i;

export function parseArgs(argv){
 const [cmd,...rest]=argv,opt={};
 for(let i=0;i<rest.length;i++){
  const t=rest[i];
  if(!t.startsWith("--"))return {error:"UNEXPECTED_ARGUMENT"};
  const k=t.slice(2);
  if(DANGEROUS.test(k))return {error:`FORBIDDEN_FLAG_--${k}`};
  if(BOOL_FLAGS.has(k)){opt[k]=true;continue}
  if(!VALUE_FLAGS.has(k)||i+1>=rest.length||rest[i+1].startsWith("--"))return {error:`UNKNOWN_OR_VALUELESS_FLAG_--${k}`};
  opt[k]=rest[++i];
 }
 return {cmd,opt};
}

const readJson=p=>JSON.parse(readFileSync(resolve(p),"utf8").replace(/^﻿/,"").trim());
function writeReport(out,report){
 const abs=resolve(out),low=abs.toLowerCase();
 const banned=["supabase","ops","contracts"].map(d=>resolve(root,d).toLowerCase()+sep);
 if(!low.endsWith(".json")||banned.some(b=>low.startsWith(b)))throw new Error("OUTPUT_PATH_NOT_ALLOWED");
 writeFileSync(abs,JSON.stringify(report,null,2)+"\n",{flag:"wx"}); // refuses to overwrite
}

export function run(argv,{now=Date.now()}={}){
 const parsed=parseArgs(argv);
 if(parsed.error||!["plan","evaluate"].includes(parsed.cmd))
  return {code:64,stderr:`RC4_RELEASE_USAGE ${parsed.error??"unknown command"}\n`};
 const {opt,cmd}=parsed;
 const ledger=opt.ledger?readJson(opt.ledger):undefined;
 const plan=buildRc4ReleasePlan({fs:diskReader(root),headSha:opt["head-sha"],ledger});
 let report=plan;
 if(cmd==="evaluate"){
  if(!opt.evidence)return {code:64,stderr:"RC4_RELEASE_USAGE evaluate requires --evidence\n"};
  report={plan:{planStatus:plan.planStatus,ledgerState:plan.ledgerState,planDigest:plan.planDigest,findings:plan.findings},
   gates:evaluateRc4Release({plan,evidence:readJson(opt.evidence),nowMs:now})};
 }
 if(opt.out)writeReport(opt.out,report);
 const failed=cmd==="plan"?plan.planStatus==="FAIL":report.gates.verdict==="FAIL";
 return {code:failed?2:0,stdout:JSON.stringify(report,null,2)+"\n"};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const r=run(process.argv.slice(2));
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  process.exitCode=r.code;
 }catch(e){
  process.stderr.write(`RC4_RELEASE_ERROR ${e instanceof Error?e.message:String(e)}\n`);
  process.exitCode=70;
 }
}
