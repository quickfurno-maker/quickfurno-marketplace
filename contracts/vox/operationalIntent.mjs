const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed={AAROHI_FOLLOWUP:["acquisition_agent","operations_manager"],
 VENDOR_PROFILE_CHANGE:["vendor_success_agent","operations_manager"],
 SUPPORT_REPLY:["support_agent","vendor_success_agent","operations_manager"]};
const kinds={AAROHI_FOLLOWUP:"prospect",VENDOR_PROFILE_CHANGE:"vendor",SUPPORT_REPLY:"support_thread"};
export function normalizeOperationalIntent(input,scope){
 if(!input||typeof input!=="object"||Array.isArray(input)||!scope||!scope.userId)return null;
 const fields=["actionKind","targetId","nonce","rationale"];
 if(Object.keys(input).some(k=>!fields.includes(k)))return null;
 if(!UUID.test(input.targetId??"")||!UUID.test(input.nonce??"")||
    !allowed[input.actionKind]?.includes(scope.role))return null;
 const kind=kinds[input.actionKind];
 if(!({prospect:scope.prospectIds,vendor:scope.vendorIds,
   support_thread:scope.supportThreadIds}[kind]??[]).includes(input.targetId))return null;
 const rationale=typeof input.rationale==="string"?input.rationale.trim().replace(/\s+/g," "):"";
 if(rationale.length<12||rationale.length>300||/[\u0000-\u001f]/.test(rationale))return null;
 return Object.freeze({requester_id:scope.userId,team_id:scope.teamId,city_id:scope.cityId,
  action_kind:input.actionKind,target_kind:kind,target_id:input.targetId,
  nonce:input.nonce,rationale});
}
