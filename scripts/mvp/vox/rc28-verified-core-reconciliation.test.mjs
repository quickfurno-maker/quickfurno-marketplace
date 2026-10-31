import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=readFileSync(resolve(root,"services/vox/rc28VerifiedCoreOutcomeReconciliation.ts"),"utf8");
assert.match(source,/RC28_CORE_RECONCILIATION_ROUTE_INSTALLED=false as const/);
mkdirSync(resolve(root,"test-results"),{recursive:true});
await build({entryPoints:[resolve(root,"services/vox/rc28VerifiedCoreOutcomeReconciliation.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",
 outfile:resolve(root,"test-results/rc28-verified-core-bundle.mjs"),plugins:[{
 name:"mock-dependencies-but-preserve-adapter",setup(b){
 b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
 b.onResolve({filter:/^\.\/verifiedStaffBearer$/},()=>({path:"auth",namespace:"mock"}));
 b.onResolve({filter:/^\.\/rc26CoreCommitReconciliation$/},()=>({path:"receipt",namespace:"mock"}));
 b.onLoad({filter:/.*/,namespace:"mock"},args=>{
  const contents=args.path==="auth"?
   "export async function verifyVoxOperationsStaffBearer(a){globalThis.__rc28AuthCalls.push(a);return globalThis.__rc28Actor}":
   args.path==="receipt"?
   "export async function reconcileRc8CoreCommitOutcome(command,acquire){globalThis.__rc28ReceiptCalls.push({command,acquire});return Object.freeze({outcome:'COMMITTED',reason:'RECEIPT_AND_EVENT_DURABLE',requiresReconciliation:false,mutationsApplied:0,providerMessagesSent:0})}":
   "";
  return {contents,loader:"js"};
 });
 }
 }]});
const {reconcileRc28VerifiedCoreCommand:run,RC28_CORE_RECONCILIATION_ROUTE_INSTALLED:off}=
 await import(pathToFileURL(resolve(root,"test-results/rc28-verified-core-bundle.mjs")).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const cmd=()=>({conversationId:id(1),nonce:id(2),action:"TAKEOVER",expectedRevision:0});
const db=async()=>{throw Error("NO_DB_CALL_EXPECTED")};
test.beforeEach(()=>{globalThis.__rc28Actor={userId:id(3),aal:"aal2",expiresAtMs:Date.now()+60000,
 teamId:id(4),cityId:id(5)};globalThis.__rc28AuthCalls=[];globalThis.__rc28ReceiptCalls=[]});
test("reviewed route release gate remains false",()=>assert.equal(off,false));
test("invalid payload or extra actor/source fields never call auth or DB",async()=>{
 for(const x of [{...cmd(),actorId:id(8)},{...cmd(),sourceProof:"real"},
  {...cmd(),expectedRevision:-1},{...cmd(),nonce:"invalid"},{...cmd(),teamId:id(4)}]){
  const r=await run("Bearer synthetic",x,db);
  assert.equal(r.outcome,"UNKNOWN");assert.equal(r.mutationsApplied,0);
 }
 assert.deepEqual(globalThis.__rc28AuthCalls,[]);
});
test("missing, expired and non-AAL2 Staff identity deny before native access",async()=>{
 for(const a of [null,{...globalThis.__rc28Actor,aal:"aal1"},
  {...globalThis.__rc28Actor,expiresAtMs:Date.now()-1000}]){
  globalThis.__rc28Actor=a;
  assert.equal((await run("Bearer synthetic",cmd(),db)).outcome,"UNKNOWN");
 }
 assert.equal(globalThis.__rc28ReceiptCalls.length,0);
});
test("verified Staff userId exclusively binds immutable native receipt reconciliation",async()=>{
 const request=cmd();
 const result=await run("Bearer synthetic",request,db);
 assert.equal(result.outcome,"COMMITTED");
 assert.deepEqual(globalThis.__rc28AuthCalls,["Bearer synthetic"]);
 assert.equal(globalThis.__rc28ReceiptCalls.length,1);
 const actual=globalThis.__rc28ReceiptCalls[0].command;
 assert.deepEqual(actual,{...request,actorId:id(3)});
 assert.equal(globalThis.__rc28ReceiptCalls[0].acquire,db);
});
test("no provider, HTTP, grant, or DB connection is opened by the adapter",()=>{
 assert.doesNotMatch(source,/fetch\(|\.rpc\(|\.send\(|process\.env/);
 assert.match(source,/reconcileRc8CoreCommitOutcome\(/);
 assert.match(source,/verifyVoxOperationsStaffBearer\(authorization\)/);
});
