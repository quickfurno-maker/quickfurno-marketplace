/** RC8 PostgreSQL transaction writer for a PENDING signed-intent receipt.
 * No production route, human key enrolment, official EOD or operator release.
 */
import {randomUUID} from "node:crypto";
import {prepareRc4SignedApproval,rc4RegistryFingerprint,
 checkRc4ApproversAtCommit,RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS} from "../../../contracts/vox/rc4ApprovalPipeline.mjs";
export const RC8_APPROVAL_WRITER_INSTALLED=false;
export const RC8_NATIVE_APPROVAL_GATE=Object.freeze({
 humanKeyCeremonyComplete:false,independentDbaAppsecApproved:false,
 dedicatedWriterRoleReviewed:false,managedRestoreCertified:false});
const deny=reason=>Object.freeze({ok:false,reason,committed:false,
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
const P="public.vox_rc8_";
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
 let client,started=false,settled=false;
 try{
  client=await acquireClient();
  if(!client||typeof client.query!=="function"||typeof client.release!=="function")
   return deny("PG_CLIENT_INVALID");
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE");
  started=true;
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
   "not_before_ms AS \"notBeforeMs\",not_after_ms AS \"notAfterMs\" "+
   "FROM "+P+"human_signer_registry_candidate_v1 "+
   "WHERE human_enrolled=true ORDER BY key_id FOR SHARE");
  const registry=registryRows.rows.map(r=>({...r,
   notBeforeMs:Number(r.notBeforeMs),notAfterMs:Number(r.notAfterMs)}));
  if(registry.length!==2||!Array.isArray(approvedRegistryFingerprints)||
     !approvedRegistryFingerprints.includes(rc4RegistryFingerprint(registry))){
   await client.query("ROLLBACK");settled=true;return deny("HUMAN_SIGNER_REGISTRY_UNAPPROVED");
  }
  const revoked=await client.query(
   "SELECT key_id FROM "+P+"signer_revocations_candidate_v1 FOR SHARE");
  const revocations={keyIds:revoked.rows.map(r=>r.key_id),signerIds:[]};
  const intentId=randomUUID();
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
   // Require nonce/receipt reconciliation; never imply a known rollback.
   return Object.freeze({ok:false,reason:"COMMIT_OUTCOME_UNKNOWN",
    intentId,subjectId:request.subjectId,
    committed:null,requiresReconciliation:true,approved:false,
    canAuthorize:false,officialEodEnabled:false});
  }
  return Object.freeze({ok:true,intentId,state:"AWAITING_EXTERNAL_REVIEW",
   committed:true,approved:false,canAuthorize:false,officialEodEnabled:false});
 }catch{
  if(started&&!settled){try{await client.query("ROLLBACK");}catch{}}
  return deny("PG_TRANSACTION_FAILED");
 }finally{try{client?.release?.()}catch{}}
}
export function executeRc8PgPendingSignedIntentProduction(options){
 return executeRc8PgPendingSignedIntent({...options,
  now:Date.now(), // live entry must never accept a caller-controlled clock
  approvedRegistryFingerprints:RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS
 },RC8_NATIVE_APPROVAL_GATE);
}
