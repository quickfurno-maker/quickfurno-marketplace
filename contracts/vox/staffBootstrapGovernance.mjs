// VOX Phase A: pure guard for staff invitations and MFA recovery.
import {createHash,timingSafeEqual} from 'node:crypto';
// NO Auth Admin API, email sending, token minting, browser action or DB write.
// Only trusted Core-side, independently verified authorizers may populate input.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i;
const ROLES=new Set(['operations_manager','acquisition_agent','vendor_success_agent','support_agent','auditor']);
const deny=reason=>Object.freeze({allowed:false,reason});
const owner=o=>o&&UUID.test(o.id)&&o.verifiedByCore===true&&o.aal==='aal2'&&
 o.profileRole==='admin'&&o.adminRole==='Superadmin'&&o.isActive===true;
const leader=(o,teamId)=>o&&UUID.test(o.id)&&o.verifiedByCore===true&&
 o.aal==='aal2'&&o.role==='team_leader'&&o.teamId===teamId&&o.isActive===true;
const stage=v=>v==='staging';
const validTime=(until,now)=>Number.isFinite(until)&&Number.isFinite(now)&&
 until>=now+5*60_000&&until<=now+30*86400_000;
export function prepareStaffInvitation(input){
 if(!input||!stage(input.environment))return deny('STAGING_DISABLED');
 const {request,review,authorizedOwner:admin,team,nowMs=Date.now()}=input;
 if(!owner(admin))return deny('OWNER_AAL2_REQUIRED');
 if(!request||!review||!team||team.isActive!==true||
    !UUID.test(team.id)||!UUID.test(team.cityId))return deny('TEAM_OR_REVIEW_UNAVAILABLE');
 if(!leader(review,team.id)||review.id===admin.id)return deny('INDEPENDENT_TEAM_LEADER_REVIEW_REQUIRED');
 if(review.signedCoreReceiptVerified!==true||review.decision!=='APPROVED'||review.requestNonce!==request.nonce||
    review.staffRole!==request.staffRole||review.cityId!==team.cityId||
    !Number.isFinite(review.validUntilMs)||review.validUntilMs<nowMs||
    review.validUntilMs>nowMs+86400000||
    !UUID.test(String(request.nonce??''))||review.targetEmailSha256!==request.emailSha256)
   return deny('REVIEW_RECEIPT_MISMATCH');
 if(typeof request.email!=='string'||request.email.length>254||
    !EMAIL.test(request.email)||request.email!==request.email.trim()||
    !/^[a-f0-9]{64}$/.test(String(request.emailSha256??'')))
   return deny('INVALID_IDENTITY');
 // Independently bind the email to the approved receipt before any operator step.
 const emailDigest=createHash('sha256').update(request.email.toLowerCase(),'utf8').digest('hex');
 const claimed=Buffer.from(request.emailSha256,'hex');
 const actual=Buffer.from(emailDigest,'hex');
 if(claimed.length!==actual.length||!timingSafeEqual(claimed,actual))
   return deny('REVIEWED_EMAIL_BINDING_DENIED');
 if(!ROLES.has(request.staffRole)||!validTime(request.expiresAtMs,nowMs))
   return deny('ROLE_OR_LEASE_DENIED');
 if(request.existingUser===true||request.existingCoreAdmin===true||
    request.targetHasVendorAccount===true||request.userMetadataAuthority===true)
   return deny('EXISTING_OR_UNTRUSTED_PRINCIPAL');
 return Object.freeze({allowed:true,reason:'INDEPENDENTLY_REVIEWED_PREPARATION_ONLY',
  action:'PREPARE_MANUAL_SERVER_SIDE_INVITE',targetPrincipal:'vox_staff',
  profileRole:null,requiresEmailConfirmation:true,requiresTotpAal2:true,
  requiresLaterAtomicCoreMembershipGrant:true,maySendEmail:false,
  mayActivateMembership:false,mayUseServiceRoleInBrowser:false});
}
export function prepareStaffMfaRecovery(input){
 if(!input||!stage(input.environment))return deny('STAGING_DISABLED');
 const {authorizedOwner:admin,review,subject,incidentId}=input;
 if(!owner(admin))return deny('OWNER_AAL2_REQUIRED');
 if(!subject||!UUID.test(subject.id)||!UUID.test(incidentId)||
   subject.profileRole!==null||subject.qfPrincipal!=='vox_staff'||
   subject.adminRole!=null)return deny('NEUTRAL_STAFF_REQUIRED');
 if(!review||review.verifiedByCore!==true||review.signedCoreReceiptVerified!==true||review.aal!=='aal2'||
   review.decision!=='APPROVED'||!UUID.test(review.id)||
   review.id===admin.id||review.id===subject.id||
   review.targetId!==subject.id||review.incidentId!==incidentId)
   return deny('INDEPENDENT_RECOVERY_REVIEW_REQUIRED');
 if(subject.membershipActive!==false||subject.allScopesRevoked!==true||
   subject.sessionsRevoked!==true||subject.recoveryAuditWritten!==true)
   return deny('REVOKE_AND_AUDIT_BEFORE_RECOVERY');
 return Object.freeze({allowed:true,reason:'REVIEWED_RECOVERY_PREPARATION_ONLY',
  action:'PREPARE_MANUAL_MFA_FACTOR_RECOVERY',mustKeepMembershipDisabled:true,
  requiresIndependentFreshTotp:true,requiresFreshAal2:true,
  requiresNewAtomicCoreGrant:true,mayUnenrollFactor:false,
  mayActivateMembership:false});
}
