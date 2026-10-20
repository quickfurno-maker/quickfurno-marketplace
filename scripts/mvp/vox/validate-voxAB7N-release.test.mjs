import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {inspectAb7kFullVoxSources} from "../../../contracts/vox/ab7kFullMigrationManifest.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const file=p=>readFileSync(resolve(root,p),"utf8");
test("AB7N all four tracks retain exact 30 source SQL manifest, no managed promotion",()=>{
 const x=inspectAb7kFullVoxSources(root);
 assert.equal(x.ok,true,x.reason);assert.equal(x.totalFiles,30);
 assert.equal(x.canApply,false);assert.equal(x.releaseReady,false);
});
test("AB7N canonical Core ACL and dual scoped Staff/Riya late-check regressions",()=>{
 const client=file("app/api/vox/v1/riya-client-cases/route.ts");
 const chat=file("app/api/vox/v1/staff-chat/route.ts");
 const acl=file("contracts/vox/ab7nCanonicalCoreAclBaseline.mjs");
 assert.match(client,/CLIENT_CASE_AUTH_REVOKED_DURING_READ/);
 assert.match(client,/CLIENT_CASE_OBJECT_GRANT_REVOKED_DURING_READ/);
 assert.match(chat,/TEAM_CHAT_SCOPE_REVOKED_DURING_READ/);
 assert.match(acl,/canApplyMigrations:false/);
});
test("AB7N signed internal worker lease expiry checked again before any claim",()=>{
 const worker=file("worker/voxAb7jSignedInternalOnce.mjs");
 const pre=worker.indexOf('await verifyNoOutboundProviders()');
 const lease=worker.indexOf('INDEPENDENT_RELEASE_EXPIRED_DURING_PREFLIGHT');
 const execute=worker.indexOf('return await runAb7fCoreInternalWorker(');
 assert.ok(pre>=0&&lease>pre&&execute>lease);
});
test("AB7N no developer source QA alone authorizes customer/provider sends",()=>{
 const manifest=file("contracts/vox/ab7mCrossServiceCandidate.mjs");
 assert.match(manifest,/outboundProviderAuthorized:false/);
 assert.match(manifest,/workerSchedulerAuthorized:false/);
 assert.match(manifest,/canDeploy:false/);
});
