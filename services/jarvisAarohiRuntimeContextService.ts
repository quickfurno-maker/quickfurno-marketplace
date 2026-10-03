import "server-only";
import crypto from "crypto";
import { adminClient } from "@/lib/supabase";

type SalesIntent =
  | "GENERAL_INFORMATION"
  | "SERVICE_FIT"
  | "LEAD_QUALITY"
  | "COMMERCIAL_TERMS"
  | "REGISTRATION_PROCESS"
  | "PAYMENT_OR_ACTIVATION"
  | "REJECTION_OR_STOP"
  | "OTHER_OR_UNCLEAR";

type Objection =
  | "NONE"
  | "PRICE_OR_PACKAGE"
  | "LEAD_QUALITY"
  | "LEAD_VOLUME_OR_ROI"
  | "TRUST_OR_VERIFICATION"
  | "TIMING_OR_NOT_READY"
  | "PRIVACY_OR_CONTACT"
  | "OTHER";

function digestRef(prefix:string,value:string):string {
  return `${prefix}.${crypto.createHash("sha256").update(value).digest("hex").slice(0,32)}`;
}

function extractText(value:unknown):string {
  if(!value||typeof value!=="object"||Array.isArray(value)) return "";
  const r=value as Record<string,unknown>;
  const fields=["text","caption","replyTitle","replyId","title","description"];
  return fields.map((key)=>typeof r[key]==="string"?String(r[key]):"")
    .filter(Boolean).join(" ").trim().toLowerCase().replace(/\s+/g," ").slice(0,4096);
}

function includesAny(text:string,phrases:readonly string[]):boolean {
  return phrases.some((phrase)=>text===phrase||text.includes(phrase));
}

export function classifyAarohiAcquisitionTurn(value:unknown):{intent:SalesIntent;objectionKind:Objection}{
  const text=extractText(value);
  if(!text) return {intent:"OTHER_OR_UNCLEAR",objectionKind:"NONE"};

  if(includesAny(text,[
    "stop","unsubscribe","do not contact","don't contact","dont contact","not interested",
    "no thanks","remove me","privacy","don't message","dont message","mat message","message mat"
  ])) {
    return {
      intent:"REJECTION_OR_STOP",
      objectionKind:includesAny(text,["privacy","do not contact","don't contact","dont contact","unsubscribe","remove me","don't message","dont message","mat message","message mat"])
        ?"PRIVACY_OR_CONTACT":"TIMING_OR_NOT_READY",
    };
  }

  if(includesAny(text,["price","pricing","package","packages","cost","charges","charge","fee","fees","credit","credits","discount","plan"])) {
    return {intent:"COMMERCIAL_TERMS",objectionKind:"PRICE_OR_PACKAGE"};
  }

  if(includesAny(text,["payment","pay now","pay","razorpay","activation","activate","go live","live kaise","paid"])) {
    return {intent:"PAYMENT_OR_ACTIVATION",objectionKind:"NONE"};
  }

  if(includesAny(text,["register","registration","sign up","signup","join quickfurno","join","onboard","onboarding","documents required"])) {
    return {intent:"REGISTRATION_PROCESS",objectionKind:"NONE"};
  }

  if(includesAny(text,["fake lead","lead quality","genuine lead","quality lead","bad lead"])) {
    return {intent:"LEAD_QUALITY",objectionKind:"LEAD_QUALITY"};
  }

  if(includesAny(text,["how many leads","lead volume","roi","conversion","convert","guarantee lead","guaranteed lead"])) {
    return {intent:"LEAD_QUALITY",objectionKind:"LEAD_VOLUME_OR_ROI"};
  }

  if(includesAny(text,["trust","verified","verification","legit","genuine quickfurno"])) {
    return {intent:"GENERAL_INFORMATION",objectionKind:"TRUST_OR_VERIFICATION"};
  }

  if(includesAny(text,["later","next month","not now","busy","call later","contact later","abhi nahi","baad me","baad mein"])) {
    return {intent:"SERVICE_FIT",objectionKind:"TIMING_OR_NOT_READY"};
  }

  if(includesAny(text,["interior","modular kitchen","painting","painter","pop","false ceiling","sofa","furniture","architect","contractor","service","category","work in"])) {
    return {intent:"SERVICE_FIT",objectionKind:"NONE"};
  }

  if(includesAny(text,["quickfurno","what is","how does","tell me","details","hello","hi","hey","namaste"])) {
    return {intent:"GENERAL_INFORMATION",objectionKind:"NONE"};
  }

  return {intent:"OTHER_OR_UNCLEAR",objectionKind:"NONE"};
}

function conversionStatus(vendor:Record<string,unknown>|null):"REGISTERED"|"ACTIVE" {
  if(!vendor) return "REGISTERED";
  const approved=String(vendor.status??"").toLowerCase()==="approved";
  const active=vendor.is_active===true;
  const verified=String(vendor.verification_status??"").toLowerCase()==="verified";
  return approved&&active&&verified?"ACTIVE":"REGISTERED";
}

export async function readAarohiRuntimeContext(args:{
  conversationId:string;
  revision:number;
}):Promise<
  | {ok:true;input:Record<string,unknown>}
  | {ok:false;reason:"not_ready"|"stale_revision"|"core_unavailable"}
>{
  const db=adminClient();
  const {data:conversation,error:conversationError}=await db
    .from("communication_conversations")
    .select("id,tenant_id,provider_account_id,destination_hash,subject_type,aarohi_prospect_id,assigned_actor,state,jarvis_enabled,human_takeover,revision,last_inbound_provider_message_id")
    .eq("id",args.conversationId)
    .maybeSingle();
  if(conversationError) return {ok:false,reason:"core_unavailable"};
  if(!conversation) return {ok:false,reason:"not_ready"};
  if(Number(conversation.revision)!==args.revision) return {ok:false,reason:"stale_revision"};
  if(
    conversation.tenant_id!=="quickfurno"||
    conversation.subject_type!=="prospect"||
    conversation.assigned_actor!=="AAROHI"||
    conversation.state!=="OPEN"||
    conversation.jarvis_enabled!==true||
    conversation.human_takeover===true||
    typeof conversation.aarohi_prospect_id!=="string"
  ) return {ok:false,reason:"not_ready"};

  const prospectId=String(conversation.aarohi_prospect_id);
  const [{data:prospect,error:prospectError},{data:inbound,error:inboundError},{data:account,error:accountError}]=await Promise.all([
    db.from("aarohi_prospects")
      .select("id,prospect_stage,do_not_contact,ai_paused,human_takeover,merged_into_prospect_id")
      .eq("id",prospectId).eq("tenant_id","quickfurno").maybeSingle(),
    db.from("communication_inbound_messages")
      .select("id,provider_message_id,content_minimized,provider_occurred_at,received_at,sender_hash")
      .eq("conversation_id",args.conversationId)
      .eq("provider_message_id",String(conversation.last_inbound_provider_message_id??""))
      .maybeSingle(),
    db.from("communication_provider_accounts")
      .select("id,account_alias,account_role,jarvis_access_mode")
      .eq("id",String(conversation.provider_account_id)).maybeSingle(),
  ]);
  if(prospectError||inboundError||accountError) return {ok:false,reason:"core_unavailable"};
  if(!prospect||!inbound||!account) return {ok:false,reason:"not_ready"};
  if(
    prospect.do_not_contact===true||
    prospect.ai_paused===true||
    prospect.human_takeover===true||
    prospect.merged_into_prospect_id||
    String(prospect.prospect_stage??"").toUpperCase()==="SUPPRESSED"
  ) return {ok:false,reason:"not_ready"};

  // The acquisition runtime may execute from any approved conversation account, but a dedicated
  // Aarohi account is distinguished by alias. Existing main-number prospect continuations remain
  // valid until the dedicated number migration is fully deployed.
  if(account.jarvis_access_mode!=="proposal_only") return {ok:false,reason:"not_ready"};

  let coreStatus:"NOT_REGISTERED"|"REGISTERED"|"ACTIVE"|"DO_NOT_CONTACT"|"UNKNOWN"="NOT_REGISTERED";
  if(prospect.do_not_contact===true) coreStatus="DO_NOT_CONTACT";

  const conversion=await db.from("aarohi_vendor_conversion_links")
    .select("vendor_id,status")
    .eq("prospect_id",prospectId)
    .in("status",["LINKED","CONVERTED"])
    .maybeSingle();
  if(conversion.error) return {ok:false,reason:"core_unavailable"};
  if(conversion.data?.vendor_id){
    const vendor=await db.from("vendors")
      .select("id,status,is_active,verification_status")
      .eq("id",String(conversion.data.vendor_id)).maybeSingle();
    if(vendor.error) return {ok:false,reason:"core_unavailable"};
    coreStatus=conversionStatus((vendor.data as Record<string,unknown>|null)??null);
  }

  if(coreStatus!=="NOT_REGISTERED") return {ok:false,reason:"not_ready"};

  const observedAt=new Date(String(inbound.provider_occurred_at??inbound.received_at)).toISOString();
  const interpretedAt=new Date().toISOString();
  const {intent,objectionKind}=classifyAarohiAcquisitionTurn(inbound.content_minimized);
  const conversationRef=digestRef("conv",String(conversation.id));
  const threadRef=digestRef("thread",String(conversation.id));
  const participantRef=digestRef("party",String(inbound.sender_hash));
  const messageRef=digestRef("msg",String(inbound.provider_message_id));
  const planRef=digestRef("plan",`${conversation.id}:${args.revision}:${messageRef}`);
  const interpretationRef=digestRef("interp",`${messageRef}:${intent}:${objectionKind}`);
  const coreLookupRef=digestRef("core",`${prospectId}:${args.revision}`);

  return {
    ok:true,
    input:Object.freeze({
      mode:"OMNICHANNEL_LIVE_V1",
      planRef,
      turn:Object.freeze({
        contractVersion:1,
        prospectRef:prospectId,
        channel:"WHATSAPP",
        channelConversationRef:conversationRef,
        channelThreadRef:threadRef,
        channelParticipantRef:participantRef,
        channelMessageRef:messageRef,
        observedAt,
      }),
      interpretation:Object.freeze({
        contractVersion:1,
        interpretationRef,
        prospectRef:prospectId,
        channel:"WHATSAPP",
        channelConversationRef:conversationRef,
        channelThreadRef:threadRef,
        channelParticipantRef:participantRef,
        channelMessageRef:messageRef,
        intent,
        objectionKind,
        interpretedAt,
        sourcePosture:"QUICKFURNO_STRUCTURED_LIVE_INTERPRETATION",
      }),
      coreObservation:Object.freeze({
        prospectRef:prospectId,
        coreLookupRef,
        status:coreStatus,
      }),
      plannedAt:interpretedAt,
      promptRef:"aarohi.acquisition.v1",
    }),
  };
}
