import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const route=read("app/api/vox/v1/signed-eod-review/route.ts");
const handlerSrc=read("services/vox/rc38SignedEodReviewHandler.ts");
const dbSrc=read("services/vox/rc38SignedEodReviewDb.ts");
mkdirSync(resolve(root,"test-results"),{recursive:true});
// Real handler + real RC28 review service; only Auth, rc8 PG reconciler and server-only are stubbed.
const stub=(entry,outfile)=>build({entryPoints:[resolve(root,entry)],bundle:true,platform:"node",
 format:"esm",target:"node20",outfile,logLevel:"silent",
 plugins:[{name:"s",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({namespace:"stub",path:"server"}));
  b.onResolve({filter:/verifiedStaffBearer$/},()=>({namespace:"stub",path:"auth"}));
  b.onResolve({filter:/rc8-pg-signed-intent-writer\.mjs$/},()=>({namespace:"stub",path:"pg"}));
  b.onLoad({filter:/.*/,namespace:"stub"},({path})=>({loader:"js",contents:
   path==="auth"?"export async function verifyVoxOwnerBearer(a){globalThis.__o.calls++;return globalThis.__o.fn(a)}"+
    "export async function verifyVoxTeamLeaderBearer(a){globalThis.__t.calls++;return globalThis.__t.fn(a)}":
   path==="pg"?"export async function reconcileRc8PgSignedIntentOutcome(x){globalThis.__rec.push(x);return globalThis.__proof(globalThis.__rec.length)}"+
    "export function rc8SignedEodPublicationAuthorizationState(){return {publicationAuthorized:false}}":""})) }}]});
const out=resolve(root,"test-results/rc38-signed-eod-review-handler.mjs");
await stub("services/vox/rc38SignedEodReviewHandler.ts",out);
const dbOut=resolve(root,"test-results/rc38-signed-eod-review-db.mjs");
await stub("services/vox/rc38SignedEodReviewDb.ts",dbOut);
const {handleRc38SignedEodReview:handle}=await import(pathToFileURL(out).href);
const {rc38SignedEodReviewDbSource:dbSource}=await import(pathToFileURL(dbOut).href);
const {verifyRc28PendingEodForHumanReview:review}=await import(
 pathToFileURL((await stub("services/vox/rc28PendingSignedEodReview.ts",
  resolve(root,"test-results/rc38-rc28-copy.mjs")),resolve(root,"test-results/rc38-rc28-copy.mjs"))).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const R="a".repeat(64);
const committed=(o={})=>({outcome:"COMMITTED",ok:true,receiptSha256:R,intentId:id(1),
 subjectId:id(2),ownerId:id(3),teamLeaderId:id(4),teamId:id(5),cityId:id(6),...o});
const q=(o={})=>new URLSearchParams({intentId:id(1),subjectId:id(2),expectedReceiptSha256:R,...o}).toString();
const req=(qs=q(),h={authorization:"Bearer owner","x-vox-team-leader-authorization":"Bearer tl"},method="GET")=>
 new Request("http://x/api/vox/v1/signed-eod-review?"+qs,{method,headers:h});
let enabled=true,source=()=>async()=>({});
const deps=()=>({enabled:()=>enabled,dbSource:()=>source(),review});
test.beforeEach(()=>{
 enabled=true;source=()=>async()=>({});
 globalThis.__o={calls:0,fn:()=>id(3)};
 globalThis.__t={calls:0,fn:()=>({userId:id(4),aal:"aal2",expiresAtMs:Date.now()+60000,teamId:id(5),cityId:id(6)})};
 globalThis.__rec=[];globalThis.__proof=()=>committed();
});
const body=async r=>({status:r.status,json:await r.json()});
test("route is read-only GET, default OFF, never publishes or writes",()=>{
 assert.match(route,/export function GET/);
 assert.match(route,/VOX_RC38_SIGNED_EOD_REVIEW_ENABLED==="staging"/);
 for(const m of ["POST","PUT","PATCH","DELETE"])assert.match(route,new RegExp("export const "+m+"=deny"));
 for(const s of [route,handlerSrc,dbSrc])
  assert.doesNotMatch(s,/\.rpc\(|adminClient|service_role|publishOfficial|fetch\(|\.insert\(|\.update\(/);
 assert.match(dbSrc,/default_transaction_read_only=on/);
});
test("disabled by default and when DB source missing: 503 before any auth or DB",async()=>{
 enabled=false;
 let r=await body(await handle(req(),deps()));
 assert.equal(r.status,503);assert.equal(r.json.error,"SIGNED_EOD_REVIEW_DISABLED");
 enabled=true;source=()=>null;
 r=await body(await handle(req(),deps()));
 assert.equal(r.status,503);assert.equal(r.json.error,"SIGNED_EOD_REVIEW_DB_SOURCE_UNAVAILABLE");
 assert.equal(globalThis.__rec.length,0);
 delete process.env.VOX_RC38_SIGNED_EOD_REVIEW_READER_DATABASE_URL;
 assert.equal(dbSource(),null);
 process.env.VOX_RC38_SIGNED_EOD_REVIEW_READER_DATABASE_URL="http://not-postgres";
 assert.equal(dbSource(),null);
 delete process.env.VOX_RC38_SIGNED_EOD_REVIEW_READER_DATABASE_URL;
});
test("strict query: exact three params, no extras, duplicates or caller identity",async()=>{
 for(const qs of ["",q({extra:"1"}),q({ownerId:id(3)}),q({publicationAuthorized:"true"}),
  q()+"&intentId="+id(1),"intentId="+id(1)+"&subjectId="+id(2)]){
  const r=await body(await handle(req(qs),deps()));
  assert.equal(r.status,400);assert.equal(r.json.error,"INVALID_REVIEW_QUERY");
 }
 const bad=await body(await handle(req(q({intentId:"nope"})),deps()));
 assert.equal(bad.status,400);
 assert.equal(globalThis.__o.calls,0);assert.equal(globalThis.__rec.length,0);
});
test("two distinct bearer credentials are mandatory",async()=>{
 for(const h of [{},{authorization:"Bearer owner"},{"x-vox-team-leader-authorization":"Bearer tl"},
  {authorization:"Bearer same","x-vox-team-leader-authorization":"Bearer same"}]){
  const r=await body(await handle(req(q(),h),deps()));
  assert.equal(r.status,403);assert.equal(r.json.error,"DISTINCT_OWNER_AND_TL_BEARERS_REQUIRED");
 }
 assert.equal(globalThis.__rec.length,0);
});
test("genuine Owner+TL receive pending-review proof only: 200, no approval or publication",async()=>{
 const r=await body(await handle(req(),deps()));
 assert.equal(r.status,200);
 assert.deepEqual(r.json,{ok:true,schema:"qf.vox.eod.signed-review.v1",mode:"READ_ONLY",
  state:"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW",receiptSha256:R,approved:false,
  publicationAuthorized:false,requiresIndependentReview:true,providerMessagesSent:0});
 assert.equal(globalThis.__rec.length,2);
});
test("unauthenticated, wrong-role, wrong-scope and revoked humans are denied",async()=>{
 globalThis.__o.fn=()=>null;
 let r=await body(await handle(req(),deps()));
 assert.equal(r.status,403);assert.equal(r.json.publicationAuthorized,false);
 globalThis.__o.fn=()=>id(3);globalThis.__t.fn=()=>null;
 assert.equal((await handle(req(),deps())).status,403);
 globalThis.__t.fn=()=>({userId:id(4),aal:"aal2",expiresAtMs:Date.now()+60000,teamId:id(9),cityId:id(6)});
 assert.equal((await handle(req(),deps())).status,403);
 globalThis.__t.fn=()=>{throw Error("auth down")};
 assert.equal((await handle(req(),deps())).status,503);
 globalThis.__t.fn=()=>({userId:id(4),aal:"aal2",expiresAtMs:Date.now()+60000,teamId:id(5),cityId:id(6)});
 let n=0;globalThis.__o.fn=()=>(++n>1?null:id(3));
 r=await body(await handle(req(),deps()));
 assert.equal(r.status,403);assert.equal(r.json.error,"HUMAN_AAL2_REVOKED_DURING_RECONCILIATION");
});
test("expired/revoked signer key or changed report (reconciler INCONSISTENT) is denied 409",async()=>{
 globalThis.__proof=()=>({outcome:"INCONSISTENT",ok:false});
 let r=await body(await handle(req(),deps()));
 assert.equal(r.status,409);assert.equal(r.json.error,"SIGNED_EOD_REVIEW_DENIED");
 assert.equal(r.json.approved,false);assert.equal(r.json.publicationAuthorized,false);
 assert.equal(JSON.stringify(r.json).includes(R),false);
 globalThis.__proof=n=>n===1?committed():{outcome:"INCONSISTENT",ok:false};
 r=await body(await handle(req(),deps()));
 assert.equal(r.status,409);
});
test("concurrent report change between snapshots is denied; DB outage is 503",async()=>{
 globalThis.__proof=n=>committed(n>1?{receiptSha256:"b".repeat(64)}:{});
 let r=await body(await handle(req(),deps()));
 assert.equal(r.status,409);
 globalThis.__proof=()=>{throw Error("db down")};
 r=await body(await handle(req(),deps()));
 assert.equal(r.status,503);assert.equal(r.json.publicationAuthorized,false);
});
