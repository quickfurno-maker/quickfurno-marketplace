import "server-only";
import crypto from "crypto";
import { adminClient } from "@/lib/supabase";
import { hashPhoneE164, normalizePhoneE164 } from "@/lib/communication/phone";
import {
  AAROHI_PHASE2_POLICY,
  initialOutreachState,
  phase2AutonomousDiscoveryEnabled,
  type AarohiDiscoverySource,
  type AarohiPhase2Channel,
} from "@/lib/aarohi/phase2Policy";
import { linkAarohiProspectWhatsAppHash } from "@/services/aarohiWhatsAppIntakeService";

const SAFE_REF=/^[A-Za-z0-9._:-]{1,300}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanRef(value:string):string{
  const v=value.trim().replace(/^@/,"");
  if(SAFE_REF.test(v)) return v;
  return "ref."+crypto.createHash("sha256").update(v).digest("hex").slice(0,40);
}
function safeUrl(value:string|undefined|null):string|null{
  if(!value) return null;
  try{const u=new URL(value);return u.protocol==="https:"?u.toString().slice(0,500):null;}catch{return null;}
}
function normalizeBusiness(value:string):string{
  return value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim().slice(0,240);
}
function safeMetadata(input:Record<string,unknown>|undefined):Record<string,unknown>{
  const result:Record<string,unknown>={};
  if(!input) return result;
  for(const [key,value] of Object.entries(input)){
    if(/message|body|content|text|transcript|secret|token|password|cookie|authorization/i.test(key)) continue;
    if(typeof value==="string") result[key]=value.slice(0,300);
    else if(typeof value==="number"||typeof value==="boolean"||value===null) result[key]=value;
  }
  return result;
}
async function actionableProspect(prospectId:string){
  const {data,error}=await adminClient().from("aarohi_prospects")
    .select("id,tenant_id,prospect_stage,do_not_contact,ai_paused,human_takeover,whatsapp_available")
    .eq("id",prospectId).eq("tenant_id","quickfurno").maybeSingle();
  if(error) throw error;
  if(!data||data.do_not_contact||data.ai_paused||data.human_takeover||data.prospect_stage==="SUPPRESSED"){
    throw new Error("aarohi_prospect_not_actionable");
  }
  return data;
}
function dayKey(date:Date):string{return date.toISOString().slice(0,10);}

export async function listAarohiDiscoveryCandidates(limit=100){
  const safe=Math.max(1,Math.min(250,Math.round(limit)));
  const {data,error}=await adminClient().from("aarohi_discovery_candidates")
    .select("id,source_type,external_reference,profile_url,business_name,city_hint,category_hint,website,confidence,state,prospect_id,observed_at,created_at,aarohi_discovery_connectors(channel,provider_key)")
    .order("created_at",{ascending:false}).limit(safe);
  if(error) throw error;
  return data??[];
}

export async function listAarohiOutreachJobs(limit=150){
  const safe=Math.max(1,Math.min(300,Math.round(limit)));
  const {data,error}=await adminClient().from("aarohi_outreach_jobs")
    .select("id,prospect_id,campaign_id,channel,initiation_mode,state,priority,scheduled_at,draft_ref,core_authorization_ref,provider_message_ref,attempt_count,max_attempts,last_error_code,updated_at,aarohi_prospects(business_name,prospect_stage,do_not_contact),aarohi_campaigns(name)")
    .order("scheduled_at",{ascending:false}).limit(safe);
  if(error) throw error;
  return data??[];
}

export async function listAarohiBroadcastBatches(limit=100){
  const safe=Math.max(1,Math.min(200,Math.round(limit)));
  const {data,error}=await adminClient().from("aarohi_broadcast_batches")
    .select("id,campaign_id,template_name,state,scheduled_for,target_count,authorized_count,dispatched_count,failed_count,daily_cap,created_at,updated_at,aarohi_campaigns(name)")
    .order("created_at",{ascending:false}).limit(safe);
  if(error) throw error;
  return data??[];
}

export async function listAarohiMemorySnapshots(limit=100){
  const safe=Math.max(1,Math.min(200,Math.round(limit)));
  const {data,error}=await adminClient().from("aarohi_memory_snapshots")
    .select("prospect_id,version,safe_summary,last_channel,last_event_at,updated_at,aarohi_prospects(business_name,prospect_stage)")
    .order("updated_at",{ascending:false}).limit(safe);
  if(error) throw error;
  return data??[];
}

export async function getAarohiPhase2Dashboard(){
  const db=adminClient();
  const [
    connectors,runs,candidates,outreach,memory,batches,
  ]=await Promise.all([
    db.from("aarohi_discovery_connectors").select("id,channel,provider_key,enabled,provider_ready,last_status,next_run_at"),
    db.from("aarohi_discovery_runs").select("state"),
    db.from("aarohi_discovery_candidates").select("state"),
    db.from("aarohi_outreach_jobs").select("state,channel"),
    db.from("aarohi_memory_snapshots").select("prospect_id",{count:"exact",head:true}),
    db.from("aarohi_broadcast_batches").select("state,target_count,authorized_count,dispatched_count,failed_count"),
  ]);
  for(const result of [connectors,runs,candidates,outreach,batches]) if(result.error) throw result.error;
  if(memory.error) throw memory.error;
  const count=(rows:any[]|null,key:string)=>Object.fromEntries(
    [...new Set((rows??[]).map((r:any)=>String(r[key]??"UNKNOWN")))]
      .map(v=>[v,(rows??[]).filter((r:any)=>String(r[key]??"UNKNOWN")===v).length])
  );
  return Object.freeze({
    connectors:connectors.data??[],
    runStates:count(runs.data as any[],"state"),
    candidateStates:count(candidates.data as any[],"state"),
    outreachStates:count(outreach.data as any[],"state"),
    outreachChannels:count(outreach.data as any[],"channel"),
    memorySnapshots:memory.count??0,
    batches:batches.data??[],
  });
}

export async function scheduleAarohiDiscoveryRuns(now=new Date()){
  if(!phase2AutonomousDiscoveryEnabled()) return {enabled:false,queued:0};
  const db=adminClient();
  const iso=now.toISOString();
  const {data:connectors,error}=await db.from("aarohi_discovery_connectors")
    .select("id,channel,provider_key,schedule_minutes,daily_candidate_cap,next_run_at,config")
    .eq("tenant_id","quickfurno").eq("enabled",true).eq("provider_ready",true)
    .or(`next_run_at.is.null,next_run_at.lte.${iso}`);
  if(error) throw error;
  let queued=0;
  for(const connector of connectors??[]){
    const idempotency=`aarohi.discovery.${connector.id}.${dayKey(now)}`;
    const inserted=await db.from("aarohi_discovery_runs").upsert({
      connector_id:connector.id,
      state:"QUEUED",
      query_spec:{
        channel:connector.channel,
        providerKey:connector.provider_key,
        dailyCandidateCap:connector.daily_candidate_cap,
        ...(typeof connector.config==="object"&&connector.config?connector.config:{}),
      },
      idempotency_key:idempotency,
    },{onConflict:"idempotency_key",ignoreDuplicates:true}).select("id");
    if(inserted.error) throw inserted.error;
    if((inserted.data??[]).length>0) queued+=1;
    const next=new Date(now.getTime()+Number(connector.schedule_minutes)*60_000).toISOString();
    const updated=await db.from("aarohi_discovery_connectors").update({
      last_run_at:iso,next_run_at:next,last_status:"QUEUED",updated_at:iso,
    }).eq("id",connector.id);
    if(updated.error) throw updated.error;
  }
  return {enabled:true,queued};
}

export async function claimAarohiDiscoveryRun(workerRef:string){
  const db=adminClient();
  const {data,error}=await db.rpc("qf_aarohi_claim_discovery_run_v1",{p_worker_ref:workerRef});
  if(error) throw error;
  if(!data) return null;
  const run=Array.isArray(data)?data[0]:data;
  if(!run?.id||!run?.connector_id) return null;
  const connector=await db.from("aarohi_discovery_connectors")
    .select("id,channel,provider_key,enabled,provider_ready,daily_candidate_cap")
    .eq("id",String(run.connector_id)).maybeSingle();
  if(connector.error) throw connector.error;
  if(!connector.data||connector.data.enabled!==true||connector.data.provider_ready!==true){
    await db.from("aarohi_discovery_runs").update({
      state:"CANCELLED",completed_at:new Date().toISOString(),error_code:"CONNECTOR_NOT_READY",
    }).eq("id",String(run.id));
    return null;
  }
  return Object.freeze({
    runId:String(run.id),
    connectorId:String(run.connector_id),
    channel:String(connector.data.channel),
    providerKey:String(connector.data.provider_key),
    querySpec:typeof run.query_spec==="object"&&run.query_spec?run.query_spec:{},
    maxCandidates:Number(connector.data.daily_candidate_cap??100),
  });
}

export async function ingestAarohiDiscoveryCandidate(args:{
  runId:string;connectorId:string;sourceType:AarohiDiscoverySource;externalReference:string;
  profileUrl?:string|null;businessName:string;cityHint?:string|null;categoryHint?:string|null;
  website?:string|null;phoneE164?:string|null;email?:string|null;confidence?:number;
  metadata?:Record<string,unknown>;observedAt?:string|null;
}){
  if(!UUID.test(args.runId)||!UUID.test(args.connectorId)) throw new Error("aarohi_discovery_ref_invalid");
  const business=args.businessName.trim().slice(0,240);
  if(business.length<2) throw new Error("aarohi_discovery_business_required");
  let phone:string|null=null;
  if(args.phoneE164){
    const normalized=normalizePhoneE164(args.phoneE164);
    if(!normalized.ok) throw new Error("aarohi_discovery_phone_invalid");
    phone=normalized.e164;
  }
  const row={
    run_id:args.runId,connector_id:args.connectorId,source_type:args.sourceType,
    external_reference:cleanRef(args.externalReference),
    profile_url:safeUrl(args.profileUrl),
    business_name:business,normalized_business_name:normalizeBusiness(business),
    city_hint:args.cityHint?.trim().slice(0,120)||null,
    category_hint:args.categoryHint?.trim().slice(0,160)||null,
    website:safeUrl(args.website),
    phone_e164:phone,
    email:args.email?.trim().toLowerCase().slice(0,254)||null,
    confidence:Math.max(0,Math.min(100,Math.round(args.confidence??0))),
    safe_metadata:safeMetadata(args.metadata),
    observed_at:args.observedAt??new Date().toISOString(),
    updated_at:new Date().toISOString(),
  };
  const {data,error}=await adminClient().from("aarohi_discovery_candidates")
    .upsert(row,{onConflict:"connector_id,external_reference"}).select("id,state,prospect_id").single();
  if(error) throw error;
  return data;
}

async function activeCityFromHint(cityHint:string|null){
  if(!cityHint) return null;
  const hint=cityHint.trim();
  const {data,error}=await adminClient().from("cities").select("id,name,slug")
    .eq("is_active",true);
  if(error) throw error;
  const normalized=normalizeBusiness(hint);
  const matches=(data??[]).filter((c:any)=>
    normalizeBusiness(String(c.name??""))===normalized||normalizeBusiness(String(c.slug??""))===normalized
  );
  return matches.length===1?matches[0]:null;
}

export async function promoteAarohiDiscoveryCandidate(candidateId:string,actorRef:string){
  if(!UUID.test(candidateId)) throw new Error("aarohi_candidate_invalid");
  const db=adminClient();
  const {data:candidate,error}=await db.from("aarohi_discovery_candidates")
    .select("*,aarohi_discovery_connectors(channel,provider_key)")
    .eq("id",candidateId).maybeSingle();
  if(error) throw error;
  if(!candidate) throw new Error("aarohi_candidate_not_found");
  if(candidate.state==="PROMOTED"&&candidate.prospect_id) return {prospectId:candidate.prospect_id,replay:true};
  if(["REJECTED"].includes(String(candidate.state))) throw new Error("aarohi_candidate_not_promotable");
  const city=await activeCityFromHint(candidate.city_hint);
  if(!city){
    await db.from("aarohi_discovery_candidates").update({state:"REVIEW",updated_at:new Date().toISOString()}).eq("id",candidateId);
    throw new Error("aarohi_candidate_city_review_required");
  }

  const {data:existing,error:existingError}=await db.from("aarohi_prospects")
    .select("id").eq("tenant_id","quickfurno").eq("city_id",city.id)
    .eq("normalized_business_name",candidate.normalized_business_name)
    .is("merged_into_prospect_id",null).neq("prospect_stage","SUPPRESSED");
  if(existingError) throw existingError;
  let prospectId:string;
  if((existing??[]).length===1){
    prospectId=String(existing![0]!.id);
    await db.from("aarohi_discovery_candidates").update({
      state:"DUPLICATE",prospect_id:prospectId,updated_at:new Date().toISOString(),
    }).eq("id",candidateId);
  }else if((existing??[]).length>1){
    await db.from("aarohi_discovery_candidates").update({state:"REVIEW",updated_at:new Date().toISOString()}).eq("id",candidateId);
    throw new Error("aarohi_candidate_identity_ambiguous");
  }else{
    const created=await db.from("aarohi_prospects").insert({
      tenant_id:"quickfurno",city_id:city.id,business_name:candidate.business_name,
      normalized_business_name:candidate.normalized_business_name,
      primary_category:candidate.category_hint||null,
      primary_phone:candidate.phone_e164||null,
      website:candidate.website||null,
      phone_available:!!candidate.phone_e164,
      whatsapp_available:false,
      website_available:!!candidate.website,
      prospect_stage:"ENRICHED",conversation_stage:"NONE",
      source_confidence:Number(candidate.confidence??0),
      data_confidence:Number(candidate.confidence??0),
      next_action_type:"REVIEW",
      next_action_reason:"Review discovered prospect before governed outreach.",
      preferred_channel:null,
    }).select("id").single();
    if(created.error) throw created.error;
    prospectId=String(created.data.id);
    await db.from("aarohi_discovery_candidates").update({
      state:"PROMOTED",prospect_id:prospectId,updated_at:new Date().toISOString(),
    }).eq("id",candidateId);
  }

  const source=await db.from("aarohi_prospect_sources").insert({
    prospect_id:prospectId,source_type:candidate.source_type,
    source_name:String(candidate.aarohi_discovery_connectors?.provider_key??"phase2-discovery"),
    source_url:candidate.profile_url||candidate.website||null,
    discovery_batch_id:String(candidate.run_id),
    raw_business_name:candidate.business_name,
    raw_phone:candidate.phone_e164||null,
    raw_email:candidate.email||null,
    raw_category:candidate.category_hint||null,
    observed_at:candidate.observed_at,
    confidence:Number(candidate.confidence??0),
  }).select("id").single();
  if(source.error) throw source.error;

  if(["INSTAGRAM","FACEBOOK","X"].includes(String(candidate.source_type))){
    const channel=String(candidate.source_type);
    const identity=await db.from("aarohi_channel_identities").upsert({
      prospect_id:prospectId,channel,
      external_reference:cleanRef(String(candidate.external_reference)),
      profile_url:candidate.profile_url||null,
      display_name:candidate.business_name,
      verification_status:"OBSERVED",
      source_id:source.data.id,
      updated_at:new Date().toISOString(),
    },{onConflict:"prospect_id,channel,external_reference"});
    if(identity.error) throw identity.error;
  }

  const event=await db.from("aarohi_events").insert({
    prospect_id:prospectId,event_type:"discovery.candidate_promoted",
    actor_type:"SYSTEM",actor_reference:actorRef.slice(0,128),
    channel:["INSTAGRAM","FACEBOOK","X"].includes(String(candidate.source_type))?candidate.source_type:null,
    safe_summary:"Structured discovery candidate promoted into Aarohi CRM for governed review.",
    reference_type:"discovery_candidate",reference_id:candidateId,
    event_data:{sourceType:candidate.source_type,confidence:Number(candidate.confidence??0),cityId:city.id},
  });
  if(event.error) throw event.error;
  await refreshAarohiMemorySnapshot(prospectId);
  return {prospectId,replay:false};
}

export async function queueAarohiOutreach(args:{
  prospectId:string;channel:AarohiPhase2Channel;campaignId?:string|null;
  priority?:number;draftRef?:string|null;idempotencyKey:string;
  continuation?:boolean;
}){
  const prospect=await actionableProspect(args.prospectId);
  if(args.channel==="WHATSAPP"&&prospect.whatsapp_available!==true){
    throw new Error("aarohi_whatsapp_not_available");
  }
  const policy=AAROHI_PHASE2_POLICY[args.channel];
  // Cold first contact and continuation are intentionally different authorities.
  // IG/FB cold starts remain human-assisted; after an inbound reply, a continuation
  // may enter Core authorization without pretending that the original cold-DM was automated.
  const state=args.continuation===true?"NEEDS_CORE_AUTHORIZATION":initialOutreachState(args.channel);
  const {data,error}=await adminClient().from("aarohi_outreach_jobs").upsert({
    prospect_id:args.prospectId,campaign_id:args.campaignId??null,
    channel:args.channel,initiation_mode:policy.initiation,state,
    priority:Math.max(0,Math.min(100,Math.round(args.priority??50))),
    draft_ref:args.draftRef?.trim().slice(0,300)||null,
    idempotency_key:args.idempotencyKey.slice(0,300),
    max_attempts:args.channel==="WHATSAPP"?2:1,
    updated_at:new Date().toISOString(),
  },{onConflict:"idempotency_key"}).select("id,state").single();
  if(error) throw error;
  return data;
}

export async function recordAarohiCommunicationPermission(args:{
  prospectId:string;
  channel:"WHATSAPP"|"INSTAGRAM"|"FACEBOOK"|"X";
  purpose:"ACQUISITION_CONTINUATION"|"MARKETING_BROADCAST";
  state:"GRANTED"|"REVOKED";
  evidenceKind:"SOCIAL_WHATSAPP_SHARE"|"WHATSAPP_EXPLICIT_OPT_IN"|"ADMIN_EVIDENCE_IMPORT"|"STOP_OR_SUPPRESSION";
  evidenceRef:string;
  destinationHash?:string|null;
}){
  await actionableProspect(args.prospectId).catch((error)=>{
    if(args.state!=="REVOKED") throw error;
  });
  const now=new Date().toISOString();
  const evidence=args.evidenceRef.trim().slice(0,300);
  if(evidence.length<3) throw new Error("aarohi_permission_evidence_required");
  if(args.destinationHash&&!/^[0-9a-f]{64}$/.test(args.destinationHash)){
    throw new Error("aarohi_permission_destination_invalid");
  }
  const row={
    prospect_id:args.prospectId,channel:args.channel,purpose:args.purpose,state:args.state,
    destination_hash:args.destinationHash??null,evidence_kind:args.evidenceKind,
    evidence_ref:evidence,policy_version:"aarohi-permission-v1",
    granted_at:args.state==="GRANTED"?now:null,
    revoked_at:args.state==="REVOKED"?now:null,
    updated_at:now,
  };
  const {data,error}=await adminClient().from("aarohi_communication_permissions")
    .upsert(row,{onConflict:"prospect_id,channel,purpose"}).select("id,state").single();
  if(error) throw error;
  await adminClient().from("aarohi_events").insert({
    prospect_id:args.prospectId,
    event_type:args.state==="GRANTED"?"consent.permission_granted":"consent.permission_revoked",
    actor_type:args.evidenceKind==="ADMIN_EVIDENCE_IMPORT"?"HUMAN":"SYSTEM",
    actor_reference:"aarohi-phase2-permission",
    channel:args.channel,
    safe_summary:args.state==="GRANTED"
      ?`Aarohi communication permission recorded for ${args.purpose}.`
      :`Aarohi communication permission revoked for ${args.purpose}.`,
    reference_type:"communication_permission",reference_id:String(data.id),
    event_data:{purpose:args.purpose,evidenceKind:args.evidenceKind,policyVersion:"aarohi-permission-v1"},
  });
  return data;
}

export async function planAarohiWhatsAppBroadcast(args:{
  campaignId:string;templateName:string;actorId:string;dailyCap?:number;
}){
  const db=adminClient();
  const cap=Math.max(1,Math.min(10000,Math.round(args.dailyCap??1000)));
  const [{data:members,error},{data:permissions,error:permissionError}]=await Promise.all([
    db.from("aarohi_campaign_members")
      .select("prospect_id,aarohi_prospects!inner(id,whatsapp_available,do_not_contact,ai_paused,human_takeover,prospect_stage)")
      .eq("campaign_id",args.campaignId),
    db.from("aarohi_communication_permissions")
      .select("prospect_id").eq("channel","WHATSAPP").eq("purpose","MARKETING_BROADCAST").eq("state","GRANTED"),
  ]);
  if(error) throw error;
  if(permissionError) throw permissionError;
  const marketingAllowed=new Set((permissions??[]).map((row:any)=>String(row.prospect_id)));
  const eligible=(members??[]).filter((m:any)=>{
    const p=m.aarohi_prospects;
    return marketingAllowed.has(String(m.prospect_id))&&p?.whatsapp_available===true&&p?.do_not_contact!==true&&p?.ai_paused!==true&&p?.human_takeover!==true&&p?.prospect_stage!=="SUPPRESSED";
  }).slice(0,cap);
  const batch=await db.from("aarohi_broadcast_batches").insert({
    campaign_id:args.campaignId,template_name:args.templateName.trim().slice(0,512),
    state:"READY",target_count:eligible.length,daily_cap:cap,created_by:args.actorId,
  }).select("id").single();
  if(batch.error) throw batch.error;
  let queued=0;
  for(const member of eligible){
    const prospectId=String((member as any).prospect_id);
    await queueAarohiOutreach({
      prospectId,channel:"WHATSAPP",campaignId:args.campaignId,priority:60,
      draftRef:`template:${args.templateName.trim().slice(0,200)}`,
      idempotencyKey:`aarohi.broadcast.${batch.data.id}.${prospectId}`,
    });
    queued+=1;
  }
  await db.from("aarohi_broadcast_batches").update({target_count:queued,updated_at:new Date().toISOString()}).eq("id",batch.data.id);
  await db.from("aarohi_events").insert({
    event_type:"broadcast.batch_planned",actor_type:"HUMAN",actor_reference:args.actorId,
    safe_summary:"Aarohi WhatsApp broadcast batch planned; every recipient still requires Core authorization.",
    reference_type:"broadcast_batch",reference_id:String(batch.data.id),
    event_data:{targetCount:queued,dailyCap:cap},
  });
  return {batchId:String(batch.data.id),targetCount:queued};
}

export async function recordAarohiSocialReply(args:{
  prospectId:string;channel:"INSTAGRAM"|"FACEBOOK"|"X";
  threadRef:string;messageRef:string;replyKind:"INTERESTED"|"WHATSAPP_SHARED"|"STOP"|"OTHER";
  safeSummary:string;occurredAt:string;phoneE164?:string|null;
}){
  const db=adminClient();
  await actionableProspect(args.prospectId).catch(async(error)=>{
    if(args.replyKind!=="STOP") throw error;
  });
  let whatsappHash:string|null=null;
  let normalizedPhone:string|null=null;
  if(args.phoneE164){
    const normalized=normalizePhoneE164(args.phoneE164);
    if(!normalized.ok) throw new Error("aarohi_social_whatsapp_invalid");
    normalizedPhone=normalized.e164;
    whatsappHash=hashPhoneE164(normalized.e164);
  }
  const insert=await db.from("aarohi_social_reply_signals").upsert({
    prospect_id:args.prospectId,channel:args.channel,
    external_thread_reference:cleanRef(args.threadRef),
    external_message_reference:cleanRef(args.messageRef),
    reply_kind:args.replyKind,whatsapp_hash:whatsappHash,
    safe_summary:args.safeSummary.trim().slice(0,500),
    occurred_at:new Date(args.occurredAt).toISOString(),
  },{onConflict:"channel,external_message_reference"}).select("id").single();
  if(insert.error) throw insert.error;

  if(args.replyKind==="STOP"){
    const stopped=await db.from("aarohi_prospects").update({
      do_not_contact:true,ai_paused:true,prospect_stage:"SUPPRESSED",
      next_action_type:null,next_action_at:null,next_action_reason:"Prospect requested no further acquisition contact.",
      updated_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),
    }).eq("id",args.prospectId);
    if(stopped.error) throw stopped.error;
  }else{
    const patch:Record<string,unknown>={
      prospect_stage:args.replyKind==="INTERESTED"||args.replyKind==="WHATSAPP_SHARED"?"INTERESTED":"ENGAGED",
      conversation_stage:"REPLIED",
      preferred_channel:args.channel,
      last_activity_at:new Date().toISOString(),updated_at:new Date().toISOString(),
      next_action_type:args.replyKind==="WHATSAPP_SHARED"?"WHATSAPP":"FOLLOW_UP",
      next_action_reason:args.replyKind==="WHATSAPP_SHARED"
        ?"Continue the same acquisition journey on dedicated Aarohi WhatsApp."
        :"Follow up on the social response under channel policy.",
    };
    if(normalizedPhone){
      patch.primary_phone=normalizedPhone;patch.phone_available=true;patch.whatsapp_available=true;
      const linked=await linkAarohiProspectWhatsAppHash({prospectId:args.prospectId,destinationHash:whatsappHash!});
      if(!linked.ok) throw new Error(linked.reason);
      await recordAarohiCommunicationPermission({
        prospectId:args.prospectId,
        channel:"WHATSAPP",
        purpose:"ACQUISITION_CONTINUATION",
        state:"GRANTED",
        evidenceKind:"SOCIAL_WHATSAPP_SHARE",
        evidenceRef:`social-reply:${insert.data.id}`,
        destinationHash:whatsappHash,
      });
    }
    const updated=await db.from("aarohi_prospects").update(patch).eq("id",args.prospectId);
    if(updated.error) throw updated.error;
  }
  await db.from("aarohi_events").insert({
    prospect_id:args.prospectId,
    event_type:args.replyKind==="STOP"?"prospect.social_stop":"conversation.social_reply",
    actor_type:"SYSTEM",actor_reference:"aarohi-phase2-social-bridge",
    channel:args.channel,safe_summary:args.safeSummary.trim().slice(0,500),
    reference_type:"social_reply",reference_id:String(insert.data.id),
    event_data:{replyKind:args.replyKind,whatsappShared:!!normalizedPhone},
  });

  if(args.replyKind==="INTERESTED"){
    await queueAarohiOutreach({
      prospectId:args.prospectId,
      channel:args.channel,
      priority:75,
      draftRef:"system:request-whatsapp-continuation",
      idempotencyKey:`aarohi.social.request-whatsapp.${insert.data.id}`,
      continuation:true,
    });
  }
  if(args.replyKind==="WHATSAPP_SHARED"&&normalizedPhone){
    await queueAarohiOutreach({
      prospectId:args.prospectId,
      channel:"WHATSAPP",
      priority:90,
      draftRef:"system:whatsapp-acquisition-continuation",
      idempotencyKey:`aarohi.social.whatsapp-continuation.${insert.data.id}`,
      continuation:true,
    });
  }

  await refreshAarohiMemorySnapshot(args.prospectId);
  return {signalId:String(insert.data.id),whatsappLinked:!!normalizedPhone};
}

export async function refreshAarohiMemorySnapshot(prospectId:string){
  const db=adminClient();
  const [{data:prospect,error:pError},{data:events,error:eError},{data:identities,error:iError},{data:sources,error:sError}]=await Promise.all([
    db.from("aarohi_prospects").select("id,business_name,primary_category,area,prospect_stage,conversation_stage,registration_stage,commercial_stage,payment_stage,preferred_channel,current_objection,next_action_type,next_action_reason,whatsapp_available,do_not_contact,cities(name)").eq("id",prospectId).maybeSingle(),
    db.from("aarohi_events").select("event_type,channel,safe_summary,occurred_at").eq("prospect_id",prospectId).order("occurred_at",{ascending:false}).limit(8),
    db.from("aarohi_channel_identities").select("channel,verification_status").eq("prospect_id",prospectId),
    db.from("aarohi_prospect_sources").select("source_type").eq("prospect_id",prospectId),
  ]);
  if(pError||eError||iError||sError) throw pError??eError??iError??sError;
  if(!prospect) throw new Error("aarohi_prospect_not_found");
  const channels=[...new Set((identities??[]).map((r:any)=>String(r.channel)))];
  const sourceTypes=[...new Set((sources??[]).map((r:any)=>String(r.source_type)))];
  const recent=(events??[]).map((r:any)=>String(r.safe_summary??"").trim()).filter(Boolean).slice(0,5);
  const summary=[
    `Business: ${prospect.business_name}.`,
    prospect.primary_category?`Category: ${prospect.primary_category}.`:"",
    (prospect as any).cities?.name?`City: ${(prospect as any).cities.name}.`:"",
    prospect.area?`Area: ${prospect.area}.`:"",
    `Acquisition stage: ${prospect.prospect_stage}; conversation: ${prospect.conversation_stage}.`,
    prospect.current_objection?`Current objection: ${prospect.current_objection}.`:"",
    channels.length?`Observed channels: ${channels.join(", ")}.`:"",
    recent.length?`Recent safe history: ${recent.join(" | ")}`:"",
  ].filter(Boolean).join(" ").slice(0,3500);
  const current=await db.from("aarohi_memory_snapshots").select("version").eq("prospect_id",prospectId).maybeSingle();
  if(current.error) throw current.error;
  const version=Number(current.data?.version??0)+1;
  const facts={
    businessName:prospect.business_name,category:prospect.primary_category??null,
    city:(prospect as any).cities?.name??null,area:prospect.area??null,
    prospectStage:prospect.prospect_stage,conversationStage:prospect.conversation_stage,
    registrationStage:prospect.registration_stage,commercialStage:prospect.commercial_stage,
    paymentStage:prospect.payment_stage,preferredChannel:prospect.preferred_channel??null,
    currentObjection:prospect.current_objection??null,nextActionType:prospect.next_action_type??null,
    whatsappAvailable:prospect.whatsapp_available===true,doNotContact:prospect.do_not_contact===true,
    channels,sourceTypes,
  };
  const {error}=await db.from("aarohi_memory_snapshots").upsert({
    prospect_id:prospectId,version,safe_summary:summary,structured_facts:facts,
    last_channel:prospect.preferred_channel??null,
    last_event_at:(events?.[0] as any)?.occurred_at??null,updated_at:new Date().toISOString(),
  },{onConflict:"prospect_id"});
  if(error) throw error;
  return {version,summary,facts};
}

export async function readAarohiMemorySnapshot(prospectId:string){
  const {data,error}=await adminClient().from("aarohi_memory_snapshots")
    .select("version,safe_summary,structured_facts,last_channel,last_event_at,updated_at")
    .eq("prospect_id",prospectId).maybeSingle();
  if(error) throw error;
  return data??null;
}

export async function completeAarohiDiscoveryRun(args:{
  runId:string;state:"COMPLETED"|"PARTIAL"|"FAILED"|"CANCELLED";
  candidateCount:number;promotedCount:number;errorCode?:string|null;
}){
  const {error}=await adminClient().from("aarohi_discovery_runs").update({
    state:args.state,candidate_count:Math.max(0,Math.round(args.candidateCount)),
    promoted_count:Math.max(0,Math.min(Math.round(args.promotedCount),Math.round(args.candidateCount))),
    error_code:args.errorCode?.slice(0,160)||null,completed_at:new Date().toISOString(),
  }).eq("id",args.runId);
  if(error) throw error;
}
