const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS=new Set(["taskId","action","result"]);
const clean=v=>typeof v==="string"?v.trim().replace(/\s+/g," "):"";
// Native Vendor CRM task lifecycle only: complete (needs a result) or cancel.
// No reopen, no edit, no vendor/consent/WhatsApp/credit fields can be expressed.
export function normalizeVendorTaskTransition(input,scope){
 if(!scope||!UUID.test(scope.userId??"")||!UUID.test(scope.cityId??"")||
   !["operations_manager","vendor_success_agent"].includes(scope.role)||
   !Array.isArray(scope.vendorIds)||!input||typeof input!=="object"||Array.isArray(input))return null;
 if(Object.keys(input).some(k=>!KEYS.has(k))||!UUID.test(input.taskId??""))return null;
 if(input.action==="cancel"){
  if("result" in input)return null;
  return Object.freeze({taskId:input.taskId,action:"cancel",status:"cancelled",result:null});
 }
 if(input.action!=="complete")return null;
 const result=clean(input.result);
 if(result.length<8||result.length>300||/[\u0000-\u001f]/.test(result))return null;
 return Object.freeze({taskId:input.taskId,action:"complete",status:"done",result});
}
