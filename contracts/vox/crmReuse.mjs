// VOX-05: narrow projections from EXISTING Aarohi and Vendor CRM records.
// No duplicate CRM state, vendor authority, customer contact fields, or writes.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x)?x:null;
const txt=(x,n=100)=>typeof x==="string"?x.replace(/[\u0000-\u001f]/g," ").trim().slice(0,n):"";
const date=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const take=x=>Array.isArray(x)?x.slice(0,12):[];
export function projectAarohiWorkspace({prospects=[],tasks=[],conversions=[],scope}={}){
 if(!scope||!Array.isArray(scope.prospectIds)||!Array.isArray(scope.vendorIds)||!id(scope.cityId))throw Error("VERIFIED_SCOPE_REQUIRED");
 const allowed=new Set(scope.prospectIds),vendors=new Set(scope.vendorIds);
 const ps=take(prospects.filter(x=>x&&id(x.id)&&allowed.has(x.id)&&x.city_id===scope.cityId)).map(x=>Object.freeze({
  id:x.id,businessName:txt(x.business_name,120),category:txt(x.primary_category,60),
  stage:txt(x.prospect_stage,40),conversationStage:txt(x.conversation_stage,40),priority:txt(x.priority_band,8),
  nextAction:txt(x.next_action_type,50),nextActionAt:date(x.next_action_at),
  doNotContact:x.do_not_contact===true,aiPaused:x.ai_paused===true,humanTakeover:x.human_takeover===true,
  lastActivityAt:date(x.last_activity_at)}));
 const exposed=new Set(ps.map(x=>x.id));
 const ts=take(tasks.filter(x=>x&&id(x.id)&&exposed.has(x.prospect_id))).map(x=>Object.freeze({
  id:x.id,prospectId:x.prospect_id,type:txt(x.task_type,60),status:txt(x.status,30),
  priority:txt(x.priority,20),dueAt:date(x.due_at)}));
 // Conversion correlation is NOT permission to activate a vendor. Only reveal
 // when BOTH prospect and vendor assigned. Linked ID never proves Core ACTIVE.
 const cs=take(conversions.filter(x=>x&&exposed.has(x.prospect_id)&&vendors.has(x.vendor_id)&&id(x.vendor_id)&&x.revoked_at==null)).map(x=>
 Object.freeze({prospectId:x.prospect_id,vendorId:x.vendor_id,linkStatus:txt(x.status,40),coreActivationVerified:false}));
 return Object.freeze({schema:"qf.vox.aarohi.reuse.v1",owner:"quickfurno-core",readOnly:true,
  prospects:Object.freeze(ps),tasks:Object.freeze(ts),links:Object.freeze(cs)});
}
export function projectVendor360({vendors=[],crm=[],tasks=[],scope}={}){
 if(!scope||!Array.isArray(scope.vendorIds)||!Array.isArray(scope.validatedVendorIds))throw Error("VERIFIED_SCOPE_REQUIRED");
 const allowed=new Set(scope.vendorIds),validated=new Set(scope.validatedVendorIds);
 const vs=take(vendors.filter(v=>v&&id(v.id)&&allowed.has(v.id)&&validated.has(v.id))).map(v=>Object.freeze({
  vendorId:v.id,businessName:txt(v.business_name,120),status:txt(v.status,45),
  verificationStatus:txt(v.verification_status,45),locationVerification:txt(v.location_verification_status,45),
  googlePlaceVerified:Boolean(v.google_place_id&&v.location_verification_status==="verified"),
  active:v.is_active===true,acceptingLeads:v.accepting_leads===true,
  serviceZoneId:id(v.service_zone_id)}));
 const shown=new Set(vs.map(v=>v.vendorId));
 const crmRows=take(crm.filter(x=>x&&shown.has(x.vendor_id))).map(x=>Object.freeze({
  vendorId:x.vendor_id,onboarding:txt(x.onboarding_stage,60),relationship:txt(x.relationship_status,60),
  nextFollowupAt:date(x.next_follow_up_at),acquisitionSource:txt(x.acquisition_source,60),
  aarohiProspectId:id(x.aarohi_prospect_id)}));
 const work=take(tasks.filter(x=>x&&id(x.id)&&shown.has(x.vendor_id))).map(x=>Object.freeze({
  id:x.id,vendorId:x.vendor_id,title:txt(x.title,120),status:txt(x.status,30),
  priority:txt(x.priority,30),dueAt:date(x.due_at)}));
 return Object.freeze({schema:"qf.vox.vendor360.reuse.v1",owner:"quickfurno-core",readOnly:true,
 vendors:Object.freeze(vs),crm:Object.freeze(crmRows),tasks:Object.freeze(work),
 paymentsEnabled:false,matchingEnabled:false,profileWritesEnabled:false});
}
