import assert from 'node:assert/strict';
import {prepareStaffInvitation,prepareStaffMfaRecovery} from '../../../contracts/vox/staffBootstrapGovernance.mjs';
const id=(x)=>'00000000-0000-4000-8000-'+String(x).padStart(12,'0');
const now=Date.now(),email='example.staff@example.invalid';
const owner={id:id(1),profileRole:'admin',adminRole:'Superadmin',verifiedByCore:true,aal:'aal2',isActive:true};
const review={id:id(2),role:'team_leader',teamId:id(3),verifiedByCore:true,aal:'aal2',isActive:true,
 decision:'APPROVED',requestNonce:id(4),targetEmailSha256:'f'.repeat(64)};
const team={id:id(3),cityId:id(5),isActive:true};
const request={nonce:id(4),email,emailSha256:'f'.repeat(64),staffRole:'support_agent',
 expiresAtMs:now+86400000,existingUser:false,existingCoreAdmin:false,
 targetHasVendorAccount:false,userMetadataAuthority:false};
const input={environment:'staging',authorizedOwner:owner,team,request,review,nowMs:now};
const recovery={environment:'staging',authorizedOwner:owner,incidentId:id(6),
 review:{id:id(7),verifiedByCore:true,aal:'aal2',decision:'APPROVED',targetId:id(8),incidentId:id(6)},
 subject:{id:id(8),profileRole:null,qfPrincipal:'vox_staff',adminRole:null,membershipActive:false,
 allScopesRevoked:true,sessionsRevoked:true,recoveryAuditWritten:true}};
let positive=0,negative=0;
const ok=(label,x,fn)=>{assert.equal(fn(x).allowed,true,label);positive++};
const no=(label,x,fn)=>{assert.equal(fn(x).allowed,false,label);negative++};
ok('safe signed reviewed invite preparation',input,prepareStaffInvitation);
ok('disabled & independently reviewed MFA recovery preparation',recovery,prepareStaffMfaRecovery);
const invite=prepareStaffInvitation(input);
assert.equal(invite.maySendEmail,false);
assert.equal(invite.mayActivateMembership,false);
assert.equal(invite.mayUseServiceRoleInBrowser,false);
assert.equal(invite.profileRole,null);
for(const [name,change] of [
 ['environment off',{environment:'production'}],
 ['owner no aal2',{authorizedOwner:{...owner,aal:'aal1'}}],
 ['legacy owner role',{authorizedOwner:{...owner,profileRole:null}}],
 ['staff reviewer not leader',{review:{...review,role:'support_agent'}}],
 ['self review',{review:{...review,id:owner.id}}],
 ['wrong city team',{team:{...team,isActive:false}}],
 ['wrong nonce',{review:{...review,requestNonce:id(23)}}],
 ['wrong email receipt',{review:{...review,targetEmailSha256:'0'.repeat(64)}}],
 ['unknown staff role',{request:{...request,staffRole:'Superadmin'}}],
 ['legacy Core administrator candidate',{request:{...request,existingCoreAdmin:true}}],
 ['existing account claimed',{request:{...request,existingUser:true}}],
 ['vendor account claimed',{request:{...request,targetHasVendorAccount:true}}],
 ['untrusted metadata',{request:{...request,userMetadataAuthority:true}}],
 ['expired lease',{request:{...request,expiresAtMs:now-10}}],
 ['long lease',{request:{...request,expiresAtMs:now+40*86400000}}],
 ['bad address',{request:{...request,email:'not an email'}}],
 ['unverified reviewer',{review:{...review,verifiedByCore:false}}]
])no(name,{...input,...change},prepareStaffInvitation);
for(const [name,change] of [
 ['production',{environment:'production'}],
 ['no owner MFA',{authorizedOwner:{...owner,aal:'aal1'}}],
 ['same owner-reviewer',{review:{...recovery.review,id:owner.id}}],
 ['target reviewer',{review:{...recovery.review,id:id(8)}}],
 ['wrong incident',{review:{...recovery.review,incidentId:id(10)}}],
 ['unreviewed',{review:{...recovery.review,decision:'PENDING'}}],
 ['non-neutral staff',{subject:{...recovery.subject,profileRole:'admin'}}],
 ['vendor identity',{subject:{...recovery.subject,qfPrincipal:'vendor'}}],
 ['active staff',{subject:{...recovery.subject,membershipActive:true}}],
 ['active grants',{subject:{...recovery.subject,allScopesRevoked:false}}],
 ['active sessions',{subject:{...recovery.subject,sessionsRevoked:false}}],
 ['missing audit',{subject:{...recovery.subject,recoveryAuditWritten:false}}]
])no(name,{...recovery,...change},prepareStaffMfaRecovery);
const result=prepareStaffMfaRecovery(recovery);
assert.equal(result.mayUnenrollFactor,false);
assert.equal(result.mayActivateMembership,false);
console.log('VOX_PHASE_A_INVITATION_RECOVERY_SOURCE_PASS positives='+positive+
 ' negative='+negative+' emailSent=false mfaReset=false coreRightsGranted=false');
