// VOX RC4 Track D: reusable, fail-closed VERIFIED Staff authorization binder.
// Pure decision logic. All I/O (Supabase Auth, Core reads) is INJECTED through
// `deps`, so this module is unit-testable and never creates users, writes rows
// or touches RLS. Feature gating lives in the server adapter, not here.
//
// Authority comes ONLY from: remote-verified Auth identity + AAL2 claims of that
// same token + fresh Core facts. Caller-supplied ids/roles/claims are never
// authority; a caller-supplied user id is only compared and rejected on mismatch.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const STAFF_ROLES=new Set(["operations_manager","acquisition_agent","vendor_success_agent","support_agent","auditor","team_leader"]);
const REQUIRED=new Set(["owner","team_leader","staff"]);
const isId=x=>typeof x==="string"&&UUID.test(x);
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const liveAt=(x,nowMs)=>typeof x==="string"&&Number.isFinite(Date.parse(x))&&Date.parse(x)>nowMs;

/** Deterministic denial table: code -> HTTP status. Callers should surface only `status`. */
export const RC4_STAFF_DENIALS=Object.freeze({
 BAD_REQUEST:400,
 UNAUTHENTICATED:401,
 AAL2_REQUIRED:401,
 STALE_CREDENTIAL:401,
 SESSION_REVOKED:401,
 SUBJECT_MISMATCH:403,
 PRINCIPAL_MISMATCH:403,
 NOT_STAFF:403,
 MEMBERSHIP_INACTIVE:403,
 ROLE_MISMATCH:403,
 SCOPE_MISMATCH:403,
 SCOPE_REQUIRED:403,
 SELF_APPROVAL:403,
 OWNER_STAFF_CONFLATION:403,
 DEPENDENCY_UNAVAILABLE:503,
});
const deny=code=>Object.freeze({ok:false,code,status:RC4_STAFF_DENIALS[code]});

/** Decode claims of a token the Auth server ALREADY verified. Not a signature check. */
function readClaims(token){
 try{
  return JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8"));
 }catch{return null;}
}
export function parseBearer(header){
 if(typeof header!=="string"||!header.startsWith("Bearer "))return null;
 const t=header.slice(7);
 return t.length>100&&t.length<8192&&JWT.test(t)?t:null;
}

/**
 * @param {object} input
 * @param {string|null} input.authorization  raw Authorization header
 * @param {"owner"|"team_leader"|"staff"} input.required
 * @param {string} [input.claimedUserId]     caller-supplied id: compared, never trusted
 * @param {string} [input.teamId]            scope the caller wants to act in
 * @param {string} [input.cityId]
 * @param {{requestedBy:string,targetUserId:string}} [input.approval]  set for approve actions
 * @param {object} input.deps
 *   verifyBearer(token)->{id,app_metadata}|null   (remote Supabase Auth getUser)
 *   loadFacts(userId)->{profile,authUser,membership,team,city,authorizationEpoch}
 *   isSessionLive(userId,sessionId)->boolean      (same-session revocation probe)
 *   now?()->ms
 */
export async function authorizeRc4Staff({authorization,required,claimedUserId,teamId,cityId,approval,deps}={}){
 if(!REQUIRED.has(required)||!isObj(deps)||typeof deps.verifyBearer!=="function"||
    typeof deps.loadFacts!=="function"||typeof deps.isSessionLive!=="function")return deny("BAD_REQUEST");
 if(claimedUserId!==undefined&&!isId(claimedUserId))return deny("BAD_REQUEST");
 for(const v of [teamId,cityId])if(v!==undefined&&!isId(v))return deny("BAD_REQUEST");
 if(approval!==undefined&&(!isObj(approval)||!isId(approval.requestedBy)||!isId(approval.targetUserId)))return deny("BAD_REQUEST");
 const token=parseBearer(authorization);
 if(!token)return deny("UNAUTHENTICATED");
 const nowMs=typeof deps.now==="function"?deps.now():Date.now();
 if(!Number.isSafeInteger(nowMs)||nowMs<=0)return deny("DEPENDENCY_UNAVAILABLE");
 const now=Math.floor(nowMs/1000);

 let user,facts,sessionLive;
 try{
  user=await deps.verifyBearer(token);
  if(!isObj(user)||!isId(user.id))return deny("UNAUTHENTICATED");
  const claims=readClaims(token);
  if(!isObj(claims)||claims.sub!==user.id||claims.is_anonymous===true)return deny("UNAUTHENTICATED");
  // Strict: missing/null/aal1 are all denied.
  if(claims.aal!=="aal2")return deny("AAL2_REQUIRED");
  if(!Number.isInteger(claims.exp)||claims.exp<=now||claims.exp>now+86400||
     !Number.isInteger(claims.iat)||claims.iat>now+30||!isId(claims.session_id))return deny("UNAUTHENTICATED");
  // IDOR: a body/query/header user id may only ever equal the verified one.
  if(claimedUserId!==undefined&&claimedUserId.toLowerCase()!==user.id.toLowerCase())return deny("SUBJECT_MISMATCH");
  facts=await deps.loadFacts(user.id);
  sessionLive=await deps.isSessionLive(user.id,claims.session_id);
  if(!isObj(facts))return deny("DEPENDENCY_UNAVAILABLE");
  // Revocation on the SAME still-unexpired JWT: session must be live and the token
  // must not predate the latest authorization change for this user.
  if(sessionLive!==true)return deny("SESSION_REVOKED");
  const epoch=facts.authorizationEpoch;
  if(epoch===undefined||(epoch!==null&&!Number.isFinite(Date.parse(epoch))))return deny("DEPENDENCY_UNAVAILABLE");
  if(epoch!==null&&claims.iat*1000<Date.parse(epoch))return deny("STALE_CREDENTIAL");
 }catch{return deny("DEPENDENCY_UNAVAILABLE");}

 const {profile,authUser,membership,team,city}=facts;
 if(!isObj(profile)||profile.id!==user.id||profile.is_active!==true||
    !isObj(authUser)||authUser.id!==user.id)return deny("NOT_STAFF");
 const meta=isObj(authUser.app_metadata)?authUser.app_metadata:{};

 const ownerShaped=profile.role==="admin"&&meta.admin_role==="Superadmin";
 if(ownerShaped){
  // Owner and neutral Team Leader are DISJOINT principals. Any live staff
  // membership on an Owner identity is ambiguity -> deny both.
  if(membership!==null&&membership!==undefined)return deny("OWNER_STAFF_CONFLATION");
  if(required!=="owner")return deny("PRINCIPAL_MISMATCH");
  if(approval&&(approval.requestedBy===user.id||approval.targetUserId===user.id))return deny("SELF_APPROVAL");
  return Object.freeze({ok:true,principal:Object.freeze({kind:"owner",userId:user.id,sessionId:readClaims(token).session_id})});
 }
 if(required==="owner")return deny("PRINCIPAL_MISMATCH");

 // Neutral Staff principal: no legacy Core role, no admin role, server-set marker.
 if(profile.role!==null||meta.qf_principal!=="vox_staff"||meta.admin_role!=null)return deny("NOT_STAFF");
 if(!isObj(membership)||membership.auth_user_id!==user.id)return deny("NOT_STAFF");
 // Strict: null/false/undefined is_active all denied; expiry is mandatory.
 if(membership.is_active!==true||membership.revoked_at!==null||!liveAt(membership.expires_at,nowMs))return deny("MEMBERSHIP_INACTIVE");
 if(!STAFF_ROLES.has(membership.staff_role)||!isId(membership.team_id))return deny("ROLE_MISMATCH");
 const isLeader=membership.staff_role==="team_leader";
 // Both Auth metadata and Core membership must agree on Team Leader, both ways.
 if(isLeader!==(meta.vox_role==="team_leader"))return deny("ROLE_MISMATCH");
 if(required==="team_leader"&&!isLeader)return deny("PRINCIPAL_MISMATCH");
 if(!isObj(team)||team.id!==membership.team_id||team.is_active!==true||!isId(team.city_id))return deny("SCOPE_MISMATCH");
 if(!isObj(city)||city.id!==team.city_id||city.is_active!==true)return deny("SCOPE_MISMATCH");
 // Staff actions must name their scope; it must equal the verified membership scope.
 if(teamId===undefined||cityId===undefined)return deny("SCOPE_REQUIRED");
 if(teamId.toLowerCase()!==team.id.toLowerCase()||cityId.toLowerCase()!==city.id.toLowerCase())return deny("SCOPE_MISMATCH");
 if(approval){
  if(approval.requestedBy===user.id||approval.targetUserId===user.id)return deny("SELF_APPROVAL");
  if(!isLeader)return deny("PRINCIPAL_MISMATCH");
 }
 return Object.freeze({ok:true,principal:Object.freeze({
  kind:isLeader?"team_leader":"staff",userId:user.id,staffRole:membership.staff_role,
  teamId:team.id,cityId:city.id,sessionId:readClaims(token).session_id})});
}
