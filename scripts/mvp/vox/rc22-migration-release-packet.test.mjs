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

test("migration release packet rejects version collisions and keeps immutable source pins",async()=>{
 const {rc22AssertUniqueVersions,RC22_PINNED_SOURCE}=await import("./rc22-migration-release-packet.mjs");
 assert.throws(()=>rc22AssertUniqueVersions([
  "20261013144901_first.sql","20261013144901_second.sql"
 ]),/DUPLICATE_MIGRATION_VERSION/);
 assert.equal(rc22AssertUniqueVersions(["20261013144901_reviewed.sql"]),true);
 assert.throws(()=>rc22AssertUniqueVersions(["not-a-migration.sql"]),/MIGRATION_NAME_FORMAT_INVALID/);
 const packet=buildRc22MigrationPacket();
 assert.equal(packet.migrations.count,RC22_PINNED_SOURCE.count);
 assert.equal(packet.migrations.aggregateSha256,RC22_PINNED_SOURCE.aggregateSha256);
 assert.equal(packet.historicalFinance.sha256,RC22_PINNED_SOURCE.legacySha256);
 assert.equal(packet.financeCandidate.sha256,RC22_PINNED_SOURCE.candidateSha256);
});
