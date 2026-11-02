// Byte-bounded raw Razorpay webhook intake. No DB/provider access.
// Must run BEFORE passing a body to HMAC verification. Do not log request data.
export const RAZORPAY_WEBHOOK_MAX_BYTES=65536;
const invalid=(code)=>Object.freeze({ok:false,code});
export async function readBoundedRazorpayWebhookBody(request){
 if(!request||typeof request!=="object"||!request.headers||
    typeof request.headers.get!=="function")return invalid("WEBHOOK_REQUEST_INVALID");
 const declared=request.headers.get("content-length");
 if(declared!==null){
  if(!/^\d{1,10}$/.test(declared))return invalid("WEBHOOK_LENGTH_INVALID");
  if(Number(declared)>RAZORPAY_WEBHOOK_MAX_BYTES)
   return invalid("WEBHOOK_BODY_TOO_LARGE");
 }
 if(!request.body||typeof request.body.getReader!=="function")
  return invalid("WEBHOOK_BODY_EMPTY");
 const reader=request.body.getReader();
 let total=0;const parts=[];
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))
    return invalid("WEBHOOK_BODY_INVALID");
   total+=value.byteLength;
   if(total>RAZORPAY_WEBHOOK_MAX_BYTES)
    return invalid("WEBHOOK_BODY_TOO_LARGE");
   parts.push(value);
  }
  if(total===0)return invalid("WEBHOOK_BODY_EMPTY");
  if(declared!==null&&Number(declared)!==total)
   return invalid("WEBHOOK_LENGTH_MISMATCH");
  const bytes=new Uint8Array(total);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
  let rawBody;
  try{rawBody=new TextDecoder("utf-8",{fatal:true}).decode(bytes)}
  catch{return invalid("WEBHOOK_BODY_UTF8_INVALID")}
  return Object.freeze({ok:true,rawBody});
 }catch{return invalid("WEBHOOK_BODY_READ_FAILED")}
 finally{try{reader.releaseLock()}catch{}}
}
