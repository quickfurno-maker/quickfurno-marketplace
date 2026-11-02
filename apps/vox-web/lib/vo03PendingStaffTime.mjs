import {validateTimeCommand} from "../../../contracts/vox/virtualOfficeTimekeeping.mjs";
/**
 * Local single-tab recovery guard for time actions that may have reached Core.
 * Not an attendance ledger, server authority, or proof of successful work.
 * Do not use browser time for billing; do not store JWTs or personal details.
 */
export const VO_PENDING_TIME_KEY="qf.vox.pending-time-command.v1";
export function readPendingTimeCommand(store){
 if(!store)return {available:false,pending:null};
 try{
  const raw=store.getItem(VO_PENDING_TIME_KEY);
  if(raw===null)return {available:true,pending:null};
  if(typeof raw!=="string"||raw.length>512)
   return {available:false,pending:null};
  const item=JSON.parse(raw);
  const valid=validateTimeCommand(item);
  if(!valid.ok)return {available:false,pending:null};
  return {available:true,pending:valid.command};
 }catch{return {available:false,pending:null};}
}
export function savePendingTimeCommand(store,item){
 const parsed=validateTimeCommand(item);
 if(!store||!parsed.ok)return false;
 const existing=readPendingTimeCommand(store);
 if(!existing.available)return false;
 if(existing.pending&&JSON.stringify(existing.pending)!==
    JSON.stringify(parsed.command))return false;
 try{
  store.setItem(VO_PENDING_TIME_KEY,JSON.stringify(parsed.command));
  const readback=readPendingTimeCommand(store);
  return readback.available&&
   JSON.stringify(readback.pending)===JSON.stringify(parsed.command);
 }catch{return false;}
}
export function clearPendingTimeCommand(store,item,receipt){
 const parsed=validateTimeCommand(item);
 if(!store||!parsed.ok)return false;
 const current=readPendingTimeCommand(store);
 if(!current.available||!current.pending||
    JSON.stringify(current.pending)!==JSON.stringify(parsed.command))
  return false;
 // Clear only after a server-authoritative, exactly matched Core receipt.
 if(!receipt||typeof receipt!=="object"||Array.isArray(receipt)||
   Object.keys(receipt).sort().join("|")!==
    "eventId|moneyMinorUnits|nonce|occurredAt|ok|productionCertified|providerMessagesSent|revision|schema"||
   receipt.schema!=="qf.vox.staff.time.receipt.v1"||
   receipt.ok!==true||
   receipt.nonce!==parsed.command.nonce||
   receipt.revision!==parsed.command.expectedRevision+1||
   typeof receipt.eventId!=="string"||
   !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.eventId)||
   typeof receipt.occurredAt!=="string"||
   !Number.isFinite(Date.parse(receipt.occurredAt))||
   receipt.moneyMinorUnits!==0||receipt.providerMessagesSent!==0||
   receipt.productionCertified!==false)return false;
 try{
  store.removeItem(VO_PENDING_TIME_KEY);
  const after=readPendingTimeCommand(store);
  return after.available&&after.pending===null;
 }catch{return false;}
}
