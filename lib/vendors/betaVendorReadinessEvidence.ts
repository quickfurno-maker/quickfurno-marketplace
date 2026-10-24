// Phase 3B-14D OFFLINE planning only. Do not import into live vendor approval,
// auth or public-listing paths until provider-certified attestation integration.
// No Aadhaar numbers, OTPs, documents or provider tokens may be supplied here.
export interface BetaVendorReadinessEvidence {
  status?: string|null;
  isActive?: boolean|null;
  publicVisible?: boolean|null;
  acceptingLeads?: boolean|null;
  authIdentityLinked?: boolean|null;
  credits?: number|null;
  googlePlaceServerVerified?: boolean|null;
  serviceZoneServerVerified?: boolean|null;
  officeLocationStatus?: string|null;
  approvedServiceCategories?: number|null;
  identityAttestedByApprovedProvider?: boolean|null;
  aadhaarConsentAttested?: boolean|null;
  ownerApprovalRecorded?: boolean|null;
}
export type BetaVendorBlocker =
  | "NOT_APPROVED"|"INACTIVE"|"NOT_PUBLIC"|"NOT_ACCEPTING_LEADS"
  | "NO_LINKED_AUTH_IDENTITY"|"INSUFFICIENT_CREDITS"
  | "OFFICE_NOT_SERVER_VERIFIED"|"SERVICE_ZONE_NOT_VERIFIED"
  | "OFFICE_LOCATION_NOT_VERIFIED"|"NO_APPROVED_CATEGORIES"
  | "IDENTITY_ATTESTATION_MISSING"|"AADHAAR_CONSENT_MISSING"
  | "OWNER_APPROVAL_MISSING";
export function assessBetaVendorReadiness(
  e: Readonly<BetaVendorReadinessEvidence>
): Readonly<{ready:boolean; blockers:readonly BetaVendorBlocker[]; mode:"ADVISORY_ONLY"}> {
  const blockers:BetaVendorBlocker[]=[];
  if(e.status!=="Approved")blockers.push("NOT_APPROVED");
  if(e.isActive!==true)blockers.push("INACTIVE");
  if(e.publicVisible!==true)blockers.push("NOT_PUBLIC");
  if(e.acceptingLeads!==true)blockers.push("NOT_ACCEPTING_LEADS");
  if(e.authIdentityLinked!==true)blockers.push("NO_LINKED_AUTH_IDENTITY");
  if(!Number.isInteger(e.credits)||!(e.credits!>0))blockers.push("INSUFFICIENT_CREDITS");
  if(e.googlePlaceServerVerified!==true)blockers.push("OFFICE_NOT_SERVER_VERIFIED");
  if(e.serviceZoneServerVerified!==true)blockers.push("SERVICE_ZONE_NOT_VERIFIED");
  if(e.officeLocationStatus!=="verified")blockers.push("OFFICE_LOCATION_NOT_VERIFIED");
  if(!Number.isInteger(e.approvedServiceCategories)||!(e.approvedServiceCategories!>0))blockers.push("NO_APPROVED_CATEGORIES");
  if(e.identityAttestedByApprovedProvider!==true)blockers.push("IDENTITY_ATTESTATION_MISSING");
  if(e.aadhaarConsentAttested!==true)blockers.push("AADHAAR_CONSENT_MISSING");
  if(e.ownerApprovalRecorded!==true)blockers.push("OWNER_APPROVAL_MISSING");
  return Object.freeze({ready:blockers.length===0,blockers:Object.freeze(blockers),mode:"ADVISORY_ONLY" as const});
}
