import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildRc22MigrationPacket} from "./rc22-migration-release-packet.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("DB release packet binds exact historical and review-only file hashes, never authorizes GO",()=>{
 const p=buildRc22MigrationPacket();
 assert.equal(p.status,"HOLD");
 assert.equal(p.releaseGo,false);
 assert.equal(p.managedDatabaseInspected,false);
 assert.ok(p.migrations.count>=100);
 assert.match(p.migrations.aggregateSha256,/^[0-9a-f]{64}$/);
 for(const k of ["historicalFinance","financeCandidate"]){
  assert.equal(p[k].sha256,createHash("sha256").update(readFileSync(resolve(root,p[k].path))).digest("hex"));
 }
 assert.equal(p.financeCandidate.installed,false);
 assert.ok(p.requiredExternalEvidence.includes("INDEPENDENT_DBA_APPSEC_ADJUDICATION"));
 assert.equal(JSON.stringify(p).includes("password"),false);
});
test("DB handoff emits no write-capable SQL or managed DB requests",()=>{
 const s=readFileSync(resolve(root,"scripts/mvp/vox/rc22-migration-release-packet.mjs"),"utf8");
 assert.doesNotMatch(s,/\bfetch\s*\(|\.query\(|\.rpc\(|\bexecFileSync\(|\bspawnSync\(|\bprocess\.env\b/);
 assert.match(s,/releaseGo:false/);
});
