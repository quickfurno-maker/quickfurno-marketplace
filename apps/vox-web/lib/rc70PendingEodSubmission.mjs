// Staff partial EOD: same-tab retry nonce, including across refresh.
// The client never certifies a Core commit, official EOD or provider activity.
const KEY="qf.vox.pending-partial-eod.v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const valid=r=>r&&typeof r==="object"&&!Array.isArray(r)&&
 Object.keys(r).sort().join("|")==="businessDate|nonce"&&
 typeof r.nonce==="string"&&UUID.test(r.nonce)&&
 typeof r.businessDate==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(r.businessDate);
export function indiaBusinessDate(now=new Date()){
 return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
  year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
export function readPendingEodSubmission(store){
 if(!store)return {available:false,pending:null};
 try{
  const raw=store.getItem(KEY);
  if(raw===null)return {available:true,pending:null};
  if(typeof raw!=="string"||raw.length>220)return {available:false,pending:null};
  const p=JSON.parse(raw);
  return valid(p)?{available:true,pending:p}:{available:false,pending:null};
 }catch{return {available:false,pending:null};}
}
export function savePendingEodSubmission(store,row){
 if(!valid(row))return false;
 const old=readPendingEodSubmission(store);
 if(!old.available||(old.pending&&
   (old.pending.nonce!==row.nonce||old.pending.businessDate!==row.businessDate)))return false;
 try{
  store.setItem(KEY,JSON.stringify(row));
  const saved=readPendingEodSubmission(store);
  return saved.available&&saved.pending?.nonce===row.nonce&&
   saved.pending?.businessDate===row.businessDate;
 }catch{return false;}
}
export function clearPendingEodSubmission(store,row){
 if(!valid(row))return false;
 const old=readPendingEodSubmission(store);
 if(!old.available||old.pending?.nonce!==row.nonce||
    old.pending?.businessDate!==row.businessDate)return false;
 try{
  store.removeItem(KEY);
  const after=readPendingEodSubmission(store);
  return after.available&&after.pending===null;
 }catch{return false;}
}
