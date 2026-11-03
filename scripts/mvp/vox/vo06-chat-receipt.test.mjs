import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readPendingTeamChat,savePendingTeamChat,clearPendingTeamChat}
 from "../../../apps/vox-web/lib/vo01PendingTeamChat.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const row={nonce:id(1),body:"Internal team-only note"};
const receipt={ok:true,status:201,nonce:id(1),messageId:id(2),
 effect:"INTERNAL_TEAM_MESSAGE_ONLY",externalMessagesSent:0,
 agentConversationChanged:false,staffPrivilegesChanged:false};
const store=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,
 setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
const read=path=>readFileSync(new URL("../../../"+path,import.meta.url),"utf8");
test("VO6 exact original Core nonce and no side effects clear pending chat",()=>{
 const s=store();assert.equal(savePendingTeamChat(s,row),true);
 assert.equal(clearPendingTeamChat(s,row,receipt),true);
 assert.equal(readPendingTeamChat(s).pending,null);
});
test("VO6 forged receipt and unrelated message cannot clear original",()=>{
 const s=store();savePendingTeamChat(s,row);
 const bad=[{...receipt,nonce:id(88)},{...receipt,ok:false},
  {...receipt,status:200},{...receipt,messageId:"bad"},
  {...receipt,externalMessagesSent:1},
  {...receipt,agentConversationChanged:true},
  {...receipt,staffPrivilegesChanged:true},{...receipt,extra:"junk"}];
 for(const x of bad){
  assert.equal(clearPendingTeamChat(s,row,x),false);
  assert.deepEqual(readPendingTeamChat(s).pending,row);
 }
 assert.equal(clearPendingTeamChat(s,row,undefined),false);
});
test("VO6 Core rebinds SQL-nonce to trusted receipt, BFF confirms equality",()=>{
 const core=read("app/api/vox/v1/staff-chat/route.ts");
 const bff=read("apps/vox-web/lib/teamWorkflow.ts");
 const web=read("apps/vox-web/app/team/chat/ChatComposer.tsx");
 assert.match(core,/p_nonce:body\.nonce/);
 assert.match(core,/messageId:r\.message_id,nonce:body\.nonce/);
 assert.match(bff,/x\.nonce!==nonce/);
 assert.match(bff,/nonce,\s*\n\s*effect:"INTERNAL_TEAM_MESSAGE_ONLY"/);
 assert.match(web,/data\.nonce!==item\.nonce/);
 assert.match(web,/clearPendingTeamChat\(store\(\),item,data\)/);
 assert.doesNotMatch(web,/\[89ab\]\[0-9a-f\]\{3\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]/);
});
test("VO6 lost response keeps same nonce, never clears on message ID alone",()=>{
 const s=store();savePendingTeamChat(s,row);
 assert.equal(clearPendingTeamChat(s,row,{messageId:id(2)}),false);
 assert.equal(savePendingTeamChat(s,{...row,nonce:id(33)}),false);
 assert.deepEqual(readPendingTeamChat(s).pending,row);
});
