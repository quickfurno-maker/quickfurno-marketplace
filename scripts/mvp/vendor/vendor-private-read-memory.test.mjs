import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {decodeVerifiedPrivateObject} from "../../../lib/vendors/decodeVerifiedPrivateObject.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const adapter=readFileSync(resolve(root,"lib/storage/supabaseObjectStorage.ts"),"utf8");

test("P2-R1 correctly sized private object survives authenticated download byte comparison",async()=>{
 const original=Uint8Array.from([37,80,68,70,45,49,46,55,10,12,13]);
 const got=await decodeVerifiedPrivateObject({size:original.byteLength,arrayBuffer:async()=>original.buffer});
 assert.ok(got instanceof Uint8Array);
 assert.deepEqual(got,original);
 assert.ok(got.some(x=>x!==0));
 got.fill(0);
});
test("P2-R2 mismatched private Storage length fails closed and zeroes decoded working bytes",async()=>{
 const bytes=Uint8Array.from([37,80,68,70,45,49,46,55,10]);
 const result=await decodeVerifiedPrivateObject({size:bytes.length+1,arrayBuffer:async()=>bytes.buffer});
 assert.equal(result,null);
 assert.ok(bytes.every(x=>x===0),"malformed provider response must not retain private bytes");
});
test("P2-R3 oversized observed length versus declared size is also discarded and cleared",async()=>{
 const bytes=Uint8Array.from([1,2,3,4,5,6,7,8,9]);
 assert.equal(await decodeVerifiedPrivateObject({size:8,arrayBuffer:async()=>bytes.buffer}),null);
 assert.ok(bytes.every(x=>x===0));
});
test("P2-R4 download errors propagate without manufacturing evidence",async()=>{
 await assert.rejects(decodeVerifiedPrivateObject({
  size:9,arrayBuffer:async()=>{throw new Error("SYNTHETIC_PRIVATE_STORAGE_FAILURE");}
 }),/SYNTHETIC_PRIVATE_STORAGE_FAILURE/);
});
test("P2-R5 real Storage adapter uses verified decoder after private bucket, size and key checks",()=>{
 assert.match(adapter,/await assertPrivate\(\);/);
 assert.match(adapter,/data\.size < 8 \|\| data\.size > maxBytes/);
 assert.match(adapter,/return await decodeVerifiedPrivateObject\(data\);/);
 assert.match(adapter,/qf-vendor-verification-private/);
 assert.doesNotMatch(adapter.slice(adapter.indexOf("export function createPrivateVendorEvidenceStorage")) , /getPublicUrl\(|createSignedUrl\(/);
});
