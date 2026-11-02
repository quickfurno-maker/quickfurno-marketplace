// A single browser tab must never silently mint a second decision nonce after
// refresh, lost HTTP or revoked AAL2. This is a *local checkpoint*, not proof
// that Core committed or rolled back the first request.
const KEY="qf.vox.pending-tl-review.v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const valid=r=>r&&typeof r==="object"&&!Array.isArray(r)&&
 Object.keys(r).sort().join("|")==="decision|nonce|reportId"&&
 UUID.test(r.reportId)&&UUID.test(r.nonce)&&
 ["ACKNOWLEDGED","REJECTED"].includes(r.decision);
export function readPendingTlReviews(store){
 if(!store)return {available:false,records:[]};
 try{
  const s=store.getItem(KEY);
  if(s===null)return {available:true,records:[]};
  if(typeof s!=="string"||s.length>6000)return {available:false,records:[]};
  const list=JSON.parse(s);
  if(!Array.isArray(list)||list.length>16||list.some(x=>!valid(x))||
   new Set(list.map(x=>x.reportId)).size!==list.length)return {available:false,records:[]};
  return {available:true,records:list};
 }catch{return {available:false,records:[]};}
}
export function savePendingTlReview(store,row){
 if(!valid(row))return false;
 const state=readPendingTlReviews(store);if(!state.available)return false;
 const prior=state.records.find(x=>x.reportId===row.reportId);
 if(prior&&(prior.decision!==row.decision||prior.nonce!==row.nonce))return false;
 const next=prior?state.records:[...state.records,row];
 if(next.length>16)return false;
 try{
  store.setItem(KEY,JSON.stringify(next));
  const actual=readPendingTlReviews(store);
  return actual.available&&actual.records.length===next.length&&
   actual.records.every((x,i)=>JSON.stringify(x)===JSON.stringify(next[i]));
 }catch{return false;}
}
export function clearPendingTlReview(store,row){
 if(!valid(row))return false;
 const state=readPendingTlReviews(store);if(!state.available)return false;
 if(!state.records.some(x=>x.reportId===row.reportId&&x.nonce===row.nonce&&x.decision===row.decision))return false;
 const next=state.records.filter(x=>x.reportId!==row.reportId);
 try{
  if(next.length)store.setItem(KEY,JSON.stringify(next));
  else store.removeItem(KEY);
  const after=readPendingTlReviews(store);
  return after.available&&after.records.length===next.length&&
   after.records.every((x,i)=>JSON.stringify(x)===JSON.stringify(next[i]));
 }catch{return false;}
}
