// VOX-08P: non-executable Riya client/case handover source-readiness gate.
// DO NOT trust browser request fields as subject grants, provider consent or
// signed Jarvis verification. Core must inject a separate verified grant reader.
import {prepareRiyaHandoverIntent} from "./riyaHandoverPreparation.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=s=>typeof s==="string"&&UUID.test(s);
const record=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v,keys)=>record(v)&&Object.keys(v).sort().join("|")===[...keys].sort().join("|");
const block=(reason)=>Object.freeze({ok:false,error:reason,kind:"DENIED_PREFLIGHT",
 executionAuthorized:false,providerMessagesSent:0});
const ACTIONS=new Set(["REQUEST_TAKEOVER","ACCEPT_TAKEOVER","PROPOSE_REPLY","RELEASE_TO_RIYA"]);
/**
 * Caller requirements:
 * - Staff scope freshly resolved by real Supabase AAL2 Core Auth
 * - current *independently human approved* 'client_success' department
 * - separately queried canonical client↔project↔city grant, NEVER self-asserted
 * - separately verified signed Jarvis (same client/case revision and expiry)
 * - Core-owned current consent/human takeover and assigned staff lock
 *
 * This module only checks the data and NEVER executes any action.
 * verifyGrant and verifyJarvis are trusted server-side injected verifiers. Their
 * absence must fail closed; passing fake callbacks in tests is NOT approval.
 */
export async function preflightRiyaClientHandover({
 scope,department,conversation,clientGrant,canonicalLocationProof,jarvisReceipt,request,
 verifyGrant,verifyCanonicalLocation,verifyJarvis,now=Date.now()
}={}){
 if(!record(scope)||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
  scope.canReadContent!==true||scope.canMutate!==false||
  !["support_agent","operations_manager"].includes(scope.role)||
  !Array.isArray(scope.conversationIds)||scope.conversationIds.length>200||
  !scope.conversationIds.every(id))
  return block("CURRENT_NEUTRAL_AAL2_STAFF_SCOPE_REQUIRED");
 if(!record(department)||!exact(department,["department","staffId","teamId",
    "cityId","approvedByIndependentTl","expiresAt","revokedAt"])||
  department.department!=="client_success"||department.staffId!==scope.userId||
  department.teamId!==scope.teamId||department.cityId!==scope.cityId||
  department.approvedByIndependentTl!==true||department.revokedAt!==null||
  !Number.isFinite(Date.parse(department.expiresAt))||
  Date.parse(department.expiresAt)<=now)
  return block("INDEPENDENT_CLIENT_DEPARTMENT_GRANT_REQUIRED");
 if(!record(conversation)||!exact(conversation,[
  "id","clientId","projectId","teamId","cityId","assignedStaffId","revision",
  "state","humanTakeover","pausedRiya","providerOwner","consentState",
  "doNotContact","humanRequestedStop"
 ])||!id(conversation.id)||!scope.conversationIds.includes(conversation.id)||
  !id(conversation.clientId)||!id(conversation.projectId)||
  conversation.teamId!==scope.teamId||conversation.cityId!==scope.cityId||
  conversation.assignedStaffId!==scope.userId||
  !Number.isSafeInteger(conversation.revision)||conversation.revision<0||
  !["AI","TAKEOVER_PENDING","HUMAN","CLOSED"].includes(conversation.state)||
  conversation.providerOwner!=="CORE")
  return block("CLIENT_CONVERSATION_RESTRICTED");
 if(!record(clientGrant)||!exact(clientGrant,["clientId","projectId","staffId",
   "conversationId","teamId","cityId","status","expiresAt","grantRevision"])||
  clientGrant.clientId!==conversation.clientId||
  clientGrant.projectId!==conversation.projectId||
  clientGrant.staffId!==scope.userId||
  clientGrant.conversationId!==conversation.id||
  clientGrant.teamId!==scope.teamId||clientGrant.cityId!==scope.cityId||
  clientGrant.status!=="ACTIVE"||
  !Number.isSafeInteger(clientGrant.grantRevision)||clientGrant.grantRevision<1||
  !Number.isFinite(Date.parse(clientGrant.expiresAt))||
  Date.parse(clientGrant.expiresAt)<=now||typeof verifyGrant!=="function")
  return block("CANONICAL_CLIENT_PROJECT_GRANT_NOT_VERIFIED");
 let verifiedGrant=false;
 try{verifiedGrant=(await verifyGrant(clientGrant))===true;}catch{}
 if(!verifiedGrant)return block("CANONICAL_CLIENT_PROJECT_GRANT_NOT_VERIFIED");
 if(!record(canonicalLocationProof)||!exact(canonicalLocationProof,
   ["projectId","cityId","placeId","googleVerified"])||
  canonicalLocationProof.projectId!==conversation.projectId||
  canonicalLocationProof.cityId!==conversation.cityId||
  canonicalLocationProof.googleVerified!==true||
  typeof canonicalLocationProof.placeId!=="string"||
  !/^[a-zA-Z0-9_-]{8,200}$/.test(canonicalLocationProof.placeId)||
  typeof verifyCanonicalLocation!=="function")
  return block("SERVER_VERIFIED_PROJECT_GOOGLE_LOCATION_REQUIRED");
 let verifiedLocation=false;
 try{verifiedLocation=(await verifyCanonicalLocation(canonicalLocationProof))===true;}catch{}
 if(!verifiedLocation)return block("SERVER_VERIFIED_PROJECT_GOOGLE_LOCATION_REQUIRED");
 if(!record(jarvisReceipt)||!exact(jarvisReceipt,["conversationId","clientId",
  "projectId","revision","expiresAtMs","signatureVersion"])||
  jarvisReceipt.conversationId!==conversation.id||
  jarvisReceipt.clientId!==conversation.clientId||
  jarvisReceipt.projectId!==conversation.projectId||
  jarvisReceipt.revision!==conversation.revision||
  !Number.isSafeInteger(jarvisReceipt.expiresAtMs)||
  jarvisReceipt.expiresAtMs<=now||
  jarvisReceipt.expiresAtMs>now+300000||
  jarvisReceipt.signatureVersion!=="qfj.scale.http.v1"||
  typeof verifyJarvis!=="function")
  return block("SIGNED_JARVIS_CONVERSATION_PROOF_REQUIRED");
 let verifiedJarvis=false;
 try{verifiedJarvis=(await verifyJarvis(jarvisReceipt))===true;}catch{}
 if(!verifiedJarvis)return block("SIGNED_JARVIS_CONVERSATION_PROOF_REQUIRED");
 if(!record(request)||!exact(request,["action","nonce","reason","expectedRevision"])||
  !ACTIONS.has(request.action)||!id(request.nonce)||
  request.expectedRevision!==conversation.revision||
  typeof request.reason!=="string"||request.reason.length<12||
  request.reason.length>300||request.reason.trim()!==request.reason)
  return block("HANDOVER_COMMAND_OR_NONCE_INVALID");
 if(conversation.consentState!=="ALLOWED"||
  conversation.doNotContact!==false||conversation.humanRequestedStop!==false)
  return block("CLIENT_CONSENT_OR_STOP_DENIED");
 const result=prepareRiyaHandoverIntent({
  context:{coreVerified:true,aal:"aal2",currentStaffActive:true,isOwner:false,
   department:"client_success",departmentActive:true,
   staffId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
   clientIds:[conversation.clientId]},
  conversation:{
   id:conversation.id,clientId:conversation.clientId,
   projectId:conversation.projectId,cityId:conversation.cityId,
   teamId:conversation.teamId,state:conversation.state,
   revision:conversation.revision,coreSubjectVerified:true,
   canonicalGoogleLocationVerified:true,
   signedJarvisContextVerified:true,providerOwner:"CORE",
   assignedStaffId:conversation.assignedStaffId,
   signedContextExpiresAtMs:jarvisReceipt.expiresAtMs,
   doNotContact:conversation.doNotContact,
   consentState:conversation.consentState,
   isHumanRequestedStop:conversation.humanRequestedStop,
   human_takeover:conversation.humanTakeover,pausedRiya:conversation.pausedRiya
  },request,now
 });
 if(!result.ok)return block(result.error??"CORE_HANDOVER_STATE_DENIED");
 // Return only minimal case metadata, *never* transcript, phone or raw signed
 // proof, and never a Core execution token or provider-send permission.
 return Object.freeze({ok:true,schema:"qf.vox.riya.client.preflight.v2",
  kind:"NON_EXECUTABLE_PREFLIGHT",action:result.action,
  conversationId:conversation.id,clientId:conversation.clientId,
  projectId:conversation.projectId,teamId:scope.teamId,cityId:scope.cityId,
  expectedRevision:conversation.revision,nonce:request.nonce,
  proposedState:result.proposedState,
  requiresFreshCoreGrantAtExecution:true,
  requiresSeparateAtomicCoreApproval:true,
  requiresSignedJarvisPauseAck:true,requiresConsentAtSend:true,
  canReadTranscript:false,canSendReply:false,canChangeAgentState:false,
  executionAuthorized:false,providerMessagesSent:0});
}
