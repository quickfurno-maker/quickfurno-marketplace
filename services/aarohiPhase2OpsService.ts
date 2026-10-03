import "server-only";
import { adminClient } from "@/lib/supabase";

export type AarohiRuntimeMode="PAUSED"|"INBOUND_ONLY"|"ASSISTED_ONLY"|"GOVERNED_AUTOMATION";

export interface AarohiRuntimeControl{
  tenant_id:"quickfurno";
  mode:AarohiRuntimeMode;
  discovery_enabled:boolean;
  outbound_enabled:boolean;
  broadcasts_enabled:boolean;
  followups_enabled:boolean;
  whatsapp_enabled:boolean;
  instagram_enabled:boolean;
  facebook_enabled:boolean;
  x_enabled:boolean;
  provider_incident_mode:boolean;
  reason:string|null;
  updated_by:string|null;
  updated_at:string;
}

const SAFE_DEFAULT:Object=Object.freeze({
  tenant_id:"quickfurno",mode:"PAUSED",discovery_enabled:false,outbound_enabled:false,
  broadcasts_enabled:false,followups_enabled:false,whatsapp_enabled:false,
  instagram_enabled:false,facebook_enabled:false,x_enabled:false,
  provider_incident_mode:false,reason:"CONTROL_ROW_MISSING",updated_by:null,
  updated_at:new Date(0).toISOString(),
});

export async function getAarohiRuntimeControl():Promise<AarohiRuntimeControl>{
  const {data,error}=await adminClient().from("aarohi_runtime_controls")
    .select("*").eq("tenant_id","quickfurno").maybeSingle();
  if(error) throw error;
  return (data??SAFE_DEFAULT) as AarohiRuntimeControl;
}

export async function updateAarohiRuntimeControl(args:{
  mode:AarohiRuntimeMode;discoveryEnabled:boolean;outboundEnabled:boolean;
  broadcastsEnabled:boolean;followupsEnabled:boolean;whatsappEnabled:boolean;
  instagramEnabled:boolean;facebookEnabled:boolean;xEnabled:boolean;
  providerIncidentMode:boolean;reason?:string|null;actorId:string;
}){
  if(!["PAUSED","INBOUND_ONLY","ASSISTED_ONLY","GOVERNED_AUTOMATION"].includes(args.mode)){
    throw new Error("aarohi_runtime_mode_invalid");
  }
  const paused=args.mode==="PAUSED";
  const row={
    tenant_id:"quickfurno",mode:args.mode,
    discovery_enabled:paused?false:args.discoveryEnabled,
    outbound_enabled:paused?false:args.outboundEnabled,
    broadcasts_enabled:paused?false:args.broadcastsEnabled,
    followups_enabled:paused?false:args.followupsEnabled,
    whatsapp_enabled:paused?false:args.whatsappEnabled,
    instagram_enabled:paused?false:args.instagramEnabled,
    facebook_enabled:paused?false:args.facebookEnabled,
    x_enabled:paused?false:args.xEnabled,
    provider_incident_mode:args.providerIncidentMode,
    reason:args.reason?.trim().slice(0,500)||null,
    updated_by:args.actorId,updated_at:new Date().toISOString(),
  };
  const db=adminClient();
  const result=await db.from("aarohi_runtime_controls").upsert(row,{onConflict:"tenant_id"})
    .select("*").single();
  if(result.error) throw result.error;
  const event=await db.from("aarohi_events").insert({
    event_type:"runtime.controls_changed",actor_type:"HUMAN",actor_reference:args.actorId,
    safe_summary:"Aarohi global runtime controls changed by operator.",
    reference_type:"runtime_controls",reference_id:"quickfurno",
    event_data:{
      mode:row.mode,discoveryEnabled:row.discovery_enabled,outboundEnabled:row.outbound_enabled,
      broadcastsEnabled:row.broadcasts_enabled,followupsEnabled:row.followups_enabled,
      channels:{
        whatsapp:row.whatsapp_enabled,instagram:row.instagram_enabled,
        facebook:row.facebook_enabled,x:row.x_enabled,
      },
      providerIncidentMode:row.provider_incident_mode,
    },
  });
  if(event.error) throw event.error;
  return result.data as AarohiRuntimeControl;
}

export async function recordAarohiAcquisitionCost(args:{
  occurredOn:string;channel?:string|null;sourceType?:string|null;cityId?:string|null;
  campaignId?:string|null;amountMinor:number;currency?:string;sourceReference:string;
  note?:string|null;actorId:string;
}){
  const date=/^\d{4}-\d{2}-\d{2}$/.test(args.occurredOn)?args.occurredOn:null;
  if(!date) throw new Error("aarohi_cost_date_invalid");
  const amount=Math.round(args.amountMinor);
  if(!Number.isSafeInteger(amount)||amount<0) throw new Error("aarohi_cost_amount_invalid");
  const currency=(args.currency??"INR").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) throw new Error("aarohi_cost_currency_invalid");
  const sourceReference=args.sourceReference.trim().slice(0,300);
  if(!sourceReference) throw new Error("aarohi_cost_reference_required");
  const {data,error}=await adminClient().from("aarohi_acquisition_cost_entries").upsert({
    occurred_on:date,channel:args.channel?.trim().toUpperCase()||null,
    source_type:args.sourceType?.trim().slice(0,80)||null,city_id:args.cityId||null,
    campaign_id:args.campaignId||null,amount_minor:amount,currency,
    source_reference:sourceReference,note:args.note?.trim().slice(0,500)||null,
    created_by:args.actorId,
  },{onConflict:"source_reference"}).select("id").single();
  if(error) throw error;
  return String(data.id);
}

export async function listAarohiAcquisitionCosts(limit=100){
  const safe=Math.max(1,Math.min(500,Math.round(limit)));
  const {data,error}=await adminClient().from("aarohi_acquisition_cost_entries")
    .select("id,occurred_on,channel,source_type,city_id,campaign_id,amount_minor,currency,source_reference,note,created_at,cities(name),aarohi_campaigns(name)")
    .order("occurred_on",{ascending:false}).order("created_at",{ascending:false}).limit(safe);
  if(error) throw error;
  return data??[];
}

function inc(map:Record<string,number>,key:string,by=1){map[key]=(map[key]??0)+by;}

export async function getAarohiPhase2AttributionAnalytics(){
  const db=adminClient();
  const [prospects,sources,outreach,replies,handoffs,costs,cities]=await Promise.all([
    db.from("aarohi_prospects").select("id,city_id,primary_category,prospect_stage,created_at").eq("tenant_id","quickfurno").limit(20000),
    db.from("aarohi_prospect_sources").select("prospect_id,source_type,observed_at,imported_at").limit(40000),
    db.from("aarohi_outreach_jobs").select("prospect_id,campaign_id,channel,state,provider_message_ref,updated_at").limit(40000),
    db.from("aarohi_social_reply_signals").select("prospect_id,channel,reply_kind,occurred_at").limit(20000),
    db.from("aarohi_handoffs").select("prospect_id,completed_at").limit(20000),
    db.from("aarohi_acquisition_cost_entries").select("amount_minor,currency,channel,source_type,city_id,campaign_id").limit(20000),
    db.from("cities").select("id,name"),
  ]);
  for(const r of [prospects,sources,outreach,replies,handoffs,costs,cities]) if(r.error) throw r.error;

  const cityName=new Map((cities.data??[]).map((c:any)=>[String(c.id),String(c.name)]));
  const activated=new Set((handoffs.data??[]).map((h:any)=>String(h.prospect_id)));
  const sourceFirst=new Map<string,{type:string;ts:number}>();
  for(const s of sources.data??[]){
    const id=String((s as any).prospect_id);
    const ts=Date.parse(String((s as any).observed_at??(s as any).imported_at??0));
    const type=String((s as any).source_type??"UNKNOWN");
    const current=sourceFirst.get(id);
    if(!current||ts<current.ts) sourceFirst.set(id,{type,ts:Number.isFinite(ts)?ts:Number.MAX_SAFE_INTEGER});
  }

  const bySource:Record<string,{prospects:number;activated:number}>={};
  const byCity:Record<string,{prospects:number;activated:number}>={};
  const byCategory:Record<string,{prospects:number;activated:number}>={};
  for(const p of prospects.data??[]){
    const id=String((p as any).id);
    const source=sourceFirst.get(id)?.type??"UNKNOWN";
    const city=cityName.get(String((p as any).city_id))??"UNKNOWN";
    const category=String((p as any).primary_category??"OTHER");
    bySource[source]??={prospects:0,activated:0}; bySource[source]!.prospects+=1;
    byCity[city]??={prospects:0,activated:0}; byCity[city]!.prospects+=1;
    byCategory[category]??={prospects:0,activated:0}; byCategory[category]!.prospects+=1;
    if(activated.has(id)){
      bySource[source]!.activated+=1;byCity[city]!.activated+=1;byCategory[category]!.activated+=1;
    }
  }

  const outreachByChannel:Record<string,{jobs:number;accepted:number;waitingReply:number;blocked:number}>={};
  for(const j of outreach.data??[]){
    const channel=String((j as any).channel??"UNKNOWN");
    outreachByChannel[channel]??={jobs:0,accepted:0,waitingReply:0,blocked:0};
    const row=outreachByChannel[channel]!;
    row.jobs+=1;
    if((j as any).provider_message_ref) row.accepted+=1;
    if(String((j as any).state)==="WAITING_REPLY") row.waitingReply+=1;
    if(["BLOCKED","CANCELLED"].includes(String((j as any).state))) row.blocked+=1;
  }

  const replyKinds:Record<string,number>={};
  const replyChannels:Record<string,number>={};
  for(const r of replies.data??[]){
    inc(replyKinds,String((r as any).reply_kind??"UNKNOWN"));
    inc(replyChannels,String((r as any).channel??"UNKNOWN"));
  }

  const spendByCurrency:Record<string,number>={};
  const spendByChannel:Record<string,number>={};
  for(const c of costs.data??[]){
    const amount=Number((c as any).amount_minor??0);
    inc(spendByCurrency,String((c as any).currency??"INR"),amount);
    inc(spendByChannel,String((c as any).channel??(c as any).source_type??"UNATTRIBUTED"),amount);
  }
  const inrSpend=spendByCurrency.INR??0;
  const activatedCount=activated.size;
  return Object.freeze({
    totals:{
      prospects:(prospects.data??[]).length,
      activated:activatedCount,
      socialReplies:(replies.data??[]).length,
      whatsappContinuations:replyKinds.WHATSAPP_SHARED??0,
      recordedSpendMinorInr:inrSpend,
      costPerActivatedVendorMinorInr:activatedCount>0&&inrSpend>0?Math.round(inrSpend/activatedCount):null,
    },
    bySource,byCity,byCategory,outreachByChannel,replyKinds,replyChannels,spendByCurrency,spendByChannel,
  });
}
