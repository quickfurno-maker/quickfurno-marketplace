/**
 * Session-tab recovery of an in-flight atomic Staff command.
 * This is a UX checkpoint, never a database authority or a permission grant.
 * Only the exact command + idempotency nonce may be resubmitted after an
 * uncertain transport result. No credentials, client phone or messages stored.
 */
export const PENDING_CONVERSATION_KEY="qf.vox.pending-conversation.v1";
export type PendingConversation=Readonly<{conversationId:string;nonce:string;
 expectedRevision:number;action:"PAUSE_AI"|"TAKEOVER"}>;
type RecoveryStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function valid(value:unknown):value is PendingConversation{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const x=value as Record<string,unknown>;
 return Object.keys(x).sort().join("|")==="action|conversationId|expectedRevision|nonce"&&
  typeof x.conversationId==="string"&&UUID.test(x.conversationId)&&
  typeof x.nonce==="string"&&UUID.test(x.nonce)&&
  Number.isSafeInteger(x.expectedRevision)&&Number(x.expectedRevision)>=0&&
  Number(x.expectedRevision)<=2147483646&&
  (x.action==="PAUSE_AI"||x.action==="TAKEOVER");
}
export function loadPendingConversation(storage:RecoveryStorage):PendingConversation|null{
 try{
  const raw=storage.getItem(PENDING_CONVERSATION_KEY);
  if(!raw||raw.length>350)return null;
  const value:unknown=JSON.parse(raw);
  return valid(value)?value:null;
 }catch{return null;}
}
export function savePendingConversation(storage:RecoveryStorage,value:PendingConversation):boolean{
 if(!valid(value))return false;
 try{storage.setItem(PENDING_CONVERSATION_KEY,JSON.stringify(value));return true;}
 catch{return false;}
}
export function clearPendingConversation(storage:RecoveryStorage):boolean{
 try{storage.removeItem(PENDING_CONVERSATION_KEY);return true;}
 catch{return false;}
}
