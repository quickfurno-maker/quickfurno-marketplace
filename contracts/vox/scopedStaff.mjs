// VOX-03 pure, fail-closed object-scoped Core staff authority.
// Does not accept a browser role or claim. Inputs MUST be from Core-authenticated
// server-side profiles, membership, team and active grants.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=new Set(["operations_manager","acquisition_agent","vendor_success_agent","support_agent","auditor"]);
const KINDS=new Set(["prospect","vendor","support_thread","conversation"]);
function uuid(s){return typeof s==="string"&&UUID.test(s);}
function live(until,now){const n=Date.parse(String(until??""));return Number.isFinite(n)&&n>now;}
export function resolveScopedStaff({userId,identityVerified,membership,team,grants,now=Date.now()}) {
 if(!identityVerified||!uuid(userId)||!membership||membership.auth_user_id!==userId||
    membership.is_active!==true||membership.revoked_at!==null||!ROLES.has(membership.staff_role)||
    !uuid(membership.team_id)||!live(membership.expires_at,now))return null;
 if(!team||team.id!==membership.team_id||team.is_active!==true||!uuid(team.city_id))return null;
 if(!Array.isArray(grants)||grants.length>200)return null;
 const permitted={prospect:new Set(),vendor:new Set(),support_thread:new Set(),conversation:new Set()};
 for(const row of grants){
  if(!row||row.auth_user_id!==userId||!KINDS.has(row.scope_kind)||!uuid(row.object_id)||
      row.revoked_at!==null||!live(row.expires_at,now))continue;
  permitted[row.scope_kind].add(row.object_id);
 }
 const role=membership.staff_role;
 // An assignment never overrides a role restriction; all staff are object scoped.
 const allowed={
   prospect:role==="acquisition_agent"||role==="operations_manager"||role==="auditor",
   vendor:role==="vendor_success_agent"||role==="operations_manager"||role==="auditor"||role==="support_agent",
   support_thread:role==="vendor_success_agent"||role==="operations_manager"||role==="support_agent",
   conversation:role==="vendor_success_agent"||role==="acquisition_agent"||role==="operations_manager"||role==="support_agent",
 };
 return Object.freeze({userId,role,teamId:team.id,cityId:team.city_id,
   prospectIds:Object.freeze(allowed.prospect?[...permitted.prospect].slice(0,200):[]),
   vendorIds:Object.freeze(allowed.vendor?[...permitted.vendor].slice(0,200):[]),
   supportThreadIds:Object.freeze(allowed.support_thread?[...permitted.support_thread].slice(0,200):[]),
   conversationIds:Object.freeze(allowed.conversation?[...permitted.conversation].slice(0,200):[]),
   canReadContent:role!=="auditor",canMutate:false,
 });
}
export function filterHumanConversations(rows,context,validatedProspectIds,validatedVendorIds){
 if(!context||!Array.isArray(rows))return Object.freeze([]);
 const p=new Set(validatedProspectIds),v=new Set(validatedVendorIds),c=new Set(context.conversationIds);
 return Object.freeze(rows.filter(r=>r&&c.has(r.id)&&r.state==="HUMAN"&&r.human_takeover===true&&(
   (r.subject_type==="prospect"&&p.has(r.subject_id))||
   (r.subject_type==="vendor"&&v.has(r.subject_id))
 )).map(r=>Object.freeze({id:r.id,subject_type:r.subject_type,state:r.state,
   human_takeover:true,revision:r.revision,updated_at:r.updated_at})).slice(0,8));
}
