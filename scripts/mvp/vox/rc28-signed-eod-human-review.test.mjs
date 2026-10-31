import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=readFileSync(resolve(root,"services/vox/rc28PendingSignedEodReview.ts"),"utf8");
assert.match(source,/RC28_SIGNED_EOD_REVIEW_ROUTE_INSTALLED=false as const/);
mkdirSync(resolve(root,"test-results"),{recursive:true});
const outfile=resolve(root,"test-results/rc28-eod-pending-human-review.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc28PendingSignedEodReview.ts")],
 bundle:true,platform:"node",format:"esm",target:"node20",outfile,logLevel:"silent",
 plugins:[{name:"test-isolated-auth-and-reconciliation",setup(b){
 b.onResolve({filter:/^server-only$/},()=>({namespace:"stub",path:"server"}));
 b.onResolve({filter:/verifiedStaffBearer$/},()=>({namespace:"stub",path:"auth"}));
 b.onResolve({filter:/rc8-pg-signed-intent-writer\.mjs$/},()=>({namespace:"stub",path:"pg"}));
 b.onLoad({filter:/.*/,namespace:"stub"},({path})=>({loader:"js",contents:
  path==="auth"?"export async function verifyVoxOwnerBearer(){globalThis.__eodOwnerCalls++;return globalThis.__eodOwnerCalls>1&&globalThis.__eodRevokeOwner?null:globalThis.__eodOwner}"+
   "export async function verifyVoxTeamLeaderBearer(){globalThis.__eodLeaderCalls++;return globalThis.__eodLeaderCalls>1&&globalThis.__eodRevokeLeader?null:globalThis.__eodLeader}":
  path==="pg"?"export async function reconcileRc8PgSignedIntentOutcome(x){globalThis.__eodCalls.push(x);"+
   "if(globalThis.__eodThrow)throw Error('synthetic DB down');return globalThis.__eodProof}"+
   "export function rc8SignedEodPublicationAuthorizationState(){return {publicationAuthorized:globalThis.__eodPublish}}":
  ""}) );
 }}]});
const {verifyRc28PendingEodForHumanReview:run,RC28_SIGNED_EOD_REVIEW_ROUTE_INSTALLED}=
 await import(pathToFileURL(outfile).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const receipt="a".repeat(64);
const pending=()=>({intentId:id(1),subjectId:id(2),expectedReceiptSha256:receipt});
const committed=(o={})=>({outcome:"COMMITTED",ok:true,receiptSha256:receipt,
 intentId:id(1),subjectId:id(2),ownerId:id(3),teamLeaderId:id(4),teamId:id(5),
 cityId:id(6),...o});
const acquire=async()=>{throw Error("MUST_NEVER_OPEN_DB_FROM_STUB")};
test.beforeEach(()=>{
 globalThis.__eodOwner=id(3);
 globalThis.__eodLeader={userId:id(4),aal:"aal2",expiresAtMs:Date.now()+60000,
  teamId:id(5),cityId:id(6)};
 globalThis.__eodRevokeOwner=false;globalThis.__eodRevokeLeader=false;
 globalThis.__eodOwnerCalls=0;globalThis.__eodLeaderCalls=0;
 globalThis.__eodProof=committed();
 globalThis.__eodPublish=false;globalThis.__eodThrow=false;globalThis.__eodCalls=[];
});
test("human EOD review route and publication always HARD OFF",()=>{
 assert.equal(RC28_SIGNED_EOD_REVIEW_ROUTE_INSTALLED,false);
 assert.doesNotMatch(source,/\.rpc\(|publishOfficial|\.send\(/);
});
test("reject caller-supplied Owner/TL and publication flag before authentication",async()=>{
 for(const input of [{...pending(),ownerId:id(9)},{...pending(),teamLeaderId:id(4)},
  {...pending(),publicationAuthorized:true},{...pending(),expectedReceiptSha256:"bad"}]){
  const r=await run("owner","tl",input,acquire);assert.equal(r.ok,false);
 }
 assert.equal(globalThis.__eodCalls.length,0);
});
test("distinct authenticated Owner and TL required",async()=>{
 for(const leader of [null,{userId:id(3),aal:"aal2",expiresAtMs:Date.now()+60000},
  {userId:id(4),aal:"aal1",expiresAtMs:Date.now()+60000},
  {userId:id(4),aal:"aal2",expiresAtMs:Date.now()-10}]){
  globalThis.__eodLeader=leader;
  assert.equal((await run("owner","tl",pending(),acquire)).ok,false);
 }
 assert.equal(globalThis.__eodCalls.length,0);
});
test("genuine pending receipt remains pending with no publication authorization",async()=>{
 const x=await run("owner","tl",pending(),acquire);
 assert.equal(x.ok,true);assert.equal(x.state,"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW");
 assert.equal(x.publicationAuthorized,false);assert.equal(x.approved,false);
 assert.equal(globalThis.__eodCalls.length,1);
 assert.deepEqual(globalThis.__eodCalls[0],{acquireClient:acquire,...pending()});
});
test("in-flight, conflict, forged publication and SQL outage never authorize EOD",async()=>{
 for(const proof of [{outcome:"IN_FLIGHT",ok:false},{outcome:"COMMITTED",ok:true,receiptSha256:"b".repeat(64)}]){
  globalThis.__eodProof=proof;
  assert.equal((await run("owner","tl",pending(),acquire)).publicationAuthorized,false);
 }
 globalThis.__eodProof=committed();
 globalThis.__eodPublish=true;
 assert.equal((await run("owner","tl",pending(),acquire)).ok,false);
 globalThis.__eodPublish=false;globalThis.__eodThrow=true;
 assert.equal((await run("owner","tl",pending(),acquire)).reason,
  "SIGNER_RECEIPT_RECONCILIATION_UNAVAILABLE");
});

test("RC29 rechecks both human AAL2 authorities after durable DB reconciliation",async()=>{
 const result=await run("owner","tl",pending(),acquire);
 assert.equal(result.ok,true);
 assert.equal(result.publicationAuthorized,false);
 assert.equal(globalThis.__eodOwnerCalls,2);
 assert.equal(globalThis.__eodLeaderCalls,2);
});
test("EOD review is bound to the receipt's own signers and team/city scope",async()=>{
 for(const proof of [committed({ownerId:id(9)}),committed({teamLeaderId:id(9)}),
  committed({teamId:id(9)}),committed({cityId:id(9)}),committed({subjectId:id(9)}),
  committed({intentId:id(9)}),committed({ownerId:undefined})]){
  globalThis.__eodProof=proof;
  const r=await run("owner","tl",pending(),acquire);
  assert.equal(r.ok,false);assert.equal(r.reason,"REVIEWER_NOT_RECEIPT_SIGNER_SCOPE");
  assert.equal(r.publicationAuthorized,false);
 }
 globalThis.__eodProof=committed();
 assert.equal((await run("owner","tl",pending(),acquire)).ok,true);
});
test("RC29 revoked Owner or TL during slow reconciliation cannot produce a positive review",async()=>{
 globalThis.__eodRevokeOwner=true;
 let result=await run("owner","tl",pending(),acquire);
 assert.equal(result.ok,false);
 assert.equal(result.reason,"HUMAN_AAL2_REVOKED_DURING_RECONCILIATION");
 assert.equal(result.publicationAuthorized,false);
 globalThis.__eodOwnerCalls=0;globalThis.__eodLeaderCalls=0;
 globalThis.__eodRevokeOwner=false;globalThis.__eodRevokeLeader=true;
 result=await run("owner","tl",pending(),acquire);
 assert.equal(result.ok,false);
 assert.equal(result.reason,"HUMAN_AAL2_REVOKED_DURING_RECONCILIATION");
 assert.equal(result.publicationAuthorized,false);
});
