import "server-only";
import {verifyVoxOperationsStaffBearer} from "./verifiedStaffBearer";
import {executeRc8PgVendorConversationOperator} from "./rc8PgVendorConversationOperator";

// RC19-B: actual Auth->native PostgreSQL writer integration, built but CLOSED.
// A caller may not inject a verifiedStaff object or choose sourceProof.
// This module has no route, no sends and no runtime environment toggle.
export const RC19_VERIFIED_CORE_WRITER_INSTALLED=false as const;
export const RC19_CORE_RELEASE_APPROVALS=Object.freeze({
 independentDbaAppsecApproved:false,managedRestoreCertified:false,
 staffAal2AndTeamOnboarded:false,consentMutationSerializationCertified:false,
 nativeWriterRoleAndAb7bReviewed:false,stagingOperationalAcceptancePassed:false
});
type NativeClient={query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;release:()=>void};
type Command={conversationId:string;nonce:string;expectedRevision:number;action:"PAUSE_AI"|"TAKEOVER"};
const blocked=(reason:string)=>Object.freeze({ok:false,reason,committed:false,providerMessagesSent:0,
 canonicalAb7bSourceReady:false});
export async function executeRc19VerifiedCoreConversationCommand(
 authorization:string|null,command:Command,acquireClient:()=>Promise<NativeClient>
){
 // Never allow a custom gate or env flag. The constant must only change in an
 // independently reviewed release after the real migration/recovery process.
 if(!RC19_VERIFIED_CORE_WRITER_INSTALLED)
  return blocked("RC19_VERIFIED_CORE_WRITER_RELEASE_HOLD");
 if(!command||typeof acquireClient!=="function")
  return blocked("RC19_COMMAND_INVALID");
 const actor=await verifyVoxOperationsStaffBearer(authorization);
 if(!actor)return blocked("RC19_CURRENT_STAFF_AAL2_REQUIRED");
 if(actor.expiresAtMs<=Date.now())
  return blocked("RC19_CURRENT_STAFF_AAL2_EXPIRED");
 // The native writer independently rechecks current staff, city/team, object
 // scope, TL capability grant, conversation revision and serialized consent
 // inside the same transaction; passing Auth here does not replace those checks.
 return executeRc8PgVendorConversationOperator({
  conversationId:command.conversationId,nonce:command.nonce,
  expectedRevision:command.expectedRevision,action:command.action,
  verifiedStaff:{userId:actor.userId,aal:"aal2",expiresAtMs:actor.expiresAtMs}
 },acquireClient);
}
