/** A "Valid" bad-lead status is eligibility for a later ONE LEAD credit.
 * Its metadata write may commit just as Owner AAL2 is revoked. Never claim
 * confirmation without a *second* bounded current Owner verification.
 * This routine does not grant credits or authorize any payment/money refund.
 */
type Reply={ok:boolean};
export async function rc70PostEligibilityOwnerAuthority<T extends Reply>(
 receipt:T,verify:()=>Promise<boolean>,timeoutMs=1250
):Promise<T|{ok:false;code:"ELIGIBILITY_OUTCOME_UNKNOWN";error:string}>{
 if(!receipt.ok)return receipt;
 const ms=Number.isSafeInteger(timeoutMs)&&timeoutMs>=25&&timeoutMs<=2500?timeoutMs:1250;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const r=await Promise.race([
   Promise.resolve().then(verify).then(ok=>({timedOut:false as const,ok})),
   new Promise<{timedOut:true}>(resolve=>{
    timer=setTimeout(()=>resolve({timedOut:true}),ms);
   })
  ]);
  if(!r.timedOut&&r.ok===true)return receipt;
 }catch{/* Failing closed does not prove the metadata write rolled back. */}
 finally{if(timer!==undefined)clearTimeout(timer);}
 return {ok:false,code:"ELIGIBILITY_OUTCOME_UNKNOWN",
  error:"Owner eligibility authority could not be verified after the report status write. Reconcile the original report before a new decision; no credit was granted by this action."};
}
