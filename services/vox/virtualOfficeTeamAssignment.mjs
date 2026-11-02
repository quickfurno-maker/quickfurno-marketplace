/**
 * VO3 Team Leader assignment adapter — source-only and OFF.
 * Core must independently prove real AAL2/neutral Staff, approved reviewer
 * identity, valid city/team and correct object grants under a DB transaction.
 * The existing Core work item remains canonical; vendor lead matching is NEVER
 * operated by this service. No provider, EOD, money or external sends.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=x=>typeof x==="string"&&UUID.test(x);
const deny=reason=>Object.freeze({ok:false,reason,applied:false});
const unknown=()=>Object.freeze({ok:false,reason:"TL_ASSIGNMENT_OUTCOME_UNKNOWN",
 committed:null,retrySameNonceOnly:true});
const exact=(o,k)=>Object.keys(o).sort().join("|")===[...k].sort().join("|");
export function validateTlAssignmentIntent(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||
    !exact(raw,["itemId","targetStaffId","nonce","expectedRevision","reason"])||
    !uuid(raw.itemId)||!uuid(raw.targetStaffId)||!uuid(raw.nonce)||
    !Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0||
    raw.expectedRevision>2147483646||typeof raw.reason!=="string"||
    raw.reason.length>200||raw.reason!==raw.reason.trim()||
    /[\u0000-\u001f\u007f]/.test(raw.reason))
  return deny("INVALID_TEAM_ASSIGNMENT_INTENT");
 return Object.freeze({ok:true,intent:Object.freeze({...raw})});
}
const leader=(s)=>s&&uuid(s.userId)&&uuid(s.teamId)&&uuid(s.cityId)&&
 s.role==="team_leader"&&s.canMutate===false&&s.canReadContent===false&&
 Array.isArray(s.verifiedDepartments)&&
 s.verifiedDepartments.every(x=>typeof x==="string");
const target=(s,l)=>s&&uuid(s.userId)&&uuid(s.teamId)&&uuid(s.cityId)&&
 s.userId!==l.userId&&s.teamId===l.teamId&&s.cityId===l.cityId&&
 s.active===true&&s.revoked===false&&s.verifiedNeutralStaff===true&&
 s.role!=="team_leader"&&s.role!=="auditor"&&
 Array.isArray(s.objectGrants)&&s.objectGrants.length<=200&&
 s.objectGrants.every(x=>x&&["prospect","vendor","support_thread"].includes(x.kind)&&uuid(x.id));
const grants=(t,w)=>t.objectGrants.some(x=>x.kind===w.sourceKind&&x.id===w.sourceId)&&
 (w.sourceKind!=="support_thread"||
  t.objectGrants.some(x=>x.kind==="vendor"&&x.id===w.relatedVendorId));
const work=(w,l,t,i)=>w&&uuid(w.id)&&w.id===i.itemId&&
 w.teamId===l.teamId&&w.cityId===l.cityId&&
 w.state==="NEW"&&w.assigneeId===null&&
 ["prospect","vendor","support_thread"].includes(w.sourceKind)&&uuid(w.sourceId)&&
 (w.sourceKind!=="support_thread"||uuid(w.relatedVendorId))&&grants(t,w);
const sameLeader=(a,b)=>leader(a)&&leader(b)&&
 ["userId","teamId","cityId","role","canMutate","canReadContent"].every(k=>a[k]===b[k])&&
 JSON.stringify([...a.verifiedDepartments].sort())===
 JSON.stringify([...b.verifiedDepartments].sort());
const sameTarget=(a,b,l,w)=>target(a,l)&&target(b,l)&&a.userId===b.userId&&
 grants(b,w)&&JSON.stringify([...a.objectGrants].sort((x,y)=>x.kind+x.id<y.kind+y.id?-1:1))===
 JSON.stringify([...b.objectGrants].sort((x,y)=>x.kind+x.id<y.kind+y.id?-1:1));

/**
 * Source-only guarded writer hook. durable Core SQL writer must atomically
 * recheck TL rights, target grants, one canonical work item, revision and nonce.
 */
export async function assignScopedTeamWork(raw,deps={}){
 const parsed=validateTlAssignmentIntent(raw);
 if(!parsed.ok)return parsed;
 if(deps.environment!=="staging"||deps.enabled?.()!==true||
    deps.reviewedWriterInstalled?.()!==true)
  return deny("TL_ASSIGNMENT_WRITER_NOT_CERTIFIED");
 if(typeof deps.currentLeader!=="function"||typeof deps.currentTarget!=="function"||
    typeof deps.currentWork!=="function"||typeof deps.rpc!=="function")
  return deny("TL_ASSIGNMENT_AUTHORITY_NOT_INSTALLED");
 const i=parsed.intent;
 let l,t,w;
 try{
  l=await deps.currentLeader();
  if(!leader(l))return deny("CURRENT_TEAM_LEADER_AAL2_REQUIRED");
  t=await deps.currentTarget(i.targetStaffId);
  if(!target(t,l)||t.userId!==i.targetStaffId)return deny("TARGET_STAFF_SCOPE_DENIED");
  w=await deps.currentWork(i.itemId);
  if(!work(w,l,t,i))return deny("CURRENT_WORK_OR_TARGET_GRANT_DENIED");
 }catch{return deny("CURRENT_ASSIGNMENT_SOURCE_UNAVAILABLE");}
 let receipt;
 try{
  receipt=await deps.rpc("qf_vox_tl_assign_work_candidate_v1",{
   p_leader:l.userId,p_target:t.userId,p_item:w.id,
   p_expected_revision:i.expectedRevision,p_nonce:i.nonce,p_reason:i.reason
  });
 }catch{return unknown();}
 if(receipt?.error||!Array.isArray(receipt?.data)||receipt.data.length!==1)
  return unknown();
 const r=receipt.data[0];
 if(!r||typeof r!=="object"||Array.isArray(r)||
  !exact(r,["item_id","leader_id","target_id","nonce","revision","new_state",
    "external_messages_sent","vendor_assignments_changed","money_minor_units"])||
  r.item_id!==i.itemId||r.leader_id!==l.userId||
  r.target_id!==i.targetStaffId||r.nonce!==i.nonce||
  r.revision!==i.expectedRevision+1||r.new_state!=="ASSIGNED"||
  r.external_messages_sent!==0||r.vendor_assignments_changed!==0||
  r.money_minor_units!==0)return unknown();
 try{
  const latestLeader=await deps.currentLeader();
  const latestTarget=await deps.currentTarget(i.targetStaffId);
  if(!sameLeader(l,latestLeader)||!sameTarget(t,latestTarget,l,w))return unknown();
 }catch{return unknown();}
 return Object.freeze({ok:true,applied:true,itemId:i.itemId,
  targetStaffId:i.targetStaffId,nonce:i.nonce,revision:r.revision,
  externalMessagesSent:0,vendorAssignmentsChanged:0,moneyMinorUnits:0});
}
