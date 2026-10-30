#!/usr/bin/env node
// RC8: actual node-postgres PG17 SERIALIZABLE single-connection signed-intent
// integration. TEST ONLY: synthetic Owner/TL keys and human_enrolled flags.
// Loopback-only ephemeral port; no managed service, no production credentials.
import {Client,Pool} from "pg";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mintRc4VerifiedAuthContext,rc4RegistryFingerprint,rc4ScopeTargetHash}
 from "../../../contracts/vox/rc4ApprovalPipeline.mjs";
import {canonicalAb7kApprovalBytes}
 from "../../../contracts/vox/ab7kSignedApprovalVerifier.mjs";
import {executeRc8PgPendingSignedIntent,
 executeRc8PgPendingSignedIntentProduction,RC8_APPROVAL_WRITER_INSTALLED}
 from "./rc8-pg-signed-intent-writer.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const image="postgres:17-alpine",container="qf-vox-rc8-pg-native";
const docker=(args,extra={})=>execFileSync("docker",args,
 {encoding:"utf8",windowsHide:true,timeout:20000,...extra}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const eq=(a,b,label)=>{if(a!==b)throw Error(label+" expected="+b+" actual="+a)};
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=1_800_000_000_000;
const OWNER=id(1),TL=id(2),TEAM=id(3),CITY=id(4),SUB=id(5);
const TYPE="EOD_OFFICIAL_RELEASE",DIGEST="b".repeat(64);
function signer(keyId,signerId,role){
 const pair=generateKeyPairSync("ed25519");
 return {pair,entry:{keyId,signerId,signerRole:role,
  publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}),
  publicKeyFingerprint:createHash("sha256").update(pair.publicKey.export({type:"spki",format:"der"})).digest("hex"),
  notBeforeMs:now-60000,notAfterMs:now+600000}};
}
const owner=signer("owner-rc8",OWNER,"OWNER"),leader=signer("tl-rc8",TL,"TEAM_LEADER");
const registry=[owner.entry,leader.entry],fingerprint=rc4RegistryFingerprint(registry);
function auth(userId,values){
 return mintRc4VerifiedAuthContext({userId,sessionId:id(userId===OWNER?80:81),
 jwtRole:"authenticated",aal:"aal2",aal2AtMs:now-1000,sessionExpiresAtMs:now+600000,
 profileRole:null,profileActive:true,staffRole:null,teamId:null,cityId:null,
 membershipRevokedAtMs:null,membershipExpiresAtMs:null,...values});
}
const ownerAuth=auth(OWNER,{profileRole:"admin"});
const teamLeaderAuth=auth(TL,{staffRole:"team_leader",teamId:TEAM,cityId:CITY,
 membershipExpiresAtMs:now+600000});
function envelope(s,num){
 const payload={domain:"qf.vox.ab7k.signed-approval",version:"v1",
 type:TYPE,environment:"staging",keyId:s.entry.keyId,
 signerRole:s.entry.signerRole,signerId:s.entry.signerId,
 ownerId:OWNER,teamLeaderId:TL,subjectId:SUB,digest:DIGEST,
 targetHash:rc4ScopeTargetHash({type:TYPE,subjectId:SUB,teamId:TEAM,cityId:CITY}),
 nonce:id(num),issuedAtMs:now-1000,expiresAtMs:now+300000};
 return {payload,signature:sign(null,canonicalAb7kApprovalBytes(payload),
  s.pair.privateKey).toString("base64url")};
}
const request=(ownerNonce=7,tlNonce=8)=>({type:TYPE,subjectId:SUB,digest:DIGEST,
 teamId:TEAM,cityId:CITY,ownerEnvelope:envelope(owner,ownerNonce),
 teamLeaderEnvelope:envelope(leader,tlNonce)});
const TEST_ONLY_GATE={humanKeyCeremonyComplete:true,
 independentDbaAppsecApproved:true,dedicatedWriterRoleReviewed:true,
 managedRestoreCertified:true};
let pool,created=false;
try{
 if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))
  throw Error("REMOTE_DOCKER_REFUSED");
 docker(["image","inspect",image]);
 if(docker(["ps","-aq","--filter","name=^/"+container+"$"]))
  throw Error("CONTAINER_ALREADY_EXISTS");
 docker(["run","--pull","never","--rm","-d",
  "--name",container,"-p","127.0.0.1::5432","-e","POSTGRES_PASSWORD=synthetic_only",
  image]);
 created=true;
 let port;
 for(let i=0;i<110;i++){
  const mapped=docker(["port",container,"5432/tcp"]);
  const match=mapped.match(/^127\.0\.0\.1:(\d+)$/m);
  if(match)port=Number(match[1]);
  let ready=false;
  try{ready=docker(["exec",container,"psql","-A","-t","-U","postgres",
   "-d","postgres","-c","SELECT 1;"])==="1"&&
   docker(["logs",container]).includes("PostgreSQL init process complete; ready for start up.");}catch{}
  if(port&&ready)break;
  await sleep(200);
 }
 if(!port)throw Error("NO_LOOPBACK_PORT");
 pool=new Pool({host:"127.0.0.1",port,user:"postgres",password:"synthetic_only",
  database:"postgres",max:5,connectionTimeoutMillis:5000});
 for(let i=0;i<30;i++){try{await pool.query("SELECT 1");break}catch(e){
  if(i===29)throw e;await sleep(100);}}
 await pool.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN");
 await pool.query("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb NOT NULL)");
 await pool.query("CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean NOT NULL)");
 await pool.query("CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean NOT NULL)");
 await pool.query("CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz)");
 await pool.query("INSERT INTO public.profiles VALUES ($1,'admin',true),($2,NULL,true)",[OWNER,TL]);
 await pool.query("INSERT INTO auth.users VALUES($1,'{\"admin_role\":\"Superadmin\"}'),($2,'{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}')",[OWNER,TL]);
 await pool.query("INSERT INTO public.vox_staff_teams_v1 VALUES ($1,$2,true)",[TEAM,CITY]);
 await pool.query("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,'team_leader',true,NULL,clock_timestamp()+interval '30 days')",[TL,TEAM]);
 const ddl=readFileSync(resolve(root,"ops/vox/rc7-review-candidates/20261030010000_vox_rc8_signed_intent_transaction_review_only.sql"),"utf8");
 await pool.query(ddl);
 // Synthetic local registry enrolment DOES NOT authorize any real human signer.
 for(const e of registry){
  await pool.query("INSERT INTO public.vox_rc8_human_signer_registry_candidate_v1 "+
   "(key_id,signer_id,signer_role,public_key_pem,public_key_fingerprint,not_before_ms,not_after_ms,human_enrolled,enrolled_at) "+
   "VALUES ($1,$2,$3,$4,$5,$6,$7,true,clock_timestamp())",
   [e.keyId,e.signerId,e.signerRole,e.publicKeyPem,e.publicKeyFingerprint,
    e.notBeforeMs,e.notAfterMs]);
 }
 const args=(req=request())=>({acquireClient:()=>pool.connect(),request:req,
  ownerAuth,teamLeaderAuth,now,approvedRegistryFingerprints:[fingerprint]});
 eq(RC8_APPROVAL_WRITER_INSTALLED,false,"SOURCE_PRODUCTION_GATE");
 let r=await executeRc8PgPendingSignedIntentProduction(args());
 eq(r.reason,"NATIVE_RELEASE_GATE_CLOSED","PRODUCTION_BLOCK");
 r=await executeRc8PgPendingSignedIntent(args(),TEST_ONLY_GATE);
 eq(r.ok,true,"NATIVE_REAL_PG_COMMIT");eq(r.approved,false,"NEVER_APPROVED");
 const counts=async()=>({
  claims:Number((await pool.query("SELECT count(*)::int AS n FROM public.vox_rc8_approval_claims_candidate_v1")).rows[0].n),
  intents:Number((await pool.query("SELECT count(*)::int AS n FROM public.vox_rc8_verified_intents_candidate_v1")).rows[0].n)});
 let c=await counts();eq(c.claims,3,"THREE_CLAIMS");eq(c.intents,1,"ONE_INTENT");
 r=await executeRc8PgPendingSignedIntent(args(),TEST_ONLY_GATE);
 eq(r.ok,false,"NONCE_REPLAY_DENIED");
 r=await executeRc8PgPendingSignedIntent(args(request(9,10)),TEST_ONLY_GATE);
 eq(r.ok,false,"SUBJECT_REPLAY_DENIED");
 c=await counts();eq(c.claims,3,"REPLAY_NO_PARTIAL_CLAIM");
 eq(c.intents,1,"REPLAY_NO_PARTIAL_INTENT");
 const tampered=request(11,12);tampered.ownerEnvelope.signature="bogus";
 r=await executeRc8PgPendingSignedIntent(args(tampered),TEST_ONLY_GATE);
 eq(r.ok,false,"ED25519_TAMPER_DENIED");
 await pool.query("INSERT INTO public.vox_rc8_signer_revocations_candidate_v1 VALUES($1,clock_timestamp(),$2)",
  [owner.entry.keyId,"f".repeat(64)]);
 r=await executeRc8PgPendingSignedIntent(args(request(13,14)),TEST_ONLY_GATE);
 eq(r.ok,false,"REVOKED_KEY_DENIED");
 await pool.query("UPDATE public.vox_staff_memberships_v1 SET revoked_at=clock_timestamp() WHERE auth_user_id=$1",[TL]);
 r=await executeRc8PgPendingSignedIntent(args(request(15,16)),TEST_ONLY_GATE);
 eq(r.reason,"CURRENT_ACTOR_REVOKED","CURRENT_TL_REVOKED_DENIED");
 await pool.query("UPDATE public.vox_staff_memberships_v1 SET revoked_at=NULL WHERE auth_user_id=$1",[TL]);
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{\"qf_principal\":\"vox_staff\"}' WHERE id=$1",[TL]);
 r=await executeRc8PgPendingSignedIntent(args(request(17,18)),TEST_ONLY_GATE);
 eq(r.reason,"CURRENT_ACTOR_REVOKED","CURRENT_TL_AUTH_METADATA_REVOKED_DENIED");
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}' WHERE id=$1",[TL]);
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1",[OWNER]);
 r=await executeRc8PgPendingSignedIntent(args(request(19,20)),TEST_ONLY_GATE);
 eq(r.reason,"CURRENT_ACTOR_REVOKED","CURRENT_OWNER_AUTH_METADATA_REVOKED_DENIED");
 const finale=await counts();eq(finale.claims,3,"FINAL_CLAIMS");eq(finale.intents,1,"FINAL_INTENTS");
 console.log("VOX_RC8_REAL_PG17_SIGNED_INTENT_PASS two_real_keys=synthetic "+
 "real_sql_transaction=true claims=3 receipts=1 replay_and_tamper_denied=true "+
 "revocation_denied=true owner_tl_scope_rechecked=true official_eod=false production_gate=false");
}catch(e){console.error("VOX_RC8_REAL_PG17_SIGNED_INTENT_FAIL "+String(e?.stack||e));process.exitCode=1;}
finally{
 if(pool)try{await pool.end()}catch{}
 if(created)try{docker(["rm","-f","-v",container])}catch{}
}
