/**
 * Byte-limited MFA JSON intake. A large request must be rejected BEFORE
 * parsing or allocating an unbounded string, irrespective of Content-Length.
 * Never log, persist, hash or return TOTP codes. No Auth/session side effects.
 */
export type MfaJsonIntake =
 | {ok:true;value:unknown}
 | {ok:false;reason:"too_large"|"invalid"};
export async function readBoundedOwnerMfaJson(request:Request,maxBytes=256):Promise<MfaJsonIntake>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)return {ok:false,reason:"invalid"};
 const declared=request.headers.get("content-length");
 if(declared!==null){
  if(!/^[1-9][0-9]*$/.test(declared)||!Number.isSafeInteger(Number(declared))||
     Number(declared)>maxBytes)return {ok:false,reason:"too_large"};
 }
 const reader=request.body?.getReader();
 if(!reader)return {ok:false,reason:"invalid"};
 const chunks:Uint8Array[]=[];
 let bytes=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array)){await reader.cancel().catch(()=>{});return {ok:false,reason:"invalid"};}
   bytes+=value.byteLength;
   if(bytes>maxBytes){await reader.cancel().catch(()=>{});return {ok:false,reason:"too_large"};}
   chunks.push(value);
  }
 }catch{return {ok:false,reason:"invalid"};}
 finally{reader.releaseLock();}
 if(!bytes)return {ok:false,reason:"invalid"};
 const buffer=new Uint8Array(bytes);
 let at=0;
 for(const chunk of chunks){buffer.set(chunk,at);at+=chunk.byteLength;}
 try{
  const decoded=new TextDecoder("utf-8",{fatal:true}).decode(buffer);
  const parsed:unknown=JSON.parse(decoded);
  return {ok:true,value:parsed};
 }catch{return {ok:false,reason:"invalid"};}
 finally{buffer.fill(0);}
}
