import {createHash} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_TYPES=new Set(["onboarding","documents","verification","complaint","campaign_response_followup","general"]);
const PRIORITIES=new Set(["low","medium","high"]);
const KEYS=new Set(["vendorId","nonce","taskType","title","priority","dueAt"]);
export function normalizeScopedVendorTask(input,scope,now=Date.now()){
 if(!scope||!UUID.test(scope.userId??"")||!UUID.test(scope.cityId??"")||
   !["operations_manager","vendor_success_agent"].includes(scope.role)||
   !Array.isArray(scope.vendorIds)||!input||typeof input!=="object"||Array.isArray(input))return null;
 if(Object.keys(input).some(k=>!KEYS.has(k))||
    !UUID.test(input.vendorId??"")||!scope.vendorIds.includes(input.vendorId)||
    !UUID.test(input.nonce??"")||!TASK_TYPES.has(input.taskType)||
    !PRIORITIES.has(input.priority))return null;
 const title=typeof input.title==="string"?input.title.trim().replace(/\s+/g," "):"";
 if(title.length<8||title.length>120||/[\u0000-\u001f]/.test(title))return null;
 const due=typeof input.dueAt==="string"?Date.parse(input.dueAt):NaN;
 if(!Number.isFinite(due)||due<=now+5*60*1000||due>now+90*86400000)return null;
 const idempotency_key="vox-"+createHash("sha256").update(
  [scope.userId,input.vendorId,input.nonce].join(":")).digest("hex");
 return Object.freeze({vendorId:input.vendorId,idempotency_key,
  task_type:input.taskType,title,priority:input.priority,due_at:new Date(due).toISOString()});
}
