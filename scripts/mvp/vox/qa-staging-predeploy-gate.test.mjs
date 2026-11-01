// VOX staging pre-deployment gate (fail-closed) + its own negative regression.
// Run by .github/workflows/vox-staging-predeploy-gate.yml on EVERY pull request (no path filter, so it
// can be a required status check) and runnable locally: node --test scripts/mvp/vox/qa-staging-predeploy-gate.test.mjs
//
// What it refuses (any violation fails; a missing file, constant, flag or digest is a violation, never a skip):
//  1. Source hard-off switches (Finance/EOD/signer/outreach writers and senders) must stay literally `false`.
//  2. Protected routes must keep their default-off, exact-match "staging" env gate; official EOD publish must keep
//     its writer-not-installed check ahead of any env flag.
//  3. Env templates and every workflow must not set a protected Finance / EOD / outreach flag to an enabling value,
//     and the templates must keep the outreach flags explicit and off.
//  4. No live credentials in the CI environment, env templates or workflows; no `secrets.*` context or
//     `pull_request_target` in VOX workflows.
//  5. The generated RC38 staged-migration digest (offline sample) must be well-formed SHA-256, recompute to the
//     same value, be deterministic, and keep releaseGo=false with no managed connection or SQL execution.
//  6. The gate workflow itself must stay always-on for pull requests, read-only, SHA-pinned and invoke this file.
// Enabling any protected flag for Staging needs a separate, independently approved change that also updates this
// gate's expectations; this gate never mutates Staging or opens a connection.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync,existsSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {runCli} from "./rc38-migration-staged-dryrun.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const diskRead=p=>{const f=resolve(root,p);return existsSync(f)?readFileSync(f,"utf8"):null;};
const WORKFLOW_DIR=".github/workflows";
const GATE_WORKFLOW=WORKFLOW_DIR+"/vox-staging-predeploy-gate.yml";
const GATE_TEST="scripts/mvp/vox/qa-staging-predeploy-gate.test.mjs";
const ENV_TEMPLATES=[".env.example","apps/vox-web/.env.example"];
const workflowFiles=(read=diskRead,list=()=>readdirSync(resolve(root,WORKFLOW_DIR)))=>
 list().filter(f=>/\.ya?ml$/.test(f)).sort().map(f=>WORKFLOW_DIR+"/"+f).map(p=>[p,read(p)]);
const sha256=s=>createHash("sha256").update(s).digest("hex");
const HEX64=/^[0-9a-f]{64}$/;

// ---- 1. source hard-off switches ----
export const HARD_OFF=Object.freeze([
 ["contracts/vox/rc4ApprovalPipeline.mjs","RC4_OFFICIAL_EOD_ENABLED"],
 ["scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs","RC8_APPROVAL_WRITER_INSTALLED"],
 ["services/vox/rc8PgVendorConversationOperator.ts","RC8_CORE_WRITER_INSTALLED"],
 ["services/vox/rc19VerifiedConversationWriter.ts","RC19_VERIFIED_CORE_WRITER_INSTALLED"],
 ["services/vox/rc26CoreCommitReconciliation.ts","RC26_CORE_RECONCILER_ROUTE_INSTALLED"],
 ["services/vox/rc28PendingSignedEodReview.ts","RC28_SIGNED_EOD_REVIEW_ROUTE_INSTALLED"],
 ["services/vox/rc28VerifiedCoreOutcomeReconciliation.ts","RC28_CORE_RECONCILIATION_ROUTE_INSTALLED"],
 ["services/vox/rc38SignedEodReviewDb.ts","RC38_SIGNED_EOD_REVIEW_READER_INSTALLED"],
 ["services/vox/rc6TransactionalConsentProof.ts","RC6_CONVERSATION_WRITER_INSTALLED"],
 ["lib/payments/vendorPackageProviderEventRepository.mjs","RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED"],
 ["app/api/vox/v1/official-eod-publish/route.ts","VERIFIED_APPROVAL_WRITER_INSTALLED"],
 ["lib/aos/config/featureFlags.ts","WHATSAPP_SENDING_ENABLED"],
 ["lib/aos/config/featureFlags.ts","CREDIT_DEDUCTION_ENABLED"]
]);
export function checkHardOff(read=diskRead,table=HARD_OFF){
 const v=[];
 for(const [file,name] of table){
  const src=read(file);
  if(src===null){v.push(`HARD_OFF_FILE_MISSING ${file}`);continue;}
  const decl=src.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`,"g"))||[];
  const ok=new RegExp(`^\\s*(?:export\\s+)?const\\s+${name}\\s*=\\s*false(?:\\s+as\\s+(?:const|boolean))?\\s*;`,"m").test(src);
  if(decl.length!==1||!ok)v.push(`HARD_OFF_NOT_FALSE ${file} ${name}`);
  if(new RegExp(`\\b${name}\\s*=\\s*true\\b`).test(src))v.push(`HARD_OFF_ASSIGNED_TRUE ${file} ${name}`);
 }
 return v;
}

// ---- 2. protected route gates ----
export const ROUTE_GATES=Object.freeze([
 ["app/api/vox/v1/finance/refund-intake/route.ts",['process.env.VOX_FINANCE_REFUND_REVIEW_WRITE_ENABLED!=="staging"','REFUND_REVIEW_WRITER_NOT_INSTALLED']],
 ["app/api/vox/v1/official-eod-publish/route.ts",['if(!VERIFIED_APPROVAL_WRITER_INSTALLED)','process.env.VOX_AB7G_EOD_PUBLISH_ENABLED!=="staging"','process.env.VOX_AB7G_SIGNED_OWNER_PROOF_ENABLED!=="staging"']],
 ["app/api/vox/v1/signed-eod-review/route.ts",['process.env.VOX_RC38_SIGNED_EOD_REVIEW_ENABLED==="staging"','export const POST=deny;']],
 ["app/api/vox/v1/eod-submissions/route.ts",['process.env.VOX_EOD_SUBMISSIONS_ENABLED==="staging"']],
 ["app/api/vox/v1/eod-reviews/route.ts",['process.env.VOX_EOD_SUBMISSIONS_ENABLED==="staging"']],
 ["lib/aarohi/phase2Policy.ts",['process.env.QF_AAROHI_PHASE2_PROVIDER_EXECUTION_ENABLED?.trim().toLowerCase()==="true"']]
]);
export function checkRouteGates(read=diskRead,table=ROUTE_GATES){
 const v=[];
 for(const [file,needles] of table){
  const src=read(file);
  if(src===null){v.push(`ROUTE_FILE_MISSING ${file}`);continue;}
  for(const n of needles)if(!src.includes(n))v.push(`ROUTE_GATE_WEAKENED ${file} :: ${n}`);
 }
 const pub=read("app/api/vox/v1/official-eod-publish/route.ts");
 if(pub!==null){
  const a=pub.indexOf("if(!VERIFIED_APPROVAL_WRITER_INSTALLED)"),b=pub.indexOf("VOX_AB7G_EOD_PUBLISH_ENABLED");
  if(a<0||b<0||a>b)v.push("ROUTE_WRITER_CHECK_NOT_FIRST app/api/vox/v1/official-eod-publish/route.ts");
 }
 return v;
}

// ---- 3. env templates and workflows must not enable protected flags ----
export const PROTECTED_FLAG=/\b(?:VOX_(?:FINANCE|EOD|OFFICIAL_EOD|RC38_SIGNED_EOD|AB7G)(?:_[A-Z0-9]+)*_ENABLED|QF_AAROHI_PHASE2_(?:PROVIDER_EXECUTION|DISCOVERY)_ENABLED|QF_JARVIS_WHATSAPP(?:_MEDIA)?_ENABLED|WHATSAPP_SENDING_ENABLED|RC4_OFFICIAL_EOD_ENABLED)\b/;
const OFF_VALUES=new Set(["","disabled","false","0","off","no"]);
export function scanProtectedFlags(label,text){
 const v=[];
 const re=new RegExp(`(${PROTECTED_FLAG.source})["']?\\s*[:=]\\s*["']?([^\\s"'#,;)}]*)`,"g");
 for(const m of text.matchAll(re)){
  if(!OFF_VALUES.has(m[2].toLowerCase()))v.push(`PROTECTED_FLAG_ENABLED ${label} ${m[1]}`);
 }
 return v;
}
export const REQUIRED_EXPLICIT_OFF=Object.freeze([
 [".env.example","QF_AAROHI_PHASE2_PROVIDER_EXECUTION_ENABLED"],
 [".env.example","QF_AAROHI_PHASE2_DISCOVERY_ENABLED"],
 [".env.example","QF_JARVIS_WHATSAPP_ENABLED"],
 [".env.example","QF_JARVIS_WHATSAPP_MEDIA_ENABLED"],
 ["apps/vox-web/.env.example","VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED"]
]);
export function checkProtectedFlags(read=diskRead,workflows=workflowFiles(read)){
 const v=[];
 for(const f of ENV_TEMPLATES){
  const t=read(f);
  if(t===null)v.push(`ENV_TEMPLATE_MISSING ${f}`);else v.push(...scanProtectedFlags(f,t));
 }
 for(const [f,name] of REQUIRED_EXPLICIT_OFF){
  const t=read(f)??"";
  const m=[...t.matchAll(new RegExp(`^${name}=(.*)$`,"gm"))];
  if(m.length!==1||!OFF_VALUES.has(m[0][1].trim().toLowerCase())||m[0][1].trim()==="")
   v.push(`PROTECTED_FLAG_NOT_EXPLICITLY_OFF ${f} ${name}`);
 }
 for(const [p,t] of workflows){
  if(t===null)v.push(`WORKFLOW_UNREADABLE ${p}`);else v.push(...scanProtectedFlags(p,t));
 }
 return v;
}

// ---- 4. no live credentials / no secret context ----
const CRED_NAME=/(?:^DATABASE_URL$|^POSTGRES_URL|^SUPABASE_(?!URL$)[A-Z_]*(?:KEY|SECRET|TOKEN)|SERVICE_ROLE|^RAZORPAY_[A-Z_]*(?:KEY|SECRET)|WHATSAPP_[A-Z_]*(?:TOKEN|SECRET)|^META_[A-Z_]*(?:TOKEN|SECRET)|SIGNING_(?:PRIVATE_)?KEY(?:_PEM|_FILE)?$|RECOVERY_SIGNING_KEY|^VOX_[A-Z_]*(?:SERVICE_KEY|SECRET|TOKEN)|^QF_JARVIS_SIGNING)/;
export function checkNoLiveCredentialsInEnv(env=process.env){
 return Object.keys(env).filter(k=>CRED_NAME.test(k)&&String(env[k]).trim()!=="").sort().map(k=>`LIVE_CREDENTIAL_IN_ENV ${k}`);
}
const SECRET_LITERAL=/postgres(?:ql)?:\/\/[^\s"'@]*:[^\s"'@]+@|eyJ[\w-]{20,}\.[\w-]{10,}\.|\b(?:sk|rk)_(?:live|test)_\w{8,}|\brzp_live_\w+|\bEAA[A-Za-z0-9]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
// Disposable CI service-container DBs only: loopback host + password ending _ci_only. Anything else still fails.
const CI_ONLY_LOCAL_DB=/postgres(?:ql)?:\/\/\w+:\w*_ci_only@(?:127\.0\.0\.1|localhost)(?=[:/\s"'])/g;
const PLACEHOLDER=/^(?:your-[\w-]+|<[^>]*>|changeme|example|placeholder|x{3,})$/i;
export function checkNoCredentialLiterals(read=diskRead,workflows=workflowFiles(read)){
 const v=[];
 const docs=[...ENV_TEMPLATES.map(f=>[f,read(f)]),...workflows];
 for(const [p,t] of docs){
  if(t===null)continue;
  if(SECRET_LITERAL.test(t.replace(CI_ONLY_LOCAL_DB,"")))v.push(`CREDENTIAL_LITERAL ${p}`);
 }
 for(const f of ENV_TEMPLATES){
  const t=read(f)??"";
  for(const m of t.matchAll(/^([A-Z0-9_]+)=(.+)$/gm))
   if(CRED_NAME.test(m[1])&&m[2].trim()!==""&&!PLACEHOLDER.test(m[2].trim()))v.push(`ENV_TEMPLATE_CREDENTIAL_VALUE ${f} ${m[1]}`);
 }
 return v;
}
export function checkWorkflowSecretUse(workflows){
 const v=[];
 for(const [p,t] of workflows){
  if(t===null||!/\/vox-[^/]*\.ya?ml$/.test(p))continue;
  if(/\$\{\{\s*secrets\./i.test(t))v.push(`VOX_WORKFLOW_USES_SECRETS ${p}`);
  if(/^\s*pull_request_target\s*:/m.test(t))v.push(`VOX_WORKFLOW_PULL_REQUEST_TARGET ${p}`);
 }
 return v;
}

// ---- 5. generated digest ----
export function sampleDryRun(){
 const out=[],err=[];
 const code=runCli(["--sample"],{log:s=>out.push(s),err:s=>err.push(s)});
 return {code,err:err.join("\n"),text:out.join("\n")};
}
export function checkGeneratedDigest(gen=sampleDryRun){
 const v=[];
 const a=gen();
 if(a.code===1||!a.text)return [`DIGEST_GENERATION_FAILED ${a.err||"no output"}`];
 let plan;
 try{plan=JSON.parse(a.text);}catch{return ["DIGEST_OUTPUT_NOT_JSON"];}
 const {planSha256,...body}=plan;
 if(!HEX64.test(planSha256||""))v.push("DIGEST_PLAN_SHA_MALFORMED");
 else if(sha256(JSON.stringify(body))!==planSha256)v.push("DIGEST_PLAN_SHA_MISMATCH");
 if(!HEX64.test(plan.evidencePackageSha256||""))v.push("DIGEST_EVIDENCE_SHA_MALFORMED");
 if(!HEX64.test(plan.baseState?.stateSha256||""))v.push("DIGEST_BASE_STATE_MALFORMED");
 for(const s of plan.stages||[])
  for(const k of [s.forwardSha256,s.fromState?.stateSha256,s.toState?.stateSha256])
   if(!HEX64.test(k||""))v.push("DIGEST_STAGE_MALFORMED");
 if(plan.releaseGo!==false)v.push("DIGEST_RELEASE_GO_NOT_FALSE");
 for(const k of ["connectsToManaged","executesSql","managedWrites","promotesProtectedSql"])
  if(plan[k]!==false)v.push(`DIGEST_${k}_NOT_FALSE`);
 if(plan.requiresIndependentDbaDecision!==true)v.push("DIGEST_INDEPENDENT_DECISION_NOT_REQUIRED");
 const b=gen();
 if(b.text!==a.text)v.push("DIGEST_NOT_DETERMINISTIC");
 return v;
}

// ---- 6. the gate workflow itself ----
const ACTION_PIN=/^[^@\s]+@[0-9a-f]{40}$/;
export async function checkGateWorkflow(read=diskRead){
 const text=read(GATE_WORKFLOW);
 if(text===null)return ["GATE_WORKFLOW_MISSING"];
 const {parse}=await import("yaml");
 let doc;
 try{doc=parse(text);}catch(e){return ["GATE_WORKFLOW_YAML_INVALID "+e.message.split("\n")[0]];}
 const v=[];
 const on=doc?.on;
 if(!on||typeof on!=="object"||!("pull_request" in on))v.push("GATE_NOT_ON_PULL_REQUEST");
 else{
  const pr=on.pull_request||{};
  for(const k of ["paths","paths-ignore","branches","branches-ignore","types"])
   if(k in pr)v.push(`GATE_PULL_REQUEST_FILTERED ${k}`);
 }
 if("pull_request_target" in (on||{}))v.push("GATE_USES_PULL_REQUEST_TARGET");
 const perms=doc?.permissions;
 if(!perms||Object.keys(perms).length!==1||perms.contents!=="read")v.push("GATE_PERMISSIONS_NOT_READ_ONLY");
 const jobs=Object.values(doc?.jobs||{});
 if(jobs.length!==1)v.push("GATE_JOB_COUNT");
 for(const j of jobs){
  if(!Number.isInteger(j["timeout-minutes"]))v.push("GATE_NO_TIMEOUT");
  if("continue-on-error" in j||"if" in j)v.push("GATE_JOB_CONDITIONAL");
  for(const s of j.steps||[]){
   if("continue-on-error" in s)v.push("GATE_STEP_CONTINUE_ON_ERROR");
   if(s.uses&&!ACTION_PIN.test(s.uses))v.push(`GATE_ACTION_NOT_PINNED ${s.uses}`);
   if(s.env&&checkNoLiveCredentialsInEnv(s.env).length)v.push("GATE_STEP_SETS_CREDENTIAL");
  }
  if(!(j.steps||[]).some(s=>typeof s.run==="string"&&s.run.includes("node --test "+GATE_TEST)))v.push("GATE_DOES_NOT_RUN_TEST");
 }
 if(/\$\{\{\s*secrets\./i.test(text))v.push("GATE_USES_SECRETS");
 return v;
}
export async function checkAllWorkflowsParse(workflows){
 const {parse}=await import("yaml");
 const v=[];
 for(const [p,t] of workflows){
  try{
   const d=parse(t);
   if(!d||typeof d!=="object"||!d.on||!d.jobs||!Object.keys(d.jobs).length)v.push(`WORKFLOW_SHAPE ${p}`);
  }catch{v.push(`WORKFLOW_YAML_INVALID ${p}`);}
 }
 return v;
}

// =============== gate against the real repository ===============
test("GATE: protected hard-off switches are literally false in source",()=>assert.deepEqual(checkHardOff(),[]));
test("GATE: protected routes keep default-off exact-match staging gates",()=>assert.deepEqual(checkRouteGates(),[]));
test("GATE: no Finance/EOD/outreach flag enabled in env templates or any workflow",()=>assert.deepEqual(checkProtectedFlags(),[]));
test("GATE: no live credentials in the CI environment",()=>assert.deepEqual(checkNoLiveCredentialsInEnv(),[]));
test("GATE: no credential literals or secrets context in templates and workflows",()=>{
 const w=workflowFiles();
 assert.deepEqual([...checkNoCredentialLiterals(diskRead,w),...checkWorkflowSecretUse(w)],[]);
});
test("GATE: generated RC38 digest is valid SHA-256, recomputable, deterministic, release HOLD",()=>assert.deepEqual(checkGeneratedDigest(),[]));
test("GATE: gate workflow is always-on for PRs, read-only, pinned and runs this file",async()=>assert.deepEqual(await checkGateWorkflow(),[]));
test("GATE: every workflow is valid YAML with on/jobs",async()=>assert.deepEqual(await checkAllWorkflowsParse(workflowFiles()),[]));

// =============== negative regression: the gate must actually fail ===============
const overlay=(over,base=diskRead)=>p=>p in over?over[p]:base(p);
const sub=(p,from,to)=>{const t=diskRead(p);assert.ok(t.includes(from),`fixture anchor missing in ${p}`);return t.replace(from,to);};
const NO_WF=[];

test("REGRESSION: flipping a hard-off constant to true is rejected",()=>{
 const f="contracts/vox/rc4ApprovalPipeline.mjs";
 const v=checkHardOff(overlay({[f]:sub(f,"RC4_OFFICIAL_EOD_ENABLED=false","RC4_OFFICIAL_EOD_ENABLED=true")}));
 assert.ok(v.some(x=>x.startsWith("HARD_OFF_NOT_FALSE")&&x.includes("RC4_OFFICIAL_EOD_ENABLED")),v.join());
});
test("REGRESSION: turning on WhatsApp sending or the EOD publish writer is rejected",()=>{
 const a="lib/aos/config/featureFlags.ts",b="app/api/vox/v1/official-eod-publish/route.ts";
 const v=checkHardOff(overlay({[a]:sub(a,"WHATSAPP_SENDING_ENABLED = false","WHATSAPP_SENDING_ENABLED = true"),
  [b]:sub(b,"VERIFIED_APPROVAL_WRITER_INSTALLED=false","VERIFIED_APPROVAL_WRITER_INSTALLED=true")}));
 assert.equal(v.filter(x=>x.startsWith("HARD_OFF_NOT_FALSE")).length,2,v.join());
});
test("REGRESSION: constant made non-literal, duplicated, or file deleted is rejected",()=>{
 const f="services/vox/rc8PgVendorConversationOperator.ts";
 assert.ok(checkHardOff(overlay({[f]:sub(f,"RC8_CORE_WRITER_INSTALLED=false as const","RC8_CORE_WRITER_INSTALLED=process.env.X==='1'")})).length);
 assert.ok(checkHardOff(overlay({[f]:diskRead(f)+"\nexport const RC8_CORE_WRITER_INSTALLED=false as const;\n"})).length);
 assert.ok(checkHardOff(overlay({[f]:null})).some(x=>x.startsWith("HARD_OFF_FILE_MISSING")));
});
test("REGRESSION: weakened Finance, signed-EOD and outreach route gates are rejected",()=>{
 const fin="app/api/vox/v1/finance/refund-intake/route.ts",eod="app/api/vox/v1/signed-eod-review/route.ts",out="lib/aarohi/phase2Policy.ts";
 const v=checkRouteGates(overlay({
  [fin]:sub(fin,'VOX_FINANCE_REFUND_REVIEW_WRITE_ENABLED!=="staging"','VOX_FINANCE_REFUND_REVIEW_WRITE_ENABLED==="off"'),
  [eod]:sub(eod,"export const POST=deny;","export const POST=GET;"),
  [out]:sub(out,'PROVIDER_EXECUTION_ENABLED?.trim().toLowerCase()==="true"','PROVIDER_EXECUTION_ENABLED?.trim().toLowerCase()!=="false"')}));
 assert.equal(v.length,3,v.join());
});
test("REGRESSION: EOD publish env check ordered ahead of the writer-installed check is rejected",()=>{
 const f="app/api/vox/v1/official-eod-publish/route.ts";
 const t=diskRead(f).replace("if(!VERIFIED_APPROVAL_WRITER_INSTALLED)","if(false)")+"\n// if(!VERIFIED_APPROVAL_WRITER_INSTALLED)\n";
 assert.ok(checkRouteGates(overlay({[f]:t})).some(x=>x.startsWith("ROUTE_WRITER_CHECK_NOT_FIRST")));
});
test("REGRESSION: enabling a protected flag in an env template or a workflow is rejected",()=>{
 const e=".env.example";
 const t=sub(e,"QF_AAROHI_PHASE2_PROVIDER_EXECUTION_ENABLED=false","QF_AAROHI_PHASE2_PROVIDER_EXECUTION_ENABLED=true");
 assert.ok(checkProtectedFlags(overlay({[e]:t}),NO_WF).some(x=>x.includes("PROTECTED_FLAG_ENABLED")));
 for(const line of ["VOX_EOD_SUBMISSIONS_ENABLED: staging","  VOX_FINANCE_REFUND_REVIEW_WRITE_ENABLED=staging","VOX_RC38_SIGNED_EOD_REVIEW_ENABLED: 'staging'",
  'env: {VOX_AB7G_EOD_PUBLISH_ENABLED: "True"}',"QF_JARVIS_WHATSAPP_ENABLED: true","WHATSAPP_SENDING_ENABLED=1"]){
  const v=checkProtectedFlags(diskRead,[["wf.yml","jobs:\n  x:\n    env:\n"+line+"\n"]]);
  assert.equal(v.length,1,line+" => "+v.join());
 }
 assert.deepEqual(checkProtectedFlags(diskRead,[["wf.yml","VOX_EOD_SUBMISSIONS_ENABLED: disabled\nQF_JARVIS_WHATSAPP_ENABLED: 'false'\n"]]),[]);
});
test("REGRESSION: removing or blanking an explicit outreach OFF flag is rejected",()=>{
 const e=".env.example";
 const missing=diskRead(e).replace(/^QF_JARVIS_WHATSAPP_ENABLED=.*\n/m,"");
 assert.ok(checkProtectedFlags(overlay({[e]:missing}),NO_WF).some(x=>x.startsWith("PROTECTED_FLAG_NOT_EXPLICITLY_OFF")));
 const blank=diskRead(e).replace(/^QF_JARVIS_WHATSAPP_ENABLED=.*$/m,"QF_JARVIS_WHATSAPP_ENABLED=");
 assert.ok(checkProtectedFlags(overlay({[e]:blank}),NO_WF).some(x=>x.startsWith("PROTECTED_FLAG_NOT_EXPLICITLY_OFF")));
});
test("REGRESSION: live credentials in the CI environment are rejected (names only, never values)",()=>{
 const secret="s3cr3t-value-should-never-print";
 for(const k of ["DATABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RAZORPAY_LIVE_KEY_SECRET","WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN","QF_JARVIS_SIGNING_PRIVATE_KEY_PEM"]){
  const v=checkNoLiveCredentialsInEnv({PATH:"x",[k]:secret});
  assert.deepEqual(v,["LIVE_CREDENTIAL_IN_ENV "+k]);
  assert.ok(!v.join().includes(secret));
 }
 assert.deepEqual(checkNoLiveCredentialsInEnv({PATH:"x",DATABASE_URL:"  ",SUPABASE_URL:"https://x.supabase.co",CI:"true"}),[]);
});
test("REGRESSION: credential literals, secrets context and pull_request_target are rejected",()=>{
 const wf=[["a/vox-x.yml","on:\n  pull_request_target:\n    types: [opened]\njobs:\n  j:\n    steps:\n      - run: echo ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}\n"]];
 assert.equal(checkWorkflowSecretUse(wf).length,2);
 assert.ok(checkNoCredentialLiterals(diskRead,[["wf.yml","run: psql postgresql://postgres:hunter2@db.example.co:5432/postgres\n"]]).length);
 assert.ok(checkNoCredentialLiterals(diskRead,[["wf.yml","run: psql postgresql://u:p_ci_only@db.example.co:5432/x\n"]]).length,"_ci_only on a remote host must fail");
 assert.deepEqual(checkNoCredentialLiterals(diskRead,[["wf.yml","run: psql postgresql://u:p_ci_only@127.0.0.1:5432/x\n"]]),[]);
 const e=".env.example";
 assert.ok(checkNoCredentialLiterals(overlay({[e]:diskRead(e)+"\nSUPABASE_SERVICE_ROLE_KEY=abc\n"}),NO_WF).length);
});
test("REGRESSION: tampered, malformed, non-deterministic or GO digests are rejected",()=>{
 const real=JSON.parse(sampleDryRun().text);
 const emit=o=>()=>({code:2,err:"",text:JSON.stringify(o,null,2)});
 assert.deepEqual(checkGeneratedDigest(emit(real)),[]);
 assert.ok(checkGeneratedDigest(emit({...real,planSha256:"abc"})).includes("DIGEST_PLAN_SHA_MALFORMED"));
 assert.ok(checkGeneratedDigest(emit({...real,planSha256:"0".repeat(64)})).includes("DIGEST_PLAN_SHA_MISMATCH"));
 assert.ok(checkGeneratedDigest(emit({...real,evidencePackageSha256:"G".repeat(64)})).includes("DIGEST_EVIDENCE_SHA_MALFORMED"));
 const {planSha256,...body}=real;
 const go={...body,releaseGo:true};
 const goV=checkGeneratedDigest(emit({...go,planSha256:sha256(JSON.stringify(go))}));
 assert.ok(goV.includes("DIGEST_RELEASE_GO_NOT_FALSE"),goV.join());
 const live={...body,connectsToManaged:true};
 assert.ok(checkGeneratedDigest(emit({...live,planSha256:sha256(JSON.stringify(live))})).includes("DIGEST_connectsToManaged_NOT_FALSE"));
 let n=0;
 assert.ok(checkGeneratedDigest(()=>({code:2,err:"",text:JSON.stringify({...real,n:n++})})).includes("DIGEST_NOT_DETERMINISTIC"));
 assert.ok(checkGeneratedDigest(()=>({code:1,err:"RC38_X",text:""})).some(x=>x.startsWith("DIGEST_GENERATION_FAILED")));
});
test("REGRESSION: a weakened or missing gate workflow is rejected",async()=>{
 const good=diskRead(GATE_WORKFLOW);
 assert.ok(good!==null,"gate workflow must exist");
 const run=async t=>checkGateWorkflow(p=>p===GATE_WORKFLOW?t:diskRead(p));
 assert.deepEqual(await checkGateWorkflow(p=>p===GATE_WORKFLOW?null:diskRead(p)),["GATE_WORKFLOW_MISSING"]);
 assert.ok((await run(good.replace(/pull_request:\s*\n/,"pull_request:\n    paths: ['docs/**']\n"))).some(x=>x.startsWith("GATE_PULL_REQUEST_FILTERED")));
 assert.ok((await run(good.replace(/contents: read/,"contents: write"))).includes("GATE_PERMISSIONS_NOT_READ_ONLY"));
 assert.ok((await run(good.replace(/(uses: actions\/checkout@)[0-9a-f]{40}/,"$1v4"))).some(x=>x.startsWith("GATE_ACTION_NOT_PINNED")));
 assert.ok((await run(good.replace("node --test "+GATE_TEST,"echo skipped"))).includes("GATE_DOES_NOT_RUN_TEST"));
 assert.ok((await run(good.replace(/jobs:\n(\s+)([\w-]+):\n/,"jobs:\n$1$2:\n$1  continue-on-error: true\n"))).includes("GATE_JOB_CONDITIONAL"));
 assert.ok((await run(good+"\n#x\n  : : bad")).some(x=>x.startsWith("GATE_WORKFLOW_YAML_INVALID")));
});
test("REGRESSION: a broken workflow file fails the YAML sweep",async()=>{
 assert.ok((await checkAllWorkflowsParse([["x.yml","on: [push\njobs: {"]])).length===1);
 assert.ok((await checkAllWorkflowsParse([["y.yml","name: no jobs\n"]])).length===1);
});
