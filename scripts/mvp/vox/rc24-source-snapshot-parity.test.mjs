import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {buildRc23HistoryPacket,RC24_MANAGED_SNAPSHOT_SHA256,verifyRc24CapturedSource}
 from "./rc23-migration-adjudication.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const raw=readFileSync(resolve(root,
 "docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json"));
const captured=JSON.parse(raw.toString("utf8"));
const names=readdirSync(resolve(root,"supabase/migrations")).filter(n=>/^\d{14}_.+\.sql$/.test(n));
test("read-only managed capture is byte-pinned and its source names match 162 current SQL files",()=>{
 assert.equal(createHash("sha256").update(raw).digest("hex"),RC24_MANAGED_SNAPSHOT_SHA256);
 assert.equal(verifyRc24CapturedSource(captured,names),true);
 const packet=buildRc23HistoryPacket();
 assert.equal(packet.releaseGo,false);
 assert.equal(packet.appendOnlyCandidates,0);
 assert.equal(packet.historicalMissing,107);
});
test("equal-count filename replacement, duplicated version and stale capture deny",()=>{
 assert.throws(()=>verifyRc24CapturedSource(captured,
  names.map((n,i)=>i===0?"20260620000001_CHANGED.sql":n)),
  /RC24_CAPTURE_OR_LOCAL_SOURCE_DRIFT/);
 assert.throws(()=>verifyRc24CapturedSource(captured,
  [...names.slice(0,161),names[0]]),
  /RC24_CAPTURE_OR_LOCAL_SOURCE_DRIFT/);
 assert.throws(()=>verifyRc24CapturedSource({...captured,source_only:
  [...captured.source_only.slice(0,-1),"20990101010101_FAKE.sql"]},names),
  /RC24_CAPTURE_OR_LOCAL_SOURCE_DRIFT/);
});
