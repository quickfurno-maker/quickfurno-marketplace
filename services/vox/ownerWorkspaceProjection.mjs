// Owner-only, read-only projections. Do not reuse Staff membership or write authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=v=>typeof v==="string"&&UUID.test(v)?v:null;
const safe=(v,max=100)=>typeof v==="string"?v.replace(/[\u0000-\u001f]/g," ").trim().slice(0,max):"";
const timestamp=v=>typeof v==="string"&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const limited=v=>Array.isArray(v)?v.slice(0,12):[];
const envelope=(schema,fields)=>Object.freeze({schema,owner:"quickfurno-core",readOnly:true,actionsEnabled:false,...fields});

/** Recent client lead metadata only. Core retains lead/assignment authority and PII.
 * A 12-row sample is never represented as an exhaustive directory or true KPI. */
export function projectOwnerClientInbox({leads=[]}={}){
 const rows=limited(leads).filter(lead=>id(lead?.id)).map(lead=>Object.freeze({
  leadId:lead.id,
  state:safe(lead.status,40),
  city:safe(lead.city,80),
  category:safe(lead.category,80),
  source:safe(lead.source,60),
  createdAt:timestamp(lead.created_at)
 }));
 return envelope("qf.vox.owner.clients.v1",{
  leads:rows,recentOnly:true,totalCountKnown:false
 });
}

export function projectOwnerAcquisition({prospects=[],tasks=[]}={}){
 const ps=limited(prospects).filter(p=>id(p?.id)).map(p=>Object.freeze({
  id:p.id,businessName:safe(p.business_name,120),stage:safe(p.prospect_stage,40),
  priority:safe(p.priority_band,8),nextAction:safe(p.next_action_type,50),
  humanTakeover:p.human_takeover===true,doNotContact:p.do_not_contact===true,
  lastActivityAt:timestamp(p.last_activity_at)
 }));
 const allowed=new Set(ps.map(p=>p.id));
 const ts=limited(tasks).filter(t=>id(t?.id)&&allowed.has(t.prospect_id)).map(t=>Object.freeze({
  id:t.id,prospectId:t.prospect_id,status:safe(t.status,30),
  type:safe(t.task_type,60),dueAt:timestamp(t.due_at)
 }));
 return envelope("qf.vox.owner.acquisition.v1",{prospects:ps,tasks:ts});
}
export function projectOwnerVendor360({vendors=[],crm=[],tasks=[]}={}){
 const vs=limited(vendors).filter(v=>id(v?.id)).map(v=>Object.freeze({
  vendorId:v.id,businessName:safe(v.business_name,120),status:safe(v.status,45),
  verificationStatus:safe(v.verification_status,45),
  locationVerification:safe(v.location_verification_status,45),active:v.is_active===true
 }));
 const allowed=new Set(vs.map(v=>v.vendorId));
 const cs=limited(crm).filter(c=>allowed.has(c?.vendor_id)).map(c=>Object.freeze({
  vendorId:c.vendor_id,onboarding:safe(c.onboarding_stage,60),
  relationship:safe(c.relationship_status,60)
 }));
 const ts=limited(tasks).filter(t=>id(t?.id)&&allowed.has(t.vendor_id)).map(t=>Object.freeze({
  id:t.id,vendorId:t.vendor_id,title:safe(t.title,120),status:safe(t.status,30)
 }));
 return envelope("qf.vox.owner.vendor360.v1",{vendors:vs,crm:cs,tasks:ts});
}
export function projectOwnerDesk({threads=[],conversations=[],now=Date.now()}={}){
 const support=limited(threads).filter(t=>id(t?.id)).map(t=>Object.freeze({
  threadId:t.id,state:safe(t.status,32),priority:safe(t.priority,32),
  ageBand:"NOT_CONFIGURED",canClose:false
 }));
 const humanInbox=limited(conversations)
  .filter(c=>id(c?.id)&&c.state==="HUMAN"&&c.human_takeover===true)
  .map(c=>{
   const kind=safe(c.subject_type,40).toLowerCase();
   const lane=kind==="vendor"?"ANISHA":kind==="aarohi_prospect"||kind==="prospect"?"AAROHI":"UNKNOWN";
   const exp=timestamp(c.service_window_expires_at);
   return Object.freeze({conversationId:c.id,lane,state:"HUMAN",
    serviceWindow:exp&&Date.parse(exp)>now?"OPEN":"CLOSED_OR_UNKNOWN",canReply:false});
  });
 return envelope("qf.vox.owner.desk.v1",{support,humanInbox});
}
