/** Persistent same-tab team chat write checkpoint. A lost HTTP receipt is
 * not permission to mint a new nonce or alter the original message. */
const KEY="qf.vox.pending-team-chat.v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const valid=v=>v&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")==="body|nonce"&&
 typeof v.nonce==="string"&&UUID.test(v.nonce)&&
 typeof v.body==="string"&&v.body.length>=1&&v.body.length<=500&&
 v.body===v.body.trim()&&!/[\u0000-\u001f\u007f]/.test(v.body);
const equal=(a,b)=>a?.nonce===b?.nonce&&a?.body===b?.body;
export function readPendingTeamChat(store){
 if(!store)return {available:false,pending:null};
 try{
  const raw=store.getItem(KEY);
  if(raw===null)return {available:true,pending:null};
  if(typeof raw!=="string"||raw.length>800)return {available:false,pending:null};
  const row=JSON.parse(raw);
  return valid(row)?{available:true,pending:row}:{available:false,pending:null};
 }catch{return {available:false,pending:null};}
}
export function savePendingTeamChat(store,row){
 if(!valid(row))return false;
 const old=readPendingTeamChat(store);
 if(!old.available||(old.pending&&!equal(old.pending,row)))return false;
 try{
  store.setItem(KEY,JSON.stringify(row));
  const result=readPendingTeamChat(store);
  return result.available&&equal(row,result.pending);
 }catch{return false;}
}
/** A persisted intent may clear only after Core confirms the same nonce.
 * A messageId by itself is never proof the pending original was accepted.
 */
export function clearPendingTeamChat(store,row,receipt){
 if(!valid(row))return false;
 if(!receipt||typeof receipt!=="object"||Array.isArray(receipt)||
   Object.keys(receipt).sort().join("|")!==
   "agentConversationChanged|effect|externalMessagesSent|messageId|nonce|ok|staffPrivilegesChanged|status"||
   receipt.ok!==true||receipt.status!==201||
   typeof receipt.messageId!=="string"||!UUID.test(receipt.messageId)||
   receipt.nonce!==row.nonce||
   receipt.effect!=="INTERNAL_TEAM_MESSAGE_ONLY"||
   receipt.externalMessagesSent!==0||
   receipt.agentConversationChanged!==false||
   receipt.staffPrivilegesChanged!==false)return false;
 const old=readPendingTeamChat(store);
 if(!old.available||!equal(old.pending,row))return false;
 try{
  store.removeItem(KEY);
  const result=readPendingTeamChat(store);
  return result.available&&result.pending===null;
 }catch{return false;}
}
