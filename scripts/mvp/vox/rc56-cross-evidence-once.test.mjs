import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const sql=readFileSync(resolve(root,"ops/vox/rc42-review-candidates/20261101020000_vox_rc42_bad_lead_credit_only_atomic_REVIEW_ONLY.sql"),"utf8");
test("all restoration evidence types have one original-assignment uniqueness candidate",()=>{
 assert.match(sql,/RC56_CROSS_EVIDENCE_RESTORATION_COLLISION_REVIEW_REQUIRED/);
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS vox_rc56_all_evidence_once_per_original_assignment/);
 const full=sql.split("CREATE UNIQUE INDEX IF NOT EXISTS vox_rc56_all_evidence_once_per_original_assignment")[1]?.split("CREATE OR REPLACE FUNCTION")[0]||"";
 assert.match(full,/original_assignment_id/);
 assert.match(full,/status IN \('requested','approved','applied'\)/);
 assert.doesNotMatch(full,/evidence_type\s*=/);
 assert.match(sql,/GROUP BY original_assignment_id HAVING count\(\*\)>1/);
 assert.match(sql,/RC42_DUPLICATE_HISTORICAL_BAD_LEAD_APPROVALS_REVIEW_REQUIRED/);
});
test("review-only SQL requires human Owner approval and never refunds money or creates replacement",()=>{
 assert.match(sql,/UNINSTALLED/);
 assert.match(sql,/r.status NOT IN \('Approved','Valid'\)/);
 assert.match(sql,/a.credit_deducted IS DISTINCT FROM true/);
 assert.match(sql,/cash_refunded_minor_units',0/);
 assert.match(sql,/automatic_replacement_created',false/);
 assert.doesNotMatch(sql,/INSERT INTO public\.payment_refunds|UPDATE public\.payment_refunds/i);
});
