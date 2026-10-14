import {createHash} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=new Set(["support_agent","vendor_success_agent","operations_manager"]);
const PRIORITIES=new Set(["low","medium","high"]);
export function normalizeScopedSupportTask(input,scope,now=Date.now()){
 if(!input||typeof input!=="object"||Array.isArray(input)||!scope||
    !UUID.test(scope.userId??"")||!UUID.test(scope.cityId??"")||
    !ROLES.has(scope.role)||!Array.isArray(scope.supportThreadIds))return null;
 if(Object.keys(input).some(k=>!["threadId","nonce","priority","dueAt"].includes(k))||
    !UUID.test(input.threadId??"")||!UUID.test(input.nonce??"")||
    !scope.supportThreadIds.includes(input.threadId)||!PRIORITIES.has(input.priority))return null;
 const due=typeof input.dueAt==="string"?Date.parse(input.dueAt):NaN;
 if(!Number.isFinite(due)||due<=now+5*60000||due>now+30*86400000)return null;
 const key="vox-desk-"+createHash("sha256").update(
  [scope.userId,input.threadId,input.nonce].join(":")).digest("hex");
 return Object.freeze({threadId:input.threadId,task_type:"complaint",
  title:"Follow up on assigned support case",priority:input.priority,
  due_at:new Date(due).toISOString(),idempotency_key:key});
}
