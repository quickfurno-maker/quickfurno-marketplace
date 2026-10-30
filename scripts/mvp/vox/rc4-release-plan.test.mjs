import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,sign as edSign} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";import {dirname,resolve} from "node:path";
import {RC4_PINS} from "../../../contracts/vox/rc4ReleasePins.mjs";
import {buildRc4ReleasePlan,classifyCommand,diskReader,scanSqlObjects,sha256} from "../../../contracts/vox/rc4ReleasePlan.mjs";
import {canonicalJson,evaluateRc4Release} from "../../../contracts/vox/rc4ReleaseGates.mjs";
import {parseArgs,run} from "./rc4-release-plan.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const NOW=Date.parse("2026-10-30T12:00:00Z");
const iso=ms=>new Date(ms).toISOString();
const codes=p=>p.findings.map(f=>f.code);
const sqlFor=(create,refs=[])=>`begin;\ncreate table public.${create} (id int primary key, note text default 'padding-padding-padding-padding');\n${refs.map(r=>`select 1 from public.${r};`).join("\n")}\ncommit;\n`;
const AB7J="ops/c/20261018120000_vox_ab7j_two_person_staff_suspend_candidate.sql";
const P06="ops/p06/20261013200000_p06.sql",Q1="ops/q/20261014010000_a.sql",Q2="ops/q/20261014020000_b.sql",
 C1="ops/c/20261015010000_c.sql",OV="ops/ov/20261030010000_ov.sql";

/** Synthetic miniature release (1 P0-6 + 2 quarantined + 2 candidates + overlay) with self-consistent pins. */
function makeWorld({override={},p06=true,overlayPin=true}={}){
 const pins=structuredClone(RC4_PINS);
 const text={
  [P06]:sqlFor("vox_p06"),[Q1]:sqlFor("vox_a",p06?["vox_p06"]:[]),[Q2]:sqlFor("vox_b",["vox_a"]),
  [C1]:sqlFor("vox_c",["vox_b"]),[AB7J]:sqlFor("vox_d",["vox_c"]),[OV]:sqlFor("vox_ov",["vox_d"]),...override
 };
 const files=new Map(Object.entries(text));
 const h=p=>sha256(Buffer.from(text[p]));
 const thirty=[Q1,Q2,C1,AB7J].map((path,i)=>({order:i+1,stage:i<2?"QUARANTINED_FOUNDATION":"UNINSTALLED_CANDIDATE",
  path,sha256:h(path),bytes:Buffer.byteLength(text[path]),managedInstalled:false}));
 const digest=sha256(Buffer.from(thirty.map(f=>`${f.order}|${f.path}|${f.sha256}`).join("\n")));
 files.set("docs/fp.json",JSON.stringify({ok:true,manifestDigest:digest,files:thirty}));
 pins.source30={fingerprintPath:"docs/fp.json",manifestDigest:digest,quarantined:{dir:"ops/q",count:2},candidates:{dir:"ops/c",count:2}};
 pins.p06=p06?{path:P06,sha256:h(P06),bytes:Buffer.byteLength(text[P06])}:{path:null,sha256:null,bytes:null};
 if(!p06)files.delete(P06);
 pins.overlay={dir:"ops/ov",file:"20261030010000_ov.sql",sha256:overlayPin?h(OV):null,bytes:overlayPin?Buffer.byteLength(text[OV]):null,
  requiresPathIncludes:"20261018120000_vox_ab7j_two_person_staff_suspend_candidate.sql"};
 const fs={
  read:p=>files.has(p)?Buffer.from(files.get(p)):null,
  list:d=>[...files.keys()].filter(k=>k.startsWith(d+"/")&&!k.slice(d.length+1).includes("/")).map(k=>k.slice(d.length+1))
 };
 return {pins,files,fs,headSha:pins.rc3BaseSha,text};
}
const goodLedger=(pins,{count=86,latest="20261013144901",project=pins.stagingProjectRef,extra=[]}={})=>({
 projectRef:project,appliedCount:count+extra.length,
 versions:[...Array.from({length:count-1},(_,i)=>String(20260101000000+i)),latest,...extra]
});
const plan0=(w,ledger)=>buildRc4ReleasePlan({fs:w.fs,pins:w.pins,headSha:w.headSha,ledger:ledger??goodLedger(w.pins)});

test("plan: self-consistent synthetic release is deterministic, ordered and never ready",()=>{
 const w=makeWorld(),a=plan0(w),b=plan0(w);
 assert.deepEqual(codes(a),[],JSON.stringify(a.findings));
 assert.equal(a.planStatus,"CONSISTENT");assert.equal(a.ledgerState,"MATCH");
 assert.equal(a.planDigest,b.planDigest);assert.match(a.planDigest,/^[a-f0-9]{64}$/);
 assert.deepEqual(a.entries.map(e=>e.stage),["P0_6","QUARANTINED_FOUNDATION","QUARANTINED_FOUNDATION","UNINSTALLED_CANDIDATE","UNINSTALLED_CANDIDATE","REVIEW_ONLY_OVERLAY"]);
 assert.deepEqual(a.entries.map(e=>e.order),[1,2,3,4,5,6]);
 assert.equal(a.entries.at(-1).reviewOnly,true);
 assert.equal(a.canApply,false);assert.equal(a.migrationReady,false);assert.equal(a.executesSql,false);assert.equal(a.mode,"PLAN_ONLY");
});
test("plan: unpinned P0-6 and unpinned overlay hash are HOLD, not skipped",()=>{
 const a=plan0(makeWorld({p06:false,overlayPin:false}));
 assert.equal(a.planStatus,"HOLD");
 assert.ok(codes(a).includes("P0_6_UNPINNED"));assert.ok(codes(a).includes("OVERLAY_SHA_UNPINNED"));
 assert.equal(a.entries[0].status,"UNPINNED");assert.match(a.entries.at(-1).sha256,/^[a-f0-9]{64}$/);
});
test("plan: swapped file contents fail by hash",()=>{
 const w=makeWorld();const q1=w.files.get(Q1);w.files.set(Q1,w.files.get(Q2));w.files.set(Q2,q1);
 const a=plan0(w);
 assert.equal(a.planStatus,"FAIL");
 assert.equal(codes(a).filter(c=>c==="HASH_MISMATCH").length,2);
});
test("plan: one changed byte, a swapped P0-6 and a swapped overlay all fail",()=>{
 for(const p of [Q1,P06,OV]){
  const w=makeWorld();w.files.set(p,w.files.get(p)+"-- x\n");
  const a=plan0(w);assert.equal(a.planStatus,"FAIL",p);assert.ok(codes(a).includes("HASH_MISMATCH"),p);
 }
});
test("plan: consistently re-hashed fingerprint cannot launder edited SQL",()=>{
 const w=makeWorld();const edited=w.text[Q1]+"-- edited\n";w.files.set(Q1,edited);
 const fp=JSON.parse(w.files.get("docs/fp.json"));
 fp.files[0].sha256=sha256(Buffer.from(edited));fp.files[0].bytes=Buffer.byteLength(edited);
 w.files.set("docs/fp.json",JSON.stringify(fp));
 const a=plan0(w);
 assert.ok(codes(a).includes("SOURCE30_DIGEST_MISMATCH"));assert.equal(a.planStatus,"FAIL");
 const fp2=JSON.parse(w.files.get("docs/fp.json"));fp2.manifestDigest="0".repeat(64);w.files.set("docs/fp.json",JSON.stringify(fp2));
 assert.ok(codes(plan0(w)).includes("FINGERPRINT_DIGEST_PIN_MISMATCH"));
});
test("plan: missing, extra and reordered files are blocked",()=>{
 const m=makeWorld();m.files.delete(C1);
 assert.ok(codes(plan0(m)).includes("FILE_MISSING"));assert.ok(codes(plan0(m)).includes("MISSING_SQL_FILE"));
 const x=makeWorld();x.files.set("ops/c/20261016000000_extra.sql",sqlFor("vox_extra"));
 assert.ok(codes(plan0(x)).includes("UNEXPECTED_SQL_FILE"));
 const o=makeWorld();o.files.set("ops/ov/20261030020000_second.sql",sqlFor("vox_second"));
 assert.ok(codes(plan0(o)).includes("UNEXPECTED_OVERLAY_FILE"));
 const r=makeWorld();const fp=JSON.parse(r.files.get("docs/fp.json"));[fp.files[0],fp.files[1]]=[fp.files[1],fp.files[0]];
 r.files.set("docs/fp.json",JSON.stringify(fp));
 assert.equal(plan0(r).planStatus,"FAIL");
});
test("plan: missing dependency and dependency-order violations are blocked",()=>{
 const g=makeWorld({override:{[C1]:sqlFor("vox_c",["vox_b","vox_ghost"])}});
 const a=plan0(g);assert.ok(a.findings.some(f=>f.code==="MISSING_DEPENDENCY"&&f.detail.includes("vox_ghost")));
 const o=makeWorld({override:{[Q1]:sqlFor("vox_a",["vox_b"])}});
 assert.ok(codes(plan0(o)).includes("DEPENDENCY_ORDER_VIOLATION"));
 const noP06=makeWorld({p06:false,override:{[Q1]:sqlFor("vox_a",["vox_p06"])}});
 assert.ok(plan0(noP06).findings.some(f=>f.code==="MISSING_DEPENDENCY"&&f.detail.includes("vox_p06")));
});
test("plan: overlay needs the AB7J candidate earlier in the plan",()=>{
 const w=makeWorld();w.pins.overlay.requiresPathIncludes="nope.sql";
 assert.ok(codes(plan0(w)).includes("OVERLAY_DEPENDENCY_MISSING"));
});
test("plan: versions must ascend and stay out of supabase/migrations",()=>{
 const v=makeWorld();v.pins.p06.path="ops/p06/20261020000000_p06.sql";
 v.files.set(v.pins.p06.path,v.text[P06]);v.pins.p06.sha256=sha256(Buffer.from(v.text[P06]));
 assert.ok(codes(plan0(v)).includes("VERSION_ORDER_VIOLATION"));
 const c=makeWorld();c.files.set("supabase/migrations/20261014020000_b.sql","x");
 assert.ok(codes(plan0(c)).includes("PLAN_FILE_IN_SUPABASE_MIGRATIONS"));
});
test("plan: head SHA must equal the exact RC3 pin",()=>{
 const w=makeWorld();
 assert.ok(codes(buildRc4ReleasePlan({fs:w.fs,pins:w.pins,headSha:"a".repeat(40),ledger:goodLedger(w.pins)})).includes("BASE_SHA_MISMATCH"));
 assert.ok(codes(buildRc4ReleasePlan({fs:w.fs,pins:w.pins,ledger:goodLedger(w.pins)})).includes("HEAD_SHA_NOT_SUPPLIED"));
});
test("plan: ledger drift, stale old version 86, applied versions and wrong project",()=>{
 const w=makeWorld();
 assert.equal(plan0(w,goodLedger(w.pins)).ledgerState,"MATCH");
 const none=buildRc4ReleasePlan({fs:w.fs,pins:w.pins,headSha:w.headSha});
 assert.equal(none.ledgerState,"MISSING");assert.ok(codes(none).includes("LEDGER_EVIDENCE_MISSING"));
 const drift=plan0(w,goodLedger(w.pins,{extra:["20261013150000"]}));
 assert.equal(drift.ledgerState,"DRIFT");assert.ok(codes(drift).includes("LEDGER_DRIFT"));
 const ahead=plan0(w,goodLedger(w.pins,{extra:["20261020000000"]}));
 assert.equal(ahead.ledgerState,"BLOCKED");assert.ok(codes(ahead).includes("VERSION_BEHIND_LEDGER_HEAD"));
 const stale=plan0(w,goodLedger(w.pins,{latest:"20261001000000"}));
 assert.equal(stale.ledgerState,"BLOCKED");assert.ok(codes(stale).includes("LEDGER_STALE_OLD_VERSION"));
 const fewer=plan0(w,goodLedger(w.pins,{count:60}));assert.ok(codes(fewer).includes("LEDGER_STALE_OLD_VERSION"));
 const applied=plan0(w,goodLedger(w.pins,{extra:["20261014010000"]}));
 assert.ok(codes(applied).includes("VERSION_ALREADY_IN_LEDGER"));
 assert.ok(codes(plan0(w,goodLedger(w.pins,{project:"yqpgcsduqbxulrlzwzap"}))).includes("LEDGER_PROJECT_MISMATCH"));
 assert.ok(codes(plan0(w,{projectRef:w.pins.stagingProjectRef,appliedCount:3,versions:["20260101000000","20260101000000"]})).includes("LEDGER_INCONSISTENT"));
});
test("plan: rollback is explicit, reverse ordered and contains no executable SQL",()=>{
 const a=plan0(makeWorld());
 assert.equal(a.rollback.executableSql,null);assert.equal(a.rollback.downMigrationsAuthored,false);
 assert.equal(a.rollback.handWrittenDropForbidden,true);
 assert.equal(a.rollback.reverseOrder[0],OV);assert.equal(a.rollback.reverseOrder.at(-1),P06);
 assert.ok(a.forbiddenCommands.includes("supabase db push"));
});
test("scan: finds vox objects and ignores comments",()=>{
 const s=scanSqlObjects("-- public.vox_c\ncreate table public.vox_a(id int);\ncreate or replace function public.qf_vox_f() returns int as $$ select 1 from public.vox_a $$;");
 assert.deepEqual(s.defs,["qf_vox_f","vox_a"]);assert.deepEqual(s.refs,["qf_vox_f","vox_a"]);
});
test("commands: blanket db push, ledger repair, psql -f and merges are never allowed",()=>{
 for(const c of ["supabase db push","supabase db push --include-all","supabase migration repair --status applied 20261014010000","psql -f x.sql","psql postgres://h/db -c 'select 1'","gh pr merge 446","git push origin main","supabase db reset --linked"])
  assert.equal(classifyCommand(c).allowed,false,c);
 assert.equal(classifyCommand("supabase db push").code,"BLANKET_DB_PUSH");
 assert.equal(classifyCommand("").allowed,false);
});

// ---------- gates ----------
function gateWorld({goEnabled=false}={}){
 const w=makeWorld();w.pins.goEnabled=goEnabled;w.pins.ownerId="owner-a";
 const keys={};let n=0;
 const addKey=(role,signerId,keyId=`k-${role}-${signerId}`)=>{
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  w.pins.signerKeys.push({keyId,role,signerId,publicKeyPem:publicKey.export({type:"spki",format:"pem"})});
  return keys[keyId]={keyId,role,signerId,privateKey};
 };
 const plan=plan0(w);
 const mk=(key,purpose,extra={},{mutate,planDigest,issuedAt,expiresAt,nonce}={})=>{
  const payload={role:key.role,purpose,signerId:key.signerId,signerKind:"HUMAN",planDigest:planDigest??plan.planDigest,
   issuedAt:issuedAt??iso(NOW-60e3),expiresAt:expiresAt??iso(NOW+3600e3),nonce:nonce??`nonce-${String(++n).padStart(16,"0")}`,...extra};
  const signature=edSign(null,Buffer.from(canonicalJson(payload)),key.privateKey).toString("base64");
  if(mutate)mutate(payload);
  return {keyId:key.keyId,payload,signature};
 };
 const k={dba:addKey("DBA","dba-1"),appsec:addKey("APPSEC","sec-1"),owner:addKey("OWNER","owner-a"),
  tl:addKey("TEAM_LEADER","tl-1"),rel:addKey("RELEASE_SIGNER","rel-1")};
 const evidence=(o={})=>({
  authorIds:["claude-session"],
  dba:mk(k.dba,"RC4_SIGNOFF"),appsec:mk(k.appsec,"RC4_SIGNOFF"),
  backup:mk(k.dba,"BACKUP_RESTORE",{projectRef:w.pins.stagingProjectRef,includesOwner:true,includesAcl:true,includesRoles:true,
   restoreRehearsalPassed:true,restoreCompareDigest:"a".repeat(64),backupArtifactSha256:"b".repeat(64),takenAt:iso(NOW-3600e3),
   rollbackPlanSha256:"c".repeat(64),rollbackRehearsed:true}),
  owner:mk(k.owner,"OWNER_AAL2",{aal:"aal2",mfaVerifiedAt:iso(NOW-60e3)}),
  teamLeader:mk(k.tl,"TEAM_LEADER_AAL2",{aal:"aal2",mfaVerifiedAt:iso(NOW-60e3)}),
  image:mk(k.rel,"SIGNED_IMAGE",{imageDigest:"sha256:"+"d".repeat(64),sourceSha:w.pins.rc3BaseSha}),
  flags:{VOX_STAFF_PORTAL_ENABLED:"false",VOX_TEAM_WORKSPACE_ENABLED:false,VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED:"false"},
  ...o
 });
 const ev=(o,opts)=>evaluateRc4Release({plan,evidence:evidence(o),pins:w.pins,nowMs:NOW,options:opts});
 return {w,plan,k,mk,addKey,evidence,ev};
}
const status=(r,id)=>r.gates.find(g=>g.id===id);

test("gates: every gate can pass yet GO stays reserved and nothing is ready",()=>{
 const g=gateWorld(),r=g.ev();
 assert.deepEqual(r.gates.filter(x=>x.status!=="PASS").map(x=>x.id),["GO_SWITCH"],JSON.stringify(r.gates));
 assert.equal(r.verdict,"HOLD");assert.equal(r.goEligible,false);
 assert.equal(r.canApply,false);assert.equal(r.migrationReady,false);
});
test("gates: even with the GO switch on, the result is only eligibility for a human",()=>{
 const r=gateWorld({goEnabled:true}).ev();
 assert.equal(r.verdict,"GO_ELIGIBLE_FOR_HUMAN_DECISION");assert.equal(r.canApply,false);assert.equal(r.migrationReady,false);
});
test("gates: shipped pins have no signer keys, no owner and GO off",()=>{
 assert.equal(RC4_PINS.goEnabled,false);assert.deepEqual(RC4_PINS.signerKeys,[]);assert.equal(RC4_PINS.ownerId,null);
 assert.throws(()=>{"use strict";RC4_PINS.goEnabled=true});
 const r=evaluateRc4Release({plan:gateWorld().plan,evidence:{},nowMs:NOW});
 assert.notEqual(r.verdict,"GO_ELIGIBLE_FOR_HUMAN_DECISION");
 for(const id of ["DBA_SIGNOFF","APPSEC_SIGNOFF","BACKUP_RESTORE","OWNER_AAL2","TEAM_LEADER_AAL2","SIGNED_IMAGE","FEATURE_FLAGS_OFF"])
  assert.equal(status(r,id).status,"HOLD",id);
});
test("gates: missing DBA or AppSec signoff holds",()=>{
 const g=gateWorld();
 assert.equal(status(g.ev({dba:undefined}),"DBA_SIGNOFF").status,"HOLD");
 assert.equal(status(g.ev({appsec:undefined}),"APPSEC_SIGNOFF").status,"HOLD");
 assert.equal(g.ev({dba:undefined}).verdict,"HOLD");
});
test("gates: signoff independence (same person, owner, author, AI) fails",()=>{
 const g=gateWorld();
 const dbaAsSec=g.addKey("APPSEC","dba-1","k-sec-dba");
 assert.equal(status(g.ev({appsec:g.mk(dbaAsSec,"RC4_SIGNOFF")}),"APPSEC_SIGNOFF").code,"INDEPENDENCE_VIOLATION");
 const ownerAsDba=g.addKey("DBA","owner-a","k-dba-owner");
 assert.equal(status(g.ev({dba:g.mk(ownerAsDba,"RC4_SIGNOFF")}),"DBA_SIGNOFF").code,"INDEPENDENCE_VIOLATION");
 const author=g.addKey("APPSEC","claude-session","k-sec-author");
 assert.equal(status(g.ev({appsec:g.mk(author,"RC4_SIGNOFF")}),"APPSEC_SIGNOFF").code,"INDEPENDENCE_VIOLATION");
 assert.equal(status(g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{signerKind:"AI"})}),"DBA_SIGNOFF").code,"NOT_A_HUMAN_SIGNER");
 assert.equal(status(g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{aiGenerated:true})}),"DBA_SIGNOFF").code,"NOT_A_HUMAN_SIGNER");
});
test("gates: forged, tampered, replayed, expired or other-plan signatures fail",()=>{
 const g=gateWorld();
 assert.equal(status(g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{},{mutate:p=>{p.planDigest="f".repeat(64)}})}),"DBA_SIGNOFF").code,"PLAN_DIGEST_MISMATCH");
 assert.equal(status(g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{},{mutate:p=>{p.nonce="tampered-nonce-0001"}})}),"DBA_SIGNOFF").code,"BAD_SIGNATURE");
 assert.equal(status(g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{},{planDigest:"e".repeat(64)})}),"DBA_SIGNOFF").code,"PLAN_DIGEST_MISMATCH");
 assert.equal(status(g.ev({dba:{...g.mk(g.k.dba,"RC4_SIGNOFF"),keyId:"unknown"}}),"DBA_SIGNOFF").code,"UNPINNED_KEY");
 const wrongKey={...g.mk(g.k.dba,"RC4_SIGNOFF"),signature:g.mk(g.k.appsec,"RC4_SIGNOFF").signature};
 assert.equal(status(g.ev({dba:wrongKey}),"DBA_SIGNOFF").code,"BAD_SIGNATURE");
 assert.equal(status(g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{},{expiresAt:iso(NOW-1000)})}),"DBA_SIGNOFF").code,"ENVELOPE_NOT_CURRENT");
 assert.equal(status(g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{},{issuedAt:iso(NOW+1e6),expiresAt:iso(NOW+2e6)})}),"DBA_SIGNOFF").code,"ENVELOPE_NOT_CURRENT");
 const dup="shared-nonce-000001";
 const r=g.ev({dba:g.mk(g.k.dba,"RC4_SIGNOFF",{},{nonce:dup}),appsec:g.mk(g.k.appsec,"RC4_SIGNOFF",{},{nonce:dup})});
 assert.equal(status(r,"APPSEC_SIGNOFF").code,"NONCE_INVALID_OR_REPLAYED");
 assert.equal(g.ev({usedNonces:["x"]}).verdict,"HOLD");
 const prior=g.evidence();const replay=g.ev({...prior,usedNonces:[prior.dba.payload.nonce]});
 assert.equal(status(replay,"DBA_SIGNOFF").code,"NONCE_INVALID_OR_REPLAYED");
 const roleSwap=g.mk(g.k.appsec,"RC4_SIGNOFF");
 assert.equal(status(g.ev({dba:roleSwap}),"DBA_SIGNOFF").code,"ROLE_MISMATCH");
});
test("gates: Owner mismatch, missing AAL2, stale MFA and Owner==TL fail",()=>{
 const g=gateWorld();
 const impostor=g.addKey("OWNER","owner-x");
 assert.equal(status(g.ev({owner:g.mk(impostor,"OWNER_AAL2",{aal:"aal2",mfaVerifiedAt:iso(NOW-1000)})}),"OWNER_AAL2").code,"OWNER_MISMATCH");
 assert.equal(status(g.ev({owner:g.mk(g.k.owner,"OWNER_AAL2",{aal:"aal1",mfaVerifiedAt:iso(NOW-1000)})}),"OWNER_AAL2").code,"AAL2_MISSING_OR_STALE");
 assert.equal(status(g.ev({owner:g.mk(g.k.owner,"OWNER_AAL2",{aal:"aal2",mfaVerifiedAt:iso(NOW-3600e3)})}),"OWNER_AAL2").code,"AAL2_MISSING_OR_STALE");
 assert.equal(status(g.ev({teamLeader:g.mk(g.k.tl,"TEAM_LEADER_AAL2",{aal:"aal2"})}),"TEAM_LEADER_AAL2").code,"AAL2_MISSING_OR_STALE");
 const tlAsOwner=g.addKey("TEAM_LEADER","owner-a","k-tl-owner");
 assert.equal(status(g.ev({teamLeader:g.mk(tlAsOwner,"TEAM_LEADER_AAL2",{aal:"aal2",mfaVerifiedAt:iso(NOW-1000)})}),"TEAM_LEADER_AAL2").code,"INDEPENDENCE_VIOLATION");
 const unpinned=gateWorld();unpinned.w.pins.ownerId=null;
 assert.equal(status(unpinned.ev(),"OWNER_AAL2").code,"OWNER_NOT_PINNED");
});
test("gates: backup restore and rollback attestations must be complete and fresh",()=>{
 const g=gateWorld();
 const b=(extra,opts)=>g.mk(g.k.dba,"BACKUP_RESTORE",{projectRef:g.w.pins.stagingProjectRef,includesOwner:true,includesAcl:true,includesRoles:true,
  restoreRehearsalPassed:true,restoreCompareDigest:"a".repeat(64),backupArtifactSha256:"b".repeat(64),takenAt:iso(NOW-3600e3),
  rollbackPlanSha256:"c".repeat(64),rollbackRehearsed:true,...extra},opts);
 for(const bad of [{includesAcl:false},{includesOwner:false},{includesRoles:false},{restoreRehearsalPassed:false},
  {projectRef:"yqpgcsduqbxulrlzwzap"},{takenAt:iso(NOW-48*3600e3)},{restoreCompareDigest:"nothex"}])
  assert.equal(status(g.ev({backup:b(bad)}),"BACKUP_RESTORE").status,"FAIL",JSON.stringify(bad));
 assert.equal(status(g.ev({backup:b({rollbackRehearsed:false})}),"ROLLBACK_PLAN").status,"FAIL");
 assert.equal(status(g.ev({backup:b({rollbackPlanSha256:"short"})}),"ROLLBACK_PLAN").status,"FAIL");
 assert.equal(status(g.ev({backup:undefined}),"BACKUP_RESTORE").status,"HOLD");
});
test("gates: signed image must be bound to the pinned RC3 source",()=>{
 const g=gateWorld();
 const i=extra=>g.mk(g.k.rel,"SIGNED_IMAGE",{imageDigest:"sha256:"+"d".repeat(64),sourceSha:g.w.pins.rc3BaseSha,...extra});
 assert.equal(status(g.ev({image:i({sourceSha:"b".repeat(40)})}),"SIGNED_IMAGE").status,"FAIL");
 assert.equal(status(g.ev({image:i({imageDigest:"latest"})}),"SIGNED_IMAGE").status,"FAIL");
 assert.equal(status(g.ev({image:undefined}),"SIGNED_IMAGE").status,"HOLD");
});
test("gates: feature flags must be reported and off",()=>{
 const g=gateWorld();
 assert.equal(status(g.ev({flags:undefined}),"FEATURE_FLAGS_OFF").status,"HOLD");
 assert.equal(status(g.ev({flags:{VOX_STAFF_PORTAL_ENABLED:"false"}}),"FEATURE_FLAGS_OFF").code,"REQUIRED_FLAG_NOT_REPORTED");
 const base={VOX_STAFF_PORTAL_ENABLED:"false",VOX_TEAM_WORKSPACE_ENABLED:"false",VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED:"false"};
 for(const on of ["true",true,"1","ON"])
  assert.equal(status(g.ev({flags:{...base,VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED:on}}),"FEATURE_FLAGS_OFF").status,"FAIL");
 assert.equal(status(g.ev({flags:{...base,VOX_EOD_SUBMIT_UI_ENABLED:"true"}}),"FEATURE_FLAGS_OFF").status,"FAIL");
 assert.equal(status(g.ev({flags:{...base,VOX_STAFF_PORTAL_ENABLED:"maybe"}}),"FEATURE_FLAGS_OFF").status,"FAIL");
});
test("gates: forced unsafe GO and spoofed verdicts are rejected",()=>{
 const g=gateWorld();
 for(const opts of [{force:true},{forceGo:true},{go:true},{apply:true},{execute:true},{skipGates:true},{bypass:true},{dbUrl:"postgres://x"},{push:true},{repair:true},{merge:true},{promote:true}]){
  const r=g.ev({},opts);
  assert.equal(r.verdict,"FAIL",JSON.stringify(opts));assert.equal(r.gates[0].code,"FORCED_OR_SPOOFED_REQUEST_REJECTED");
  assert.equal(r.canApply,false);assert.equal(r.migrationReady,false);
 }
 for(const spoof of [{goEligible:true},{verdict:"GO_ELIGIBLE_FOR_HUMAN_DECISION"},{canApply:true},{migrationReady:true}])
  assert.equal(g.ev(spoof).verdict,"FAIL",JSON.stringify(spoof));
 const failedPlan=plan0(makeWorld({override:{[C1]:sqlFor("vox_c",["vox_ghost"])}}));
 const r=evaluateRc4Release({plan:failedPlan,evidence:g.evidence(),pins:g.w.pins,nowMs:NOW});
 assert.equal(r.verdict,"FAIL");assert.equal(status(r,"PLAN_CONSISTENT").status,"FAIL");
});
test("gates: a plan that claims it can apply is rejected",()=>{
 const g=gateWorld();
 for(const forged of [{...g.plan,canApply:true},{...g.plan,migrationReady:true},{...g.plan,executesSql:true},{schema:"x"},null]){
  const r=evaluateRc4Release({plan:forged,evidence:g.evidence(),pins:g.w.pins,nowMs:NOW});
  assert.equal(r.verdict,"FAIL");
 }
});
test("gates: ledger drift keeps the release on hold even with full signoffs",()=>{
 const g=gateWorld();
 const drift=plan0(g.w,goodLedger(g.w.pins,{extra:["20261013150000"]}));
 const r=evaluateRc4Release({plan:drift,evidence:g.evidence(),pins:{...g.w.pins,goEnabled:true},nowMs:NOW});
 assert.equal(drift.planDigest,g.plan.planDigest); // ledger evidence is not part of the signed digest
 assert.equal(status(r,"LEDGER_MATCHES_PIN").status,"HOLD");
 assert.equal(status(r,"PLAN_CONSISTENT").status,"HOLD");
 assert.equal(r.verdict,"HOLD");assert.equal(r.goEligible,false);
});

// ---------- CLI and structure ----------
test("cli: dangerous or unknown flags exit 64 and nothing runs",()=>{
 for(const flag of ["--apply","--execute","--push","--repair","--merge","--promote","--force","--go","--yes","--db-url","--linked","--skip-gates","--sql","--migrate"])
  assert.ok(parseArgs(["plan",flag]).error,flag);
 assert.equal(run(["plan","--apply"]).code,64);
 assert.equal(run(["plan","--db-url","postgres://x"]).code,64);
 assert.equal(run(["apply"]).code,64);
 assert.equal(run([]).code,64);
 assert.equal(run(["plan","--head-sha"]).code,64);
 assert.equal(run(["evaluate","--head-sha","a".repeat(40)]).code,64);
});
test("cli: refuses to write reports into SQL-bearing directories",()=>{
 assert.throws(()=>run(["plan","--head-sha",RC4_PINS.rc3BaseSha,"--out",resolve(root,"supabase/migrations/x.json")]),/OUTPUT_PATH_NOT_ALLOWED/);
 assert.throws(()=>run(["plan","--head-sha",RC4_PINS.rc3BaseSha,"--out",resolve(root,"ops/vox/x.json")]),/OUTPUT_PATH_NOT_ALLOWED/);
 assert.throws(()=>run(["plan","--head-sha",RC4_PINS.rc3BaseSha,"--out",resolve(root,"x.sql")]),/OUTPUT_PATH_NOT_ALLOWED/);
});
test("real tree: plan is source-only, ordered with P0-6 first and overlay last, and not ready",()=>{
 const a=buildRc4ReleasePlan({fs:diskReader(root),headSha:RC4_PINS.rc3BaseSha}),b=buildRc4ReleasePlan({fs:diskReader(root),headSha:RC4_PINS.rc3BaseSha});
 assert.equal(a.planDigest,b.planDigest);
 assert.equal(a.entries[0].stage,"P0_6");assert.equal(a.entries.at(-1).stage,"REVIEW_ONLY_OVERLAY");
 assert.notEqual(a.planStatus,"CONSISTENT");assert.equal(a.canApply,false);assert.equal(a.migrationReady,false);
 assert.ok(codes(a).includes("P0_6_UNPINNED"));assert.ok(codes(a).includes("OVERLAY_SHA_UNPINNED"));
 assert.ok(codes(a).includes("LEDGER_EVIDENCE_MISSING"));
 const r=run(["plan","--head-sha",RC4_PINS.rc3BaseSha]);
 assert.ok([0,2].includes(r.code));assert.equal(JSON.parse(r.stdout).migrationReady,false);
 const g=evaluateRc4Release({plan:a,evidence:{},nowMs:NOW});
 assert.notEqual(g.verdict,"GO_ELIGIBLE_FOR_HUMAN_DECISION");
});
test("structure: tooling has no network, shell, env or database access and writes only via the CLI",()=>{
 const read=p=>readFileSync(resolve(root,p),"utf8");
 const banned=["child_process","process.env","fetch(","node:net","node:http","node:https","node:dns","require(","pg\"","@supabase"];
 for(const p of ["contracts/vox/rc4ReleasePlan.mjs","contracts/vox/rc4ReleaseGates.mjs","contracts/vox/rc4ReleasePins.mjs","scripts/mvp/vox/rc4-release-plan.mjs"]){
  const s=read(p);for(const b of banned)assert.equal(s.includes(b),false,`${p} contains ${b}`);
 }
 for(const p of ["contracts/vox/rc4ReleasePlan.mjs","contracts/vox/rc4ReleaseGates.mjs","contracts/vox/rc4ReleasePins.mjs"])
  assert.equal(/writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync/.test(read(p)),false,p);
 assert.equal(/writeFileSync/.test(read("scripts/mvp/vox/rc4-release-plan.mjs")),true);
});
