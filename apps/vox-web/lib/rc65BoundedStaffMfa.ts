// Bounded pre-Core identity check: an unavailable GoTrue session never
// starts a Core transaction. The Core RPC has its own independent AAL2 gate.
export type StaffMfaCheck={completed:true;token:string|null}|{completed:false;token:null};
export async function rc65BoundedStaffMfa(
 verify:()=>Promise<string|null>,timeoutMs=1500):Promise<StaffMfaCheck>{
 const ms=Number.isSafeInteger(timeoutMs)&&timeoutMs>=25&&timeoutMs<=2500?timeoutMs:1500;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([
   Promise.resolve().then(verify).then(token=>({done:true as const,token})),
   new Promise<{done:false}>(resolve=>{
    timer=setTimeout(()=>resolve({done:false}),ms);
   })
  ]);
  if(!result.done)return {completed:false,token:null};
  if(result.token===null)return {completed:true,token:null};
  if(typeof result.token!=="string"||result.token.length<1||
     result.token.length>8192)return {completed:false,token:null};
  return {completed:true,token:result.token};
 }catch{return {completed:false,token:null};}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
