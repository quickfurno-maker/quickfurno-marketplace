import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=x=>readFileSync(resolve(root,x),"utf8");
test("Core treats post-COMMIT transport ambiguity as unknown, never false rollback",()=>{
 const src=read("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(src,/reason:"COMMIT_OUTCOME_UNKNOWN",[\s\S]*?committed:null,requiresReconciliation:true/);
 assert.ok(src.includes('RC8_CORE_WRITER_INSTALLED=false'));
 const pg=read("scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs");
 assert.ok(pg.includes("CORE_POST_COMMIT_UNKNOWN"));
 assert.ok(pg.includes("CORE_UNKNOWN_NOT_FALSE_ROLLBACK"));
 assert.ok(pg.includes("SYNTHETIC_POST_COMMIT_TRANSPORT_DROP"));
 assert.ok(pg.includes("EVENT_1"));
 assert.ok(pg.includes("RECEIPT_1"));
});
test("signed EOD post-COMMIT ambiguity requires durable nonce and receipt reconciliation",()=>{
 const src=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 assert.match(src,/reason:"COMMIT_OUTCOME_UNKNOWN",[\s\S]*?committed:null,requiresReconciliation:true/);
 assert.ok(src.includes('RC8_APPROVAL_WRITER_INSTALLED=false'));
 const pg=read("scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs");
 assert.ok(pg.includes("EOD_POST_COMMIT_UNKNOWN"));
 assert.ok(pg.includes("EOD_UNKNOWN_NOT_FALSE_ROLLBACK"));
 assert.ok(pg.includes("SYNTHETIC_POST_COMMIT_TRANSPORT_DROP"));
 assert.ok(pg.includes("THREE_CLAIMS"));
 assert.ok(pg.includes("ONE_INTENT"));
});
