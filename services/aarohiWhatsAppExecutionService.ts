import "server-only";
import { adminClient } from "@/lib/supabase";
import { RECIPIENT_REFERENCE_DESTINATION } from "@/lib/communication/types";
import { phase2ProviderExecutionEnabled } from "@/lib/aarohi/phase2Policy";
import { createAarohiOutboundConsentEnforcer } from "@/services/aarohiOutboundConsentEnforcer";
import {
  claimAarohiWhatsAppOutreach,
  completeAarohiWhatsAppOutreach,
} from "@/services/aarohiPhase2AcquisitionService";
import { createRuntimeCommunicationService } from "@/services/runtimeCommunicationService";

const TEMPLATE_KEY=/^[A-Za-z0-9._:-]{1,160}$/;

function conversationalEnv():NodeJS.ProcessEnv{
  const env={...process.env};
  env.WHATSAPP_PROVIDER_MODE="meta_cloud";
  env.WHATSAPP_ACCESS_TOKEN=process.env.WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN;
  env.WHATSAPP_PHONE_NUMBER_ID=process.env.WHATSAPP_CONVERSATIONAL_PHONE_NUMBER_ID;
  env.WHATSAPP_WABA_ID=process.env.WHATSAPP_CONVERSATIONAL_WABA_ID;
  env.WHATSAPP_GRAPH_API_VERSION=
    process.env.WHATSAPP_CONVERSATIONAL_GRAPH_API_VERSION||
    process.env.WHATSAPP_GRAPH_API_VERSION;
  return env;
}

function templateForJob(job:any):{
  messageType:"aarohi_marketing_broadcast"|"aarohi_acquisition_continuation";
  templateKey:string;
}|null{
  const draft=String(job.draft_ref??"");
  if(draft.startsWith("template:")){
    const templateKey=draft.slice("template:".length).trim();
    return TEMPLATE_KEY.test(templateKey)
      ?{messageType:"aarohi_marketing_broadcast",templateKey}
      :null;
  }
  if(draft==="system:whatsapp-acquisition-continuation"){
    const templateKey=process.env.QF_AAROHI_CONTINUATION_TEMPLATE_KEY?.trim()??"";
    return TEMPLATE_KEY.test(templateKey)
      ?{messageType:"aarohi_acquisition_continuation",templateKey}
      :null;
  }
  if(draft.startsWith("system:follow-up:")){
    const templateKey=process.env.QF_AAROHI_FOLLOWUP_TEMPLATE_KEY?.trim()??"";
    return TEMPLATE_KEY.test(templateKey)
      ?{messageType:"aarohi_acquisition_continuation",templateKey}
      :null;
  }
  return null;
}

async function prospectVariables(prospectId:string):Promise<Record<string,string>>{
  const {data,error}=await adminClient().from("aarohi_prospects")
    .select("business_name,contact_person_name,primary_category,cities(name)")
    .eq("id",prospectId).eq("tenant_id","quickfurno").maybeSingle();
  if(error) throw error;
  if(!data) throw new Error("aarohi_prospect_not_found");
  return {
    business_name:String(data.business_name??"").slice(0,240),
    contact_name:String(data.contact_person_name??data.business_name??"").slice(0,160),
    category:String(data.primary_category??"QuickFurno services").slice(0,160),
    city:String((data as any).cities?.name??"").slice(0,120),
  };
}

function safeFailureCode(value:unknown):string{
  if(!value||typeof value!=="object") return "COMMUNICATION_SEND_FAILED";
  const code=(value as any).code??(value as any).error?.code;
  return typeof code==="string"&&/^[A-Z0-9._:-]{1,160}$/.test(code)
    ?code
    :"COMMUNICATION_SEND_FAILED";
}

export async function executeAarohiWhatsAppOutreachOnce(
  workerRef="qf-aarohi-phase2-whatsapp",
):Promise<"disabled"|"idle"|"accepted"|"blocked"|"uncertain">{
  if(!phase2ProviderExecutionEnabled()) return "disabled";

  const job=await claimAarohiWhatsAppOutreach(workerRef);
  if(!job) return "idle";

  const jobId=String(job.id);
  const executionToken=String(job.execution_token);
  const prospectId=String(job.prospect_id);
  const template=templateForJob(job);
  if(!template){
    await completeAarohiWhatsAppOutreach({
      jobId,executionToken,outcome:"DEFINITIVE_FAILURE",
      errorCode:"AAROHI_TEMPLATE_NOT_CONFIGURED",
    });
    return "blocked";
  }

  let variables:Record<string,string>;
  try{
    variables=await prospectVariables(prospectId);
  }catch{
    await completeAarohiWhatsAppOutreach({
      jobId,executionToken,outcome:"DEFINITIVE_FAILURE",
      errorCode:"AAROHI_PROSPECT_CONTEXT_UNAVAILABLE",
    });
    return "blocked";
  }

  const service=createRuntimeCommunicationService(
    conversationalEnv(),
    undefined,
    createAarohiOutboundConsentEnforcer(),
  );
  if(!service.ok){
    await completeAarohiWhatsAppOutreach({
      jobId,executionToken,outcome:"DEFINITIVE_FAILURE",
      errorCode:safeFailureCode(service),
    });
    return "blocked";
  }

  const idempotencyKey=`aarohi.outreach.${jobId}`;
  const sent=await service.data.send({
    type:template.messageType,
    lane:"business",
    channel:"whatsapp",
    recipient_type:"prospect",
    recipient_id:prospectId,
    destination_source:RECIPIENT_REFERENCE_DESTINATION,
    template_key:template.templateKey,
    variables,
    entity_type:"aarohi_outreach_job",
    entity_id:jobId,
    correlation_id:`aarohi:${jobId}`,
    idempotency_key:idempotencyKey,
    priority:"normal",
    scheduled_at:null,
    policy_decision_id:null,
    metadata:{aarohi_job_id:jobId},
  });

  if(!sent.ok){
    const existing=await adminClient().from("communication_messages")
      .select("status,provider_message_id,error_code")
      .eq("idempotency_key",idempotencyKey).maybeSingle();
    if(existing.error){
      await completeAarohiWhatsAppOutreach({
        jobId,executionToken,outcome:"UNCERTAIN",
        errorCode:"COMMUNICATION_EVIDENCE_UNAVAILABLE",
      });
      return "uncertain";
    }
    if(existing.data?.status==="outcome_unknown"){
      await completeAarohiWhatsAppOutreach({
        jobId,executionToken,outcome:"UNCERTAIN",
        errorCode:String(existing.data.error_code??"PROVIDER_OUTCOME_UNKNOWN").slice(0,160),
      });
      return "uncertain";
    }
    await completeAarohiWhatsAppOutreach({
      jobId,executionToken,outcome:"DEFINITIVE_FAILURE",
      errorCode:safeFailureCode(sent),
    });
    return "blocked";
  }

  const message=sent.data as any;
  if(message.status==="outcome_unknown"){
    await completeAarohiWhatsAppOutreach({
      jobId,executionToken,outcome:"UNCERTAIN",
      errorCode:String(message.error_code??"PROVIDER_OUTCOME_UNKNOWN").slice(0,160),
    });
    return "uncertain";
  }
  if(["accepted","sent","delivered","read"].includes(String(message.status))&&message.provider_message_id){
    await completeAarohiWhatsAppOutreach({
      jobId,executionToken,outcome:"ACCEPTED",
      providerMessageRef:String(message.provider_message_id),
    });
    return "accepted";
  }
  if(message.status==="failed"||message.status==="cancelled"||message.status==="dead_letter"){
    await completeAarohiWhatsAppOutreach({
      jobId,executionToken,outcome:"DEFINITIVE_FAILURE",
      errorCode:String(message.error_code??"COMMUNICATION_SEND_FAILED").slice(0,160),
    });
    return "blocked";
  }

  // A message persisted without a provider acceptance/refusal is not safe to retry.
  await completeAarohiWhatsAppOutreach({
    jobId,executionToken,outcome:"UNCERTAIN",
    errorCode:"COMMUNICATION_OUTCOME_NOT_TERMINAL",
  });
  return "uncertain";
}

export async function executeAarohiWhatsAppOutreachBatch(
  limit=20,
):Promise<Record<string,number>>{
  const safe=Math.max(1,Math.min(100,Math.round(limit)));
  const counts:Record<string,number>={accepted:0,blocked:0,uncertain:0,idle:0,disabled:0};
  for(let i=0;i<safe;i+=1){
    const result=await executeAarohiWhatsAppOutreachOnce();
    counts[result]=(counts[result]??0)+1;
    if(result==="idle"||result==="disabled") break;
  }
  return counts;
}
