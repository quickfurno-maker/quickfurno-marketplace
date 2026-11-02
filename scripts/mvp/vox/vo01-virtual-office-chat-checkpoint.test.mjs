import test from "node:test";
import assert from "node:assert/strict";
import {readPendingTeamChat,savePendingTeamChat,clearPendingTeamChat}
 from "../../../apps/vox-web/lib/vo01PendingTeamChat.mjs";
const row={nonce:"00000000-0000-4000-8000-000000000001",body:"Internal update"};
function mem(){const map=new Map();return {getItem:x=>map.has(x)?map.get(x):null,
 setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test("VO1 chat nonce and body survive reload and clear after verified receipt",()=>{
 const s=mem();
 assert.equal(savePendingTeamChat(s,row),true);
 assert.deepEqual(readPendingTeamChat(s).pending,row);
 assert.equal(clearPendingTeamChat(s,row),true);
 assert.equal(readPendingTeamChat(s).pending,null);
});
test("VO1 cannot overwrite original pending chat message or nonce",()=>{
 const s=mem();savePendingTeamChat(s,row);
 assert.equal(savePendingTeamChat(s,{...row,body:"Changed"}),false);
 assert.equal(savePendingTeamChat(s,{...row,nonce:"00000000-0000-4000-8000-000000000002"}),false);
 assert.equal(clearPendingTeamChat(s,{...row,body:"Wrong"}),false);
 assert.deepEqual(readPendingTeamChat(s).pending,row);
});
test("VO1 invalid, unsafe, or unavailable browser storage fails closed",()=>{
 const s=mem();
 for(const bad of [{...row,body:" bad"},{...row,body:"bad\nnew"},
  {...row,actorId:"owner"},{...row,body:"x".repeat(501)}])
  assert.equal(savePendingTeamChat(s,bad),false);
 assert.equal(readPendingTeamChat(null).available,false);
 const corrupt={getItem:()=>"{bad"};
 assert.equal(readPendingTeamChat(corrupt).available,false);
 assert.equal(savePendingTeamChat(corrupt,row),false);
});
test("VO1 storage writes require exact independent readback",()=>{
 const s={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 assert.equal(savePendingTeamChat(s,row),false);
 const s2=mem();savePendingTeamChat(s2,row);
 const sabotaged={getItem:s2.getItem,setItem:s2.setItem,removeItem:()=>{}};
 assert.equal(clearPendingTeamChat(sabotaged,row),false);
});
