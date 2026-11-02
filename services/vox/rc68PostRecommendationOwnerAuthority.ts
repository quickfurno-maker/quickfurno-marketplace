// This is human-review metadata, not a credit grant. A receipt can arrive
// after the Owner's AAL2 authority was revoked. Never report it as confirmed.
type Reply={ok:boolean};
export async function rc68PostRecommendationOwnerAuthority<T extends Reply>(
 receipt:T, verify:()=>Promise<boolean>, timeoutMs=1250
):Promise<T|{ok:false;code:"RECOMMEND_OUTCOME_UNKNOWN";error:string}>{
 if(!receipt.ok)return receipt;
 const ms=Number.isSafeInteger(timeoutMs)&&timeoutMs>=25&&timeoutMs<=2500?timeoutMs:1250;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([
   Promise.resolve().then(verify).then(ok=>({timedOut:false as const,ok})),
   new Promise<{timedOut:true}>(resolve=>{
    timer=setTimeout(()=>resolve({timedOut:true}),ms);
   })
  ]);
  if(!result.timedOut&&result.ok===true)return receipt;
 }catch{/* Do not leak identity errors or assume a metadata rollback. */}
 finally{if(timer!==undefined)clearTimeout(timer);}
 return {ok:false,code:"RECOMMEND_OUTCOME_UNKNOWN",
  error:"Owner authority could not be verified after recommendation. Reconcile the exact original report before a new decision."};
}
