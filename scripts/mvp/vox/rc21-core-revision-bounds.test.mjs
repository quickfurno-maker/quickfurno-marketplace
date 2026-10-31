import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("both verified Core adapter and native transaction reject int4 revision overflow",()=>{
 const native=read("services/vox/rc8PgVendorConversationOperator.ts");
 const adapter=read("services/vox/rc19VerifiedConversationWriter.ts");
 assert.match(native,/input\.expectedRevision>2147483646/);
 assert.match(adapter,/c\.expectedRevision as number\)<=2147483646/);
 assert.match(native,/input\.expectedRevision\+1/);
 assert.match(adapter,/RC19_VERIFIED_CORE_WRITER_INSTALLED=false/);
 assert.match(native,/RC8_CORE_WRITER_INSTALLED=false/);
});
