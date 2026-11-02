// A successful SQL receipt does not prove the Owner's AAL2 authority
// survived the in-flight mutation. Recheck same actor; never claim rollback.
// Only canonical one-credit restoration or rejection can reach this
// post-commit Owner authority recheck; legacy replacement enums are forbidden.
type Action="restore_credit"|"reject";
type Reply={ok:boolean};
type Unknown=Readonly<{ok:false;code:"CREDIT_OUTCOME_UNKNOWN"|"REJECT_OUTCOME_UNKNOWN";
 error:string}>;
export async function rc65PostCreditOwnerAuthority<T extends Reply>(
 reply:T,action:Action,verify:()=>Promise<boolean>,timeoutMs=1250
):Promise<T|Unknown>{
 if(!reply.ok)return reply;
 const deadline=Number.isSafeInteger(timeoutMs)&&timeoutMs>=25&&timeoutMs<=2500?timeoutMs:1250;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let accepted=false;
 try{
  const outcome=await Promise.race([
   Promise.resolve().then(verify).then(ok=>({expired:false as const,ok})),
   new Promise<{expired:true}>(resolve=>{
    timer=setTimeout(()=>resolve({expired:true}),deadline);
   })
  ]);
  accepted=!outcome.expired&&outcome.ok===true;
 }catch{/* A late exception cannot prove rollback. */}
 finally{if(timer!==undefined)clearTimeout(timer);}
 if(accepted)return reply;
 return {ok:false,
  code:action==="restore_credit"?"CREDIT_OUTCOME_UNKNOWN":"REJECT_OUTCOME_UNKNOWN",
  error:"Owner authority unavailable after a possible canonical mutation. Reconcile the exact original assignment and report before any new decision."};
}
