// VOX TO-02 — verified-input planning for multi-department staff memberships.
// NO Auth Admin calls, Core SQL, staff creation, role elevation or grant activation.
// This is a pure, fail-closed boundary for the future governed Core executor.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKS=Object.freeze({
 client_success:{label:"Client Success / Riya",sourceKinds:["client","conversation"]},
 vendor_success:{label:"Vendor Success / Anisha",sourceKinds:["vendor","support_thread","conversation"]},
 acquisition:{label:"Acquisition / Aarohi",sourceKinds:["prospect","conversation"]},
 service_support:{label:"Customer & Vendor Support",sourceKinds:["support_thread","conversation"]},
});
const KEYS=Object.freeze(Object.keys(PACKS));
const DENY=reason=>Object.freeze({ok:false,error:reason,mutationsAuthorized:false});
const id=x=>typeof x==="string"&&UUID.test(x);
const entry=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const verifiedOwner=a=>entry(a)&&id(a.userId)&&a.verifiedByCore===true&&a.aal==="aal2"&&
 a.profileRole==="admin"&&a.adminRole==="Superadmin"&&a.isActive===true;
const neutralStaff=a=>entry(a)&&id(a.userId)&&a.profileRole===null&&
 a.principal==="vox_staff"&&a.adminRole==null&&a.isActive===true;
const future=(t,now)=>Number.isSafeInteger(t)&&t>=now+300_000&&t<=now+30*86400_000;
export const departmentPacks=KEYS.map(key=>Object.freeze({
 key,label:PACKS[key].label,sourceKinds:Object.freeze([...PACKS[key].sourceKinds])
}));
Object.freeze(departmentPacks);
function normalizedPacks(packs){
 if(!Array.isArray(packs)||packs.length<1||packs.length>KEYS.length)return null;
 if(packs.some(x=>typeof x!=="string"||!Object.hasOwn(PACKS,x)))return null;
 const distinct=[...new Set(packs)];
 if(distinct.length!==packs.length)return null;
 return distinct.sort();
}
export function prepareStaffCapabilityRequest({
 environment,admin,target,team,request,nowMs=Date.now()
}={}){
 if(environment!=="staging")return DENY("STAGING_DISABLED");
 if(!verifiedOwner(admin))return DENY("VERIFIED_OWNER_AAL2_REQUIRED");
 if(!neutralStaff(target)||target.userId===admin.userId)return DENY("NEUTRAL_STAFF_REQUIRED");
 if(!entry(team)||!id(team.teamId)||!id(team.cityId)||team.isActive!==true)
  return DENY("VERIFIED_TEAM_REQUIRED");
 if(!entry(request)||!id(request.nonce)||request.targetId!==target.userId||
    request.teamId!==team.teamId||request.cityId!==team.cityId)
  return DENY("IDENTITY_OR_TEAM_BINDING_INVALID");
 if(typeof request.reason!=="string"||request.reason.trim().length<12||
    request.reason.trim().length>500||request.reason!==request.reason.trim())
  return DENY("AUDIT_REASON_REQUIRED");
 if(!future(request.expiresAtMs,nowMs))return DENY("CAPABILITY_LEASE_INVALID");
 const packs=normalizedPacks(request.packs);
 if(!packs)return DENY("INVALID_CAPABILITY_PACKS");
 return Object.freeze({
  ok:true,mode:"REQUEST_PREPARATION_ONLY",
  actorId:admin.userId,targetId:target.userId,
  cityId:team.cityId,teamId:team.teamId,nonce:request.nonce,
  capabilities:Object.freeze(packs.map(key=>Object.freeze({
   key,sourceKinds:Object.freeze([...PACKS[key].sourceKinds]),
   // Capabilities describe eligible desks; Core still requires exact object grant.
   requiresIndependentReview:true,requiresObjectGrant:true,active:false
  }))),
  expiresAtMs:request.expiresAtMs,mutationsAuthorized:false,
  mayInvite:false,mayActivate:false,maySend:false,mayGrantAdmin:false,
  requiresCoreAal2Recheck:true,requiresSeparateTeamLeaderReview:true,
  requiresAtomicCoreActivation:true
 });
}
/**
 * Minimizes a future Core-reviewed capability grant collection.
 * Source grants MUST be retrieved server-side after authenticated Core AAL2,
 * team membership, exact-city and object scope verification. Not an auth grant.
 */
export function previewApprovedCapabilities({
 identity,team,rows,nowMs=Date.now()
}={}){
 if(!entry(identity)||identity.verifiedByCore!==true||identity.aal!=="aal2"||
   !neutralStaff(identity)||!entry(team)||team.isActive!==true||
   !id(team.teamId)||!id(team.cityId)||team.memberUserId!==identity.userId||
   !Array.isArray(rows)||rows.length>KEYS.length||!Number.isFinite(nowMs))
  return DENY("CURRENT_STAFF_AAL2_SCOPE_REQUIRED");
 const keys=new Set();
 for(const row of rows){
  if(!entry(row)||row.targetId!==identity.userId||
     row.teamId!==team.teamId||row.cityId!==team.cityId||
     !Object.hasOwn(PACKS,row.pack)||
     !id(row.requestedBy)||!id(row.reviewedBy)||!id(row.activatedBy)||
     row.requestedBy===row.reviewedBy||row.reviewedBy===row.activatedBy||
     row.reviewedBy===identity.userId||row.activatedBy===identity.userId||
     row.status!=="ACTIVE"||row.revokedAt!==null||
     !Number.isSafeInteger(row.leaseUntilMs)||row.leaseUntilMs<=nowMs||
     !Number.isSafeInteger(row.revision)||row.revision<2
   )continue;
  keys.add(row.pack);
 }
 return Object.freeze({
  ok:true,mode:"READ_ONLY",
  packs:Object.freeze([...keys].sort().map(key=>Object.freeze({
   key,label:PACKS[key].label,sourceKinds:Object.freeze([...PACKS[key].sourceKinds])
  }))),
  coreAuthorizationRequired:true,requiresSeparateObjectScope:true,
  mayMutate:false,mayApprove:false,maySend:false,mayElevateToAdmin:false,
  proof:"NOT_AN_AUTHORIZATION_DECISION"
 });
}
