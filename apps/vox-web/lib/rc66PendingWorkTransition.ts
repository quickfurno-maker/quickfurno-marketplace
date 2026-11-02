/** Same-tab UX checkpoint for potentially committed Staff work commands.
 * This storage is NOT an authorization or durable Core transaction ledger.
 * Never store Staff JWT, customer data or provider message content here.
 */
export const PENDING_WORK_KEY="qf.vox.pending-work.v1";
export type PendingWork={itemId:string;nonce:string;action:"CLAIM"|"START"|"WAIT_EXTERNAL"|"REQUEST_APPROVAL"|"BLOCK"|"RESUME"|"COMPLETE";expectedRevision:number;reason:string};
type Store=Pick<Storage,"getItem"|"setItem">|null;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(["CLAIM","START","WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","RESUME","COMPLETE"]);
const valid=(v:unknown):v is PendingWork=>{
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const x=v as Record<string,unknown>;
 return Object.keys(x).sort().join("|")==="action|expectedRevision|itemId|nonce|reason"&&
  typeof x.itemId==="string"&&UUID.test(x.itemId)&&
  typeof x.nonce==="string"&&UUID.test(x.nonce)&&
  typeof x.action==="string"&&ACTIONS.has(x.action)&&
  Number.isSafeInteger(x.expectedRevision)&&Number(x.expectedRevision)>=0&&
  Number(x.expectedRevision)<=2147483646&&typeof x.reason==="string"&&
  x.reason.length<=300&&x.reason===x.reason.trim()&&
  (x.action!=="CLAIM"||x.reason==="")&&
  (!["BLOCK","REQUEST_APPROVAL","COMPLETE"].includes(x.action)||x.reason.length>=12);
};
export function readPendingWork(store:Store):{available:boolean;records:PendingWork[]}{
 if(!store)return {available:false,records:[]};
 try{
  const raw=store.getItem(PENDING_WORK_KEY);
  if(raw===null)return {available:true,records:[]};
  if(raw.length>18000)return {available:false,records:[]};
  const data:unknown=JSON.parse(raw);
  if(!Array.isArray(data)||data.length>40||data.some(x=>!valid(x))||
    new Set(data.map((x:PendingWork)=>x.itemId)).size!==data.length)
   return {available:false,records:[]};
  return {available:true,records:data};
 }catch{return {available:false,records:[]};}
}
export function savePendingWork(store:Store,record:PendingWork):boolean{
 if(!store||!valid(record))return false;
 const state=readPendingWork(store);if(!state.available)return false;
 const old=state.records.find(x=>x.itemId===record.itemId);
 if(old&&JSON.stringify(old)!==JSON.stringify(record))return false;
 if(!old){if(state.records.length>=40)return false;state.records.push(record);}
 try{
  store.setItem(PENDING_WORK_KEY,JSON.stringify(state.records));
  // Browser storage may silently ignore writes. Never submit a Core command
  // until the original nonce is independently read back from this tab.
  const verified=readPendingWork(store);
  return verified.available&&verified.records.length===state.records.length&&
   verified.records.every((x,i)=>JSON.stringify(x)===JSON.stringify(state.records[i]));
 }catch{return false;}
}
export function clearPendingWork(store:Store,itemId:string,nonce:string):boolean{
 if(!store||!UUID.test(itemId)||!UUID.test(nonce))return false;
 const state=readPendingWork(store);if(!state.available)return false;
 const old=state.records.find(x=>x.itemId===itemId);
 if(!old||old.nonce!==nonce)return false;
 try{
  const remaining=state.records.filter(x=>x.itemId!==itemId);
  store.setItem(PENDING_WORK_KEY,JSON.stringify(remaining));
  const verified=readPendingWork(store);
  return verified.available&&verified.records.length===remaining.length&&
   verified.records.every((x,i)=>JSON.stringify(x)===JSON.stringify(remaining[i]));
 }catch{return false;}
}
