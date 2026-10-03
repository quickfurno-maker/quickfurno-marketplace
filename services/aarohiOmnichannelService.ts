import "server-only";
import crypto from "crypto";
import { adminClient } from "@/lib/supabase";
import { hashPhoneE164, normalizePhoneE164 } from "@/lib/communication/phone";
import { AAROHI_CHANNEL_POLICY, type AarohiOmnichannelChannel } from "@/lib/aarohi/channelPolicy";
import { createAarohiRegistrationIntent } from "@/services/aarohiRegistrationIntentService";
import { linkAarohiProspectWhatsAppHash } from "@/services/aarohiWhatsAppIntakeService";

const REF=/^[A-Za-z0-9._:-]{1,300}$/;

function cleanRef(value:string):string {
  const trimmed=value.trim().replace(/^@/,"");
  if(REF.test(trimmed)) return trimmed;
  return "ref."+crypto.createHash("sha256").update(trimmed).digest("hex").slice(0,40);
}
function safeUrl(value:string|undefined|null):string|null{
  if(!value) return null;
  try{
    const u=new URL(value);
    return u.protocol==="https:"?u.toString().slice(0,500):null;
  }catch{return null;}
}
async function assertProspect(prospectId:string){
  const db=adminClient();
  const {data,error}=await db.from("aarohi_prospects")
    .select("id,do_not_contact,merged_into_prospect_id,prospect_stage")
    .eq("id",prospectId).eq("tenant_id","quickfurno").maybeSingle();
  if(error) throw error;
  if(!data||data.do_not_contact||data.merged_into_prospect_id||data.prospect_stage==="SUPPRESSED"){
    throw new Error("aarohi_prospect_not_actionable");
  }
  return data;
}

export async function observeAarohiChannelIdentity(args:{
  prospectId:string;
  channel:Exclude<AarohiOmnichannelChannel,"WHATSAPP">;
  externalReference:string;
  profileUrl?:string|null;
  displayName?:string|null;
  actorId:string;
}){
  await assertProspect(args.prospectId);
  const policy=AAROHI_CHANNEL_POLICY[args.channel];
  if(!policy.discovery) throw new Error("aarohi_channel_discovery_disabled");
  const externalReference=cleanRef(args.externalReference);
  const db=adminClient();
  const conflict=await db.from("aarohi_channel_identities")
    .select("prospect_id")
    .eq("channel",args.channel)
    .eq("external_reference",externalReference);
  if(conflict.error) throw conflict.error;
  const other=(conflict.data??[]).find((row:any)=>String(row.prospect_id)!==args.prospectId);
  if(other) throw new Error("aarohi_channel_identity_conflict");

  const result=await db.from("aarohi_channel_identities").upsert({
    prospect_id:args.prospectId,
    channel:args.channel,
    external_reference:externalReference,
    profile_url:safeUrl(args.profileUrl),
    display_name:args.displayName?.trim().slice(0,200)||null,
    verification_status:"OBSERVED",
    updated_at:new Date().toISOString(),
  },{onConflict:"prospect_id,channel,external_reference"}).select("id").single();
  if(result.error) throw result.error;
  await db.from("aarohi_events").insert({
    prospect_id:args.prospectId,
    event_type:"prospect.channel_observed",
    actor_type:"ADMIN",
    actor_reference:args.actorId,
    channel:args.channel,
    safe_summary:args.channel+" acquisition identity observed for operator review.",
    reference_type:"channel_identity",
    reference_id:String(result.data.id),
    event_data:{channel:args.channel,initiation:policy.initiation},
  });
  return result.data.id as string;
}

export async function recordAarohiAssistedFirstOutreach(args:{
  prospectId:string;
  channel:"INSTAGRAM"|"FACEBOOK";
  externalReference?:string|null;
  actorId:string;
}){
  await assertProspect(args.prospectId);
  const policy=AAROHI_CHANNEL_POLICY[args.channel];
  if(policy.initiation!=="ASSISTED_FIRST_CONTACT") throw new Error("aarohi_assisted_outreach_not_required");
  const db=adminClient();
  const now=new Date().toISOString();
  const interaction=await db.from("aarohi_interactions").insert({
    prospect_id:args.prospectId,
    channel:args.channel,
    direction:"OUTBOUND",
    actor_type:"HUMAN",
    interaction_type:"ASSISTED_FIRST_CONTACT",
    safe_summary:"Operator recorded the platform-permitted assisted first acquisition contact.",
    external_reference:args.externalReference?cleanRef(args.externalReference):null,
    occurred_at:now,
  }).select("id").single();
  if(interaction.error) throw interaction.error;
  const update=await db.from("aarohi_prospects").update({
    prospect_stage:"CONTACTED",
    conversation_stage:"FIRST_CONTACT",
    preferred_channel:args.channel,
    next_action_type:"FOLLOW_UP",
    next_action_reason:"Await eligible social response before automated Aarohi continuation.",
    last_activity_at:now,
    updated_at:now,
  }).eq("id",args.prospectId);
  if(update.error) throw update.error;
  await db.from("aarohi_events").insert({
    prospect_id:args.prospectId,
    event_type:"outreach.assisted_first_contact",
    actor_type:"ADMIN",
    actor_reference:args.actorId,
    channel:args.channel,
    safe_summary:"Human-assisted first social outreach recorded; automation waits for eligible engagement.",
    reference_type:"interaction",
    reference_id:String(interaction.data.id),
    event_data:{channel:args.channel},
  });
}

export async function linkAarohiWhatsAppContinuation(args:{
  prospectId:string;
  phoneE164:string;
  actorId:string;
}){
  await assertProspect(args.prospectId);
  const normalized=normalizePhoneE164(args.phoneE164);
  if(!normalized.ok) throw new Error("aarohi_whatsapp_invalid_destination");
  const destinationHash=hashPhoneE164(normalized.e164);
  const linked=await linkAarohiProspectWhatsAppHash({
    prospectId:args.prospectId,
    destinationHash,
  });
  if(!linked.ok) throw new Error(linked.reason);
  const db=adminClient();
  const now=new Date().toISOString();
  const update=await db.from("aarohi_prospects").update({
    whatsapp_available:true,
    preferred_channel:"WHATSAPP",
    conversation_stage:"WHATSAPP_HANDOFF",
    next_action_type:"WHATSAPP",
    next_action_reason:"Continue the existing acquisition journey on the dedicated Aarohi WhatsApp lane.",
    last_activity_at:now,
    updated_at:now,
  }).eq("id",args.prospectId);
  if(update.error) throw update.error;
  await db.from("aarohi_events").insert({
    prospect_id:args.prospectId,
    event_type:"whatsapp.continuation_linked",
    actor_type:"ADMIN",
    actor_reference:args.actorId,
    channel:"WHATSAPP",
    safe_summary:"Prospect approved WhatsApp continuation; hashed channel identity linked.",
    event_data:{identity_binding:"HASHED_E164"},
  });
}

export async function createAarohiVendorRegistrationLink(args:{
  prospectId:string;
  channel:"WHATSAPP"|"INSTAGRAM"|"FACEBOOK"|"X"|"WEBSITE"|"MANUAL";
  actorId:string;
}){
  await assertProspect(args.prospectId);
  const intent=await createAarohiRegistrationIntent({prospectId:args.prospectId,channel:args.channel});
  if(!intent.ok) throw new Error(intent.reason);
  const relativeUrl="/vendor?mode=signup&acq="+encodeURIComponent(intent.token)+"&utm_source=aarohi&utm_medium=acquisition";
  const db=adminClient();
  await db.from("aarohi_events").insert({
    prospect_id:args.prospectId,
    event_type:"registration.intent_created",
    actor_type:"ADMIN",
    actor_reference:args.actorId,
    channel:args.channel==="MANUAL"?null:args.channel,
    safe_summary:"Expiring Aarohi vendor-registration intent created.",
    reference_type:"registration_intent",
    reference_id:intent.intent.intentId,
    event_data:{channel:args.channel,expires_at:intent.intent.expiresAt},
  });
  return Object.freeze({relativeUrl,expiresAt:intent.intent.expiresAt});
}
