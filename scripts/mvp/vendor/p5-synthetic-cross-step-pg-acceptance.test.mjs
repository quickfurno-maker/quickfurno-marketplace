import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {PG17_STEPS,MIGRATION_COUNT} from "./p4-disposable-pg17-recovery.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const filename="scripts/mvp/vendor/p5-synthetic-cross-step-pg-acceptance.sql";
test("P5-J1 complete synthetic journey executes AFTER all seven vendor SQL and scan tests",()=>{
 assert.equal(MIGRATION_COUNT,7);
 assert.equal(PG17_STEPS.at(-1),filename);
 const scan=PG17_STEPS.indexOf("scripts/mvp/vendor/vendor-private-scan-pg-acceptance.sql");
 const owner=PG17_STEPS.indexOf("scripts/mvp/vendor/vendor-owner-assignment-pg-acceptance.sql");
 assert.ok(scan>owner);
 assert.ok(PG17_STEPS.indexOf(filename)>scan);
 assert.equal(PG17_STEPS.length,18);
});
test("P5-J2 cross-stage fixture proves Pending remains inactive and credits/lead not minted",()=>{
 const sql=readFileSync(resolve(root,filename),"utf8");
 for(const marker of [
  "P5_SYNTHETIC_SCANNED_CASE_NOT_READY",
  "P5_SYNTHETIC_CASE_APPROVAL_AUTO_ACTIVATED_VENDOR",
  "P5_SYNTHETIC_PENDING_VENDOR_GAINED_OPERATIONS",
  "P5_SYNTHETIC_CLEAN_CASE_MISSING_IMMUTABLE_RECEIPT",
  "P5_SYNTHETIC_REVOKED_CONSENT_READY_FOR_APPROVAL",
  "P5_SYNTHETIC_REVIEW_AUTO_ASSIGNED_LEAD"
 ]) assert.ok(sql.includes(marker),marker);
 assert.match(sql,/qf_vendor_verification_case_ready\(v_ready\)/);
 assert.match(sql,/verification_scan_receipts/);
 assert.match(sql,/remaining_credits/);
 assert.match(sql,/lead_assignments/);
});
test("P5-J3 synthetic acceptance cannot be promoted to real provider, managed or billing evidence",()=>{
 const sql=readFileSync(resolve(root,filename),"utf8");
 assert.match(sql,/Disposable networkless PostgreSQL ONLY/);
 assert.doesNotMatch(sql,/create extension|\\copy|copy\s+.+program|http_post|net\.http|https?:\/\//i);
 const runner=readFileSync(resolve(root,"scripts/mvp/vendor/p4-disposable-pg17-recovery.mjs"),"utf8");
 assert.match(runner,/--network","none"/);
 assert.match(runner,/--pull=never/);
 assert.match(runner,/actualStagingRestored:false/);
 assert.match(runner,/canDeploy:false/);
 assert.match(runner,/releaseDecision:"HOLD"/);
});
