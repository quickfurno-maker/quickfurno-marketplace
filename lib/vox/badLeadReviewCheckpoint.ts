/** Same-tab only guard: a local checkpoint never grants credit/money.
 * Any unverifiable write blocks further decisions until manual reconciliation.
 */
export const BAD_LEAD_REVIEW_CHECKPOINT_KEY="qf.vox.bad-lead-pending.v1";
type Store=Pick<Storage,"getItem"|"setItem">|null;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ReadCheckpoint={available:boolean;locked:Set<string>};
export function readBadLeadReviewCheckpoint(storage:Store):ReadCheckpoint{
 if(!storage)return {available:false,locked:new Set()};
 try{
  const raw=storage.getItem(BAD_LEAD_REVIEW_CHECKPOINT_KEY);
  if(raw===null)return {available:true,locked:new Set()};
  if(raw.length>4000)return {available:false,locked:new Set()};
  const decoded:unknown=JSON.parse(raw);
  if(!Array.isArray(decoded)||decoded.length>64||
   decoded.some(item=>typeof item!=="string"||!UUID.test(item))||
   new Set(decoded).size!==decoded.length)
   return {available:false,locked:new Set()};
  return {available:true,locked:new Set(decoded)};
 }catch{return {available:false,locked:new Set()};}
}
export function markBadLeadPending(storage:Store,reportId:string):boolean{
 if(!storage||!UUID.test(reportId))return false;
 const checkpoint=readBadLeadReviewCheckpoint(storage);
 if(!checkpoint.available)return false;
 checkpoint.locked.add(reportId);
 if(checkpoint.locked.size>64)return false;
 try{
  storage.setItem(BAD_LEAD_REVIEW_CHECKPOINT_KEY,JSON.stringify([...checkpoint.locked].sort()));
  const actual=readBadLeadReviewCheckpoint(storage);
  return actual.available&&actual.locked.size===checkpoint.locked.size&&
   actual.locked.has(reportId);
 }catch{return false;}
}
export function clearBadLeadPending(storage:Store,reportId:string):boolean{
 if(!storage||!UUID.test(reportId))return false;
 const checkpoint=readBadLeadReviewCheckpoint(storage);
 if(!checkpoint.available||!checkpoint.locked.has(reportId))return false;
 checkpoint.locked.delete(reportId);
 try{
  storage.setItem(BAD_LEAD_REVIEW_CHECKPOINT_KEY,JSON.stringify([...checkpoint.locked].sort()));
  const actual=readBadLeadReviewCheckpoint(storage);
  return actual.available&&actual.locked.size===checkpoint.locked.size&&
   !actual.locked.has(reportId);
 }catch{return false;}
}
