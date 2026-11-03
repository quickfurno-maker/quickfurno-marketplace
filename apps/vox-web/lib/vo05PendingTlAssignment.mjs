export const TL_PENDING_KEY="qf.vox.pending-tl-assignment.v1";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===[...keys].sort().join("|");
export function validTlIntent(x){
 return exact(x,["itemId","targetStaffId","nonce","expectedRevision","reason"])&&
 [x.itemId,x.targetStaffId,x.nonce].every(v=>typeof v==="string"&&ID.test(v))&&
 Number.isSafeInteger(x.expectedRevision)&&x.expectedRevision>=0&&
 x.expectedRevision<=2147483646&&typeof x.reason==="string"&&
 x.reason.length<=200&&x.reason===x.reason.trim()&&
 !/[\u0000-\u001f\u007f]/.test(x.reason);
}
export function loadPendingTl(store){
 if(!store)return {available:false,pending:null};
 try{
  const raw=store.getItem(TL_PENDING_KEY);
  if(raw===null)return {available:true,pending:null};
  if(typeof raw!=="string"||raw.length>600)return {available:false,pending:null};
  const p=JSON.parse(raw);
  if(!validTlIntent(p))return {available:false,pending:null};
  return {available:true,pending:p};
 }catch{return {available:false,pending:null};}
}
export function savePendingTl(store,p){
 if(!validTlIntent(p)||!store)return false;
 const existing=loadPendingTl(store);
 if(!existing.available||existing.pending&&JSON.stringify(existing.pending)!==
   JSON.stringify(p))return false;
 try{
  store.setItem(TL_PENDING_KEY,JSON.stringify(p));
  return JSON.stringify(loadPendingTl(store).pending)===JSON.stringify(p);
 }catch{return false;}
}
export function clearPendingTl(store,p,receipt){
 if(!store||!validTlIntent(p))return false;
 const existing=loadPendingTl(store);
 if(!existing.available||JSON.stringify(existing.pending)!==JSON.stringify(p))return false;
 if(!exact(receipt,["ok","schema","itemId","targetStaffId","nonce",
  "revision","externalMessagesSent","vendorAssignmentsChanged","moneyMinorUnits"])||
  receipt.ok!==true||receipt.schema!=="qf.vox.tl.assignment.receipt.v1"||
  receipt.itemId!==p.itemId||receipt.targetStaffId!==p.targetStaffId||
  receipt.nonce!==p.nonce||receipt.revision!==p.expectedRevision+1||
  receipt.externalMessagesSent!==0||receipt.vendorAssignmentsChanged!==0||
  receipt.moneyMinorUnits!==0)return false;
 try{
  store.removeItem(TL_PENDING_KEY);
  const after=loadPendingTl(store);
  return after.available&&after.pending===null;
 }catch{return false;}
}
