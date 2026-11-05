import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {validatePinnedVendorPendingFiles} from "./rc-launch-vendor-pending-source-addendum.mjs";
import {readdirSync} from "node:fs";

const root=resolve(import.meta.dirname,"../../..");
const src=path=>readFileSync(resolve(root,path),"utf8");
const queue=src("app/api/vox/v1/owner-vendor-verification-queue/route.ts");
const review=src("app/api/vox/v1/owner-vendor-verification-case/route.ts");
const doc=src("docs/vox/owner-vendor-verification-core-bridge-20261105.md");

test("Owner queue and case are true Core handlers and do not create parallel vendor data",()=>{
 for(const code of [queue,review]){
  assert.match(code,/import \{ adminClient \} from "@\/lib\/supabase"/);
  assert.match(code,/verifyVoxOwnerBearer/);
  assert.match(code,/"cache-control"\s*:\s*"private, no-store, max-age=0"/);
  assert.match(code,/"x-content-type-options"\s*:\s*"nosniff"/);
  assert.doesNotMatch(code,/\.storage\.|getPublicUrl|\.from\("vendors"\)/);
  assert.doesNotMatch(code,/sendMessage|grantCredits|autoAssign|activateVendor/);
 }
 assert.match(queue,/adminClient\(\)\.rpc\("qf_vox_owner_vendor_review_queue"\)/);
 assert.match(review,/adminClient\(\)\.rpc\("qf_vendor_owner_review_snapshot"/);
 assert.match(review,/"qf_owner_record_vendor_verification_decision"/);
});

test("both Core routes are OFF until independently approved Staging gates and signed AAL2",()=>{
 assert.match(queue,/VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED==="staging"/);
 assert.match(queue,/VOX_OWNER_VENDOR_QUEUE_ENABLED==="staging"/);
 assert.match(review,/VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED === "staging"/);
 assert.match(queue,/if\(!enabled\(\)\)return reply\(\{ok:false,code:"VENDOR_REVIEW_QUEUE_DISABLED"\},503\)/);
 assert.match(review,/if \(!enabled\(\)\) return response\(\{ok:false,code:"OWNER_REVIEW_DISABLED"\},503\)/);
 assert.match(queue,/const owner=await verifyVoxOwnerBearer\(authorization\)/);
 assert.match(queue,/if\(await verifyVoxOwnerBearer\(authorization\)!==owner\)/);
 assert.match(review,/if \(await verifyVoxOwnerBearer\(request.headers.get\("authorization"\)\) !== owner\)/);
 assert.match(review,/p_reviewer_user_id:owner/);
 assert.doesNotMatch(review,/p_reviewer_user_id:body\./);
});

test("Core decision is bounded, version-locked and cannot directly activate a vendor",()=>{
 assert.match(review,/MAX_REVIEW_BODY_BYTES = 2048/);
 assert.match(review,/request.body\?\.getReader\(\)/);
 assert.match(review,/size \+= value.byteLength/);
 assert.match(review,/if \(size > MAX_REVIEW_BODY_BYTES\)/);
 assert.match(review,/new URL\(origin\)\.origin !== new URL\(request.url\)\.origin/);
 assert.match(review,/p_expected_case_version:body.caseVersion/);
 assert.match(review,/immutableDecisionRecorded:true/);
 assert.match(review,/vendorBusinessStatusUnchanged:true/);
 assert.match(review,/leadActivationUnchanged:true/);
 assert.match(review,/requiresSeparateCoreVendorApproval:true/);
 assert.match(queue,/canViewPrivateDocuments:false,canActivateLeads:false/);
});

test("Seven SQL dependencies are exact source-pending in integrated candidate and remain in release HOLD",()=>{
 const versions=["20261104090000","20261104140000","20261104153000",
  "20261104160000","20261104163000","20261104170000","20261104173000"];
 for(const version of versions){
  assert.ok(doc.includes(version),version+" must be in explicit dependency declaration");
  const ledger=JSON.parse(src("supabase/staging-history/qf-post-g1-migration-ledger-20260929.json"));
  const item=ledger.records.find(r=>r.version===version);
  assert.ok(item,"new exact source-pending migration must be explicitly pinned: "+version);
  assert.equal(item.exactVersionPresence.staging,false);
  assert.equal(item.exactVersionPresence.production,false);
  assert.match(item.evidence,/NO_REMOTE_APPLY$/);
 }
 const pinned=validatePinnedVendorPendingFiles({
  names:readdirSync(resolve(root,"supabase/migrations")),
  sourceDir:resolve(root,"supabase/migrations")
 });
 assert.equal(pinned.count,7);
 assert.equal(pinned.applied,false);
 assert.equal(pinned.releaseGo,false);
 assert.match(doc,/Release:\*\* HOLD/);
 assert.match(doc,/does not introduce the seven new vendor verification SQL migrations/);
 assert.doesNotMatch(doc,/\bLIVE APPROVED\b|\bPRODUCTION GO\b/);
});
