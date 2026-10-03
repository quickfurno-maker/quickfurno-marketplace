"use server";
import { revalidatePath } from "next/cache";
import { getAdminSession } from "@/app/actions";
import { adminClient } from "@/lib/supabase";
import { hasAarohiPermission } from "@/lib/aarohi/permissions";
import type { AarohiPermission } from "@/lib/aarohi/contracts";
import {
  addAarohiCampaignMember, completeAarohiHandoff, createAarohiCampaign, createAarohiTask,
  createManualAarohiProspect, reviewAarohiIdentityMatch, scoreAarohiProspect, selectAarohiPackage,
  setAarohiPaused, setAarohiSuppressed, setAarohiTakeover, updateAarohiTask, updateAarohiWorkflow,
} from "@/services/aarohiCrmService";
import {
  createAarohiVendorRegistrationLink,
  linkAarohiWhatsAppContinuation,
  observeAarohiChannelIdentity,
  recordAarohiAssistedFirstOutreach,
} from "@/services/aarohiOmnichannelService";
import {
  markAarohiAssistedFirstContactJob,
  planAarohiWhatsAppBroadcast,
  promoteAarohiDiscoveryCandidate,
  recordAarohiCapacitySnapshot,
  recordAarohiChannelEligibility,
  recordAarohiCommunicationPermission,
  setAarohiDiscoveryConnectorState,
  updateAarohiCityPolicy,
  upsertAarohiFollowupPolicy,
} from "@/services/aarohiPhase2AcquisitionService";

async function actor(permission:AarohiPermission){
  const session=await getAdminSession();
  if(!session.isLoggedIn||!session.isAdmin||!session.userId||!hasAarohiPermission(session.adminRole,permission)) throw new Error("unauthorized");
  return session.userId;
}
async function sensitiveBudget(actorId:string){
  const since=new Date(Date.now()-60000).toISOString();
  const r=await adminClient().from("aarohi_events").select("id",{count:"exact",head:true}).eq("actor_reference",actorId).gte("created_at",since);
  if(r.error) throw r.error; if((r.count??0)>=30) throw new Error("aarohi_action_rate_limited");
}
const val=(f:FormData,k:string)=>{const v=f.get(k);return typeof v==="string"?v:"";};
function refresh(id?:string){revalidatePath("/admin/aarohi");revalidatePath("/admin/aarohi/prospects");revalidatePath("/admin/aarohi/pipeline");revalidatePath("/admin/aarohi/inbox");revalidatePath("/admin/aarohi/tasks");revalidatePath("/admin/aarohi/discovery");revalidatePath("/admin/aarohi/outreach");revalidatePath("/admin/aarohi/campaigns");if(id)revalidatePath(`/admin/aarohi/prospects/${id}`);}

export async function createProspectAction(formData:FormData){const a=await actor("aarohi.manage");const id=await createManualAarohiProspect({business_name:val(formData,"business_name"),city_id:val(formData,"city_id"),primary_category:val(formData,"primary_category"),area:val(formData,"area"),pincode:val(formData,"pincode"),primary_phone:val(formData,"primary_phone"),website:val(formData,"website"),contact_person_name:val(formData,"contact_person_name")},a);refresh(id);}
export async function updateWorkflowAction(prospectId:string,formData:FormData){const a=await actor("aarohi.manage");await updateAarohiWorkflow(prospectId,{prospect_stage:val(formData,"prospect_stage"),conversation_stage:val(formData,"conversation_stage"),priority_band:val(formData,"priority_band"),next_action_type:val(formData,"next_action_type"),next_action_at:val(formData,"next_action_at")||null,next_action_reason:val(formData,"next_action_reason"),preferred_channel:val(formData,"preferred_channel"),current_objection:val(formData,"current_objection")},a);refresh(prospectId);}
export async function suppressProspectAction(prospectId:string,formData:FormData){const a=await actor("aarohi.suppress");await sensitiveBudget(a);await setAarohiSuppressed(prospectId,val(formData,"reason")||"Operator do-not-contact decision",a);refresh(prospectId);}
export async function takeoverProspectAction(prospectId:string,takeover:boolean){const a=await actor("aarohi.takeover");await sensitiveBudget(a);await setAarohiTakeover(prospectId,takeover,a);refresh(prospectId);}
export async function pauseAarohiAction(prospectId:string,paused:boolean){const a=await actor("aarohi.manage");await setAarohiPaused(prospectId,paused,a);refresh(prospectId);}
export async function createTaskAction(prospectId:string,formData:FormData){const a=await actor("aarohi.manage");await createAarohiTask(prospectId,{task_type:val(formData,"task_type"),due_at:val(formData,"due_at")||null,priority:val(formData,"priority"),reason:val(formData,"reason")},a);refresh(prospectId);}
export async function updateTaskAction(taskId:string,prospectId:string,status:string){const a=await actor("aarohi.manage");await updateAarohiTask(taskId,status,a);refresh(prospectId);}
export async function scoreProspectAction(prospectId:string,formData:FormData){const a=await actor("aarohi.manage");await scoreAarohiProspect(prospectId,{qualification_score:val(formData,"qualification_score"),contactability_score:val(formData,"contactability_score"),engagement_score:val(formData,"engagement_score"),commercial_intent_score:val(formData,"commercial_intent_score"),data_confidence_score:val(formData,"data_confidence_score"),score_version:"aarohi-score-v1",score_reason_codes:formData.getAll("score_reason_codes")},a);refresh(prospectId);}
export async function identityDecisionAction(matchId:string,keepProspectId:string|undefined,decision:"CONFIRMED"|"REJECTED"){const a=await actor("aarohi.review_identity");await sensitiveBudget(a);await reviewAarohiIdentityMatch(matchId,decision,keepProspectId,a);refresh(keepProspectId);}
export async function createCampaignAction(formData:FormData){const a=await actor("aarohi.manage_campaigns");await createAarohiCampaign({name:val(formData,"name"),description:val(formData,"description")},a);refresh();}
export async function addCampaignMemberAction(campaignId:string,prospectId:string){const a=await actor("aarohi.manage_campaigns");await addAarohiCampaignMember(campaignId,prospectId,a);refresh(prospectId);}
export async function selectPackageAction(prospectId:string,packageId:string){const a=await actor("aarohi.manage");await selectAarohiPackage(prospectId,packageId,a);refresh(prospectId);}
export async function completeHandoffAction(prospectId:string,formData:FormData){const a=await actor("aarohi.manage");await sensitiveBudget(a);await completeAarohiHandoff(prospectId,val(formData,"vendor_id"),a);refresh(prospectId);}


export async function observeChannelIdentityAction(prospectId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  const channel=val(formData,"channel");
  if(!["INSTAGRAM","FACEBOOK","X","WEBSITE"].includes(channel)) throw new Error("invalid_channel");
  await observeAarohiChannelIdentity({
    prospectId,
    channel:channel as "INSTAGRAM"|"FACEBOOK"|"X"|"WEBSITE",
    externalReference:val(formData,"external_reference"),
    profileUrl:val(formData,"profile_url")||null,
    displayName:val(formData,"display_name")||null,
    actorId:a,
  });
  refresh(prospectId);
}

export async function recordAssistedOutreachAction(prospectId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  const channel=val(formData,"channel");
  if(channel!=="INSTAGRAM"&&channel!=="FACEBOOK") throw new Error("invalid_assisted_channel");
  await recordAarohiAssistedFirstOutreach({
    prospectId,
    channel,
    externalReference:val(formData,"external_reference")||null,
    actorId:a,
  });
  refresh(prospectId);
}

export async function linkWhatsAppContinuationAction(prospectId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  await linkAarohiWhatsAppContinuation({
    prospectId,
    phoneE164:val(formData,"phone_e164"),
    actorId:a,
  });
  refresh(prospectId);
}

export async function createRegistrationLinkAction(
  prospectId:string,
  channel:"WHATSAPP"|"INSTAGRAM"|"FACEBOOK"|"X"|"WEBSITE"|"MANUAL"="MANUAL",
):Promise<{ok:true;relativeUrl:string;expiresAt:string}|{ok:false;error:string}>{
  try{
    const a=await actor("aarohi.manage");
    await sensitiveBudget(a);
    const result=await createAarohiVendorRegistrationLink({prospectId,channel,actorId:a});
    refresh(prospectId);
    return {ok:true,...result};
  }catch(error){
    return {ok:false,error:error instanceof Error?error.message:"registration_link_failed"};
  }
}

export async function promoteDiscoveryCandidateAction(candidateId:string){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  const result=await promoteAarohiDiscoveryCandidate(candidateId,a);
  refresh(result.prospectId);
}

export async function planWhatsAppBroadcastAction(campaignId:string,formData:FormData){
  const a=await actor("aarohi.manage_campaigns");
  await sensitiveBudget(a);
  await planAarohiWhatsAppBroadcast({
    campaignId,
    templateName:val(formData,"template_name"),
    actorId:a,
    dailyCap:Number(val(formData,"daily_cap")||1000),
  });
  refresh();
}

export async function recordAarohiMarketingPermissionAction(prospectId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  const state=val(formData,"state")==="GRANTED"?"GRANTED":"REVOKED";
  await recordAarohiCommunicationPermission({
    prospectId,
    channel:"WHATSAPP",
    purpose:"MARKETING_BROADCAST",
    state,
    evidenceKind:state==="GRANTED"?"ADMIN_EVIDENCE_IMPORT":"STOP_OR_SUPPRESSION",
    evidenceRef:val(formData,"evidence_ref"),
  });
  refresh(prospectId);
}


export async function updateAarohiCityPolicyAction(cityId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  await updateAarohiCityPolicy({
    cityId,
    enabled:formData.get("enabled")==="on",
    discoveryEnabled:formData.get("discovery_enabled")==="on",
    outreachEnabled:formData.get("outreach_enabled")==="on",
    broadcastsEnabled:formData.get("broadcasts_enabled")==="on",
    quietStart:val(formData,"quiet_start")||"21:00",
    quietEnd:val(formData,"quiet_end")||"09:00",
    dailyDiscoveryCap:Number(val(formData,"daily_discovery_cap")||250),
    dailyOutreachCap:Number(val(formData,"daily_outreach_cap")||100),
    autonomyLevel:Number(val(formData,"autonomy_level")||0),
    categories:val(formData,"categories").split(",").map(x=>x.trim()).filter(Boolean),
    actorId:a,
  });
  refresh();
}

export async function setAarohiDiscoveryConnectorStateAction(connectorId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  await setAarohiDiscoveryConnectorState({
    connectorId,
    enabled:formData.get("enabled")==="on",
    providerReady:formData.get("provider_ready")==="on",
    actorId:a,
  });
  refresh();
}

export async function markAarohiAssistedFirstContactJobAction(jobId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  await markAarohiAssistedFirstContactJob({
    jobId,actorId:a,externalReference:val(formData,"external_reference")||null,
  });
  refresh();
}

export async function upsertAarohiFollowupPolicyAction(formData:FormData){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  const channel=val(formData,"channel");
  if(!["INSTAGRAM","FACEBOOK","X","WHATSAPP"].includes(channel)) throw new Error("invalid_channel");
  await upsertAarohiFollowupPolicy({
    channel:channel as "INSTAGRAM"|"FACEBOOK"|"X"|"WHATSAPP",
    triggerStage:val(formData,"trigger_stage"),
    enabled:formData.get("enabled")==="on",
    delayMinutes:Number(val(formData,"delay_minutes")||1440),
    maxAttempts:Number(val(formData,"max_attempts")||1),
    actorId:a,
  });
  refresh();
}

export async function recordAarohiChannelEligibilityAction(prospectId:string,formData:FormData){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  const channel=val(formData,"channel");
  if(!["INSTAGRAM","FACEBOOK","X","WHATSAPP"].includes(channel)) throw new Error("invalid_channel");
  const state=val(formData,"state");
  if(!["UNKNOWN","ELIGIBLE","INELIGIBLE"].includes(state)) throw new Error("invalid_eligibility_state");
  await recordAarohiChannelEligibility({
    prospectId,channel:channel as "INSTAGRAM"|"FACEBOOK"|"X"|"WHATSAPP",
    state:state as "UNKNOWN"|"ELIGIBLE"|"INELIGIBLE",
    providerKey:val(formData,"provider_key")||null,
    evidenceKind:val(formData,"evidence_kind")||"ADMIN_REVIEW",
    evidenceRef:val(formData,"evidence_ref")||`admin:${a}`,
    expiresAt:val(formData,"expires_at")||null,
  });
  refresh(prospectId);
}

export async function recordAarohiCapacitySnapshotAction(formData:FormData){
  const a=await actor("aarohi.manage");
  await sensitiveBudget(a);
  const channel=val(formData,"channel");
  const state=val(formData,"state");
  if(!["WHATSAPP","INSTAGRAM","FACEBOOK","X"].includes(channel)) throw new Error("invalid_channel");
  if(!["UNKNOWN","GREEN","YELLOW","RED"].includes(state)) throw new Error("invalid_capacity_state");
  await recordAarohiCapacitySnapshot({
    channel:channel as "WHATSAPP"|"INSTAGRAM"|"FACEBOOK"|"X",
    providerKey:val(formData,"provider_key"),
    providerAccountId:val(formData,"provider_account_id")||null,
    state:state as "UNKNOWN"|"GREEN"|"YELLOW"|"RED",
    dailyLimit:val(formData,"daily_limit")?Number(val(formData,"daily_limit")):null,
    usedToday:Number(val(formData,"used_today")||0),
    reservedForMain:Number(val(formData,"reserved_for_main")||0),
    acquisitionAvailable:Number(val(formData,"acquisition_available")||0),
    expiresAt:val(formData,"expires_at"),
    reasonCode:val(formData,"reason_code")||`admin:${a}`,
  });
  refresh();
}
