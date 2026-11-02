import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {extractPortalCorePaths,portalCoreHandlerExists} from "./rc4-qa-orchestrator.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("full static nested Core route is resolved, never truncated to parent",()=>{
 const url='fetch(base+"/api/vox/v1/core/conversation-operator")';
 assert.deepEqual(extractPortalCorePaths(url),["core/conversation-operator"]);
 assert.equal(portalCoreHandlerExists(join(root,"app/api/vox/v1"),"core/conversation-operator"),true);
 assert.equal(existsSync(join(root,"app/api/vox/v1/core/route.ts")),false);
});
test("scanner will still reject a forged missing nested endpoint",()=>{
 const fake='"/api/vox/v1/core/invented-operator"';
 const refs=extractPortalCorePaths(fake);
 assert.deepEqual(refs,["core/invented-operator"]);
 assert.equal(refs.every(p=>portalCoreHandlerExists(join(root,"app/api/vox/v1"),p)),false);
});
test("flat endpoints, duplicates and URL queries still resolve canonically",()=>{
 const source='"/api/vox/v1/vendor360"; "/api/vox/v1/vendor360?q=1";'+
  '"/api/vox/v1/finance/refund-intake"';
 assert.deepEqual(extractPortalCorePaths(source),["finance/refund-intake","vendor360"]);
});
test("real Web Core adapter references only installed exact route path",()=>{
 const src=readFileSync(join(root,"apps/vox-web/lib/conversationControl.ts"),"utf8");
 const refs=extractPortalCorePaths(src);
 assert.deepEqual(refs,["core/conversation-candidates","core/conversation-operator"]);
 // The new read-only scoped discovery endpoint is checked just as strictly
 // as the original atomic writer: every referenced Core route must exist.
 for(const path of refs)assert.equal(portalCoreHandlerExists(join(root,"app/api/vox/v1"),path),true);
});

test("dynamic Finance URL resolves only through a checked-in [orderId] handler",()=>{
 const src='fetch(base+"/api/vox/v1/finance/order/"+encodeURIComponent(orderId))';
 const paths=extractPortalCorePaths(src);
 assert.deepEqual(paths,["finance/order/*"]);
 assert.equal(portalCoreHandlerExists(join(root,"app/api/vox/v1"),paths[0]),true);
 assert.equal(portalCoreHandlerExists(join(root,"app/api/vox/v1"),"finance/order"),false);
 assert.equal(portalCoreHandlerExists(join(root,"app/api/vox/v1"),"finance/fake-order/*"),false);
});
