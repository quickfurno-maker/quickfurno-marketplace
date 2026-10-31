#!/usr/bin/env node
// RC35 c-eod: signed-approval -> pending human-review receipt, end to end.
// Real ed25519 signed bytes -> real rc8 PG writer (PG17 SERIALIZABLE) -> the
// REAL services/vox/rc28PendingSignedEodReview.ts bundled with the REAL rc8
// reconciler. Only Supabase Auth bearer verification and `server-only` are
// replaced (no network / secrets). TEST ONLY: synthetic keys and humans,
// loopback ephemeral docker postgres, no provider, no official EOD.
import {Pool} from "pg";
import {build} from "esbuild";
import {execFileSync} from "node:child_process";
import {readFileSync,mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mintRc4VerifiedAuthContext,rc4RegistryFingerprint,rc4ScopeTargetHash}
 from "../../../contracts/vox/rc4ApprovalPipeline.mjs";
import {canonicalAb7kApprovalBytes}
 from "../../../contracts/vox/ab7kSignedApprovalVerifier.mjs";
import {executeRc8PgPendingSignedIntent} from "./rc8-pg-signed-intent-writer.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const image="postgres:17-alpine",container="qf-vox-rc35-eod-review-pg";
const docker=(args)=>execFileSync("docker",args,
 {encoding:"utf8",windowsHide:true,timeout:20000}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const eq=(a,b,label)=>{if(a!==b)throw Error(label+" expected="+b+" actual="+a)};
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=1_800_000_000_000;
const OWNER=id(1),TL=id(2),TEAM=id(3),CITY=id(4),SUB=id(5),STAFF=id(90);
const OTHER_OWNER=id(11),OTHER_TL=id(12),OTHER_TEAM=id(13);
const TYPE="EOD_OFFICIAL_RELEASE",DIGEST="b".repeat(64);
function signer(keyId,signerId,role){
 const pair=generateKeyPairSync("ed25519");
 return {pair,entry:{keyId,signerId,signerRole:role,
  publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}),
  publicKeyFingerprint:createHash("sha256").update(pair.publicKey.export({type:"spki",format:"der"})).digest("hex"),
  notBeforeMs:now-60000,notAfterMs:now+420000}};
}
const owner=signer("owner-rc35",OWNER,"OWNER"),leader=signer("tl-rc35",TL,"TEAM_LEADER");
const registry=[owner.entry,leader.entry],fingerprint=rc4RegistryFingerprint(registry);
const auth=(userId,values)=>mintRc4VerifiedAuthContext({userId,
 sessionId:id(userId===OWNER?80:81),jwtRole:"authenticated",aal:"aal2",
 aal2AtMs:now-1000,sessionExpiresAtMs:now+600000,profileRole:null,profileActive:true,
 staffRole:null,teamId:null,cityId:null,membershipRevokedAtMs:null,
 membershipExpiresAtMs:null,...values});
const ownerAuth=auth(OWNER,{profileRole:"admin"});
const teamLeaderAuth=auth(TL,{staffRole:"team_leader",teamId:TEAM,cityId:CITY,
 membershipExpiresAtMs:now+600000});
const envelope=(s,num)=>{
 const payload={domain:"qf.vox.ab7k.signed-approval",version:"v1",type:TYPE,
  environment:"staging",keyId:s.entry.keyId,signerRole:s.entry.signerRole,
  signerId:s.entry.signerId,ownerId:OWNER,teamLeaderId:TL,subjectId:SUB,digest:DIGEST,
  targetHash:rc4ScopeTargetHash({type:TYPE,subjectId:SUB,teamId:TEAM,cityId:CITY}),
  nonce:id(num),issuedAtMs:now-1000,expiresAtMs:now+540000};
 return {payload,signature:sign(null,canonicalAb7kApprovalBytes(payload),
  s.pair.privateKey).toString("base64url")};
};
const request=(o=7,t=8)=>({type:TYPE,subjectId:SUB,digest:DIGEST,teamId:TEAM,
 cityId:CITY,ownerEnvelope:envelope(owner,o),teamLeaderEnvelope:envelope(leader,t)});
const GATE={humanKeyCeremonyComplete:true,independentDbaAppsecApproved:true,
 dedicatedWriterRoleReviewed:true,managedRestoreCertified:true};
const REPORT="public.vox_ab7f_four_source_eod_candidate_v1";
let pool,created=false;
try{
 if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))
  throw Error("REMOTE_DOCKER_REFUSED");
 docker(["image","inspect",image]);
 if(docker(["ps","-aq","--filter","name=^/"+container+"$"]))throw Error("CONTAINER_ALREADY_EXISTS");
 docker(["run","--pull","never","--rm","-d","--name",container,"-p","127.0.0.1::5432",
  "-e","POSTGRES_PASSWORD=synthetic_only",image]);
 created=true;
 let port=0,ready=false;
 for(let i=0;i<160&&!ready;i++){
  try{
   const m=docker(["port",container,"5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/m);
   if(m)port=Number(m[1]);
   if(port){
    const probe=new Pool({host:"127.0.0.1",port,user:"postgres",password:"synthetic_only",
     database:"postgres",max:1,connectionTimeoutMillis:1200});
    try{ready=(await probe.query("SELECT 1 AS ready")).rows[0]?.ready===1}finally{await probe.end()}
   }
  }catch{ready=false}
  if(!ready)await sleep(200);
 }
 if(!ready)throw Error("PG17_HOST_TCP_NOT_READY");
 pool=new Pool({host:"127.0.0.1",port,user:"postgres",password:"synthetic_only",
  database:"postgres",max:6,connectionTimeoutMillis:5000});
 await pool.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN");
 await pool.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb NOT NULL)");
 await pool.query("CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean NOT NULL)");
 await pool.query("CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean NOT NULL)");
 await pool.query("CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz)");
 await pool.query("CREATE TABLE "+REPORT+"(id uuid PRIMARY KEY,staff_id uuid,team_id uuid,city_id uuid,reviewer_id uuid,source_count integer,source_digest text,state text,published boolean)");
 await pool.query("INSERT INTO public.profiles VALUES ($1,'admin',true),($2,NULL,true),($3,NULL,true),($4,'admin',true),($5,NULL,true)",
  [OWNER,TL,STAFF,OTHER_OWNER,OTHER_TL]);
 await pool.query("INSERT INTO auth.users VALUES($1,'{\"admin_role\":\"Superadmin\"}'),($2,'{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}'),($3,'{\"qf_principal\":\"vox_staff\",\"vox_role\":\"operations_manager\"}'),($4,'{\"admin_role\":\"Superadmin\"}'),($5,'{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}')",
  [OWNER,TL,STAFF,OTHER_OWNER,OTHER_TL]);
 await pool.query("INSERT INTO public.vox_staff_teams_v1 VALUES ($1,$2,true),($3,$2,true)",[TEAM,CITY,OTHER_TEAM]);
 await pool.query("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,'team_leader',true,NULL,clock_timestamp()+interval '30 days'),($3,$2,'operations_manager',true,NULL,clock_timestamp()+interval '30 days'),($4,$5,'team_leader',true,NULL,clock_timestamp()+interval '30 days')",
  [TL,TEAM,STAFF,OTHER_TL,OTHER_TEAM]);
 await pool.query("INSERT INTO "+REPORT+" VALUES($1,$2,$3,$4,$5,4,$6,'TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE',false)",
  [SUB,STAFF,TEAM,CITY,TL,DIGEST]);
 for(const f of ["20261030010000_vox_rc8_signed_intent_transaction_review_only.sql",
  "20261030030000_vox_rc11_signer_revocation_lock_review_only.sql"])
  await pool.query(readFileSync(resolve(root,"ops/vox/rc7-review-candidates",f),"utf8"));
 for(const e of registry)
  await pool.query("INSERT INTO public.vox_rc8_human_signer_registry_candidate_v1 "+
   "(key_id,signer_id,signer_role,public_key_pem,public_key_fingerprint,not_before_ms,not_after_ms,human_enrolled,enrolled_at) "+
   "VALUES ($1,$2,$3,$4,$5,$6,$7,true,clock_timestamp())",
   [e.keyId,e.signerId,e.signerRole,e.publicKeyPem,e.publicKeyFingerprint,e.notBeforeMs,e.notAfterMs]);

 // Bundle the real review service + real rc8 writer/reconciler. Only the Auth
 // bearer verifiers and server-only marker are stubbed (globals set below).
 mkdirSync(resolve(root,"test-results"),{recursive:true});
 const outfile=resolve(root,"test-results/rc35-eod-signed-review-pg17.mjs");
 await build({entryPoints:[resolve(root,"services/vox/rc28PendingSignedEodReview.ts")],
  bundle:true,platform:"node",format:"esm",target:"node20",outfile,logLevel:"silent",
  external:["pg"],plugins:[{name:"auth-stub",setup(b){
   b.onResolve({filter:/^server-only$/},()=>({namespace:"stub",path:"server"}));
   b.onResolve({filter:/verifiedStaffBearer$/},()=>({namespace:"stub",path:"auth"}));
   b.onLoad({filter:/.*/,namespace:"stub"},({path})=>({loader:"js",contents:path==="auth"?
    "export async function verifyVoxOwnerBearer(){globalThis.__owner.calls++;return globalThis.__owner.revokeAfter&&globalThis.__owner.calls>globalThis.__owner.revokeAfter?null:globalThis.__owner.id}"+
    "export async function verifyVoxTeamLeaderBearer(){globalThis.__tl.calls++;return globalThis.__tl.revokeAfter&&globalThis.__tl.calls>globalThis.__tl.revokeAfter?null:globalThis.__tl.value}":""}));
  }}]});
 const {verifyRc28PendingEodForHumanReview:review}=await import(pathToFileURL(outfile).href);
 const tlValue=(o={})=>({userId:TL,aal:"aal2",expiresAtMs:Date.now()+60000,teamId:TEAM,cityId:CITY,...o});
 const as=(ownerId,tl,revokeAfter={})=>{
  globalThis.__owner={id:ownerId,calls:0,revokeAfter:revokeAfter.owner??0};
  globalThis.__tl={value:tl,calls:0,revokeAfter:revokeAfter.tl??0};
 };
 const acquire=()=>pool.connect();
 const counts=async()=>({
  claims:Number((await pool.query("SELECT count(*)::int AS n FROM public.vox_rc8_approval_claims_candidate_v1")).rows[0].n),
  intents:Number((await pool.query("SELECT count(*)::int AS n FROM public.vox_rc8_verified_intents_candidate_v1")).rows[0].n)});
 const denied=(r,reason,label)=>{eq(r.ok,false,label+"_OK");eq(r.reason,reason,label);
  eq(r.publicationAuthorized,false,label+"_NO_PUB");eq(r.approved,false,label+"_NO_APPROVE");
  eq(r.providerMessagesSent,0,label+"_NO_PROVIDER");};

 // 1. Real signed bytes -> real PG pending receipt.
 const w=await executeRc8PgPendingSignedIntent({acquireClient:acquire,request:request(),
  ownerAuth,teamLeaderAuth,now,approvedRegistryFingerprints:[fingerprint]},GATE);
 eq(w.ok,true,"WRITER_COMMITTED");eq(w.state,"AWAITING_EXTERNAL_REVIEW","WRITER_STATE");
 const input={intentId:w.intentId,subjectId:SUB,expectedReceiptSha256:w.receiptSha256};
 let c=await counts();eq(c.claims,3,"THREE_CLAIMS");eq(c.intents,1,"ONE_INTENT");

 // 2. Distinct, rechecked-AAL2 Owner+TL who signed THIS receipt -> pending review only.
 as(OWNER,tlValue());
 let r=await review("owner","tl",input,acquire);
 eq(r.ok,true,"REVIEW_PENDING_OK");
 eq(r.state,"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW","REVIEW_STATE");
 eq(r.receiptSha256,w.receiptSha256,"REVIEW_RECEIPT_DIGEST");
 eq(r.publicationAuthorized,false,"REVIEW_NO_PUB");eq(r.approved,false,"REVIEW_NO_APPROVE");
 eq(r.providerMessagesSent,0,"REVIEW_NO_PROVIDER");
 eq(globalThis.__owner.calls,2,"OWNER_AAL2_RECHECKED");
 eq(globalThis.__tl.calls,2,"TL_AAL2_RECHECKED");

 // 3. Receipt digest / identity binding.
 denied(await review("owner","tl",{...input,expectedReceiptSha256:"c".repeat(64)},acquire),
  "SIGNED_INTENT_NOT_DURABLY_PENDING","WRONG_RECEIPT_DIGEST");
 as(OWNER,tlValue());
 denied(await review("owner","tl",{...input,intentId:id(777)},acquire),
  "SIGNED_INTENT_NOT_DURABLY_PENDING","UNKNOWN_INTENT");
 as(OWNER,tlValue());
 denied(await review("owner","tl",{...input,publicationAuthorized:true},acquire),
  "SIGNED_INTENT_INPUT_INVALID","CALLER_PUBLICATION_FLAG");

 // 4. Actors: distinct Owner/TL, AAL2, and the receipt's own signer/team scope.
 as(TL,tlValue());
 denied(await review("o","t",input,acquire),"DISTINCT_OWNER_AND_TL_AAL2_REQUIRED","SAME_HUMAN_BOTH_ROLES");
 as(OWNER,tlValue({aal:"aal1"}));
 denied(await review("o","t",input,acquire),"DISTINCT_OWNER_AND_TL_AAL2_REQUIRED","TL_AAL1");
 as(OWNER,tlValue({expiresAtMs:Date.now()-1}));
 denied(await review("o","t",input,acquire),"DISTINCT_OWNER_AND_TL_AAL2_REQUIRED","TL_SESSION_EXPIRED");
 as(OTHER_OWNER,tlValue());
 denied(await review("o","t",input,acquire),"REVIEWER_NOT_RECEIPT_SIGNER_SCOPE","OTHER_OWNER");
 as(OWNER,tlValue({userId:OTHER_TL,teamId:OTHER_TEAM}));
 denied(await review("o","t",input,acquire),"REVIEWER_NOT_RECEIPT_SIGNER_SCOPE","OTHER_TEAM_TL");
 as(OWNER,tlValue({cityId:id(99)}));
 denied(await review("o","t",input,acquire),"REVIEWER_NOT_RECEIPT_SIGNER_SCOPE","OTHER_CITY_TL");

 // 5. AAL2 lost while PG reconciliation runs (acquire is awaited between the checks).
 as(OWNER,tlValue(),{owner:1});
 denied(await review("o","t",input,acquire),"HUMAN_AAL2_REVOKED_DURING_RECONCILIATION","OWNER_REVOKED_MID");
 as(OWNER,tlValue(),{tl:1});
 denied(await review("o","t",input,acquire),"HUMAN_AAL2_REVOKED_DURING_RECONCILIATION","TL_REVOKED_MID");

 // 6. Report drift after commit: the signed digest/four-source state is no longer current.
 for(const [sql,vals,label] of [
  ["UPDATE "+REPORT+" SET source_digest=$2 WHERE id=$1",[SUB,"d".repeat(64)],"DIGEST_DRIFT"],
  ["UPDATE "+REPORT+" SET published=true WHERE id=$1",[SUB],"ALREADY_PUBLISHED"],
  ["UPDATE "+REPORT+" SET source_count=3 WHERE id=$1",[SUB],"THREE_SOURCES"],
  ["UPDATE "+REPORT+" SET state='DRAFT' WHERE id=$1",[SUB],"STATE_DRIFT"]]){
  await pool.query(sql,vals);
  as(OWNER,tlValue());
  denied(await review("o","t",input,acquire),"SIGNED_INTENT_NOT_DURABLY_PENDING",label);
  await pool.query("UPDATE "+REPORT+" SET source_digest=$2,published=false,source_count=4,"+
   "state='TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE' WHERE id=$1",[SUB,DIGEST]);
 }
 as(OWNER,tlValue());
 eq((await review("o","t",input,acquire)).ok,true,"REVIEW_RESTORED_OK");

 // 7. Revoked signer key (real native revocation function) denies the review.
 const rev=await pool.query("SELECT public.qf_vox_rc11_revoke_signed_human_key_candidate_v1($1,$2) AS revoked",
  [leader.entry.keyId,"f".repeat(64)]);
 eq(rev.rows[0].revoked,true,"KEY_REVOKED");
 as(OWNER,tlValue());
 denied(await review("o","t",input,acquire),"SIGNED_INTENT_NOT_DURABLY_PENDING","REVOKED_SIGNER_KEY");

 // 8. Review is read-only: it consumed no nonce and created no receipt.
 c=await counts();eq(c.claims,3,"REVIEW_READONLY_CLAIMS");eq(c.intents,1,"REVIEW_READONLY_INTENTS");
 console.log("VOX_RC35_EOD_SIGNED_REVIEW_PG17_PASS real_ed25519_bytes=true real_pg17_writer=true "+
  "real_reconciler=true distinct_owner_tl_aal2_rechecked=true scope_bound=true "+
  "report_drift_denied=true revoked_signer_denied=true readonly=true "+
  "publication=false official_eod=false provider_messages=0");
}catch(e){console.error("VOX_RC35_EOD_SIGNED_REVIEW_PG17_FAIL "+String(e?.stack||e));process.exitCode=1;}
finally{
 if(pool)try{await pool.end()}catch{}
 if(created)try{docker(["rm","-f","-v",container])}catch{}
}
