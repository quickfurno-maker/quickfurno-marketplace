/**
 * AB-4: no identity provisioning here. A reviewed request is evidence only.
 * Current Superadmin AAL2 originates from Core Auth, Team Leader AAL2 from
 * current Core Staff grants, never from JSON caller claims.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const departments=new Set(["acquisition","vendor_success",
 "service_support","client_success"]);
const obj=x=>x&&typeof x==="object"&&!Array.isArray(x);
const exact=(o,names)=>obj(o)&&Object.keys(o).sort().join("|")===
 names.slice().sort().join("|");
const fail=reason=>({ok:false,reason,accountCreated:false,
 inviteSent:false,grantsActivated:false});
export function validateAb4StaffReviewRequest(body,{ownerId,now=Date.now()}={}){
 if(!exact(body,["action","requestId","nonce","reviewerId",
  "teamId","cityId","emailSha256","departments","expectedRosterRevision",
  "expiresAt"])||
  body.action!=="REQUEST"||!UUID.test(String(ownerId))||
  !UUID.test(String(body.requestId))||
  !UUID.test(String(body.nonce))||
  !UUID.test(String(body.reviewerId))||
  body.reviewerId===ownerId||
  !UUID.test(String(body.teamId))||
  !UUID.test(String(body.cityId))||
  !SHA.test(String(body.emailSha256))||
  !Array.isArray(body.departments)||body.departments.length<1||
  body.departments.length>4||
  !body.departments.every(x=>departments.has(x))||
  [...new Set(body.departments)].length!==body.departments.length||
  !Number.isSafeInteger(body.expectedRosterRevision)||
  body.expectedRosterRevision<0||
  typeof body.expiresAt!=="string"||
  !Number.isFinite(Date.parse(body.expiresAt))||
  Date.parse(body.expiresAt)<=now||
  Date.parse(body.expiresAt)>now+86400000)
  return fail("INVALID_STAFF_REQUEST_SHAPE");
 return {ok:true,state:"PENDING_INDEPENDENT_REVIEW",
  insert:{id:body.requestId,owner_id:ownerId,
   reviewer_id:body.reviewerId,team_id:body.teamId,city_id:body.cityId,
   email_sha256:body.emailSha256,
   department_packs:[...body.departments].sort(),nonce:body.nonce,
   expected_roster_revision:body.expectedRosterRevision,
   expires_at:new Date(Date.parse(body.expiresAt)).toISOString()},
  accountCreated:false,inviteSent:false,grantsActivated:false};
}
export function validateAb4StaffReviewDecision(body,{reviewerId}={}){
 if(!exact(body,["action","requestId","decision","decisionReference",
  "signatureSha256"])||
  body.action!=="REVIEW"||!UUID.test(String(reviewerId))||
  !UUID.test(String(body.requestId))||
  !UUID.test(String(body.decisionReference))||
  !["APPROVED","REJECTED"].includes(body.decision)||
  !SHA.test(String(body.signatureSha256)))
  return fail("INVALID_INDEPENDENT_DECISION");
 return {ok:true,
  insert:{request_id:body.requestId,reviewer_id:reviewerId,
   decision:body.decision,decision_reference:body.decisionReference,
   review_signature_sha256:body.signatureSha256},
  accountCreated:false,inviteSent:false,grantsActivated:false};
}
