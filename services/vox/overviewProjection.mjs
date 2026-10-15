// VOX-02 no-PII projection over Core-authoritative read queries.
// This file does not know about service-role credentials or auth headers.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stage=x=>typeof x==="string"?x.trim().slice(0,48):"UNKNOWN";
const short=x=>typeof x==="string"?x.replace(/[\u0000-\u001f]/g," ").trim().slice(0,96):"";
const time=x=>typeof x==="string" && !Number.isNaN(Date.parse(x))?new Date(x).toISOString():null;
const list=(rows,fn)=>Object.freeze((Array.isArray(rows)?rows:[]).slice(0,8).map(fn));
export function projectVoxOverview({prospects,crm,vendorSupport,humanConversations}){
  return Object.freeze({
    schema:"qf.vox.overview.v1",source:"quickfurno-core",
    prospectPreview:list(prospects,r=>Object.freeze({prospectId:UUID.test(r?.id)?r.id:null,
      businessName:short(r?.business_name),stage:stage(r?.prospect_stage),
      priority:stage(r?.priority_band),lastActivityAt:time(r?.last_activity_at)})),
    vendorCrmPreview:list(crm,r=>Object.freeze({vendorId:UUID.test(r?.vendor_id)?r.vendor_id:null,
      onboarding:stage(r?.onboarding_stage),relationship:stage(r?.relationship_status),
      nextFollowupAt:time(r?.next_follow_up_at)})),
    supportPreview:list(vendorSupport,r=>Object.freeze({threadId:UUID.test(r?.id)?r.id:null,
      vendorId:UUID.test(r?.vendor_id)?r.vendor_id:null,status:stage(r?.status),priority:stage(r?.priority),updatedAt:time(r?.updated_at)})),
    humanDeskPreview:list(humanConversations,r=>Object.freeze({conversationId:UUID.test(r?.id)?r.id:null,
      subjectType:["prospect","vendor","client"].includes(r?.subject_type)?r.subject_type:"unknown",
      state:r?.state==="HUMAN"&&r?.human_takeover===true?"HUMAN":"UNKNOWN",
      revision:Number.isSafeInteger(Number(r?.revision))?Number(r.revision):null,updatedAt:time(r?.updated_at)})),
    permissions:Object.freeze(["OWNER_READ_ONLY"]),
    actionsEnabled:false,
  });
}
