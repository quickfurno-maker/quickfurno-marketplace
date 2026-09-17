import "server-only";
import { adminClient } from "@/lib/supabase";
import { clampScore, derivePriorityBand } from "@/lib/aarohi/contracts";

const PAGE_SIZE = 30;
const SAFE_SEARCH = /[^A-Za-z0-9@+._ -]/g;
function cleanText(value: unknown, max=300){ return typeof value === "string" ? value.trim().replace(/\s+/g," ").slice(0,max) : ""; }
function cleanSearch(value: unknown){ return cleanText(value,80).replace(SAFE_SEARCH,""); }
function now(){ return new Date().toISOString(); }

export async function listActiveAarohiCities(){
  const r=await adminClient().from("cities").select("id,name,slug").eq("is_active",true).order("name");
  if(r.error) throw r.error; return r.data ?? [];
}

export async function getAarohiOverview(days=7){
  const db=adminClient(); const since=new Date(Date.now()-Math.max(1,Math.min(days,365))*86400000).toISOString();
  const count=(q:any)=>q.select("id",{count:"exact",head:true}).gte("created_at",since).then((r:any)=>{if(r.error) throw r.error; return r.count??0;});
  const stageCount=(stage:string)=>db.from("aarohi_prospects").select("id",{count:"exact",head:true}).eq("prospect_stage",stage).gte("created_at",since).then(r=>{if(r.error) throw r.error; return r.count??0;});
  const [newProspects,qualified,outreachReady,interested,won,followupsDue,activeConversations,handoffs] = await Promise.all([
    count(db.from("aarohi_prospects")), stageCount("QUALIFIED"), stageCount("OUTREACH_READY"), stageCount("INTERESTED"), stageCount("WON"),
    db.from("aarohi_tasks").select("id",{count:"exact",head:true}).in("status",["OPEN","IN_PROGRESS"]).lt("due_at",now()).then(r=>{if(r.error)throw r.error;return r.count??0;}),
    db.from("aarohi_conversations").select("id",{count:"exact",head:true}).in("state",["OPEN","HUMAN"]).then(r=>{if(r.error)throw r.error;return r.count??0;}),
    count(db.from("aarohi_handoffs")),
  ]);
  const stages=["DISCOVERED","ENRICHED","QUALIFIED","CONTACTED","ENGAGED","INTERESTED","CONVERSION","WON"];
  const funnel=await Promise.all(stages.map(async stage=>({stage,count:await stageCount(stage)})));
  const attention=await listAarohiAttention(12);
  return {periodDays:days,kpis:{newProspects,qualified,outreachReady,followupsDue,activeConversations,interested,activated:won,handoffs},funnel,attention};
}

export async function listAarohiProspects(input:Record<string,unknown>={}){
  const db=adminClient(); const page=Math.max(1,Number(input.page)||1); const from=(page-1)*PAGE_SIZE;
  let q=db.from("aarohi_prospects").select("id,business_name,primary_category,area,pincode,primary_phone,whatsapp_available,website,instagram_url,prospect_stage,conversation_stage,priority_band,last_activity_at,next_action_type,next_action_at,agent_owner,human_owner,do_not_contact,ai_paused,human_takeover,source_confidence,data_confidence,cities!inner(name)",{count:"exact"});
  const stage=cleanText(input.stage,30), priority=cleanText(input.priority,4), area=cleanText(input.area,80), search=cleanSearch(input.search);
  if(stage) q=q.eq("prospect_stage",stage); if(priority) q=q.eq("priority_band",priority); if(area) q=q.ilike("area",`%${area}%`);
  if(input.whatsapp_available==="true") q=q.eq("whatsapp_available",true); if(input.human_takeover==="true") q=q.eq("human_takeover",true); if(input.do_not_contact==="true") q=q.eq("do_not_contact",true);
  if(search) q=q.or(`business_name.ilike.%${search}%,primary_phone.ilike.%${search}%,contact_person_name.ilike.%${search}%,area.ilike.%${search}%,website.ilike.%${search}%,instagram_url.ilike.%${search}%`);
  const r=await q.order("last_activity_at",{ascending:false}).range(from,from+PAGE_SIZE-1); if(r.error) throw r.error;
  return {rows:r.data??[],page,pageSize:PAGE_SIZE,total:r.count??0};
}

export async function getAarohiProspect(id:string){
  const db=adminClient(); const p=await db.from("aarohi_prospects").select("*,cities(name,slug)").eq("id",id).maybeSingle(); if(p.error) throw p.error; if(!p.data)return null;
  const merged=await db.from("aarohi_prospects").select("id").eq("merged_into_prospect_id",id); if(merged.error)throw merged.error; const lineage=[id,...(merged.data??[]).map(x=>x.id)];
  const [sources,channels,interactions,conversations,tasks,scores,matches,handoff,opportunities,events]=await Promise.all([
    db.from("aarohi_prospect_sources").select("*").in("prospect_id",lineage).order("imported_at",{ascending:false}),
    db.from("aarohi_channel_identities").select("*").in("prospect_id",lineage).order("updated_at",{ascending:false}),
    db.from("aarohi_interactions").select("*").in("prospect_id",lineage).order("occurred_at",{ascending:false}).limit(100),
    db.from("aarohi_conversations").select("*").in("prospect_id",lineage).order("updated_at",{ascending:false}),
    db.from("aarohi_tasks").select("*").in("prospect_id",lineage).order("due_at",{ascending:true}),
    db.from("aarohi_scores").select("*").in("prospect_id",lineage).order("calculated_at",{ascending:false}).limit(20),
    db.from("aarohi_identity_matches").select("*").or(`prospect_a_id.eq.${id},prospect_b_id.eq.${id}`).order("created_at",{ascending:false}),
    db.from("aarohi_handoffs").select("*").eq("prospect_id",id).maybeSingle(),
    db.from("aarohi_opportunities").select("*,packages(id,name,display_price,lead_count,validity_days,is_active)").eq("prospect_id",id).order("updated_at",{ascending:false}),
    db.from("aarohi_events").select("*").in("prospect_id",lineage).order("occurred_at",{ascending:false}).limit(150),
  ]);
  for(const r of [sources,channels,interactions,conversations,tasks,scores,matches,handoff,opportunities,events]) if(r.error) throw r.error;
  let core:any=null;
  if(handoff.data?.vendor_id){
    const vendorId=handoff.data.vendor_id;
    const [v,vp,vo,pay]=await Promise.all([
      db.from("vendors").select("id,business_name,status,verification_status,is_active,paid_status,public_visibility").eq("id",vendorId).maybeSingle(),
      db.from("vendor_packages").select("id,package_id,payment_status,status,purchase_date,expiry_date,packages(name,display_price,validity_days)").eq("vendor_id",vendorId).order("purchase_date",{ascending:false}).limit(5),
      db.from("vendor_package_orders").select("id,package_id,order_status,payment_status,activation_status,paid_at,activated_at,packages(name,display_price,validity_days)").eq("vendor_id",vendorId).order("created_at",{ascending:false}).limit(5),
      db.from("payments").select("id,package_id,amount,payment_status,created_at").eq("vendor_id",vendorId).order("created_at",{ascending:false}).limit(5),
    ]); core={vendor:v.data??null,vendorPackages:vp.data??[],orders:vo.data??[],payments:pay.data??[]};
  }
  return {prospect:p.data,lineage,sources:sources.data??[],channels:channels.data??[],interactions:interactions.data??[],conversations:conversations.data??[],tasks:tasks.data??[],scores:scores.data??[],matches:matches.data??[],handoff:handoff.data??null,opportunities:opportunities.data??[],events:events.data??[],core};
}

export async function listAarohiAttention(limit=30){
  const db=adminClient(); const r=await db.from("aarohi_prospects").select("id,business_name,priority_band,prospect_stage,registration_stage,payment_stage,human_takeover,do_not_contact,next_action_at,current_objection,last_activity_at,cities(name)")
    .or(`human_takeover.eq.true,registration_stage.eq.BLOCKED,payment_stage.eq.FAILED,next_action_at.lt.${now()}`).order("priority_band").order("last_activity_at",{ascending:true}).limit(limit);
  if(r.error) throw r.error;
  return (r.data??[]).map((x:any)=>({...x,attention_reason:x.human_takeover?"Human takeover":x.registration_stage==="BLOCKED"?"Registration blocked":x.payment_stage==="FAILED"?"Payment issue":"Follow-up overdue"}));
}

export async function listAarohiTasks(input:Record<string,unknown>={}){
  const db=adminClient(); let q=db.from("aarohi_tasks").select("*,aarohi_prospects(id,business_name,priority_band,prospect_stage)",{count:"exact"});
  const status=cleanText(input.status,20); if(status) q=q.eq("status",status);
  const r=await q.order("due_at",{ascending:true,nullsFirst:false}).limit(200); if(r.error)throw r.error; return r.data??[];
}
export async function listAarohiConversations(){ const r=await adminClient().from("aarohi_conversations").select("*,aarohi_prospects(id,business_name,priority_band,human_takeover,ai_paused)").order("updated_at",{ascending:false}).limit(200);if(r.error)throw r.error;return r.data??[]; }
export async function listAarohiCampaigns(){ const r=await adminClient().from("aarohi_campaigns").select("*,aarohi_campaign_members(count)").order("created_at",{ascending:false}).limit(100);if(r.error)throw r.error;return r.data??[]; }
export async function getAarohiDiscoverySummary(){
  const db=adminClient(); const sources=await db.from("aarohi_prospect_sources").select("source_type,prospect_id,confidence").limit(5000); if(sources.error)throw sources.error;
  const prospects=await db.from("aarohi_prospects").select("id,primary_category,area,primary_phone,whatsapp_available,website,prospect_stage").limit(5000); if(prospects.error)throw prospects.error;
  const bySource:Record<string,number>={}; for(const row of sources.data??[]) bySource[row.source_type]=(bySource[row.source_type]??0)+1;
  const byCategory:Record<string,number>={}, byArea:Record<string,number>={}; for(const row of prospects.data??[]){ const c=row.primary_category||"Other",a=row.area||"Unknown";byCategory[c]=(byCategory[c]??0)+1;byArea[a]=(byArea[a]??0)+1; }
  const rows=prospects.data??[]; return {rawDiscovered:(sources.data??[]).length,uniqueProspects:rows.length,phoneReady:rows.filter(x=>x.primary_phone).length,whatsappReady:rows.filter(x=>x.whatsapp_available).length,websiteReady:rows.filter(x=>x.website).length,qualified:rows.filter(x=>["QUALIFIED","OUTREACH_READY","CONTACTED","ENGAGED","INTERESTED","CONVERSION","WON"].includes(x.prospect_stage)).length,bySource,byCategory,byArea};
}
export async function getAarohiAnalytics(){
  const prospects=await adminClient().from("aarohi_prospects").select("id,prospect_stage,primary_category,area,priority_band,created_at").limit(10000); if(prospects.error)throw prospects.error;
  const events=await adminClient().from("aarohi_events").select("event_type,occurred_at").limit(10000); if(events.error)throw events.error;
  const stageOrder=["DISCOVERED","QUALIFIED","CONTACTED","ENGAGED","INTERESTED","CONVERSION","WON"]; const rows=prospects.data??[];
  const funnel=stageOrder.map(stage=>({stage,count:rows.filter(x=>x.prospect_stage===stage).length})); const eventCounts:Record<string,number>={}; for(const e of events.data??[])eventCounts[e.event_type]=(eventCounts[e.event_type]??0)+1;
  return {funnel,eventCounts,total:rows.length};
}

export async function createManualAarohiProspect(input:Record<string,unknown>,actorId:string){
  const db=adminClient(); const businessName=cleanText(input.business_name,160); const cityId=cleanText(input.city_id,60); if(!businessName||!cityId)throw new Error("invalid_prospect");
  const city=await db.from("cities").select("id,name").eq("id",cityId).eq("is_active",true).maybeSingle(); if(city.error)throw city.error;if(!city.data)throw new Error("inactive_market");
  const normalized=businessName.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const row=await db.from("aarohi_prospects").insert({city_id:cityId,business_name:businessName,normalized_business_name:normalized,primary_category:cleanText(input.primary_category,120)||null,area:cleanText(input.area,120)||null,pincode:cleanText(input.pincode,10)||null,primary_phone:cleanText(input.primary_phone,30)||null,website:cleanText(input.website,300)||null,contact_person_name:cleanText(input.contact_person_name,120)||null}).select("id").single();if(row.error)throw row.error;
  const prospectId=row.data.id; const source=await db.from("aarohi_prospect_sources").insert({prospect_id:prospectId,source_type:"MANUAL",source_name:"QuickFurno admin",raw_business_name:businessName,raw_phone:cleanText(input.primary_phone,30)||null,raw_category:cleanText(input.primary_category,120)||null,confidence:100}).select("id").single();if(source.error)throw source.error;
  const ev=await db.from("aarohi_events").insert({prospect_id:prospectId,event_type:"prospect.discovered",actor_type:"HUMAN",actor_reference:actorId,safe_summary:"Prospect created manually in Aarohi CRM",reference_type:"source",reference_id:source.data.id});if(ev.error)throw ev.error;return prospectId;
}

export async function updateAarohiWorkflow(prospectId:string,input:Record<string,unknown>,actorId:string){
  const allowed:any={}; for(const key of ["prospect_stage","conversation_stage","priority_band","next_action_type","next_action_reason","preferred_channel","current_objection"]){if(typeof input[key]==="string")allowed[key]=cleanText(input[key],300);} if(input.next_action_at===null||typeof input.next_action_at==="string")allowed.next_action_at=input.next_action_at||null;
  allowed.updated_at=now();allowed.last_activity_at=now(); const r=await adminClient().from("aarohi_prospects").update(allowed).eq("id",prospectId).select("id").single();if(r.error)throw r.error;
  await adminClient().from("aarohi_events").insert({prospect_id:prospectId,event_type:"prospect.updated",actor_type:"HUMAN",actor_reference:actorId,safe_summary:"Aarohi workflow projection updated",event_data:{fields:Object.keys(allowed).filter(x=>!x.endsWith("_at"))}});return r.data;
}

export async function setAarohiPaused(prospectId:string,paused:boolean,actorId:string){ const r=await adminClient().from("aarohi_prospects").update({ai_paused:paused,updated_at:now()}).eq("id",prospectId).select("id").single();if(r.error)throw r.error;await adminClient().from("aarohi_events").insert({prospect_id:prospectId,event_type:paused?"aarohi.paused":"aarohi.resumed",actor_type:"HUMAN",actor_reference:actorId,safe_summary:paused?"Aarohi autonomous outbound paused":"Aarohi resumed subject to communication authority"}); }
export async function setAarohiSuppressed(prospectId:string,reason:string,actorId:string){const r=await adminClient().rpc("qf_aarohi_suppress_prospect_v1",{p_prospect_id:prospectId,p_actor_id:actorId,p_reason:cleanText(reason,500),p_idempotency_key:`ui.suppress.${prospectId}.${crypto.randomUUID()}`});if(r.error)throw r.error;return r.data;}
export async function setAarohiTakeover(prospectId:string,takeover:boolean,actorId:string){const r=await adminClient().rpc("qf_aarohi_set_human_takeover_v1",{p_prospect_id:prospectId,p_actor_id:actorId,p_takeover:takeover,p_idempotency_key:`ui.takeover.${prospectId}.${crypto.randomUUID()}`});if(r.error)throw r.error;return r.data;}
export async function createAarohiTask(prospectId:string,input:Record<string,unknown>,actorId:string){const r=await adminClient().from("aarohi_tasks").insert({prospect_id:prospectId,task_type:cleanText(input.task_type,40)||"FOLLOW_UP",due_at:typeof input.due_at==="string"?input.due_at:null,priority:cleanText(input.priority,20)||"NORMAL",reason:cleanText(input.reason,500)||null,assigned_to:actorId,created_by:actorId}).select("id").single();if(r.error)throw r.error;await adminClient().from("aarohi_events").insert({prospect_id:prospectId,event_type:"task.created",actor_type:"HUMAN",actor_reference:actorId,safe_summary:`${cleanText(input.task_type,40)||"FOLLOW_UP"} task created`,reference_type:"task",reference_id:r.data.id});return r.data;}
export async function updateAarohiTask(taskId:string,status:string,actorId:string){const r=await adminClient().from("aarohi_tasks").update({status,updated_at:now(),completed_at:status==="DONE"?now():null}).eq("id",taskId).select("id,prospect_id").single();if(r.error)throw r.error;await adminClient().from("aarohi_events").insert({prospect_id:r.data.prospect_id,event_type:"task.updated",actor_type:"HUMAN",actor_reference:actorId,safe_summary:`Task marked ${status}`,reference_type:"task",reference_id:taskId});return r.data;}
export async function scoreAarohiProspect(prospectId:string,input:Record<string,unknown>,actorId:string){
  const values={qualification:clampScore(input.qualification_score),contactability:clampScore(input.contactability_score),engagement:clampScore(input.engagement_score),commercialIntent:clampScore(input.commercial_intent_score),dataConfidence:clampScore(input.data_confidence_score)}; const priority=derivePriorityBand(values);
  const reasons=Array.isArray(input.score_reason_codes)?input.score_reason_codes.filter(x=>typeof x==="string").slice(0,20):[];
  const r=await adminClient().from("aarohi_scores").insert({prospect_id:prospectId,qualification_score:values.qualification,contactability_score:values.contactability,engagement_score:values.engagement,commercial_intent_score:values.commercialIntent,data_confidence_score:values.dataConfidence,priority_band:priority,score_version:cleanText(input.score_version,60)||"aarohi-score-v1",score_reason_codes:reasons,calculated_by:`HUMAN:${actorId}`}).select("id").single();if(r.error)throw r.error;
  await adminClient().from("aarohi_prospects").update({priority_band:priority,data_confidence:values.dataConfidence,updated_at:now()}).eq("id",prospectId);
  await adminClient().from("aarohi_events").insert({prospect_id:prospectId,event_type:"prospect.qualified",actor_type:"HUMAN",actor_reference:actorId,safe_summary:`Scoring updated; priority ${priority}`,reference_type:"score",reference_id:r.data.id,event_data:{reason_codes:reasons}});return r.data;
}
export async function reviewAarohiIdentityMatch(matchId:string,decision:"CONFIRMED"|"REJECTED",keepProspectId:string|undefined,actorId:string){
  if(decision==="CONFIRMED"){if(!keepProspectId)throw new Error("keep_prospect_required");const r=await adminClient().rpc("qf_aarohi_confirm_identity_match_v1",{p_match_id:matchId,p_keep_prospect_id:keepProspectId,p_actor_id:actorId});if(r.error)throw r.error;return r.data;}
  const match=await adminClient().from("aarohi_identity_matches").update({status:"REJECTED",reviewed_by:actorId,reviewed_at:now()}).eq("id",matchId).eq("status","RECOMMENDED").select("id,prospect_a_id").single();if(match.error)throw match.error;await adminClient().from("aarohi_events").insert({prospect_id:match.data.prospect_a_id,event_type:"identity.match_rejected",actor_type:"HUMAN",actor_reference:actorId,safe_summary:"Operator rejected identity match",reference_type:"identity_match",reference_id:matchId});return match.data;
}
export async function createAarohiCampaign(input:Record<string,unknown>,actorId:string){const r=await adminClient().from("aarohi_campaigns").insert({name:cleanText(input.name,160),description:cleanText(input.description,1000)||null,segment_definition:typeof input.segment_definition==="object"&&input.segment_definition?input.segment_definition:{},created_by:actorId,status:"DRAFT"}).select("id").single();if(r.error)throw r.error;return r.data;}
export async function addAarohiCampaignMember(campaignId:string,prospectId:string,actorId:string){const r=await adminClient().from("aarohi_campaign_members").upsert({campaign_id:campaignId,prospect_id:prospectId,added_by:actorId},{onConflict:"campaign_id,prospect_id"}).select("id").single();if(r.error)throw r.error;return r.data;}
export async function completeAarohiHandoff(prospectId:string,vendorId:string,actorId:string){
  const ref=`core.vendor.${vendorId}`; const r=await adminClient().rpc("qf_aarohi_complete_handoff_v1",{p_prospect_id:prospectId,p_vendor_id:vendorId,p_actor_id:actorId,p_core_reference:ref,p_idempotency_key:`handoff.${prospectId}.${vendorId}`});if(r.error)throw r.error;return r.data;
}
export async function listActivePackages(){const r=await adminClient().from("packages").select("id,name,lead_count,display_price,validity_days").eq("is_active",true).order("display_price");if(r.error)throw r.error;return r.data??[];}
export async function selectAarohiPackage(prospectId:string,packageId:string,actorId:string){const pack=await adminClient().from("packages").select("id,name,is_active").eq("id",packageId).eq("is_active",true).maybeSingle();if(pack.error)throw pack.error;if(!pack.data)throw new Error("package_not_available");const r=await adminClient().from("aarohi_opportunities").insert({prospect_id:prospectId,interested_package_id:packageId,opportunity_status:"SELECTED"}).select("id").single();if(r.error)throw r.error;await adminClient().from("aarohi_prospects").update({commercial_stage:"PACKAGE_SELECTED",updated_at:now()}).eq("id",prospectId);await adminClient().from("aarohi_events").insert({prospect_id:prospectId,event_type:"package.selected",actor_type:"HUMAN",actor_reference:actorId,safe_summary:`Canonical package selected: ${pack.data.name}`,reference_type:"package",reference_id:packageId});return r.data;}
