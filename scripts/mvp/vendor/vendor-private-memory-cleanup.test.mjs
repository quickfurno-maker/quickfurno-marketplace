import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {withPrivateEvidenceBuffer} from "../../../lib/vendors/withPrivateEvidenceBuffer.ts";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const upload=readFileSync(resolve(root,"app/api/vendor/private-evidence/route.ts"),"utf8");
const worker=readFileSync(resolve(root,"scripts/mvp/vendor/run-private-evidence-scan-once.mjs"),"utf8");

test("P2-Z1 private bytes cleared after successfully awaited callback",async()=>{
 const bytes=Buffer.from("%PDF-1.7 private synthetic sample");
 const expected=Buffer.from(bytes);
 const answer=await withPrivateEvidenceBuffer(bytes,async buffer=>{
   await Promise.resolve();
   assert.equal(buffer.toString("utf8"),expected.toString("utf8"));
   return "accepted";
 });
 assert.equal(answer,"accepted");
 assert.ok(bytes.every(x=>x===0));
});
test("P2-Z2 exceptions during private Storage or Core RPC also clear working bytes",async()=>{
 const bytes=Buffer.from("synthetic private evidence sample");
 await assert.rejects(withPrivateEvidenceBuffer(bytes,async buffer=>{
   await Promise.resolve();
   assert.ok(buffer.some(x=>x!==0));
   throw Error("SYNTHETIC_STORAGE_OR_CORE_ERROR");
 }),/SYNTHETIC_STORAGE_OR_CORE_ERROR/);
 assert.ok(bytes.every(x=>x===0));
});
test("P2-Z3 early validation denial also clears working bytes",async()=>{
 const bytes=Buffer.from("invalid synthetic test content");
 const response=await withPrivateEvidenceBuffer(bytes,async()=>"INVALID_FILE_FORMAT");
 assert.equal(response,"INVALID_FILE_FORMAT");
 assert.ok(bytes.every(x=>x===0));
});
test("P2-Z4 real upload route awaits private-scope cleanup around sniff/storage/RPC responses",()=>{
 assert.match(upload,/return await withPrivateEvidenceBuffer\(binary,async \(buffer\)=>\{/);
 const open=upload.indexOf("return await withPrivateEvidenceBuffer(binary");
 const sniff=upload.indexOf("const accepted=sniff(buffer,file.type)",open);
 const write=upload.indexOf("privateEvidenceStorage.put(key,buffer",sniff);
 const link=upload.indexOf('db.rpc(\n    "qf_vendor_attach_private_evidence"',write);
 const close=upload.indexOf("}); // Always clear this request-scoped private upload Buffer.",link);
 assert.ok(open>=0&&sniff>open&&write>sniff&&link>write&&close>link);
 assert.doesNotMatch(upload,/getPublicUrl\(|createSignedUrl\(/);
 assert.match(upload,/QF_VENDOR_PRIVATE_BUCKET_CERTIFIED==="staging"/);
 assert.match(upload,/status:"pending_scan_and_owner_review"/);
});
test("P2-Z5 scanner clears downloaded private bytes after hash mismatch and async scan error",()=>{
 const after=worker.slice(worker.indexOf("const bytes=Buffer.from(await download.data.arrayBuffer())"));
 assert.match(after,/const bytes=Buffer\.from\(await download\.data\.arrayBuffer\(\)\);\s*try\{/);
 assert.match(after,/bytes\.length!==download\.data\.size/);
 assert.match(after,/scanPrivateDocumentWithLocalClamav\(bytes\)/);
 assert.match(after,/finally\{bytes\.fill\(0\);\}/);
 assert.ok(after.indexOf("finally{bytes.fill(0);}")>after.indexOf("scanPrivateDocumentWithLocalClamav(bytes)"));
 assert.match(worker,/QF_VENDOR_PRIVATE_SCAN_ONCE_APPROVED/);
 assert.doesNotMatch(worker,/getPublicUrl\(|createSignedUrl\(/);
});
