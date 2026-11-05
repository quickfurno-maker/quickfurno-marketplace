/**
 * Phase 2: bounded actual-byte JSON reader for vendor OTP/signup.
 * A browser or HTTP/2 gateway may omit Content-Length. A forged low value
 * never weakens the actual stream limit. No Auth/Storage/provider side effects.
 */
export type BoundedVendorJson =
  | { readonly ok:true; readonly value:unknown }
  | { readonly ok:false; readonly reason:"too_large"|"invalid" };

export function invalidDeclaredVendorLength(value:string|null,maxBytes:number):boolean {
 if(value===null)return false; // actual bytes are still bounded during read
 if(!/^[1-9][0-9]*$/.test(value))return true;
 const parsed=Number(value);
 return !Number.isSafeInteger(parsed)||parsed>maxBytes;
}

export async function readBoundedVendorJson(request:Request,maxBytes:number):Promise<BoundedVendorJson> {
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)return {ok:false,reason:"invalid"};
 if(invalidDeclaredVendorLength(request.headers.get("content-length"),maxBytes))
  return {ok:false,reason:"too_large"};
 const reader=request.body?.getReader();
 if(!reader)return {ok:false,reason:"invalid"};
 const chunks:Uint8Array[]=[];
 let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array)){
    await reader.cancel().catch(()=>{});
    return {ok:false,reason:"invalid"};
   }
   total+=value.byteLength;
   if(total>maxBytes){
    await reader.cancel().catch(()=>{});
    return {ok:false,reason:"too_large"};
   }
   chunks.push(value);
  }
 }catch{return {ok:false,reason:"invalid"};}
 finally{reader.releaseLock();}
 if(!total)return {ok:false,reason:"invalid"};
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{
  const decoded=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  const value:unknown=JSON.parse(decoded);
  return {ok:true,value};
 }catch{return {ok:false,reason:"invalid"};}
 finally{bytes.fill(0);}
}
