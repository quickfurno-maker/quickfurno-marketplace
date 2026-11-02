import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from "node:fs";
import {dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {fileURLToPath} from "node:url";
import {evaluatePredeployGate,approvalMessage,parseArgs,runCli,resolveHeadSha,REQUIRED_ROLES,
 RECOVERY_SCHEMA,APPROVAL_SCHEMA,KEYS_SCHEMA,MIGRATION_DIGESTS_SCHEMA} from "./rc38-staging-predeploy-gate.mjs";
import {buildStagedDryRun} from "./rc38-migration-staged-dryrun.mjs";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {AUTHORIZED_STAGING_REF,PROHIBITED_REFS} from "./ab7k-evidence-lib.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const fx=join(here,"fixtures/rc37-migration-evidence");
const NOW=Date.parse("2026-11-02T12:00:00Z");
const iso=h=>new Date(NOW-h*3600e3).toISOString();
const SHA="a".repeat(40);
const h64=c=>c.repeat(64);
const quiet={log(){},err(){}};
const tmp=()=>mkdtempSync(join(tmpdir(),"rc38gate-"));
const sha=t=>createHash("sha256").update(t).digest("hex");

const managedText=readFileSync(join(fx,"managed.json"),"utf8");
const aliasText=readFileSync(join(fx,"aliases.json"),"utf8");
const deltaSha=canonicalSqlDigest(readFileSync(join(fx,"source","20261102000000_fix_delta_append.sql")));
const rollbackText=JSON.stringify([{version:"20261102000000",forwardSha256:deltaSha,rollbackSha256:h64("a"),
 transactional:true,reviewedBy:"fixture-dba",basis:"synthetic fixture"}]);
const digestsText=JSON.stringify({schema:MIGRATION_DIGESTS_SCHEMA,migrations:[{version:"20261102000000",forwardSha256:deltaSha,rollbackSha256:h64("a")}]});

const comp=(extra={})=>({projectRef:AUTHORIZED_STAGING_REF,capturedAt:iso(5),readOnly:true,
 backup:{present:true,takenAt:iso(6),artifacts:[{name:"b.dump",sha256:h64("1"),bytes:10}]},
 restoreDrill:{executed:true,targetProjectRef:"drillproject0000000000",completedAt:iso(5.5),errors:[],sourceDigest:h64("d"),restoredDigest:h64("d")},...extra});
const recovery=()=>({schema:RECOVERY_SCHEMA,capturedBy:"operator-1",components:{
 auth:comp({usersRowsExported:false}),
 vault:comp({keyRecoveryVerified:true,secretValuesIncluded:false}),
 storage:comp({objectManifestSourceSha256:h64("e"),objectManifestRestoredSha256:h64("e")})}});

const reviewers={dba:"rev-dba",appsec:"rev-sec",owner:"rev-own"};
const keyPairs=Object.fromEntries(Object.keys(reviewers).map(r=>[r,generateKeyPairSync("ed25519")]));
const registry=()=>JSON.stringify({schema:KEYS_SCHEMA,keys:Object.keys(reviewers).map(r=>({keyId:"k-"+r,role:r,reviewerId:reviewers[r],
 publicKeyPem:keyPairs[r].publicKey.export({type:"spki",format:"pem"})}))});
const signed=(role,binding,o={})=>{
 const a={role,reviewerId:reviewers[role],keyId:"k-"+role,decision:REQUIRED_ROLES[role],issuedAt:iso(1),expiresAt:new Date(NOW+24*3600e3).toISOString(),bindingSha256:binding,...o};
 a.signature=sign(null,approvalMessage(a),keyPairs[o.signAs??role].privateKey).toString("base64");
 return a;
};
const base=(o={})=>{
 const keys=registry();
 return {now:NOW,headSha:SHA,expectedSha:SHA,managedText,sourceDir:join(fx,"source"),aliasText,rollbackText,
  migrationDigestsText:digestsText,recoveryText:JSON.stringify(recovery()),trustedKeysText:keys,trustedKeysSha256:sha(keys),
  operators:"operator-1",...o};
};
// Sign over the binding the gate itself computes, then re-evaluate.
const full=(o={},tweak=a=>a)=>{
 const i=base(o);
 const b=evaluatePredeployGate({...i,approvalsText:undefined}).bindingSha256;
 const approvals=tweak(Object.keys(reviewers).map(r=>signed(r,b)));
 return {i:{...i,approvalsText:JSON.stringify({schema:APPROVAL_SCHEMA,approvals})},b};
};
const codes=g=>g.blockedReasons.map(b=>b.code);

test("all evidence + 3 independent signatures: approved, still never deploys",()=>{
 const {i}=full();
 const g=evaluatePredeployGate(i);
 assert.deepEqual(g.blockedReasons,[]);
 assert.equal(g.verdict,"APPROVED_FOR_STAGING_PREDEPLOY");
 for(const k of ["deploys","connectsToManaged","executesSql","managedWrites","paymentMutation","readsSecrets"])assert.equal(g[k],false);
 assert.equal(g.stagingProjectRef,AUTHORIZED_STAGING_REF);
 assert.equal(g.gateSha256,evaluatePredeployGate(i).gateSha256);
});

test("fail-closed default: nothing supplied is NO_GO with actionable reasons",()=>{
 const g=evaluatePredeployGate({now:NOW});
 assert.equal(g.verdict,"NO_GO_BLOCKED");
 for(const c of ["PLAN_BUILD_FAILED","HEAD_SHA_UNRESOLVABLE","EXPECTED_SHA_INVALID","RECOVERY_EVIDENCE_MISSING","TRUSTED_KEYS_PIN_MISSING","APPROVALS_MISSING"])
  assert.ok(codes(g).includes(c),c);
 assert.ok(g.blockedReasons.every(b=>b.code&&b.subject&&"requiredExternalInput" in b));
 assert.ok(g.externalInputsRequired.length>0);
});

test("unsigned/no-approval run lists the exact binding to sign",()=>{
 const g=evaluatePredeployGate(base());
 assert.equal(g.verdict,"NO_GO_BLOCKED");
 const r=g.blockedReasons.find(b=>b.code==="APPROVALS_MISSING");
 assert.ok(r.requiredExternalInput.includes(g.bindingSha256));
 assert.match(g.bindingSha256,/^[0-9a-f]{64}$/);
});

test("incomplete RC38 plan (no reviewed rollback) blocks and surfaces plan blockers",()=>{
 const {i}=full({rollbackText:undefined});
 const g=evaluatePredeployGate(i);
 assert.equal(g.verdict,"NO_GO_BLOCKED");
 assert.ok(codes(g).includes("PLAN_NOT_READY"));
 assert.ok(codes(g).includes("PLAN_BLOCKER_ROLLBACK_REVIEW_MISSING"));
 assert.ok(codes(g).includes("MIGRATION_DIGEST_NOT_ATTESTED")||codes(g).includes("MIGRATION_DIGEST_UNEXPECTED"));
});

test("wrong commit sha blocks; approvals for another sha no longer bind",()=>{
 const {i}=full();
 const g=evaluatePredeployGate({...i,headSha:"b".repeat(40)});
 assert.ok(codes(g).includes("HEAD_SHA_MISMATCH"));
 assert.ok(codes(g).includes("APPROVAL_BINDING_MISMATCH"));
 assert.ok(codes(evaluatePredeployGate({...i,expectedSha:"abc"})).includes("EXPECTED_SHA_INVALID"));
});

test("migration digest manifest must equal recomputed digests (drift or substitution)",()=>{
 const bad=JSON.stringify({schema:MIGRATION_DIGESTS_SCHEMA,migrations:[{version:"20261102000000",forwardSha256:h64("f"),rollbackSha256:h64("a")}]});
 const g=evaluatePredeployGate(full({migrationDigestsText:bad}).i);
 assert.ok(codes(g).includes("MIGRATION_DIGEST_NOT_ATTESTED"));
 assert.ok(codes(g).includes("MIGRATION_DIGEST_UNEXPECTED"));
 assert.ok(codes(evaluatePredeployGate(full({migrationDigestsText:undefined}).i)).includes("MIGRATION_DIGESTS_MISSING"));
 assert.ok(codes(evaluatePredeployGate(full({migrationDigestsText:'{"schema":"x"}'}).i)).includes("MIGRATION_DIGESTS_MISSING"));
});

for(const name of ["auth","vault","storage"]){
 test(`${name} recovery evidence: missing, wrong project, non-isolated drill, mismatch, stale each block`,()=>{
  const mutate=f=>{const r=recovery();f(r.components[name]);return JSON.stringify(r);};
  const cases={
   [`RECOVERY_${name.toUpperCase()}_PROJECT_NOT_STAGING`]:mutate(c=>{c.projectRef=PROHIBITED_REFS[0];}),
   [`RECOVERY_${name.toUpperCase()}_RESTORE_DRILL_NOT_ISOLATED`]:mutate(c=>{c.restoreDrill.targetProjectRef=AUTHORIZED_STAGING_REF;}),
   [`RECOVERY_${name.toUpperCase()}_RESTORE_DIGEST_MISMATCH`]:mutate(c=>{c.restoreDrill.restoredDigest=h64("9");}),
   [`RECOVERY_${name.toUpperCase()}_RESTORE_DRILL_NOT_EXECUTED`]:mutate(c=>{c.restoreDrill.executed=false;}),
   [`RECOVERY_${name.toUpperCase()}_RESTORE_DRILL_ERRORS`]:mutate(c=>{c.restoreDrill.errors=["boom"];}),
   [`RECOVERY_${name.toUpperCase()}_EVIDENCE_STALE`]:mutate(c=>{c.capturedAt=iso(100);}),
   [`RECOVERY_${name.toUpperCase()}_BACKUP_ABSENT`]:mutate(c=>{c.backup.present=false;}),
   [`RECOVERY_${name.toUpperCase()}_NOT_READ_ONLY_CAPTURE`]:mutate(c=>{c.readOnly=false;}),
   [`RECOVERY_${name.toUpperCase()}_MISSING`]:JSON.stringify((()=>{const r=recovery();delete r.components[name];return r;})())
  };
  for(const [code,text] of Object.entries(cases)){
   const g=evaluatePredeployGate(full({recoveryText:text}).i);
   assert.equal(g.verdict,"NO_GO_BLOCKED",code);
   assert.ok(codes(g).includes(code),code+" in "+codes(g));
  }
 });
}

test("component-specific recovery requirements",()=>{
 const r=recovery();r.components.vault.keyRecoveryVerified=false;r.components.vault.secretValuesIncluded=true;
 r.components.storage.objectManifestRestoredSha256=h64("0");r.components.auth.usersRowsExported=true;
 const g=evaluatePredeployGate(full({recoveryText:JSON.stringify(r)}).i);
 for(const c of ["RECOVERY_VAULT_KEY_RECOVERY_UNVERIFIED","RECOVERY_VAULT_SECRET_VALUES_IN_EVIDENCE","RECOVERY_STORAGE_OBJECT_MANIFEST_MISMATCH","RECOVERY_AUTH_AUTH_ROWS_EXPORTED"])
  assert.ok(codes(g).includes(c),c);
});

test("changing recovery evidence after signing invalidates every approval",()=>{
 const {i}=full();
 const r=recovery();r.components.auth.backup.artifacts[0].name="swapped.dump";
 const g=evaluatePredeployGate({...i,recoveryText:JSON.stringify(r)});
 assert.equal(g.verdict,"NO_GO_BLOCKED");
 assert.equal(codes(g).filter(c=>c==="APPROVAL_BINDING_MISMATCH").length,3);
});

test("each role is required; missing DBA / AppSec / Owner GO blocks with role-specific reason",()=>{
 for(const role of Object.keys(reviewers)){
  const {i}=full({},a=>a.filter(x=>x.role!==role));
  const g=evaluatePredeployGate(i);
  assert.equal(g.verdict,"NO_GO_BLOCKED");
  assert.ok(g.blockedReasons.some(b=>b.code==="APPROVAL_ROLE_UNSATISFIED"&&b.subject==="role:"+role),role);
 }
});

test("forged, wrong-key, wrong-decision, expired, future, self and duplicate approvals are rejected",()=>{
 const run=(tweak,code)=>{
  const g=evaluatePredeployGate(full({},tweak).i);
  assert.equal(g.verdict,"NO_GO_BLOCKED",code);
  assert.ok(codes(g).includes(code),code+" in "+codes(g));
 };
 const set=(role,patch)=>a=>a.map(x=>x.role===role?patch(x):x);
 run(set("dba",x=>({...x,signature:Buffer.alloc(64).toString("base64")})),"APPROVAL_SIGNATURE_INVALID");
 run(set("dba",x=>({...x,reviewerId:"someone-else"})),"APPROVAL_KEY_ROLE_OR_IDENTITY_MISMATCH");
 run(set("appsec",x=>({...x,keyId:"k-unknown"})),"APPROVAL_KEY_NOT_TRUSTED");
 run(set("owner",x=>({...x,decision:"APPROVE"})),"APPROVAL_DECISION_NOT_AFFIRMATIVE");
 run(set("dba",x=>({...x,decision:"REJECT"})),"APPROVAL_DECISION_NOT_AFFIRMATIVE");
 run(set("appsec",x=>({...x,role:"auditor"})),"APPROVAL_UNKNOWN_ROLE");
 // signed by the wrong private key
 run(a=>a.map(x=>x.role==="dba"?signed("dba",x.bindingSha256,{signAs:"appsec"}):x),"APPROVAL_SIGNATURE_INVALID");
 run(a=>a.map(x=>x.role==="dba"?signed("dba",x.bindingSha256,{issuedAt:iso(30),expiresAt:iso(1)}):x),"APPROVAL_EXPIRED");
 run(a=>a.map(x=>x.role==="dba"?signed("dba",x.bindingSha256,{issuedAt:new Date(NOW+3600e3).toISOString()}):x),"APPROVAL_TIME_INVALID");
 run(a=>a.map(x=>x.role==="dba"?signed("dba",x.bindingSha256,{expiresAt:new Date(NOW+200*3600e3).toISOString()}):x),"APPROVAL_WINDOW_TOO_LONG");
 run(a=>a.map(x=>x.role==="dba"?signed("dba",x.bindingSha256,{issuedAt:iso(10)}):x),"APPROVAL_PREDATES_EVIDENCE");
 run(a=>[...a,a[0]],"APPROVAL_DUPLICATE_ROLE");
});

test("independence: operator self-approval, shared reviewer and shared key are rejected",()=>{
 let g=evaluatePredeployGate(full({operators:"operator-1,rev-dba"}).i);
 assert.ok(codes(g).includes("APPROVAL_SELF_APPROVAL"));
 const r=recovery();r.capturedBy="rev-sec";
 g=evaluatePredeployGate(full({recoveryText:JSON.stringify(r)}).i);
 assert.ok(codes(g).includes("APPROVAL_SELF_APPROVAL"),"recovery capturer cannot approve");
 // one human holding both dba and appsec registry entries
 const keys=JSON.stringify({schema:KEYS_SCHEMA,keys:Object.keys(reviewers).map(role=>({keyId:"k-"+role,role,reviewerId:role==="appsec"?"rev-dba":reviewers[role],
  publicKeyPem:keyPairs[role].publicKey.export({type:"spki",format:"pem"})}))});
 const i=base({trustedKeysText:keys,trustedKeysSha256:sha(keys)});
 const b=evaluatePredeployGate(i).bindingSha256;
 const ap=Object.keys(reviewers).map(role=>signed(role,b,role==="appsec"?{reviewerId:"rev-dba"}:{}));
 g=evaluatePredeployGate({...i,approvalsText:JSON.stringify({schema:APPROVAL_SCHEMA,approvals:ap})});
 assert.ok(codes(g).includes("APPROVAL_NOT_INDEPENDENT"));
 assert.equal(g.verdict,"NO_GO_BLOCKED");
 g=evaluatePredeployGate(full({operators:""}).i);
 assert.equal(g.verdict,"APPROVED_FOR_STAGING_PREDEPLOY"); // recovery.capturedBy still supplies an operator id
});

test("trusted key registry must be pinned and match the pin; weak keys rejected",()=>{
 const {i}=full();
 assert.ok(codes(evaluatePredeployGate({...i,trustedKeysSha256:undefined})).includes("TRUSTED_KEYS_PIN_MISSING"));
 const mism=evaluatePredeployGate({...i,trustedKeysSha256:h64("0")});
 assert.ok(codes(mism).includes("TRUSTED_KEYS_PIN_MISMATCH"));
 assert.ok(codes(mism).includes("APPROVALS_UNVERIFIABLE"));
 const rsa=generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({type:"spki",format:"pem"});
 const keys=JSON.stringify({schema:KEYS_SCHEMA,keys:[{keyId:"k-dba",role:"dba",reviewerId:"rev-dba",publicKeyPem:rsa}]});
 const g=evaluatePredeployGate({...i,trustedKeysText:keys,trustedKeysSha256:sha(keys)});
 assert.ok(codes(g).includes("TRUSTED_KEY_INVALID"));
 assert.equal(g.verdict,"NO_GO_BLOCKED");
});

test("secret-shaped content in an input is refused",()=>{
 const g=evaluatePredeployGate(full({recoveryText:JSON.stringify({...recovery(),note:"postgresql://u:pw@host/db"})}).i);
 assert.ok(codes(g).includes("SECRET_IN_INPUT"));
 assert.equal(g.verdict,"NO_GO_BLOCKED");
});

test("gate never builds an approval from a plan that rc38 itself holds",()=>{
 const {i}=full({aliasText:undefined});
 const g=evaluatePredeployGate(i);
 assert.equal(g.verdict,"NO_GO_BLOCKED");
 assert.ok(codes(g).some(c=>c.startsWith("PLAN_BLOCKER_RECONCILIATION_")));
 assert.equal(g.planStatus,"NO_GO_BLOCKED");
});

test("module is offline: no network, child process, pg, env or fetch",()=>{
 const src=readFileSync(join(here,"rc38-staging-predeploy-gate.mjs"),"utf8");
 assert.doesNotMatch(src,/child_process|node:net|node:http|node:tls|fetch\(|\bpg\b|spawn|exec\(|process\.env/);
});

test("rc38 plan used by the gate matches a direct rc38 run",()=>{
 const direct=buildStagedDryRun({managedText,sourceDir:join(fx,"source"),aliasInput:JSON.parse(aliasText),rollbackInput:rollbackText});
 assert.equal(evaluatePredeployGate(full().i).planSha256,direct.planSha256);
});

test("CLI args: dangerous/unknown flags and --head-sha override are refused",()=>{
 for(const f of ["--deploy","--head-sha","--now","--apply","--db-url","--bogus"])
  assert.ok(parseArgs([f,"x"]).error,f);
 assert.ok(parseArgs(["positional"]).error);
 assert.equal(runCli(["--deploy","x"],quiet),1);
 assert.equal(runCli([],quiet),1);
});

test("CLI end to end: blocked exits 2 with JSON; approved exits 0; --out never overwrites",()=>{
 const d=tmp(),w=(n,t)=>{const p=join(d,n);writeFileSync(p,t);return p;};
 const {i}=full();
 const args=(o={})=>["--managed",w("m.json",managedText),"--source-dir",join(fx,"source"),"--aliases",w("a.json",aliasText),
  "--rollbacks",w("r.json",rollbackText),"--expected-sha",SHA,"--migration-digests",w("d.json",digestsText),
  "--recovery",w("rec.json",i.recoveryText),"--approvals",w("ap.json",i.approvalsText),"--trusted-keys",w("k.json",i.trustedKeysText),
  "--trusted-keys-sha256",i.trustedKeysSha256,"--operators","operator-1",...(o.extra??[])];
 const ctx={now:NOW,headSha:SHA};
 const out=join(d,"gate.json");
 assert.equal(runCli([...args(),"--out",out],quiet,ctx),0);
 const rep=JSON.parse(readFileSync(out,"utf8"));
 assert.equal(rep.verdict,"APPROVED_FOR_STAGING_PREDEPLOY");
 assert.equal(rep.deploys,false);
 assert.equal(runCli([...args(),"--out",out],quiet,ctx),1,"existing --out must not be overwritten");
 assert.equal(runCli(args(),quiet,{now:NOW,headSha:"c".repeat(40)}),2);
 const logs=[];
 assert.equal(runCli(args(),{log:t=>logs.push(t),err(){}},{now:NOW,headSha:"c".repeat(40)}),2);
 assert.ok(JSON.parse(logs[0]).blockedReasons.some(b=>b.code==="HEAD_SHA_MISMATCH"));
 assert.equal(runCli([...args(),"--out",join(d,"x.txt")],quiet,ctx),1,"non-json output refused");
});

test("resolveHeadSha reads loose refs, detached HEAD and packed refs from .git without git",()=>{
 const root=tmp(),g=join(root,".git");
 mkdirSync(join(g,"refs/heads"),{recursive:true});
 writeFileSync(join(g,"HEAD"),"ref: refs/heads/main\n");
 writeFileSync(join(g,"refs/heads/main"),"1".repeat(40)+"\n");
 assert.equal(resolveHeadSha(root),"1".repeat(40));
 writeFileSync(join(g,"HEAD"),"2".repeat(40)+"\n");
 assert.equal(resolveHeadSha(root),"2".repeat(40));
 writeFileSync(join(g,"HEAD"),"ref: refs/heads/packed\n");
 writeFileSync(join(g,"packed-refs"),"# pack-refs\n"+"3".repeat(40)+" refs/heads/packed\n");
 assert.equal(resolveHeadSha(root),"3".repeat(40));
 assert.equal(resolveHeadSha(tmp()),null);
 assert.match(resolveHeadSha()||"",/^[0-9a-f]{40}$/,"real worktree resolves");
});
