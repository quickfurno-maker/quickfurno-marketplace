/** An atomic bad-lead status RPC may commit even if the HTTP reply vanishes.
 * Bound waiting without retrying, asserting rollback, or creating a second
 * transaction. No provider send, cash credit or LEAD credit in this layer.
 */
export async function rc77BoundedAtomicBadLeadReview<T>(
 write:()=>PromiseLike<T>,timeoutMs=3500
):Promise<{completed:true;reply:T}|{completed:false}>{
 const ms=Number.isSafeInteger(timeoutMs)&&timeoutMs>=25&&timeoutMs<=5000
  ?timeoutMs:3500;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([
   Promise.resolve().then(write).then(reply=>({completed:true as const,reply})),
   new Promise<{completed:false}>(resolve=>{
    timer=setTimeout(()=>resolve({completed:false}),ms);
   })
  ]);
 }catch{
  return {completed:false};
 }finally{if(timer!==undefined)clearTimeout(timer);}
}
