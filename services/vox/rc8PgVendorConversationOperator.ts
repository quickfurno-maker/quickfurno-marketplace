/** RC8 native Core vendor conversation operator: true PG READ WRITE transaction.
 * REVIEW ONLY. No exported live route. HUMAN pause/takeover only (no sends).
 * Cannot create canonical AB7B CORE_CONVERSATION source row until reviewed
 * SQL CHECK/consent scope binding and actual Staff AAL2 integration are approved.
 */
import {randomUUID} from "node:crypto";
import {decideCommunicationConsent} from "../communicationConsentDecisionService";
import {authorizeConversationalWhatsAppConsent} from "../outboundConsentEnforcementService";
export const RC8_CORE_WRITER_INSTALLED=false as const;
export const RC8_CORE_RELEASE_GATE=Object.freeze({
 ab7bBindingApproved:false,staffAal2AdapterInstalled:false,
 allConsentMutationPathsSerialized:false,managedSchemaReviewed:false});
type Db={query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;
 release:()=>void};
type Input={conversationId:string;nonce:string;expectedRevision:number;
 action:"PAUSE_AI"|"TAKEOVER";verifiedStaff:{
 userId:string;aal:"aal2";expiresAtMs:number}};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const closed=(reason:string)=>Object.freeze({ok:false,reason,committed:false,
 canonicalAb7bSourceReady:false,providerMessagesSent:0});
const timestamp=(column:string)=>"CASE WHEN "+column+" IS NULL THEN NULL ELSE "+
 "to_char("+column+" AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') END";
const suppressions="SELECT id::text AS id,scope,reason,policy_version,is_active,"+
 timestamp("expires_at")+" AS expires_at,"+timestamp("deactivated_at")+
 " AS deactivated_at FROM public.communication_suppressions "+
 "WHERE destination_hash=$1 AND channel=$2 AND is_active=true AND scope=ANY($3::text[])";
const preference="SELECT id::text AS id,state,policy_version,"+
 timestamp("consented_at")+" AS consented_at,"+timestamp("withdrawn_at")+
 " AS withdrawn_at FROM public.communication_preferences "+
 "WHERE principal_type=$1 AND principal_id=$2::uuid AND channel=$3 AND scope=$4";
export async function executeRc8PgVendorConversationOperator(input:Input,
 acquireClient:()=>Promise<Db>,
 sourceProof?:{mode:"DISPOSABLE_RC12_AB7B_PROOF"}){
 const proveSource=sourceProof?.mode==="DISPOSABLE_RC12_AB7B_PROOF";
 if(!input||!UUID.test(input.conversationId??"")||!UUID.test(input.nonce??"")||
    !Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||
    !["PAUSE_AI","TAKEOVER"].includes(input.action)||!input.verifiedStaff||
    !UUID.test(input.verifiedStaff.userId??"")||input.verifiedStaff.aal!=="aal2"||
    !Number.isSafeInteger(input.verifiedStaff.expiresAtMs)||
    input.verifiedStaff.expiresAtMs<=Date.now()||
    typeof acquireClient!=="function")return closed("INPUT_OR_AAL2_INVALID");
 let db:Db|undefined,started=false,settled=false;
 try{
  db=await acquireClient();
  if(!db||typeof db.query!=="function"||typeof db.release!=="function")
   return closed("TRANSACTION_ADAPTER_INVALID");
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE");
  started=true;
  // Read destination first, lock it BEFORE any conversation row (D2-D order).
  const pre=await db.query(
   "SELECT destination_hash,subject_type FROM public.communication_conversations WHERE id=$1::uuid",
   [input.conversationId]);
  const hash=pre.rows[0]?.destination_hash;
  if(pre.rowCount!==1||typeof hash!=="string"||!/^[a-f0-9]{64}$/.test(hash)){
   await db.query("ROLLBACK");settled=true;return closed("CONVERSATION_NOT_FOUND");
  }
  await db.query(
   "SELECT pg_advisory_xact_lock(hashtextextended('dst|' || $1::text || '|whatsapp',0))",[hash]);
  const baseColumns=
   "SELECT c.id,c.tenant_id,c.channel,c.destination_hash,c.subject_type,c.subject_id,"+
   "c.state,c.revision,c.assigned_actor,c.human_takeover, "+
   "geo_city.id AS city_id,geo_city.is_active AS city_active,"+
   "z.is_active AS zone_active,z.matching_enabled AS zone_matching_enabled ";
  const cityJoin="JOIN public.cities geo_city ON "+
   "lower(btrim(geo_city.name))=lower(btrim(z.canonical_city)) ";
  const clientBinding=pre.rows[0].subject_type==="client";
  const subjectJoin=clientBinding?
   "FROM public.communication_conversations c "+
   "JOIN public.vox_rc12_client_conversation_project_bindings_candidate_v1 b "+
   "ON b.conversation_id=c.id AND b.client_account_id=c.subject_id "+
   "AND b.review_state='APPROVED' AND b.expires_at>clock_timestamp() "+
   "JOIN public.client_accounts ca ON ca.id=b.client_account_id AND ca.status='active' "+
   "AND ca.user_id=b.owner_user_id "+
   "JOIN public.leads l ON l.id=b.lead_id AND l.service_zone_id=b.service_zone_id "+
   "AND l.location_verification_status='verified' "+
   "JOIN public.marketplace_service_zones z ON z.id=b.service_zone_id "+
   "JOIN public.profiles reviewer ON reviewer.id=b.reviewed_by "+
   "AND reviewer.is_active=true AND reviewer.role IS NULL "+
   "JOIN auth.users reviewer_auth ON reviewer_auth.id=b.reviewed_by "+
   "AND reviewer_auth.raw_app_meta_data->>'qf_principal'='vox_staff' "+
   "AND reviewer_auth.raw_app_meta_data->>'vox_role'='team_leader' "+
   "AND reviewer_auth.raw_app_meta_data->>'admin_role' IS NULL "+
   "JOIN public.vox_staff_memberships_v1 review_m ON review_m.auth_user_id=b.reviewed_by "+
   "AND review_m.team_id=b.team_id AND review_m.staff_role='team_leader' "+
   "AND review_m.is_active=true AND review_m.revoked_at IS NULL "+
   "AND review_m.expires_at>clock_timestamp() "+
   "JOIN public.vox_staff_teams_v1 review_t ON review_t.id=b.team_id "+
   "AND review_t.city_id=b.approved_city_id AND review_t.is_active=true ":
   "FROM public.communication_conversations c "+
   "JOIN public.vendors v ON c.subject_type='vendor' AND v.id=c.subject_id "+
   "JOIN public.marketplace_service_zones z ON z.id=v.service_zone_id ";
  const clientChecks=clientBinding?
   "AND geo_city.id=b.approved_city_id "+
   "AND lower(btrim(l.city))=lower(btrim(z.canonical_city)) "+
   "FOR UPDATE OF c FOR SHARE OF b,ca,l,z,geo_city,reviewer,reviewer_auth,review_m,review_t":
   "FOR UPDATE OF c";
  const conv=await db.query(baseColumns+subjectJoin+cityJoin+
   "WHERE c.id=$1::uuid "+clientChecks,[input.conversationId]);
  const c=conv.rows[0];
  if(conv.rowCount!==1||c.tenant_id!=="quickfurno"||c.channel!=="whatsapp"||
     c.destination_hash!==hash||
     !(c.subject_type==="vendor"||c.subject_type==="client")||
     c.subject_type!==pre.rows[0].subject_type||
     c.zone_active!==true||
     c.zone_matching_enabled!==true||c.city_active!==true||
     Number(c.revision)!==input.expectedRevision||c.human_takeover!==false||
     !(c.subject_type==="client"?
       c.assigned_actor==="RIYA":
       ["ANISHA","AAROHI","RIYA"].includes(c.assigned_actor))||
     (input.action==="PAUSE_AI"&&c.state!=="OPEN")||
     (input.action==="TAKEOVER"&&!["OPEN","PAUSED"].includes(c.state))){
   await db.query("ROLLBACK");settled=true;return closed("CURRENT_SUBJECT_SCOPE_OR_STATE_DENIED");
  }
  const staff=await db.query(
   "SELECT m.auth_user_id,m.team_id FROM public.vox_staff_memberships_v1 m "+
   "JOIN public.vox_staff_teams_v1 t ON t.id=m.team_id "+
   "JOIN public.profiles p ON p.id=m.auth_user_id "+
   "JOIN auth.users u ON u.id=m.auth_user_id "+
   "WHERE m.auth_user_id=$1::uuid AND m.staff_role='operations_manager' "+
   "AND m.is_active=true AND m.revoked_at IS NULL "+
   "AND m.expires_at>clock_timestamp() AND t.is_active=true "+
   "AND t.city_id=$2::uuid AND p.is_active=true AND p.role IS NULL "+
   "AND u.raw_app_meta_data->>'qf_principal'='vox_staff' "+
   "AND u.raw_app_meta_data->>'admin_role' IS NULL "+
   "FOR SHARE OF m,t,p,u",
   [input.verifiedStaff.userId,c.city_id]);
  if(staff.rowCount!==1||input.verifiedStaff.expiresAtMs<=Date.now()){
   await db.query("ROLLBACK");settled=true;return closed("CURRENT_STAFF_GRANT_OR_AAL2_DENIED");
  }
  // A capability row alone grants NOTHING. The original independent TL
  // decision, request and activation must ALL remain current. Lock their
  // rows so a concurrent revocation cannot commit before this writer.
  const reviewed=await db.query(
   "SELECT cap.id FROM public.vox_staff_department_capabilities_v1 cap "+
   "JOIN public.vox_staff_department_requests_v1 req ON req.id=cap.request_id "+
   "JOIN public.vox_staff_department_decisions_v1 d ON d.request_id=req.id "+
   "JOIN public.vox_staff_department_activations_v1 x "+
   "ON x.request_id=req.id AND x.capability_id=cap.id "+
   "JOIN public.profiles reviewer ON reviewer.id=req.decided_by "+
   "JOIN auth.users reviewer_auth ON reviewer_auth.id=reviewer.id "+
   "JOIN public.vox_staff_memberships_v1 tl ON tl.auth_user_id=reviewer.id "+
   "JOIN public.vox_staff_teams_v1 rt ON rt.id=tl.team_id "+
   "WHERE cap.auth_user_id=$1::uuid AND cap.team_id=$2::uuid "+
   "AND cap.city_id=$3::uuid AND cap.department='client_success' "+
   "AND cap.revoked_at IS NULL AND cap.revision=2 "+
   "AND cap.expires_at>clock_timestamp() "+
   "AND req.state='APPROVED' AND req.revision=1 "+
   "AND req.expires_at>clock_timestamp() AND req.target_staff_id=$1::uuid "+
   "AND req.team_id=$2::uuid AND req.city_id=$3::uuid "+
   "AND req.department='client_success' "+
   "AND req.decided_by<>req.requested_by AND req.decided_by<>req.target_staff_id "+
   "AND d.reviewer_id=req.decided_by AND d.decision='APPROVED' "+
   "AND d.decision_reference=req.decision_reference "+
   "AND x.activated_by=req.requested_by AND cap.granted_by=req.requested_by "+
   "AND reviewer.role IS NULL AND reviewer.is_active=true "+
   "AND reviewer_auth.raw_app_meta_data->>'qf_principal'='vox_staff' "+
   "AND reviewer_auth.raw_app_meta_data->>'vox_role'='team_leader' "+
   "AND reviewer_auth.raw_app_meta_data->>'admin_role' IS NULL "+
   "AND tl.staff_role='team_leader' AND tl.is_active=true "+
   "AND tl.revoked_at IS NULL AND tl.expires_at>clock_timestamp() "+
   "AND rt.id=req.team_id AND rt.city_id=req.city_id AND rt.is_active=true "+
   "FOR SHARE OF cap,req,d,x,reviewer,reviewer_auth,tl,rt",
   [input.verifiedStaff.userId,staff.rows[0].team_id,c.city_id]);
  if(reviewed.rowCount!==1){
   await db.query("ROLLBACK");settled=true;return closed("DEPARTMENT_INDEPENDENT_REVIEW_REQUIRED");
  }
  const scope=await db.query(
   "SELECT id FROM public.vox_staff_object_scopes_v1 "+
   "WHERE auth_user_id=$1::uuid AND scope_kind='conversation' "+
   "AND object_id=$2::uuid AND revoked_at IS NULL "+
   "AND expires_at>clock_timestamp() FOR SHARE",
   [input.verifiedStaff.userId,input.conversationId]);
  if(scope.rowCount!==1){
   await db.query("ROLLBACK");settled=true;return closed("CONVERSATION_OBJECT_GRANT_REVOKED");
  }
  const consent=await authorizeConversationalWhatsAppConsent({
   destinationHash:hash,subjectType:c.subject_type as "client"|"vendor",subjectId:c.subject_id},{
   decide:decision=>decideCommunicationConsent(decision,{
    now:()=>new Date(),
    readSuppressions:async q=>(await db!.query(suppressions,
     [q.destinationHash,q.channel,q.scopes])).rows,
    readExactPreference:async q=>(await db!.query(preference,
     [q.principalType,q.principalId,q.channel,q.scope])).rows
   })
  });
  if(consent.kind!=="allow"||consent.scope!=="transactional"){
   await db.query("ROLLBACK");settled=true;
   return closed(consent.kind==="unavailable"?"CONSENT_AUTHORITY_UNAVAILABLE":"CONSENT_DENIED");
  }
  const next=input.expectedRevision+1;
  const target=input.action==="TAKEOVER"?"HUMAN":"PAUSED";
  const updated=await db.query(
   "UPDATE public.communication_conversations SET state=$2,"+
   "assigned_actor=CASE WHEN $3='TAKEOVER' THEN 'HUMAN' ELSE assigned_actor END,"+
   "human_takeover=($3='TAKEOVER'),jarvis_enabled=false,revision=$4,"+
   "updated_at=clock_timestamp() WHERE id=$1::uuid AND revision=$5 RETURNING id",
   [input.conversationId,target,input.action,next,input.expectedRevision]);
  if(updated.rowCount!==1)throw Error("REVISION_CHANGED");
  const event=await db.query(
   "INSERT INTO public.communication_conversation_events "+
   "(conversation_id,event_type,actor_type,safe_summary,event_data) "+
   "VALUES($1,$2,'HUMAN','Core consent-bound Staff control; no provider send',$3::jsonb) RETURNING id",
   [input.conversationId,input.action==="TAKEOVER"?"human.takeover_started":"ai.paused_by_operator",
    JSON.stringify({operatorUserId:input.verifiedStaff.userId,revision:next})]);
  if(event.rowCount!==1||!UUID.test(event.rows[0]?.id))throw Error("NO_EVENT");
  const receipt=await db.query(
   "INSERT INTO public.vox_rc8_conversation_operator_receipts_candidate_v1 "+
   "(nonce,conversation_id,actor_id,action,previous_revision,new_revision,event_id,consent_scope) "+
   "VALUES($1,$2,$3,$4,$5,$6,$7,'transactional') RETURNING nonce",
   [input.nonce,input.conversationId,input.verifiedStaff.userId,input.action,
    input.expectedRevision,next,event.rows[0].id]);
  if(receipt.rowCount!==1||receipt.rows[0]?.nonce!==input.nonce)throw Error("NO_RECEIPT");
  // REVIEW-ONLY native original-source proof: the existing AB7B source
  // restriction must be replaced by separately reviewed RC12 SQL on this
  // disposable database. Production entry never permits this branch.
  if(proveSource){
   if(next>2147483647)throw Error("SOURCE_REVISION_OUT_OF_RANGE");
   const sourceId=randomUUID();
   const kind=input.action==="TAKEOVER"?"HUMAN_TAKEOVER":"AI_PAUSED";
   const inserted=await db.query(
    "INSERT INTO public.vox_ab7b_native_source_actions_candidate_v1 "+
    "(id,source,subject_kind,subject_id,actor_id,team_id,city_id,revision,event_kind,nonce) "+
    "VALUES($1,'CORE_CONVERSATION','conversation',$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [sourceId,input.conversationId,input.verifiedStaff.userId,
     staff.rows[0].team_id,c.city_id,next,kind,input.nonce]);
   if(inserted.rowCount!==1||inserted.rows[0]?.id!==sourceId)
    throw Error("AB7B_SOURCE_NOT_PERSISTED");
   const provenance=await db.query(
    "SELECT s.id FROM public.vox_ab7b_native_source_actions_candidate_v1 s "+
    "JOIN public.vox_staff_source_events_candidate_v1 e ON e.source='CORE_CONVERSATION' "+
    "AND e.source_event_id=s.id AND e.actor_id=s.actor_id "+
    "AND e.team_id=s.team_id AND e.city_id=s.city_id "+
    "AND e.subject_id=s.subject_id AND e.revision=s.revision "+
    "JOIN public.vox_staff_source_nonce_candidate_v1 n "+
    "ON n.source='CORE_CONVERSATION' AND n.source_event_id=s.id "+
    "AND n.nonce=s.nonce AND n.actor_id=s.actor_id "+
    "WHERE s.id=$1::uuid AND s.nonce=$2::uuid",
    [sourceId,input.nonce]);
   if(provenance.rowCount!==1)throw Error("F1_OR_NONCE_ATOMIC_PROOF_MISSING");
  }
  settled=true;
  try{await db.query("COMMIT");}catch{return closed("COMMIT_OUTCOME_UNKNOWN");}
  return Object.freeze({ok:true,state:target,revision:next,
   committed:true,canonicalAb7bSourceReady:proveSource,providerMessagesSent:0});
 }catch{
  if(started&&!settled)try{await db!.query("ROLLBACK")}catch{}
  return closed("PG_TRANSACTION_FAILED");
 }finally{try{db?.release()}catch{}}
}
/** Live entry is permanently hard-off absent reviewed binding/migration.
 * Test function above is NOT called by a route. */
export async function executeRc8PgVendorConversationOperatorProduction(){
 return closed("CORE_WRITER_RELEASE_GATE_CLOSED");
}
