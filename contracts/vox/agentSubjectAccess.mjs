// Pure, fail-closed VOX-14 request contract. No user-supplied authority flags.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds=Object.freeze({AAROHI:"prospect",ANISHA:"vendor"});
const roles=Object.freeze({AAROHI:["acquisition_agent","operations_manager"],
 ANISHA:["vendor_success_agent","support_agent","operations_manager"]});
export const SCHEMA="qf.vox.agent.subject.access.v1";
export function normalizeAgentSubjectAccess(input,scope){
 if(!input||typeof input!=="object"||Array.isArray(input)||!scope||
  !UUID.test(scope.userId??"")||!UUID.test(scope.cityId??"")||
  scope.canReadContent!==true||
  Object.keys(input).some(k=>!["agent","subjectType","subjectId","revision"].includes(k)))return null;
 const {agent,subjectType,subjectId,revision}=input;
 if(!Object.hasOwn(kinds,agent)||subjectType!==kinds[agent]||
  !UUID.test(subjectId??"")||!Number.isSafeInteger(revision)||
  revision<0||revision>2147483647||!roles[agent].includes(scope.role))return null;
 const assigned=agent==="AAROHI"?scope.prospectIds:scope.vendorIds;
 if(!Array.isArray(assigned)||!assigned.includes(subjectId)||!Array.isArray(scope.conversationIds)||
    scope.conversationIds.length===0||scope.conversationIds.length>200)return null;
 return Object.freeze({agent,subjectType,subjectId,revision});
}
export function hasHumanCoreConversation(rows,request,scope){
 if(!Array.isArray(rows)||rows.length!==1||!request||!scope)return false;
 const r=rows[0];
 return Boolean(r&&scope.conversationIds.includes(r.id)&&r.subject_type===request.subjectType&&
   r.subject_id===request.subjectId&&r.state==="HUMAN"&&r.human_takeover===true&&
   r.revision===request.revision);
}
