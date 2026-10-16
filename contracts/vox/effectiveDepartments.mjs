// VOX TO-02E: Core-only effective staff scope intersection. Pure/NO database writes.
// Input rows MUST come from Core service-role reads AFTER remote Supabase AAL2 verification.
// This function never treats a department grant as source-object authorization.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKS=new Set(["client_success","vendor_success","acquisition","service_support"]);
const id=x=>typeof x==="string"&&UUID.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const until=(x,now)=>typeof x==="string"&&Number.isFinite(Date.parse(x))&&Date.parse(x)>now;
const closed=()=>null;
/** Reuse authenticated Core scoped object IDs, never union grants.
 * Client subjects and external human inbox are intentionally DENIED until
 * canonical Core owner-verified subject and consent/handover joins exist.
 * TL/auditor never receives subject content from this resolver.
 */
export function restrictScopedStaffByDepartment({scoped,capabilities,requests,decisions,activations,reviewers,now=Date.now()}={}){
 if(!obj(scoped)||!id(scoped.userId)||!id(scoped.teamId)||!id(scoped.cityId)||
    !Number.isSafeInteger(now)||now<=0||
    !Array.isArray(capabilities)||capabilities.length>16||
    !Array.isArray(requests)||requests.length>16||
    !Array.isArray(decisions)||decisions.length>16||
    !Array.isArray(activations)||activations.length>16||
    !Array.isArray(reviewers)||reviewers.length>16)return closed();
 for(const key of ["prospectIds","vendorIds","supportThreadIds","conversationIds"]){
  if(!Array.isArray(scoped[key])||scoped[key].length>200||
     scoped[key].some(x=>!id(x)))return closed();
 }
 const req=new Map(), dec=new Map(), act=new Map(), packs=new Set(),liveReviewers=new Map();
 for(const proof of reviewers){
  if(!obj(proof)||!id(proof.userId)||liveReviewers.has(proof.userId)||
     proof.userId===scoped.userId||proof.role!==null||
     proof.isActive!==true||proof.qfPrincipal!=="vox_staff"||
     proof.adminRole!==null||proof.voxRole!=="team_leader"||
     proof.staffRole!=="team_leader"||proof.membershipActive!==true||
     proof.revokedAt!==null||proof.teamId!==scoped.teamId||
     proof.cityId!==scoped.cityId||proof.teamActive!==true||
     !until(proof.expiresAt,now))return closed();
  liveReviewers.set(proof.userId,true);
 }
 for(const row of requests){
  if(!obj(row)||!id(row.id)||req.has(row.id))return closed();
  req.set(row.id,row);
 }
 for(const row of decisions){
  if(!obj(row)||!id(row.request_id)||dec.has(row.request_id))return closed();
  dec.set(row.request_id,row);
 }
 for(const row of activations){
  if(!obj(row)||!id(row.capability_id)||act.has(row.capability_id))return closed();
  act.set(row.capability_id,row);
 }
 const seen=new Set();
 for(const g of capabilities){
  if(!obj(g)||!id(g.id)||seen.has(g.id))return closed();
  seen.add(g.id);
  if(g.auth_user_id!==scoped.userId||g.team_id!==scoped.teamId||
     g.city_id!==scoped.cityId||!PACKS.has(g.department)||
     g.revoked_at!==null||g.revision!==2||
     !until(g.expires_at,now)||!id(g.request_id)||!id(g.granted_by))return closed();
  const r=req.get(g.request_id),d=dec.get(g.request_id),a=act.get(g.id);
  if(!r||!d||!a||r.id!==g.request_id||r.target_staff_id!==scoped.userId||
     r.team_id!==scoped.teamId||r.city_id!==scoped.cityId||
     r.department!==g.department||r.state!=="APPROVED"||r.revision!==1||
     !until(r.expires_at,now)||r.requested_by!==g.granted_by||
     !id(r.decided_by)||r.decided_by===r.requested_by||
     r.decided_by===r.target_staff_id||!liveReviewers.has(r.decided_by)||
     d.reviewer_id!==r.decided_by||
     d.decision!=="APPROVED"||d.decision_reference!==r.decision_reference||
     a.request_id!==r.id||a.capability_id!==g.id||
     a.activated_by!==g.granted_by)return closed();
  packs.add(g.department);
 }
 const leader=scoped.role==="team_leader"||scoped.role==="auditor";
 const prospect=leader||!packs.has("acquisition")?[]:scoped.prospectIds;
 const vendor=leader||!(packs.has("vendor_success")||packs.has("service_support"))?[]:scoped.vendorIds;
 const support=leader||!packs.has("service_support")?[]:scoped.supportThreadIds;
 // External conversations require a second Core consent+subject proof per item.
 return Object.freeze({...scoped,
  prospectIds:Object.freeze([...prospect]),vendorIds:Object.freeze([...vendor]),
  supportThreadIds:Object.freeze([...support]),conversationIds:Object.freeze([]),
  verifiedDepartments:Object.freeze([...packs].sort()),
  canReadContent:!leader&&scoped.canReadContent===true,canMutate:false});
}
