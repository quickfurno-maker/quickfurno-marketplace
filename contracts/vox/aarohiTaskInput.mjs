// The Staff-only Aarohi write is intentionally narrower than the existing
// Admin CRM interface. This parser never accepts browser-supplied actor, role,
// city, team, recipient, message, external channel or task reason.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeScopedAarohiTask(input,scope,now=Date.now()){
 if(!input||typeof input!=="object"||Array.isArray(input)||!scope||
    scope.role!=="acquisition_agent"||scope.canReadContent!==true||
    !UUID.test(scope.userId??"")||!UUID.test(scope.teamId??"")||
    !UUID.test(scope.cityId??"")||!Array.isArray(scope.prospectIds))return null;
 if(Object.keys(input).some(k=>!["prospectId","nonce","priority","dueAt"].includes(k))||
    !UUID.test(input.prospectId??"")||!UUID.test(input.nonce??"")||
    !scope.prospectIds.includes(input.prospectId)||
    !["NORMAL","HIGH"].includes(input.priority))return null;
 const due=typeof input.dueAt==="string"?Date.parse(input.dueAt):NaN;
 if(!Number.isFinite(due)||due<=now+5*60000||due>now+30*86400000)return null;
 return Object.freeze({prospectId:input.prospectId,nonce:input.nonce,
   priority:input.priority,due_at:new Date(due).toISOString()});
}
