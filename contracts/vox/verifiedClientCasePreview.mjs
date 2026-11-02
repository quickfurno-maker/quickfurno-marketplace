// VOX-L2. Current AAL2 Staff client-case metadata only; NOT full Riya
// handover authorization, provider consent, transcript access or messaging.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=v=>typeof v==="string"&&UUID.test(v);
const arr=v=>Array.isArray(v)&&v.length<=25;
const error=reason=>Object.freeze({ok:false,error:reason,
 canReadTranscript:false,canSendReply:false,canTakeover:false,
 providerMessagesSent:0});
export function projectScopedClientCaseList({
 scope,grants,conversations,leads,zones,now=Date.now()
}={}){
 if(!scope||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
   scope.canReadContent!==true||scope.canMutate!==false||
   !["operations_manager","support_agent"].includes(scope.role)||
   !Array.isArray(scope.verifiedDepartments)||
   !scope.verifiedDepartments.includes("client_success")||
   !arr(grants)||!arr(conversations)||!arr(leads)||!arr(zones)||
   !Number.isSafeInteger(now)||now<=0)
   return error("INDEPENDENT_CURRENT_CLIENT_SUCCESS_STAFF_REQUIRED");
 const allowed=new Set();
 for(const g of grants){
  if(!g||g.auth_user_id!==scope.userId||g.scope_kind!=="conversation"||
   !id(g.object_id)||allowed.has(g.object_id)||
   g.revoked_at!==null||typeof g.expires_at!=="string"||
   !Number.isFinite(Date.parse(g.expires_at))||Date.parse(g.expires_at)<=now)
   return error("CURRENT_CLIENT_OBJECT_GRANT_DENIED");
  allowed.add(g.object_id);
 }
 const leadById=new Map(),zoneById=new Map(),seen=new Set(),items=[];
 for(const z of zones){
  if(!z||!id(z.id)||zoneById.has(z.id)||z.city_id!==scope.cityId||
   z.is_active!==true)return error("CROSS_CITY_LOCATION_DENIED");
  zoneById.set(z.id,z);
 }
 for(const l of leads){
  if(!l||!id(l.id)||leadById.has(l.id)||!id(l.service_zone_id)||
    !zoneById.has(l.service_zone_id)||
    typeof l.google_place_id!=="string"||
    !/^[A-Za-z0-9_-]{8,200}$/.test(l.google_place_id)||
    l.location_verification_status!=="verified"||
    typeof l.latitude!=="number"||!Number.isFinite(l.latitude)||
    l.latitude<-90||l.latitude>90||
    typeof l.longitude!=="number"||!Number.isFinite(l.longitude)||
    l.longitude<-180||l.longitude>180)
   return error("CORE_GOOGLE_LOCATION_NOT_VERIFIED");
  leadById.set(l.id,l);
 }
 for(const c of conversations){
  if(!c||!id(c.id)||!allowed.has(c.id)||seen.has(c.id)||
    c.subject_type!=="client"||!id(c.subject_id)||
    !leadById.has(c.subject_id)||
    !["RIYA","HUMAN"].includes(c.assigned_actor)||
    !["OPEN","PAUSED","HUMAN","CLOSED"].includes(c.state)||
    !Number.isSafeInteger(c.revision)||c.revision<0||
    c.human_takeover!==(c.state==="HUMAN")||
    (c.assigned_actor==="HUMAN"&&c.state!=="HUMAN")||
    (c.assigned_actor==="RIYA"&&c.state==="HUMAN")||
    typeof c.updated_at!=="string"||!Number.isFinite(Date.parse(c.updated_at)))
   return error("UNVERIFIED_CLIENT_CONVERSATION");
  seen.add(c.id);
  items.push(Object.freeze({
   conversationId:c.id,clientProjectId:c.subject_id,
   agent:c.assigned_actor,caseState:c.state,revision:c.revision,
   lastUpdated:c.updated_at,googleLocationVerified:true,
   currentCityVerified:true,readOnly:true,canReadTranscript:false,
   canSendReply:false,canTakeover:false
  }));
 }
 items.sort((a,b)=>Date.parse(b.lastUpdated)-Date.parse(a.lastUpdated));
 return Object.freeze({ok:true,
  schema:"qf.vox.client.case.source-readiness.v1",
  mode:"READ_ONLY",source:"CORE_CANONICAL_CLIENT_CASES",
  boundedWindow:true,totalKnown:false,items:Object.freeze(items.slice(0,12)),
  canReadTranscript:false,canSendReply:false,canTakeover:false,
  requiresJarvisSignedPauseAck:true,requiresFreshClientConsent:true,
  allClientSubjectsVerified:false,providerMessagesSent:0});
}
