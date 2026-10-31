/** RC8 PostgreSQL transaction writer for a PENDING signed-intent receipt.
 * No production route, human key enrolment, official EOD or operator release.
 */
import {createHash,randomUUID} from "node:crypto";
import {prepareRc4SignedApproval,rc4RegistryFingerprint,
 checkRc4ApproversAtCommit,RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS,
 RC4_OFFICIAL_EOD_ENABLED} from "../../../contracts/vox/rc4ApprovalPipeline.mjs";
export const RC8_APPROVAL_WRITER_INSTALLED=false;
export const RC8_NATIVE_APPROVAL_GATE=Object.freeze({
 humanKeyCeremonyComplete:false,independentDbaAppsecApproved:false,
 dedicatedWriterRoleReviewed:false,managedRestoreCertified:false});
// Only objects returned by this module can describe a writer/reconciliation
// outcome; caller-shaped JSON never reaches a publication state.
const RESULTS=new WeakSet();
const result=o=>{const f=Object.freeze(o);RESULTS.add(f);return f;};
const deny=reason=>result({ok:false,reason,committed:false,
 officialEodEnabled:false,approved:false,canAuthorize:false});
// No positional or caller-invented approval flags: only these independent
// review decisions can satisfy the synthetic transaction gate. Production
// always passes the immutable all-false gate below regardless.
const APPROVAL_KEYS=Object.freeze([
 "dedicatedWriterRoleReviewed","humanKeyCeremonyComplete",
 "independentDbaAppsecApproved","managedRestoreCertified"
]);
const gateOK=g=>{
 if(!g||typeof g!=="object"||Array.isArray(g))return false;
 const keys=Object.keys(g).sort();
 return keys.length===APPROVAL_KEYS.length&&
  keys.every((k,i)=>k===APPROVAL_KEYS[i])&&
  APPROVAL_KEYS.every(k=>g[k]===true);
};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LOWER_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEX64=/^[a-f0-9]{64}$/;
const P="public.vox_rc8_";
const RC37_KEYS_TABLE="public.vox_rc37_receipt_signer_keys_candidate_v1";
// Transaction-scoped advisory lock namespace for one signed-intent writer.
// A hashtext collision can only produce a spurious IN_FLIGHT (fail-closed).
const INTENT_LOCK_CLASS=827027;
const INTENT_LOCK_SQL="SELECT pg_advisory_xact_lock("+INTENT_LOCK_CLASS+",hashtext($1::text))";
const INTENT_LOCK_PROBE_SQL="SELECT pg_try_advisory_xact_lock_shared("+INTENT_LOCK_CLASS+
 ",hashtext($1::text)) AS \"writerFinished\"";
const RECEIPT_KINDS=Object.freeze(["OWNER_NONCE","SUBJECT","TL_NONCE"]);
const RECEIPT_FIELDS=Object.freeze(["id","type","subjectId","digest","teamId",
 "cityId","ownerId","teamLeaderId"]);
/** Deterministic digest of a durable pending receipt, computed ONLY from
 * values PostgreSQL stores (intent row + its three claims). The writer and
 * the read-only reconciler derive it identically, so an ambiguous COMMIT can
 * be matched to exactly one durable receipt. null for any malformed input. */
export function rc8SignedIntentReceiptSha256(intent,claims){
 if(!intent||typeof intent!=="object"||intent.type!=="EOD_OFFICIAL_RELEASE"||
    intent.verifiedSignaturePair!==true||intent.state!=="AWAITING_EXTERNAL_REVIEW"||
    !["id","subjectId","teamId","cityId","ownerId","teamLeaderId"]
     .every(k=>typeof intent[k]==="string"&&LOWER_UUID.test(intent[k]))||
    intent.ownerId===intent.teamLeaderId||
    typeof intent.digest!=="string"||!HEX64.test(intent.digest)||
    !Array.isArray(claims)||claims.length!==RECEIPT_KINDS.length)return null;
 const sorted=[...claims].sort((a,b)=>String(a?.claimKind).localeCompare(String(b?.claimKind)));
 if(sorted.some((c,i)=>c?.claimKind!==RECEIPT_KINDS[i]||
    typeof c.claimKey!=="string"||!HEX64.test(c.claimKey))||
    new Set(sorted.map(c=>c.claimKey)).size!==RECEIPT_KINDS.length)return null;
 const body=RECEIPT_FIELDS.map(k=>`${k}=${intent[k]}\n`).join("")+
  sorted.map(c=>`claim=${c.claimKind}:${c.claimKey}\n`).join("");
 return createHash("sha256").update("qf.vox.rc8.signed-intent-receipt/v1\n"+body,"utf8").digest("hex");
}
async function readDurableReceipt(client,intentId){
 const intents=await client.query(
  "SELECT id::text AS id,type,subject_id::text AS \"subjectId\",digest,"+
  "team_id::text AS \"teamId\",city_id::text AS \"cityId\","+
  "owner_id::text AS \"ownerId\",team_leader_id::text AS \"teamLeaderId\","+
  "verified_signature_pair AS \"verifiedSignaturePair\",state "+
  "FROM "+P+"verified_intents_candidate_v1 WHERE id=$1::uuid",[intentId]);
 const claims=await client.query(
  "SELECT claim_key AS \"claimKey\",claim_kind AS \"claimKind\" "+
  "FROM "+P+"approval_claims_candidate_v1 WHERE intent_id=$1::uuid "+
  "ORDER BY claim_kind",[intentId]);
 return {intents:intents.rows??[],claims:claims.rows??[]};
}
export async function executeRc8PgPendingSignedIntent(options={},gate=RC8_NATIVE_APPROVAL_GATE){
 if(!gateOK(gate))return deny("NATIVE_RELEASE_GATE_CLOSED");
 const {acquireClient,request,ownerAuth,teamLeaderAuth,now=Date.now(),
  approvedRegistryFingerprints=RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS}=options;
 if(typeof acquireClient!=="function"||!request||typeof request!=="object")
  return deny("TRANSACTION_CLIENT_REQUIRED");
 // This pending-receipt writer is restricted to the reviewed four-source EOD
 // lane. Other signed commands require their own independent source/authority.
 if(request.type!=="EOD_OFFICIAL_RELEASE"||
    !UUID.test(request.subjectId??"")||!UUID.test(request.teamId??"")||
    !UUID.test(request.cityId??"")||
    typeof request.digest!=="string"||!/^[a-f0-9]{64}$/.test(request.digest))
  return deny("EOD_REQUEST_SCOPE_INVALID");
 let client,started=false,settled=false,destroyConnection=false;
 try{
  client=await acquireClient();
  if(!client||typeof client.query!=="function"||typeof client.release!=="function")
   return deny("PG_CLIENT_INVALID");
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE");
  started=true;
  // Key revocation is a plain INSERT whose FK check only takes KEY SHARE on
  // the registry row, which does not conflict with the FOR SHARE below. Block
  // every revocation INSERT for the whole writer window. This MUST precede the
  // first SELECT: a SERIALIZABLE snapshot taken earlier could miss a
  // revocation committed before the lock was granted.
  await client.query("LOCK TABLE "+P+"signer_revocations_candidate_v1 IN SHARE MODE");
  // Hold an intent-scoped marker until this transaction ends (COMMIT or
  // abort). After a lost COMMIT response the backend may still be in flight;
  // the reconciler must not read "no rows" as NOT_COMMITTED while it is held.
  const intentId=randomUUID();
  await client.query(INTENT_LOCK_SQL,[intentId]);
  const owner=await client.query(
   "SELECT p.id FROM public.profiles p JOIN auth.users a ON a.id=p.id "+
   "WHERE p.id=$1::uuid AND p.role='admin' AND p.is_active=true "+
   "AND a.raw_app_meta_data->>'admin_role'='Superadmin' "+
   "FOR SHARE OF p,a",
   [ownerAuth?.userId]);
  const tl=await client.query(
   "SELECT m.auth_user_id FROM public.vox_staff_memberships_v1 m "+
   "JOIN public.profiles p ON p.id=m.auth_user_id "+
   "JOIN auth.users a ON a.id=m.auth_user_id "+
   "JOIN public.vox_staff_teams_v1 t ON t.id=m.team_id "+
   "WHERE m.auth_user_id=$1::uuid AND m.staff_role='team_leader' "+
   "AND m.team_id=$2::uuid AND t.city_id=$3::uuid "+
   "AND m.is_active=true AND m.revoked_at IS NULL "+
   "AND m.expires_at>clock_timestamp() AND t.is_active=true "+
   "AND p.is_active=true AND p.role IS NULL "+
   "AND a.raw_app_meta_data->>'qf_principal'='vox_staff' "+
   "AND a.raw_app_meta_data->>'vox_role'='team_leader' "+
   "AND a.raw_app_meta_data->>'admin_role' IS NULL "+
   "FOR SHARE OF m,p,t,a",
   [teamLeaderAuth?.userId,request.teamId,request.cityId]);
  if(owner.rowCount!==1||tl.rowCount!==1){
   await client.query("ROLLBACK");settled=true;return deny("CURRENT_ACTOR_REVOKED");
  }
  let lockedEodSubjectStaffId=null;
  // EOD signatures must bind to the CURRENT locked four-source report,
  // not just a caller-supplied digest and UUID. Operator-command requests use
  // their separate signed-operator source and never this EOD path.
  if(request.type==="EOD_OFFICIAL_RELEASE"){
   const report=await client.query(
    "SELECT id,staff_id,team_id,city_id,reviewer_id,source_count,source_digest,"+
    "state,published FROM public.vox_ab7f_four_source_eod_candidate_v1 "+
    "WHERE id=$1::uuid FOR UPDATE",
    [request.subjectId]);
   const row=report.rows[0];
   if(report.rowCount!==1||!row||!UUID.test(row.id??"")||
      !UUID.test(row.staff_id??"")||row.id!==request.subjectId||
      row.team_id!==request.teamId||
      row.city_id!==request.cityId||row.reviewer_id!==teamLeaderAuth?.userId||
      row.staff_id===ownerAuth?.userId||row.staff_id===teamLeaderAuth?.userId||
      Number(row.source_count)!==4||row.source_digest!==request.digest||
      row.state!=="TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE"||
      row.published!==false){
    await client.query("ROLLBACK");settled=true;
    return deny("EOD_CURRENT_FOUR_SOURCE_REVIEW_REQUIRED");
   }
   // A valid Staff UUID in a report is not itself an active Staff identity.
   // Lock actual membership, team and Auth before claiming signer nonces.
   const staff=await client.query(
    "SELECT m.auth_user_id FROM public.vox_staff_memberships_v1 m "+
    "JOIN public.vox_staff_teams_v1 t ON t.id=m.team_id "+
    "JOIN public.profiles p ON p.id=m.auth_user_id "+
    "JOIN auth.users a ON a.id=m.auth_user_id "+
    "WHERE m.auth_user_id=$1::uuid AND m.team_id=$2::uuid "+
    "AND t.city_id=$3::uuid AND t.is_active=true "+
    "AND m.is_active=true AND m.revoked_at IS NULL "+
    "AND m.expires_at>clock_timestamp() "+
    "AND p.is_active=true AND p.role IS NULL "+
    "AND a.raw_app_meta_data->>'qf_principal'='vox_staff' "+
    "AND a.raw_app_meta_data->>'admin_role' IS NULL "+
    "FOR SHARE OF m,t,p,a",
    [row.staff_id,request.teamId,request.cityId]);
   if(staff.rowCount!==1){
    await client.query("ROLLBACK");settled=true;
    return deny("EOD_SUBJECT_STAFF_REVOKED");
   }
   lockedEodSubjectStaffId=row.staff_id;
  }
  const registryRows=await client.query(
   "SELECT key_id AS \"keyId\",signer_id::text AS \"signerId\", "+
   "signer_role AS \"signerRole\",public_key_pem AS \"publicKeyPem\", "+
   "public_key_fingerprint AS \"publicKeyFingerprint\", "+
   "not_before_ms AS \"notBeforeMs\",not_after_ms AS \"notAfterMs\", "+
   "(enrolled_at IS NOT NULL AND enrolled_at<=clock_timestamp()) AS \"enrolmentEffective\" "+
   "FROM "+P+"human_signer_registry_candidate_v1 "+
   "WHERE human_enrolled=true ORDER BY key_id FOR SHARE");
  if(registryRows.rows.some(r=>r.enrolmentEffective!==true)){
   // A future-dated or unstamped enrolment is not a completed registration.
   await client.query("ROLLBACK");settled=true;return deny("SIGNER_KEY_REGISTRATION_NOT_EFFECTIVE");
  }
  const registry=registryRows.rows.map(({enrolmentEffective,...r})=>({...r,
   notBeforeMs:Number(r.notBeforeMs),notAfterMs:Number(r.notAfterMs)}));
  if(registry.length!==2||!Array.isArray(approvedRegistryFingerprints)||
     !approvedRegistryFingerprints.includes(rc4RegistryFingerprint(registry))){
   await client.query("ROLLBACK");settled=true;return deny("HUMAN_SIGNER_REGISTRY_UNAPPROVED");
  }
  // The pinned pair must be exactly the current Owner's and current Team
  // Leader's keys, checked against the locked DB actors before any nonce work.
  const ownerKeys=registry.filter(k=>k.signerRole==="OWNER");
  const tlKeys=registry.filter(k=>k.signerRole==="TEAM_LEADER");
  if(ownerKeys.length!==1||tlKeys.length!==1||
     ownerKeys[0].signerId!==ownerAuth?.userId||
     tlKeys[0].signerId!==teamLeaderAuth?.userId){
   await client.query("ROLLBACK");settled=true;return deny("SIGNER_REGISTRY_ACTOR_BINDING_DENIED");
  }
  // Revocation table is SHARE-locked (above), so this read is final for the
  // transaction. A pinned pair with ANY revoked member is invalid as a whole.
  const revoked=await client.query(
   "SELECT key_id FROM "+P+"signer_revocations_candidate_v1 FOR SHARE");
  const revocations={keyIds:revoked.rows.map(r=>r.key_id),signerIds:[]};
  if(registry.some(k=>revocations.keyIds.includes(k.keyId))){
   await client.query("ROLLBACK");settled=true;return deny("SIGNER_KEY_REVOKED");
  }
  const claimed=[];
  const ledger={
   durable:true,
   claimAll:async({nonceKeys,subjectKey,expiresAtMs})=>{
    if(!Array.isArray(nonceKeys)||nonceKeys.length!==2||!Number.isSafeInteger(expiresAtMs)||
       expiresAtMs<=now)return false;
    const claims=[[nonceKeys[0],"OWNER_NONCE"],[nonceKeys[1],"TL_NONCE"],
     [subjectKey,"SUBJECT"]];
    if(new Set(claims.map(([k])=>k)).size!==3)return false;
    for(const [key,kind] of claims){
     const written=await client.query(
      "INSERT INTO "+P+"approval_claims_candidate_v1 "+
      "(claim_key,claim_kind,intent_id,expires_at) "+
      "VALUES ($1,$2,$3,to_timestamp($4::double precision/1000.0)) "+
      "ON CONFLICT DO NOTHING RETURNING claim_key",
      [key,kind,intentId,expiresAtMs]);
     if(written.rowCount!==1)return false;
     claimed.push({claimKey:key,claimKind:kind});
    }
    return true;
   }
  };
  const signed=await prepareRc4SignedApproval({request,ownerAuth,teamLeaderAuth,
   registry,approvedRegistryFingerprints,revocations,ledger,now});
  if(!signed.ok||signed.signatureVerified!==true||signed.ledgerDurable!==true){
   await client.query("ROLLBACK");settled=true;
   return deny(signed.reason||"SIGNATURE_OR_NONCE_DENIED");
  }
  if(!UUID.test(signed.ownerId)||!UUID.test(signed.teamLeaderId)||
     signed.ownerId===signed.teamLeaderId||
     signed.ownerId!==ownerAuth?.userId||
     signed.teamLeaderId!==teamLeaderAuth?.userId){
   await client.query("ROLLBACK");settled=true;return deny("INVALID_SIGNER_BINDING");
  }
  const receipt=await client.query(
   "INSERT INTO "+P+"verified_intents_candidate_v1 "+
   "(id,type,subject_id,digest,team_id,city_id,owner_id,team_leader_id,verified_signature_pair) "+
   "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id",
   [intentId,request.type,request.subjectId,request.digest,request.teamId,
    request.cityId,signed.ownerId,signed.teamLeaderId]);
  if(receipt.rowCount!==1||receipt.rows[0]?.id!==intentId)
   throw Error("INTENT_RECEIPT_UNVERIFIED");
  // RC37: persist the exact two signer keys (from the locked, pinned registry)
  // in this same transaction so review can later prove THESE keys, not a guess.
  const keyEvidence=await client.query(
   "INSERT INTO "+RC37_KEYS_TABLE+" (intent_id,key_id,signer_id,signer_role,"+
   "public_key_fingerprint,not_before_ms,not_after_ms) "+
   "SELECT $1::uuid,k.key_id,k.signer_id::uuid,k.signer_role,k.fp,k.nb,k.na FROM "+
   "unnest($2::text[],$3::text[],$4::text[],$5::text[],$6::bigint[],$7::bigint[]) "+
   "AS k(key_id,signer_id,signer_role,fp,nb,na) RETURNING key_id",
   [intentId,registry.map(k=>k.keyId),registry.map(k=>k.signerId),
    registry.map(k=>k.signerRole),registry.map(k=>k.publicKeyFingerprint),
    registry.map(k=>String(k.notBeforeMs)),registry.map(k=>String(k.notAfterMs))]);
  if(keyEvidence.rowCount!==2)throw Error("SIGNER_KEY_EVIDENCE_UNVERIFIED");
  // Atomic readback: the exact three claims written by THIS transaction and
  // the receipt row must be what PostgreSQL holds for intentId, and yield the
  // digest later used to reconcile an ambiguous COMMIT.
  const durable=await readDurableReceipt(client,intentId);
  const receiptSha256=durable.intents.length===1?
   rc8SignedIntentReceiptSha256(durable.intents[0],durable.claims):null;
  const sameClaims=claimed.length===3&&durable.claims.length===3&&
   claimed.every(c=>durable.claims.some(d=>d.claimKey===c.claimKey&&d.claimKind===c.claimKind));
  if(!receiptSha256||!sameClaims||durable.intents[0].subjectId!==request.subjectId||
     durable.intents[0].digest!==request.digest)
   throw Error("DURABLE_RECEIPT_READBACK_MISMATCH");
  // DB locks, nonce claims and report writes can outlive the initial AAL2
  // check. Never commit a pending receipt after either real verified session
  // or either signed envelope has expired while the transaction was open.
  const atCommit=Date.now();
  if(!Number.isSafeInteger(signed.signatureExpiresAtMs)||
     signed.signatureExpiresAtMs<=atCommit||
     !Number.isSafeInteger(ownerAuth?.sessionExpiresAtMs)||
     ownerAuth.sessionExpiresAtMs<=atCommit||
     !Number.isSafeInteger(teamLeaderAuth?.sessionExpiresAtMs)||
     teamLeaderAuth.sessionExpiresAtMs<=atCommit||
     !Number.isSafeInteger(teamLeaderAuth?.membershipExpiresAtMs)||
     teamLeaderAuth.membershipExpiresAtMs<=atCommit){
   await client.query("ROLLBACK");settled=true;
   return deny("SIGNED_EOD_IDENTITY_OR_ENVELOPE_EXPIRED_DURING_TRANSACTION");
  }
  // The signature may remain valid beyond an actual enrolled key's TTL.
  // Recheck the pinned, locked registry at the commit boundary.
  // Math.max supports deterministic disposable-fixture time advancement.
  const keyCommitTime=Math.max(now,atCommit);
  if(registry.length!==2||registry.some(k=>
     !Number.isSafeInteger(k.notBeforeMs)||!Number.isSafeInteger(k.notAfterMs)||
     keyCommitTime<k.notBeforeMs||keyCommitTime>=k.notAfterMs)){
   await client.query("ROLLBACK");settled=true;
   return deny("SIGNED_EOD_SIGNER_KEY_EXPIRED_DURING_TRANSACTION");
  }
  // Memberships locked above cannot be concurrently changed, but their
  // TTLs advance during long transactions. Check actual PostgreSQL time,
  // not caller-provided membership expiry, immediately before COMMIT.
  const finalMembers=await client.query(
   "SELECT m.auth_user_id FROM public.vox_staff_memberships_v1 m "+
   "WHERE m.team_id=$1::uuid AND m.is_active=true AND m.revoked_at IS NULL "+
   "AND m.expires_at>clock_timestamp() AND ("+
   "(m.auth_user_id=$2::uuid AND m.staff_role='team_leader') OR "+
   "(m.auth_user_id=$3::uuid))",
   [request.teamId,teamLeaderAuth?.userId,lockedEodSubjectStaffId]);
  if(finalMembers.rowCount!==2||
     new Set(finalMembers.rows.map(r=>r.auth_user_id)).size!==2){
   await client.query("ROLLBACK");settled=true;
   return deny("SIGNED_EOD_MEMBERSHIP_EXPIRED_DURING_TRANSACTION");
  }
  // Signed envelopes can remain valid while the original verified AAL2
  // session becomes stale. Reuse the branded verifier, not caller claims.
  const finalAuth=checkRc4ApproversAtCommit(ownerAuth,teamLeaderAuth,
   Math.max(now,atCommit));
  if(finalAuth){
   await client.query("ROLLBACK");settled=true;
   return deny("SIGNED_EOD_AAL2_STALE_DURING_TRANSACTION");
  }
  settled=true;
  try{await client.query("COMMIT");}
  catch{
   // A transport error after COMMIT can hide a genuine durable receipt.
   // Never reuse the backend whose transaction outcome is unknown.
   destroyConnection=true;
   // Require nonce/receipt reconciliation; never imply a known rollback.
   return result({ok:false,reason:"COMMIT_OUTCOME_UNKNOWN",
    intentId,subjectId:request.subjectId,receiptSha256,
    committed:null,requiresReconciliation:true,approved:false,
    canAuthorize:false,officialEodEnabled:false});
  }
  // Auditable receipt: receiptSha256 is recomputable from the DB alone; the
  // key ids and registry pin are evidence the review-only DDL does not store.
  return result({ok:true,intentId,state:"AWAITING_EXTERNAL_REVIEW",
   receiptSha256,receipt:Object.freeze({schema:"qf.vox.rc8.signed-intent-receipt/v1",
    intentId,type:request.type,subjectId:request.subjectId,digest:request.digest,
    teamId:request.teamId,cityId:request.cityId,ownerId:signed.ownerId,
    teamLeaderId:signed.teamLeaderId,ownerKeyId:ownerKeys[0].keyId,
    teamLeaderKeyId:tlKeys[0].keyId,registryFingerprint:rc4RegistryFingerprint(registry),
    claims:Object.freeze(durable.claims.map(c=>Object.freeze({...c}))),receiptSha256}),
   committed:true,approved:false,canAuthorize:false,officialEodEnabled:false});
 }catch{
  if(started&&!settled){
   try{await client.query("ROLLBACK");}
   catch{destroyConnection=true;}
  }
  return deny("PG_TRANSACTION_FAILED");
 }finally{try{client?.release?.(destroyConnection)}catch{}}
}
/** Read-only reconciliation of a COMMIT_OUTCOME_UNKNOWN signed EOD intent.
 * Never writes, never re-claims nonces, never approves. Outcomes:
 *  COMMITTED      exact durable receipt with the expected digest exists;
 *  NOT_COMMITTED  writer transaction has ended and there is no receipt and
 *                 no claims for intentId (nonces were never consumed; a fresh
 *                 signed pair is still required);
 *  IN_FLIGHT      writer transaction still open: outcome undecided, retry;
 *  INCONSISTENT   anything else: HOLD for independent DBA/AppSec review. */
export async function reconcileRc8PgSignedIntentOutcome({acquireClient,intentId,
 subjectId,expectedReceiptSha256,now}={}){
 const base={approved:false,canAuthorize:false,officialEodEnabled:false,
  publicationAuthorized:false};
 if(typeof acquireClient!=="function"||typeof intentId!=="string"||
    !LOWER_UUID.test(intentId)||typeof subjectId!=="string"||!LOWER_UUID.test(subjectId)||
    typeof expectedReceiptSha256!=="string"||!HEX64.test(expectedReceiptSha256))
  return result({...base,ok:false,reason:"RECONCILIATION_INPUT_INVALID",outcome:null});
 let client,started=false,destroyConnection=false;
 try{
  client=await acquireClient();
  if(!client||typeof client.query!=="function"||typeof client.release!=="function")
   return result({...base,ok:false,reason:"PG_CLIENT_INVALID",outcome:null});
  // READ COMMITTED on purpose: a REPEATABLE READ snapshot would be taken by
  // the probe statement itself, BEFORE the lock is granted, and could miss a
  // COMMIT that lands in between. Each read below gets a post-probe snapshot.
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ ONLY");
  started=true;
  const probe=await client.query(INTENT_LOCK_PROBE_SQL,[intentId]);
  if(probe.rows?.[0]?.writerFinished!==true){
   // The writer's transaction still holds its intent lock: COMMIT may yet
   // land. Absence of rows is not evidence of rollback; retry later.
   await client.query("ROLLBACK");started=false;
   return result({...base,ok:false,reason:"RECONCILIATION_WRITER_IN_FLIGHT",
    outcome:"IN_FLIGHT",intentId,subjectId,retryReconciliationLater:true});
  }
  const durable=await readDurableReceipt(client,intentId);
  const forSubject=await client.query(
   "SELECT id::text AS id FROM "+P+"verified_intents_candidate_v1 "+
   "WHERE type='EOD_OFFICIAL_RELEASE' AND subject_id=$1::uuid",[subjectId]);
  // The pending receipt is only meaningful while the CURRENT four-source report
  // still carries the exact digest/scope the two humans signed. Read it inside
  // the same read-only transaction (writer already finished, so it is stable).
  let reportCurrent=false,signerKeysCurrent=false;
  if(durable.intents.length===1){
   const rep=await client.query(
    "SELECT team_id::text AS \"teamId\",city_id::text AS \"cityId\","+
    "staff_id::text AS \"staffId\",reviewer_id::text AS \"reviewerId\",source_count AS \"sourceCount\","+
    "source_digest AS \"sourceDigest\",state,published "+
    "FROM public.vox_ab7f_four_source_eod_candidate_v1 WHERE id=$1::uuid",[subjectId]);
   const r=rep.rows?.[0],i=durable.intents[0];
   reportCurrent=rep.rows?.length===1&&r.teamId===i.teamId&&r.cityId===i.cityId&&
    r.reviewerId===i.teamLeaderId&&Number(r.sourceCount)===4&&
    // The receipt does not store the report's Staff subject, and the report
    // stays mutable after COMMIT. Re-assert the writer's independence rule:
    // the submitting Staff may never become the Owner or Team Leader signer.
    typeof r.staffId==="string"&&LOWER_UUID.test(r.staffId)&&
    r.staffId!==i.ownerId&&r.staffId!==i.teamLeaderId&&
    r.sourceDigest===i.digest&&
    r.state==="TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE"&&r.published===false;
   // RC34/RC37: the receipt's STORED signer keys must still be unrevoked, still
   // the exact enrolled key material, and inside their validity window now.
   // One statement = one snapshot, so a revocation cannot interleave per row.
   if(reportCurrent){
    const keys=await client.query(
     "SELECT e.key_id AS \"keyId\",e.signer_id::text AS \"signerId\","+
     "e.signer_role AS \"signerRole\",(v.key_id IS NOT NULL) AS \"revoked\","+
     "(r.public_key_fingerprint=e.public_key_fingerprint AND r.signer_id=e.signer_id AND "+
     "r.signer_role=e.signer_role AND r.not_before_ms=e.not_before_ms AND "+
     "r.not_after_ms=e.not_after_ms AND r.human_enrolled=true) AS \"registryMatches\","+
     "e.not_before_ms AS \"notBeforeMs\",e.not_after_ms AS \"notAfterMs\" "+
     "FROM "+RC37_KEYS_TABLE+" e "+
     "JOIN "+P+"human_signer_registry_candidate_v1 r ON r.key_id=e.key_id "+
     "LEFT JOIN "+P+"signer_revocations_candidate_v1 v ON v.key_id=e.key_id "+
     "WHERE e.intent_id=$1::uuid",[intentId]);
    const k=keys.rows??[];
    // `now` can only advance past the real clock (fixtures); never rewind it.
    const keyTime=Math.max(Number.isSafeInteger(now)?now:0,Date.now());
    const ownerKeys=k.filter(x=>x.signerId===i.ownerId&&x.signerRole==="OWNER");
    const tlKeys=k.filter(x=>x.signerId===i.teamLeaderId&&x.signerRole==="TEAM_LEADER");
    signerKeysCurrent=k.length===2&&ownerKeys.length===1&&tlKeys.length===1&&
     k.every(x=>x.revoked===false&&x.registryMatches===true&&
      keyTime>=Number(x.notBeforeMs)&&keyTime<Number(x.notAfterMs));
   }
  }
  await client.query("ROLLBACK");started=false;
  const otherIntent=(forSubject.rows??[]).some(r=>r.id!==intentId);
  if(durable.intents.length===0&&durable.claims.length===0)
   return result({...base,ok:true,outcome:"NOT_COMMITTED",intentId,subjectId,
    subjectClaimedByOtherIntent:otherIntent,retryRequiresFreshSignedPair:true});
  const digest=durable.intents.length===1?
   rc8SignedIntentReceiptSha256(durable.intents[0],durable.claims):null;
  if(digest&&digest===expectedReceiptSha256&&!otherIntent&&reportCurrent&&signerKeysCurrent&&
     durable.intents[0].subjectId===subjectId)
   return result({...base,ok:true,outcome:"COMMITTED",intentId,subjectId,
    receiptSha256:digest,state:"AWAITING_EXTERNAL_REVIEW",
    // Durable signer/scope identity so a reviewer can be bound to THIS receipt.
    ownerId:durable.intents[0].ownerId,teamLeaderId:durable.intents[0].teamLeaderId,
    teamId:durable.intents[0].teamId,cityId:durable.intents[0].cityId});
  return result({...base,ok:false,reason:"RECONCILIATION_INCONSISTENT",
   outcome:"INCONSISTENT",intentId,subjectId,requiresIndependentReview:true});
 }catch{
  // Unknown backend state after a failed read: never return it to the pool.
  destroyConnection=true;
  if(started){try{await client.query("ROLLBACK");}catch{}}
  return result({...base,ok:false,reason:"RECONCILIATION_UNAVAILABLE",outcome:null});
 }finally{try{client?.release?.(destroyConnection)}catch{}}
}
const PUBLICATION_BLOCKERS=Object.freeze(["RC8_APPROVAL_WRITER_NOT_INSTALLED",
 "NATIVE_APPROVAL_GATE_CLOSED","OFFICIAL_EOD_HARD_OFF",
 "NO_HUMAN_APPROVED_SIGNER_REGISTRY","EXTERNAL_REVIEW_OF_PENDING_RECEIPT_ABSENT",
 "DB_STORED_SIGNER_KEY_EVIDENCE_ABSENT"]);
/** Publication authorization STATE for a writer or reconciliation result.
 * Accepts no flags: authority comes only from source constants, all of which
 * are closed, so publicationAuthorized is false for every input today. */
export function rc8SignedEodPublicationAuthorizationState(outcome){
 const closed=(state,extra={})=>Object.freeze({state,publicationAuthorized:false,
  canPublish:false,approved:false,officialEodEnabled:false,
  blockers:PUBLICATION_BLOCKERS,...extra});
 if(!outcome||typeof outcome!=="object"||!RESULTS.has(outcome))
  return closed("UNVERIFIED_OUTCOME_DENIED");
 let state;
 if(outcome.ok===true&&outcome.committed===true&&HEX64.test(outcome.receiptSha256??""))
  state="PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW";
 else if(outcome.outcome==="COMMITTED")state="PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW";
 else if(outcome.reason==="COMMIT_OUTCOME_UNKNOWN"||outcome.outcome==="IN_FLIGHT")
  state="COMMIT_OUTCOME_UNKNOWN_RECONCILE_REQUIRED";
 else if(outcome.outcome==="NOT_COMMITTED")state="NOT_COMMITTED_FRESH_SIGNED_PAIR_REQUIRED";
 else if(outcome.outcome==="INCONSISTENT")state="RECONCILIATION_INCONSISTENT_HOLD";
 else state="DENIED";
 // Reported only. Every source gate is false today, and publicationAuthorized
 // stays hard false here: actual publication needs its own reviewed writer.
 const sourceAuthorized=RC8_APPROVAL_WRITER_INSTALLED===true&&RC4_OFFICIAL_EOD_ENABLED===true&&
  Object.values(RC8_NATIVE_APPROVAL_GATE).every(v=>v===true)&&
  RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS.length>0;
 return closed(state,{sourceAuthorized,
  receiptSha256:HEX64.test(outcome.receiptSha256??"")?outcome.receiptSha256:null});
}
export function executeRc8PgPendingSignedIntentProduction(options){
 return executeRc8PgPendingSignedIntent({...options,
  now:Date.now(), // live entry must never accept a caller-controlled clock
  approvedRegistryFingerprints:RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS
 },RC8_NATIVE_APPROVAL_GATE);
}
