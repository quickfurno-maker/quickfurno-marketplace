#!/usr/bin/env node
// RC41 c-eod: executable PG17 proof of the review-only signed-EOD snapshot RPC.
// Real ed25519 signed bytes -> real rc8 PG writer -> the REAL RC41 SQL function
// called the way PostgREST calls it (read-only tx, SET LOCAL ROLE reader) ->
// the REAL services/vox/rc41SignedEodReviewSnapshot.ts + rc28 review flow, with
// the REAL rc8 evaluator. Only Supabase Auth bearer verification and
// `server-only` are replaced. TEST ONLY: synthetic keys/humans, loopback
// ephemeral docker postgres, no provider, no official EOD, no managed project.
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
import {executeRc8PgPendingSignedIntent,reconcileRc8PgSignedIntentOutcome} from "./rc8-pg-signed-intent-writer.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const image="postgres:17-alpine",container="qf-vox-rc41-eod-snapshot-pg";
const docker=(args)=>execFileSync("docker",args,
 {encoding:"utf8",windowsHide:true,timeout:20000}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const eq=(a,b,label)=>{if(a!==b)throw Error(label+" expected="+b+" actual="+a)};
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.now();
const OWNER=id(1),TL=id(2),TEAM=id(3),CITY=id(4),SUB=id(5),STAFF=id(90);
const OTHER_OWNER=id(11),OTHER_TL=id(12),OTHER_TEAM=id(13);
const TYPE="EOD_OFFICIAL_RELEASE",DIGEST="b".repeat(64);
const FN="public.qf_vox_rc41_signed_eod_review_snapshot_v1";
const FN_SIG=FN+"(uuid,uuid)";
const READER="vox_rc41_eod_review_reader";
function signer(keyId,signerId,role){
 const pair=generateKeyPairSync("ed25519");
 return {pair,entry:{keyId,signerId,signerRole:role,
  publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}),
  publicKeyFingerprint:createHash("sha256").update(pair.publicKey.export({type:"spki",format:"der"})).digest("hex"),
  notBeforeMs:now-60000,notAfterMs:now+3600000}};
}
const owner=signer("owner-rc41",OWNER,"OWNER"),leader=signer("tl-rc41",TL,"TEAM_LEADER");
const shortOwner=signer("owner-rc41-short",OWNER,"OWNER"),
 shortLeader=signer("tl-rc41-short",TL,"TEAM_LEADER");
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
  nonce:id(num),issuedAtMs:Date.now()-1000,expiresAtMs:Date.now()+540000};
 return {payload,signature:sign(null,canonicalAb7kApprovalBytes(payload),
  s.pair.privateKey).toString("base64url")};
};
const request=(o,t,os,ls)=>({type:TYPE,subjectId:SUB,digest:DIGEST,teamId:TEAM,
 cityId:CITY,ownerEnvelope:envelope(os,o),teamLeaderEnvelope:envelope(ls,t)});
const GATE={humanKeyCeremonyComplete:true,independentDbaAppsecApproved:true,
 dedicatedWriterRoleReviewed:true,managedRestoreCertified:true};
const REPORT="public.vox_ab7f_four_source_eod_candidate_v1";
const pools=[];let created=false;
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
 const mkPool=database=>{const p=new Pool({host:"127.0.0.1",port,user:"postgres",
  password:"synthetic_only",database,max:8,connectionTimeoutMillis:5000});pools.push(p);return p};
 const admin=mkPool("postgres");
 eq((await admin.query("SHOW server_version_num")).rows[0].server_version_num.startsWith("17"),true,"PG_IS_17");
 await admin.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN");
 const fixtureUsers=JSON.stringify;
 // Each database gets the real RC8/RC11/RC37 DDL. The writer needs EXACTLY two enrolled
 // keys, so the key-expiry scenario lives in its own database with a short-lived pair.
 async function bootstrap(dbName,signers,shortMs){
  await admin.query("CREATE DATABASE "+dbName);
  const pool=mkPool(dbName),Q=(q,v)=>pool.query(q,v);
  await Q("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb NOT NULL)");
  // Shapes mirror Supabase Auth: typed enums, nullable not_after, MFA factor status.
  await Q("CREATE TYPE auth.aal_level AS ENUM('aal1','aal2','aal3');"+
   "CREATE TYPE auth.factor_status AS ENUM('unverified','verified');"+
   "CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,aal auth.aal_level,not_after timestamptz,factor_id uuid);"+
   "CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY,user_id uuid NOT NULL,status auth.factor_status NOT NULL,factor_type text NOT NULL)");
  await Q("CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean NOT NULL)");
  await Q("CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean NOT NULL)");
  await Q("CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz)");
  await Q("CREATE TABLE "+REPORT+"(id uuid PRIMARY KEY,staff_id uuid,team_id uuid,city_id uuid,reviewer_id uuid,source_count integer,source_digest text,state text,published boolean)");
  await Q("INSERT INTO public.profiles VALUES ($1,'admin',true),($2,NULL,true),($3,NULL,true),($4,'admin',true),($5,NULL,true)",
   [OWNER,TL,STAFF,OTHER_OWNER,OTHER_TL]);
  const admin_meta=fixtureUsers({admin_role:"Superadmin"});
  await Q("INSERT INTO auth.users VALUES($1,$6),($2,$7),($3,$8),($4,$6),($5,$7)",
   [OWNER,TL,STAFF,OTHER_OWNER,OTHER_TL,admin_meta,
    fixtureUsers({qf_principal:"vox_staff",vox_role:"team_leader"}),
    fixtureUsers({qf_principal:"vox_staff",vox_role:"operations_manager"})]);
  await Q("INSERT INTO public.vox_staff_teams_v1 VALUES ($1,$2,true),($3,$2,true)",[TEAM,CITY,OTHER_TEAM]);
  await Q("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,'team_leader',true,NULL,clock_timestamp()+interval '30 days'),($3,$2,'operations_manager',true,NULL,clock_timestamp()+interval '30 days'),($4,$5,'team_leader',true,NULL,clock_timestamp()+interval '30 days')",
   [TL,TEAM,STAFF,OTHER_TL,OTHER_TEAM]);
  await Q("INSERT INTO "+REPORT+" VALUES($1,$2,$3,$4,$5,4,$6,'TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE',false)",
   [SUB,STAFF,TEAM,CITY,TL,DIGEST]);
  const sessions=async()=>{
   await Q("DELETE FROM auth.sessions;DELETE FROM auth.mfa_factors");
   for(const [n,u] of [[1,OWNER],[2,TL]]){
    await Q("INSERT INTO auth.sessions VALUES($1,$2,'aal2',clock_timestamp()+interval '1 hour',$3)",[id(200+n),u,id(300+n)]);
    await Q("INSERT INTO auth.mfa_factors VALUES($1,$2,'verified','totp')",[id(300+n),u]);
   }
  };
  await sessions();
  for(const f of [["rc7-review-candidates","20261030010000_vox_rc8_signed_intent_transaction_review_only.sql"],
   ["rc7-review-candidates","20261030030000_vox_rc11_signer_revocation_lock_review_only.sql"],
   ["rc37-review-candidates","20261031010000_vox_rc37_receipt_signer_evidence_review_only.sql"]])
   await Q(readFileSync(resolve(root,"ops/vox",f[0],f[1]),"utf8"));
  // The window opens only now, so DDL time cannot eat a short-lived key.
  if(shortMs)for(const sg of signers)sg.entry.notAfterMs=Date.now()+shortMs;
  for(const e of signers.map(sg=>sg.entry))
   await Q("INSERT INTO public.vox_rc8_human_signer_registry_candidate_v1 "+
    "(key_id,signer_id,signer_role,public_key_pem,public_key_fingerprint,not_before_ms,not_after_ms,human_enrolled,enrolled_at) "+
    "VALUES ($1,$2,$3,$4,$5,$6,$7,true,clock_timestamp())",
    [e.keyId,e.signerId,e.signerRole,e.publicKeyPem,e.publicKeyFingerprint,e.notBeforeMs,e.notAfterMs]);
  return {pool,Q,sessions,fingerprint:rc4RegistryFingerprint(signers.map(sg=>sg.entry))};
 }
 // PostgREST shape: read-only transaction, role switched to the API role, one call.
 const mkCall=pool=>async(role,intentId,subjectId)=>{
  const c=await pool.connect();
  try{
   await c.query("BEGIN READ ONLY");
   await c.query("SET LOCAL ROLE "+role);
   const r=await c.query("SELECT "+FN+"($1,$2) AS data",[intentId,subjectId]);
   await c.query("COMMIT");
   return {data:r.rows[0].data,error:null};
  }catch(e){try{await c.query("ROLLBACK")}catch{}return {data:null,error:{message:String(e.message)}}}
  finally{c.release()}
 };
 const main=await bootstrap("rc41_main",[owner,leader]);
 const {pool,Q,sessions}=main;
 const call=mkCall(pool);

 // 0. The RC41 SQL: fail closed until a dedicated reader role exists.
 const sqlFile=resolve(root,"ops/vox/rc41-review-candidates/20261101010000_vox_rc41_signed_eod_review_snapshot_rpc_review_only.sql");
 const sql=readFileSync(sqlFile,"utf8");
 await Q(sql);
 const priv=async role=>(await Q("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[role,FN_SIG])).rows[0].ok;
 const publicGrantee=async()=>(await Q("SELECT count(*)::int AS n FROM pg_proc p,aclexplode(p.proacl) a "+
  "WHERE p.proname='qf_vox_rc41_signed_eod_review_snapshot_v1' AND a.grantee=0")).rows[0].n;
 for(const r of ["anon","authenticated","service_role"])eq(await priv(r),false,"NO_EXECUTE_"+r);
 eq(await publicGrantee(),0,"NO_PUBLIC_EXECUTE");
 const meta=(await Q("SELECT provolatile,prosecdef,proconfig FROM pg_proc WHERE proname='qf_vox_rc41_signed_eod_review_snapshot_v1'")).rows[0];
 eq(meta.provolatile,"s","FUNCTION_STABLE");eq(meta.prosecdef,true,"FUNCTION_DEFINER");
 if(!Array.isArray(meta.proconfig)||meta.proconfig.length!==1||
  !["search_path=",'search_path=""'].includes(meta.proconfig[0]))
  throw Error("FUNCTION_EMPTY_SEARCH_PATH "+JSON.stringify(meta.proconfig));
 await admin.query("CREATE ROLE "+READER+" NOLOGIN");
 await Q(sql);
 eq(await priv(READER),true,"READER_HAS_EXECUTE");
 for(const r of ["anon","authenticated","service_role"])eq(await priv(r),false,"STILL_NO_EXECUTE_"+r);
 eq(await publicGrantee(),0,"STILL_NO_PUBLIC_EXECUTE");
 const rpcFor=c=>(fn,a)=>{eq(fn,"qf_vox_rc41_signed_eod_review_snapshot_v1","RPC_NAME");
  return c(READER,a.p_intent_id,a.p_subject_id)};
 const rpc=rpcFor(call);
 for(const r of ["anon","authenticated","service_role"]){
  const d=await call(r,id(1),id(2));
  eq(/permission denied/.test(d.error?.message??""),true,"ROLE_DENIED_"+r);
 }
 {
  const c=await pool.connect();
  try{
   await c.query("BEGIN");await c.query("SET LOCAL ROLE "+READER);
   let msg="";
   try{await c.query("SELECT * FROM public.vox_rc8_verified_intents_candidate_v1")}catch(e){msg=e.message}
   eq(/permission denied/.test(msg),true,"READER_CANNOT_SELECT_RC8_TABLE");
   await c.query("ROLLBACK");
  }finally{c.release()}
 }

 // Bundle: real adapter + real rc28 flow + real rc8 evaluator. Auth + server-only stubbed.
 mkdirSync(resolve(root,"test-results"),{recursive:true});
 const outfile=resolve(root,"test-results/rc41-eod-review-snapshot-pg17.mjs");
 await build({entryPoints:[resolve(root,"services/vox/rc41SignedEodReviewSnapshot.ts")],
  bundle:true,platform:"node",format:"esm",target:"node20",outfile,logLevel:"silent",
  external:["pg"],plugins:[{name:"auth-stub",setup(b){
   b.onResolve({filter:/^server-only$/},()=>({namespace:"stub",path:"server"}));
   b.onResolve({filter:/verifiedStaffBearer$/},()=>({namespace:"stub",path:"auth"}));
   b.onLoad({filter:/.*/,namespace:"stub"},({path})=>({loader:"js",contents:path==="auth"?
    "export async function verifyVoxOwnerBearer(){globalThis.__owner.calls++;return globalThis.__owner.revokeAfter&&globalThis.__owner.calls>globalThis.__owner.revokeAfter?null:globalThis.__owner.id}"+
    "export async function verifyVoxTeamLeaderBearer(){globalThis.__tl.calls++;return globalThis.__tl.revokeAfter&&globalThis.__tl.calls>globalThis.__tl.revokeAfter?null:globalThis.__tl.value}":""}));
  }}]});
 const {verifyRc41PendingEodViaRpc:review,rc41ReconcileSignedEodReceiptViaRpc:reconcileRpc}=
  await import(pathToFileURL(outfile).href);
 const tlValue=(o={})=>({userId:TL,aal:"aal2",expiresAtMs:Date.now()+60000,teamId:TEAM,cityId:CITY,...o});
 const as=(ownerId,tl,revokeAfter={})=>{
  globalThis.__owner={id:ownerId,calls:0,revokeAfter:revokeAfter.owner??0};
  globalThis.__tl={value:tl,calls:0,revokeAfter:revokeAfter.tl??0};
 };
 const acquire=()=>pool.connect();
 const count=async t=>Number((await Q("SELECT count(*)::int AS n FROM public."+t)).rows[0].n);
 const counts=async()=>({claims:await count("vox_rc8_approval_claims_candidate_v1"),
  intents:await count("vox_rc8_verified_intents_candidate_v1"),
  keyRows:await count("vox_rc37_receipt_signer_keys_candidate_v1"),
  revocations:await count("vox_rc8_signer_revocations_candidate_v1")});
 const denied=(r,reason,label)=>{eq(r.ok,false,label+"_OK");eq(r.reason,reason,label);
  eq(r.publicationAuthorized,false,label+"_NO_PUB");eq(r.approved,false,label+"_NO_APPROVE");
  eq(r.providerMessagesSent,0,label+"_NO_PROVIDER");};

 // 1. Real signed bytes -> real PG pending receipt.
 const w=await executeRc8PgPendingSignedIntent({acquireClient:acquire,
  request:request(7,8,owner,leader),ownerAuth,teamLeaderAuth,now:Date.now(),
  approvedRegistryFingerprints:[main.fingerprint]},GATE);
 eq(w.ok,true,"WRITER_COMMITTED");
 const input={intentId:w.intentId,subjectId:SUB,expectedReceiptSha256:w.receiptSha256};
 const before=await counts();eq(before.claims,3,"THREE_CLAIMS");eq(before.intents,1,"ONE_INTENT");

 // 2. Raw snapshot: bounded, complete, and free of key material / session secrets.
 const raw=await call(READER,w.intentId,SUB);
 eq(raw.error,null,"RAW_SNAPSHOT_OK");
 const snap=raw.data,text=JSON.stringify(snap);
 eq(snap.schema,"qf.vox.rc41.signed-eod-review-snapshot.v1","SNAPSHOT_SCHEMA");
 eq(snap.intents.length,1,"ONE_INTENT_ROW");eq(snap.claims.length,3,"THREE_CLAIM_ROWS");
 eq(snap.keys.length,2,"TWO_KEY_ROWS");eq(snap.subjectIntentIds.length,1,"ONE_SUBJECT_INTENT");
 eq(snap.attestations.owner.userId,OWNER,"ATT_OWNER");eq(snap.attestations.teamLeader.userId,TL,"ATT_TL");
 eq(snap.attestations.owner.aal2Current&&snap.attestations.teamLeader.aal2Current,true,"ATT_AAL2");
 eq(snap.attestations.owner.authorityCurrent&&snap.attestations.teamLeader.authorityCurrent,true,"ATT_AUTHORITY");
 eq(/PUBLIC KEY|PRIVATE|BEGIN |public_key_pem|secret|token|session_id|factor/i.test(text),false,"NO_KEY_OR_SESSION_MATERIAL");
 eq(text.includes(owner.entry.publicKeyPem.trim().split("\n")[1].slice(0,20)),false,"NO_PEM_BYTES");
 eq(text.length<4096,true,"BOUNDED_PAYLOAD");
 const nonExistent=(await call(READER,id(777),id(778))).data;
 eq(nonExistent.intents.length+nonExistent.claims.length+nonExistent.keys.length,0,"UNKNOWN_EMPTY");
 eq(nonExistent.report,null,"UNKNOWN_NO_REPORT");eq(nonExistent.attestations,null,"UNKNOWN_NO_ATTESTATIONS");
 for(const [a,b,label] of [[null,id(1),"NULL_INTENT"],[id(1),null,"NULL_SUBJECT"]]){
  const d=await call(READER,a,b);
  eq(/VOX_RC41_REVIEW_INPUT_INVALID/.test(d.error?.message??""),true,label);
 }
 eq((await call(READER,"not-a-uuid",id(1))).error!==null,true,"MALFORMED_UUID_REJECTED");

 // 3. RPC review of a genuine receipt: positive, and identical to the pg reconciler.
 as(OWNER,tlValue());
 let r=await review("owner","tl",input,rpc);
 eq(r.ok,true,"RPC_REVIEW_PENDING_OK");
 eq(r.state,"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW","RPC_REVIEW_STATE");
 eq(r.receiptSha256,w.receiptSha256,"RPC_REVIEW_RECEIPT_DIGEST");
 eq(r.publicationAuthorized,false,"RPC_NO_PUB");eq(r.approved,false,"RPC_NO_APPROVE");
 eq(r.providerMessagesSent,0,"RPC_NO_PROVIDER");
 eq(globalThis.__owner.calls,2,"OWNER_AAL2_RECHECKED");eq(globalThis.__tl.calls,2,"TL_AAL2_RECHECKED");
 const viaRpc=await reconcileRpc(rpc,input);
 const viaPg=await reconcileRc8PgSignedIntentOutcome({acquireClient:acquire,...input});
 for(const k of ["ok","outcome","receiptSha256","ownerId","teamLeaderId","teamId","cityId","state","publicationAuthorized"])
  eq(viaRpc[k],viaPg[k],"PARITY_"+k);

 // 4. Input / actor / transport denials.
 denied(await review("o","t",{...input,expectedReceiptSha256:"c".repeat(64)},rpc),
  "SIGNED_INTENT_NOT_DURABLY_PENDING","WRONG_RECEIPT_DIGEST");
 as(OWNER,tlValue());
 denied(await review("o","t",{...input,intentId:id(777)},rpc),"SIGNED_INTENT_NOT_DURABLY_PENDING","UNKNOWN_INTENT");
 as(OWNER,tlValue());
 denied(await review("o","t",{...input,publicationAuthorized:true},rpc),"SIGNED_INTENT_INPUT_INVALID","CALLER_PUBLICATION_FLAG");
 as(TL,tlValue());
 denied(await review("o","t",input,rpc),"DISTINCT_OWNER_AND_TL_AAL2_REQUIRED","SAME_HUMAN_BOTH_ROLES");
 as(OTHER_OWNER,tlValue());
 denied(await review("o","t",input,rpc),"REVIEWER_NOT_RECEIPT_SIGNER_SCOPE","OTHER_OWNER");
 as(OWNER,tlValue({userId:OTHER_TL,teamId:OTHER_TEAM}));
 denied(await review("o","t",input,rpc),"REVIEWER_NOT_RECEIPT_SIGNER_SCOPE","OTHER_TEAM_TL");
 as(OWNER,tlValue(),{owner:1});
 denied(await review("o","t",input,rpc),"HUMAN_AAL2_REVOKED_DURING_RECONCILIATION","OWNER_REVOKED_MID");
 as(OWNER,tlValue());
 denied(await review("o","t",input,async()=>({data:null,error:{message:"boom"}})),
  "SIGNER_RECEIPT_RECONCILIATION_UNAVAILABLE","RPC_ERROR");
 as(OWNER,tlValue());
 denied(await review("o","t",input,async()=>{throw Error("network")}),
  "SIGNER_RECEIPT_RECONCILIATION_UNAVAILABLE","RPC_THROWS");
 const good=(await call(READER,w.intentId,SUB)).data;
 // A misbehaving function / proxy can never smuggle key or session material, or oversize rows.
 for(const [mutate,label] of [
  [d=>{d.keys[0].privateKey="x"},"EXTRA_KEY_FIELD"],
  [d=>{d.keys[0].publicKeyPem="-----BEGIN PUBLIC KEY-----"},"PEM_LEAK"],
  [d=>{d.attestations.owner.sessionId=id(1)},"SESSION_LEAK"],
  [d=>{d.claims.push(d.claims[0],d.claims[0])},"OVERSIZED_CLAIMS"],
  [d=>{d.schema="qf.other"},"WRONG_SCHEMA"],
  [d=>{d.report.published="false"},"WRONG_TYPE"],
  [d=>{d.extra=1},"EXTRA_TOP_FIELD"]]){
  as(OWNER,tlValue());
  const d=structuredClone(good);mutate(d);
  denied(await review("o","t",input,async()=>({data:d,error:null})),
   "SIGNER_RECEIPT_RECONCILIATION_UNAVAILABLE","MALFORMED_"+label);
 }
 // Well-formed but tampered evidence is still denied by the shared evaluator.
 for(const [mutate,label] of [
  [d=>{d.attestations.teamLeader.userId=OWNER},"ATT_SAME_HUMAN"],
  [d=>{d.attestations.owner.aal2Current=false},"ATT_NO_AAL2"],
  [d=>{d.attestations=null},"ATT_MISSING"],
  [d=>{d.keys.pop()},"ONE_KEY_ONLY"]]){
  as(OWNER,tlValue());
  const d=structuredClone(good);mutate(d);
  denied(await review("o","t",input,async()=>({data:d,error:null})),
   "SIGNED_INTENT_NOT_DURABLY_PENDING","EVIDENCE_"+label);
 }

 // 5. AAL2 / authority attestations come from live DB state, not from the caller.
 const sessionCases=[
  ["OWNER_NO_SESSION","DELETE FROM auth.sessions WHERE user_id='"+OWNER+"'"],
  ["TL_NO_SESSION","DELETE FROM auth.sessions WHERE user_id='"+TL+"'"],
  ["OWNER_AAL1","UPDATE auth.sessions SET aal='aal1' WHERE user_id='"+OWNER+"'"],
  ["TL_AAL1","UPDATE auth.sessions SET aal='aal1' WHERE user_id='"+TL+"'"],
  ["OWNER_SESSION_EXPIRED","UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE user_id='"+OWNER+"'"],
  ["TL_SESSION_EXPIRED","UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE user_id='"+TL+"'"],
  ["OWNER_MFA_UNVERIFIED","UPDATE auth.mfa_factors SET status='unverified' WHERE user_id='"+OWNER+"'"],
  ["TL_NO_MFA_FACTOR","DELETE FROM auth.mfa_factors WHERE user_id='"+TL+"'"],
  ["OWNER_PROFILE_INACTIVE","UPDATE public.profiles SET is_active=false WHERE id='"+OWNER+"'"],
  ["OWNER_NOT_SUPERADMIN","UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+OWNER+"'"],
  ["TL_MEMBERSHIP_REVOKED","UPDATE public.vox_staff_memberships_v1 SET revoked_at=clock_timestamp() WHERE auth_user_id='"+TL+"'"],
  ["TL_MEMBERSHIP_EXPIRED","UPDATE public.vox_staff_memberships_v1 SET expires_at=clock_timestamp()-interval '1 second' WHERE auth_user_id='"+TL+"'"],
  ["TL_TEAM_INACTIVE","UPDATE public.vox_staff_teams_v1 SET is_active=false WHERE id='"+TEAM+"'"],
  ["TL_PROFILE_INACTIVE","UPDATE public.profiles SET is_active=false WHERE id='"+TL+"'"]];
 const restoreAuthority=async()=>{
  await sessions();
  await Q("UPDATE public.profiles SET is_active=true WHERE id IN ($1,$2)",[OWNER,TL]);
  await Q("UPDATE auth.users SET raw_app_meta_data=$2 WHERE id=$1",[OWNER,fixtureUsers({admin_role:"Superadmin"})]);
  await Q("UPDATE public.vox_staff_memberships_v1 SET revoked_at=NULL,expires_at=clock_timestamp()+interval '30 days' WHERE auth_user_id=$1",[TL]);
  await Q("UPDATE public.vox_staff_teams_v1 SET is_active=true WHERE id=$1",[TEAM]);
 };
 for(const [label,stmt] of sessionCases){
  await Q(stmt);
  as(OWNER,tlValue());
  denied(await review("o","t",input,rpc),"SIGNED_INTENT_NOT_DURABLY_PENDING","ATTESTATION_"+label);
  await restoreAuthority();
 }
 as(OWNER,tlValue());
 eq((await review("o","t",input,rpc)).ok,true,"RPC_REVIEW_RESTORED_OK");

 // 6. Report drift denies, and matches the pg reconciler's outcome for the same state.
 for(const [stmt,vals,label] of [
  ["UPDATE "+REPORT+" SET source_digest=$2 WHERE id=$1",[SUB,"d".repeat(64)],"DIGEST_DRIFT"],
  ["UPDATE "+REPORT+" SET published=true WHERE id=$1",[SUB],"ALREADY_PUBLISHED"],
  ["UPDATE "+REPORT+" SET source_count=3 WHERE id=$1",[SUB],"THREE_SOURCES"],
  ["UPDATE "+REPORT+" SET state='DRAFT' WHERE id=$1",[SUB],"STATE_DRIFT"],
  ["UPDATE "+REPORT+" SET staff_id=reviewer_id WHERE id=$1",[SUB],"STAFF_IS_SIGNER"],
  ["UPDATE "+REPORT+" SET team_id=$2 WHERE id=$1",[SUB,OTHER_TEAM],"TEAM_DRIFT"]]){
  await Q(stmt,vals);
  as(OWNER,tlValue());
  denied(await review("o","t",input,rpc),"SIGNED_INTENT_NOT_DURABLY_PENDING",label);
  eq((await reconcileRpc(rpc,input)).outcome,
   (await reconcileRc8PgSignedIntentOutcome({acquireClient:acquire,...input})).outcome,"PARITY_"+label);
  await Q("UPDATE "+REPORT+" SET source_digest=$2,published=false,source_count=4,staff_id=$3,team_id=$4,"+
   "state='TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE' WHERE id=$1",[SUB,DIGEST,STAFF,TEAM]);
 }
 as(OWNER,tlValue());
 eq((await review("o","t",input,rpc)).ok,true,"RPC_REVIEW_RESTORED_AFTER_DRIFT");

 // 6a. Uncommitted writes are invisible; a committed change between the two review
 //     snapshots is caught by the second snapshot.
 {
  const c=await pool.connect();
  try{
   await c.query("BEGIN");
   await c.query("UPDATE "+REPORT+" SET published=true WHERE id=$1",[SUB]);
   as(OWNER,tlValue());
   eq((await review("o","t",input,rpc)).ok,true,"UNCOMMITTED_CHANGE_INVISIBLE");
   await c.query("ROLLBACK");
  }finally{c.release()}
  let calls=0;
  const racing=async(fn,a)=>{calls++;
   if(calls===2)await Q("UPDATE "+REPORT+" SET published=true WHERE id=$1",[SUB]);
   return rpc(fn,a)};
  as(OWNER,tlValue());
  denied(await review("o","t",input,racing),"SIGNED_EOD_CHANGED_DURING_REVIEW","CHANGE_BETWEEN_SNAPSHOTS");
  eq(calls,2,"TWO_SNAPSHOT_CALLS");
  await Q("UPDATE "+REPORT+" SET published=false WHERE id=$1",[SUB]);
 }

 // 7. ONE statement = ONE snapshot: two facts that always change together in one
 //    committed transaction are never observed torn apart, under concurrency.
 {
  let stop=false,torn=0,reads=0,flips=0;
  const flipper=(async()=>{
   const c=await pool.connect();
   try{
    for(let i=0;i<150&&!stop;i++){
     const bad=i%2===0;
     await c.query("BEGIN");
     await c.query("UPDATE "+REPORT+" SET source_digest=$2 WHERE id=$1",[SUB,bad?"d".repeat(64):DIGEST]);
     await c.query("UPDATE public.profiles SET is_active=$2 WHERE id=$1",[OWNER,!bad]);
     await c.query("COMMIT");flips++;
    }
    await c.query("UPDATE "+REPORT+" SET source_digest=$2 WHERE id=$1",[SUB,DIGEST]);
    await c.query("UPDATE public.profiles SET is_active=true WHERE id=$1",[OWNER]);
   }finally{c.release();stop=true}
  })();
  const reader=async()=>{
   while(!stop){
    const s=(await call(READER,w.intentId,SUB)).data;reads++;
    if((s.report.sourceDigest===DIGEST)!==s.attestations.owner.authorityCurrent)torn++;
   }
  };
  await Promise.all([flipper,reader(),reader(),reader()]);
  eq(torn,0,"NO_TORN_SNAPSHOT_reads="+reads+"_flips="+flips);
  eq(reads>20,true,"STRESS_HAD_READS_"+reads);
  as(OWNER,tlValue());
  eq((await review("o","t",input,rpc)).ok,true,"RPC_REVIEW_AFTER_STRESS_OK");
 }

 // 8. Key revoked (real native revocation function) denies the RPC review.
 eq((await Q("SELECT public.qf_vox_rc11_revoke_signed_human_key_candidate_v1($1,$2) AS revoked",
  [leader.entry.keyId,"f".repeat(64)])).rows[0].revoked,true,"KEY_REVOKED");
 as(OWNER,tlValue());
 denied(await review("o","t",input,rpc),"SIGNED_INTENT_NOT_DURABLY_PENDING","REVOKED_SIGNER_KEY");
 eq((await call(READER,w.intentId,SUB)).data.keys.some(k=>k.revoked===true),true,"SNAPSHOT_SHOWS_REVOCATION");

 // 9. Read-only: reviewing consumed no nonce and wrote no receipt/evidence.
 const after=await counts();
 eq(after.claims,3,"REVIEW_READONLY_CLAIMS");eq(after.intents,1,"REVIEW_READONLY_INTENTS");
 eq(after.keyRows,2,"REVIEW_READONLY_KEY_EVIDENCE");eq(after.revocations,1,"ONLY_THE_EXPLICIT_REVOCATION");

 // 10. Key window: a separate database whose real enrolled keys expire seconds after commit.
 const short=await bootstrap("rc41_short",[shortOwner,shortLeader],14000);
 await short.Q(sql);
 const shortCall=mkCall(short.pool),shortRpc=rpcFor(shortCall);
 const w2=await executeRc8PgPendingSignedIntent({acquireClient:()=>short.pool.connect(),
  request:request(17,18,shortOwner,shortLeader),ownerAuth,teamLeaderAuth,now:Date.now(),
  approvedRegistryFingerprints:[short.fingerprint]},GATE);
 eq(w2.ok,true,"SHORT_KEY_RECEIPT_COMMITTED");
 const input2={intentId:w2.intentId,subjectId:SUB,expectedReceiptSha256:w2.receiptSha256};
 as(OWNER,tlValue());
 eq((await review("o","t",input2,shortRpc)).ok,true,"SHORT_KEY_RECEIPT_REVIEWABLE_IN_WINDOW");
 while(Date.now()<=shortOwner.entry.notAfterMs)await sleep(250);
 as(OWNER,tlValue());
 denied(await review("o","t",input2,shortRpc),"SIGNED_INTENT_NOT_DURABLY_PENDING","KEY_EXPIRED");
 console.log("VOX_RC41_EOD_REVIEW_SNAPSHOT_PG17_PASS real_pg17=true real_ed25519_bytes=true "+
  "real_rc8_writer=true postgrest_shaped_call=true single_statement_snapshot=true no_torn_reads=true "+
  "acl_fail_closed=true reader_role_execute_only=true no_key_or_session_material=true "+
  "bounded=true owner_tl_distinct_aal2_attested=true shared_evaluator_parity=true "+
  "key_revoked_denied=true key_expired_denied=true report_drift_denied=true readonly=true "+
  "publication=false official_eod=false provider_messages=0");
}catch(e){console.error("VOX_RC41_EOD_REVIEW_SNAPSHOT_PG17_FAIL "+String(e?.stack||e));process.exitCode=1;}
finally{
 for(const p of pools)try{await p.end()}catch{}
 if(created)try{docker(["rm","-f","-v",container])}catch{}
}
