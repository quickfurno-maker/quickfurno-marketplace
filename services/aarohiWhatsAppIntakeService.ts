import "server-only";
import { adminClient } from "@/lib/supabase";
import { normalizePhoneE164 } from "@/lib/communication/phone";
import { vendorStoredPhoneCandidatesForInbound } from "@/services/inboundIdentityResolutionService";

type IntakeOutcome =
  | { readonly kind:"ready"; readonly prospectId:string }
  | { readonly kind:"prompt"; readonly body:string }
  | { readonly kind:"completed"; readonly prospectId:string; readonly body:string }
  | { readonly kind:"ambiguous"; readonly body:string }
  | { readonly kind:"existing_vendor"; readonly body:string }
  | { readonly kind:"refused" };

function normalizedText(value:Record<string,unknown>,messageType:string):string {
  const raw =
    messageType==="text" ? value.text :
    messageType==="button_reply"||messageType==="list_reply"
      ? (value.replyTitle ?? value.title ?? value.replyId)
      : value.caption;
  return typeof raw==="string"?raw.trim().replace(/\s+/g," ").slice(0,240):"";
}

function normalizeCity(value:string):string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

function vendorContactOrFilter(values:readonly string[]):string {
  return values.flatMap((value)=>[
    "whatsapp_number.eq."+value,
    "phone.eq."+value,
  ]).join(",");
}

async function anyExistingVendorForInboundPhone(senderPhoneE164:string):Promise<"yes"|"no"|"error">{
  const normalized=normalizePhoneE164(senderPhoneE164);
  if(!normalized.ok) return "error";
  const db=adminClient();
  const storedForms=vendorStoredPhoneCandidatesForInbound(normalized.e164);
  const [businessContacts,verifiedMemberships]=await Promise.all([
    db.from("vendors").select("id").or(vendorContactOrFilter(storedForms)),
    db.from("vendor_dashboard_users")
      .select("vendor_id")
      .eq("phone_verified",true)
      .eq("phone_e164",normalized.e164),
  ]);
  if(businessContacts.error||verifiedMemberships.error) return "error";
  const ids=new Set<string>();
  for(const row of businessContacts.data??[]){
    const id=(row as {id?:unknown}).id;
    if(typeof id==="string"&&id) ids.add(id);
  }
  for(const row of verifiedMemberships.data??[]){
    const id=(row as {vendor_id?:unknown}).vendor_id;
    if(typeof id==="string"&&id) ids.add(id);
  }
  return ids.size>0?"yes":"no";
}

export async function resolveAarohiProspectByWhatsAppHash(destinationHash:string):Promise<
  {kind:"exact";prospectId:string}|{kind:"none"}|{kind:"ambiguous"}
>{
  const db=adminClient();
  const ref="whatsapp_hash:"+destinationHash;
  const identities=await db.from("aarohi_channel_identities")
    .select("prospect_id")
    .eq("channel","WHATSAPP")
    .eq("external_reference",ref);
  if(identities.error) return {kind:"ambiguous"};
  const ids=[...new Set((identities.data??[]).map((row:any)=>String(row.prospect_id)).filter(Boolean))];
  if(ids.length===0) return {kind:"none"};

  const prospects=await db.from("aarohi_prospects")
    .select("id,do_not_contact,merged_into_prospect_id,prospect_stage")
    .in("id",ids)
    .eq("tenant_id","quickfurno");
  if(prospects.error) return {kind:"ambiguous"};
  const active=(prospects.data??[]).filter((row:any)=>
    row.do_not_contact!==true &&
    !row.merged_into_prospect_id &&
    String(row.prospect_stage??"").toUpperCase()!=="SUPPRESSED"
  );
  if(active.length===1) return {kind:"exact",prospectId:String(active[0].id)};
  if(active.length===0) return {kind:"none"};
  return {kind:"ambiguous"};
}

async function availableCities():Promise<Array<{id:string;name:string;slug:string}>>{
  const {data,error}=await adminClient().from("cities")
    .select("id,name,slug")
    .eq("is_active",true)
    .order("name",{ascending:true});
  if(error) return [];
  return (data??[]).map((x:any)=>({id:String(x.id),name:String(x.name),slug:String(x.slug??"")}));
}

export async function processAarohiWhatsAppIntake(args:{
  providerAccountId:string;
  destinationHash:string;
  senderPhoneE164:string;
  messageType:string;
  contentMinimized:Record<string,unknown>;
}):Promise<IntakeOutcome>{
  const existing=await resolveAarohiProspectByWhatsAppHash(args.destinationHash);
  if(existing.kind==="exact") return {kind:"ready",prospectId:existing.prospectId};
  if(existing.kind==="ambiguous"){
    return {kind:"ambiguous",body:"We found more than one acquisition profile for this WhatsApp identity. A QuickFurno team member will review it before Aarohi continues."};
  }

  const vendorGate=await anyExistingVendorForInboundPhone(args.senderPhoneE164);
  if(vendorGate==="error") return {kind:"refused"};
  if(vendorGate==="yes"){
    return {
      kind:"existing_vendor",
      body:"This WhatsApp identity is already connected to a QuickFurno vendor record. Please use the main QuickFurno vendor support channel instead of starting a new partner acquisition.",
    };
  }

  const db=adminClient();
  let {data:intake,error}=await db.from("aarohi_whatsapp_intakes")
    .select("id,state,business_name,city_id,primary_category,prospect_id")
    .eq("provider_account_id",args.providerAccountId)
    .eq("destination_hash",args.destinationHash)
    .maybeSingle();
  if(error) return {kind:"refused"};

  if(intake?.state==="COMPLETE" && intake.prospect_id){
    return {kind:"ready",prospectId:String(intake.prospect_id)};
  }
  if(intake?.state==="CANCELLED") return {kind:"refused"};

  const text=normalizedText(args.contentMinimized,args.messageType);
  if(!intake){
    const inserted=await db.from("aarohi_whatsapp_intakes").insert({
      provider_account_id:args.providerAccountId,
      destination_hash:args.destinationHash,
      state:"AWAITING_BUSINESS",
    }).select("id,state,business_name,city_id,primary_category,prospect_id").single();
    if(inserted.error||!inserted.data) return {kind:"refused"};
    intake=inserted.data;
    return {kind:"prompt",body:"Welcome to QuickFurno Partner. Aarohi will help you join QuickFurno. First, please send your business or company name."};
  }

  if(!text){
    return {kind:"prompt",body:"Please reply with text so QuickFurno can securely complete your vendor acquisition profile."};
  }

  if(intake.state==="AWAITING_BUSINESS"){
    if(text.length<2){
      return {kind:"prompt",body:"Please send your business or company name (at least 2 characters)."};
    }
    const updated=await db.from("aarohi_whatsapp_intakes")
      .update({business_name:text.slice(0,160),state:"AWAITING_CITY",updated_at:new Date().toISOString()})
      .eq("id",intake.id).eq("state","AWAITING_BUSINESS");
    if(updated.error) return {kind:"refused"};
    return {kind:"prompt",body:"Thanks. Which city is your business based in? Please send the city name."};
  }

  if(intake.state==="AWAITING_CITY"){
    const cities=await availableCities();
    const wanted=normalizeCity(text);
    const city=cities.find((one)=>normalizeCity(one.name)===wanted||normalizeCity(one.slug)===wanted);
    if(!city){
      const labels=cities.slice(0,8).map((one)=>one.name).join(", ");
      return {kind:"prompt",body:labels ? "Please choose an active QuickFurno city. Available now: "+labels+"." : "QuickFurno city availability is temporarily unavailable. Please try again shortly."};
    }
    const updated=await db.from("aarohi_whatsapp_intakes")
      .update({city_id:city.id,state:"AWAITING_CATEGORY",updated_at:new Date().toISOString()})
      .eq("id",intake.id).eq("state","AWAITING_CITY");
    if(updated.error) return {kind:"refused"};
    return {kind:"prompt",body:"Great. What service or category does your business provide? For example: Interior Design, Modular Kitchen, Painting, POP, Sofa or Carpentry."};
  }

  if(intake.state==="AWAITING_CATEGORY"){
    if(text.length<2){
      return {kind:"prompt",body:"Please send the main service or category your business provides."};
    }
    const completed=await db.rpc("qf_aarohi_complete_whatsapp_intake_v1" as never,{
      p_intake_id:intake.id,
      p_primary_category:text.slice(0,120),
    } as never);
    if(completed.error||!completed.data) return {kind:"refused"};
    const prospectId=String(completed.data);
    return {
      kind:"completed",
      prospectId,
      body:"Perfect. Your QuickFurno acquisition profile is ready. Aarohi can now continue with your questions and guide you through joining QuickFurno.",
    };
  }

  return {kind:"refused"};
}

export async function linkAarohiProspectWhatsAppHash(args:{
  prospectId:string;
  destinationHash:string;
  displayName?:string|null;
}):Promise<{ok:true}|{ok:false;reason:string}>{
  const db=adminClient();
  const prospect=await db.from("aarohi_prospects")
    .select("id,do_not_contact,merged_into_prospect_id,prospect_stage")
    .eq("id",args.prospectId).eq("tenant_id","quickfurno").maybeSingle();
  if(prospect.error) return {ok:false,reason:"core_unavailable"};
  if(!prospect.data||prospect.data.do_not_contact||prospect.data.merged_into_prospect_id||prospect.data.prospect_stage==="SUPPRESSED"){
    return {ok:false,reason:"prospect_not_linkable"};
  }
  const ref="whatsapp_hash:"+args.destinationHash;
  const occupied=await db.from("aarohi_channel_identities")
    .select("prospect_id").eq("channel","WHATSAPP").eq("external_reference",ref);
  if(occupied.error) return {ok:false,reason:"core_unavailable"};
  const others=[...new Set((occupied.data??[]).map((x:any)=>String(x.prospect_id)))].filter((id)=>id!==args.prospectId);
  if(others.length>0) return {ok:false,reason:"identity_conflict"};

  const inserted=await db.from("aarohi_channel_identities").upsert({
    prospect_id:args.prospectId,
    channel:"WHATSAPP",
    external_reference:ref,
    display_name:args.displayName?.trim().slice(0,200)||null,
    verification_status:"OBSERVED",
    updated_at:new Date().toISOString(),
  },{onConflict:"prospect_id,channel,external_reference"});
  if(inserted.error) return {ok:false,reason:"link_failed"};
  await db.from("aarohi_events").insert({
    prospect_id:args.prospectId,
    event_type:"whatsapp.identity_observed",
    actor_type:"CORE",
    actor_reference:"aarohi-omnichannel",
    channel:"WHATSAPP",
    safe_summary:"WhatsApp continuation identity linked to existing Aarohi prospect.",
    event_data:{identity_binding:"HASHED_DESTINATION"},
  });
  return {ok:true};
}
