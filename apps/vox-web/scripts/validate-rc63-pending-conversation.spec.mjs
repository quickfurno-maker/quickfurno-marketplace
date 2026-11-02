import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";

const root=resolve(import.meta.dirname,"..");
const temp=mkdtempSync(join(tmpdir(),"vox-rc63-pending-"));
const output=join(temp,"pending.mjs");
await build({entryPoints:[resolve(root,"lib/pendingConversationRecovery.ts")],
 outfile:output,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {savePendingConversation,loadPendingConversation,clearPendingConversation,
 PENDING_CONVERSATION_KEY}=await import(pathToFileURL(output).href);
const valid={conversationId:"11111111-1111-4111-8111-111111111111",
 nonce:"22222222-2222-4222-8222-222222222222",expectedRevision:4,action:"TAKEOVER"};
function memory(){
 const m=new Map();
 return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),
  removeItem:k=>m.delete(k),entries:m};
}
test("same-tab in-flight command and nonce survive reload and clear only after confirmation",()=>{
 const storage=memory();
 assert.equal(savePendingConversation(storage,valid),true);
 assert.deepEqual(loadPendingConversation(storage),valid);
 assert.equal(storage.entries.size,1);
 assert.equal(clearPendingConversation(storage),true);
 assert.equal(loadPendingConversation(storage),null);
});
test("tampered command, invalid action, extra keys, future revision cannot be restored",()=>{
 for(const value of [{...valid,nonce:"x"},{...valid,action:"SEND_PROVIDER"},
  {...valid,expectedRevision:2147483647},{...valid,actorId:"fake"},
  {...valid,expectedRevision:-1}]){
  const storage=memory();assert.equal(savePendingConversation(storage,value),false);
  storage.setItem(PENDING_CONVERSATION_KEY,JSON.stringify(value));
  assert.equal(loadPendingConversation(storage),null);
 }
});
test("unavailable storage fails closed without revealing tokens or replacing nonce",()=>{
 const broken={getItem(){throw Error("denied")},setItem(){throw Error("denied")},
  removeItem(){throw Error("denied")}};
 assert.equal(savePendingConversation(broken,valid),false);
 assert.equal(loadPendingConversation(broken),null);
 assert.equal(clearPendingConversation(broken),false);
});
test("actual Staff UI saves before HTTP, restores at mount, only clears after verified receipt",()=>{
 const ui=readFileSync(resolve(root,"app/team/conversation-control/ConversationControl.tsx"),"utf8");
 for(const marker of ["loadPendingConversation(window.sessionStorage)",
  "savePendingConversation(window.sessionStorage","clearPendingConversation(window.sessionStorage)",
  "setUncertain(true)","if(!recoveryReady||busy||!valid)return",
  "No Core request was sent","pending.current={command:JSON.stringify(cmd),nonce}"])
  assert.ok(ui.includes(marker),marker);
 assert.ok(ui.indexOf("savePendingConversation(window.sessionStorage")<
  ui.indexOf('fetch("/api/conversation-control"'),"persist before network");
 assert.ok(ui.indexOf("clearPendingConversation(window.sessionStorage")>
  ui.indexOf("response.json()"),"clear only after reply validation");
});
process.on("exit",()=>{rmSync(temp,{recursive:true,force:true});});
