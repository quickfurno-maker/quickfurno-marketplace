import "server-only";
import { adminClient } from "@/lib/supabase";
import {
  decideCommunicationConsent,
  type ConsentDecisionOutcome,
} from "@/services/communicationConsentDecisionService";
import type {
  OutboundConsentEnforcer,
  OutboundConsentEnforcementInput,
  OutboundConsentOutcome,
} from "@/services/outboundConsentEnforcementService";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;

type AarohiPermissionPurpose="ACQUISITION_CONTINUATION"|"MARKETING_BROADCAST";

function purposeFor(input:OutboundConsentEnforcementInput):AarohiPermissionPurpose|null{
  if(input.messageType==="aarohi_acquisition_continuation") return "ACQUISITION_CONTINUATION";
  if(input.messageType==="aarohi_marketing_broadcast") return "MARKETING_BROADCAST";
  return null;
}
const invalid=():OutboundConsentOutcome=>({
  kind:"invalid",code:"CONSENT_ENFORCEMENT_INVALID",retryable:false,
});
const denied=(code:"CONSENT_SUPPRESSED"|"CONSENT_NOT_GRANTED"):OutboundConsentOutcome=>({
  kind:"deny",code,retryable:false,
});
const unavailable=():OutboundConsentOutcome=>({
  kind:"unavailable",code:"CONSENT_AUTHORITY_UNAVAILABLE",retryable:true,
});

async function authorizeAarohiOutbound(
  input:OutboundConsentEnforcementInput,
):Promise<OutboundConsentOutcome>{
  if(
    !input||
    input.channel!=="whatsapp"||
    input.lane!=="business"||
    input.destinationSource!=="recipient_reference"||
    input.recipientType!=="prospect"||
    typeof input.recipientId!=="string"||
    !UUID.test(input.recipientId)||
    typeof input.destinationHash!=="string"||
    !HEX64.test(input.destinationHash)
  ) return invalid();

  const purpose=purposeFor(input);
  if(!purpose) return denied("CONSENT_NOT_GRANTED");

  const db=adminClient();
  const [prospect,permission]=await Promise.all([
    db.from("aarohi_prospects")
      .select("id,do_not_contact,ai_paused,human_takeover,prospect_stage")
      .eq("id",input.recipientId).eq("tenant_id","quickfurno").maybeSingle(),
    db.from("aarohi_communication_permissions")
      .select("id,destination_hash,state")
      .eq("prospect_id",input.recipientId)
      .eq("channel","WHATSAPP")
      .eq("purpose",purpose)
      .eq("state","GRANTED")
      .maybeSingle(),
  ]);
  if(prospect.error||permission.error) return unavailable();
  if(
    !prospect.data||
    prospect.data.do_not_contact===true||
    prospect.data.ai_paused===true||
    prospect.data.human_takeover===true||
    prospect.data.prospect_stage==="SUPPRESSED"
  ) return denied("CONSENT_SUPPRESSED");
  if(!permission.data||permission.data.destination_hash!==input.destinationHash){
    return denied("CONSENT_NOT_GRANTED");
  }

  let global:ConsentDecisionOutcome;
  try{
    // Prospects are deliberately NOT D2-C principals. D2-C is consulted with
    // unknown identity solely for destination-scoped suppression authority.
    global=await decideCommunicationConsent({
      channel:"whatsapp",
      scope:"transactional",
      destinationHash:input.destinationHash,
      identityConfidence:"unknown",
      principal:null,
    });
  }catch{
    return unavailable();
  }
  if(!global.ok){
    return global.code==="AUTHORITY_LOOKUP_FAILED"?unavailable():invalid();
  }
  if(global.disposition==="blocked") return denied("CONSENT_SUPPRESSED");
  if(global.disposition!=="no_consent_objection") return invalid();

  return {kind:"allow",scope:purpose==="MARKETING_BROADCAST"?"marketing":"transactional"};
}

export function createAarohiOutboundConsentEnforcer():OutboundConsentEnforcer{
  return {authorize:authorizeAarohiOutbound};
}
