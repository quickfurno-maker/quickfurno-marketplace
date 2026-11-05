import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const route=readFileSync(resolve(root,"app/api/vendor/private-evidence/route.ts"),"utf8");

test("P2-B1 certify private bucket before any begin-case RPC or Storage mutation",()=>{
 const bucket=route.indexOf("await privateEvidenceStorage.assertPrivate()");
 const begin=route.indexOf('"qf_vendor_begin_private_verification_case"');
 const put=route.indexOf("await privateEvidenceStorage.put(key,buffer");
 const link=route.indexOf('"qf_vendor_attach_private_evidence"');
 assert.ok(bucket>0&&begin>bucket&&put>begin&&link>put,
   "private nonpublic bucket must be attested before beginning a pending verification case");
});
test("P2-B2 unsafe bucket refuses with 503 and cannot be treated as evidence admission",()=>{
 assert.match(route,/try\{await privateEvidenceStorage\.assertPrivate\(\);\}\s*catch\{return reply\(\{ok:false,code:"PRIVATE_BUCKET_NOT_CERTIFIED"\},503\);\}/);
 assert.match(route,/if\(!enabled\(\)\)return reply\(\{ok:false,code:"PRIVATE_EVIDENCE_NOT_YET_AVAILABLE"\},503\)/);
 assert.match(route,/const accepted=sniff\(buffer,file\.type\)/);
 assert.match(route,/if\(!accepted\)return reply\(\{ok:false,code:"INVALID_FILE_FORMAT"\},415\)/);
});
test("P2-B3 case remains Pending, no public URLs and no implied approvals",()=>{
 assert.match(route,/status:"pending_scan_and_owner_review"/);
 assert.match(route,/approved:false,publicDocumentUrl:null/);
 assert.match(route,/vendorBusinessStatusUnchanged:true/);
 assert.doesNotMatch(route,/getPublicUrl\(|createSignedUrl\(|grantCredits\(|assignLead\(/);
});
