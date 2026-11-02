import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const s=readFileSync(resolve(root,"ops/vox/rc42-review-candidates/20261101020000_vox_rc42_bad_lead_credit_only_atomic_REVIEW_ONLY.sql"),"utf8");
const t=readFileSync(resolve(root,"scripts/mvp/vox/validate-vox-rc42-credit-only-pg17.ps1"),"utf8");
test("index identity must be checked despite IF NOT EXISTS",()=>{
 assert.match(s,/RC57_CROSS_EVIDENCE_INDEX_DEFINITION_UNTRUSTED/);
 for(const v of ["indisunique","indisvalid","indisready","indnkeyatts=1","indexprs IS NULL","indpred IS NOT NULL","pg_get_expr","evidence_type"])
  assert.ok(s.includes(v),"missing index shape check "+v);
 assert.match(t,/spoofed same-name non-unique index fails reviewed SQL candidate/);
 assert.match(t,/RunFile \$candidate 'rc42-candidate.sql'/);
});
test("no money, no replacement, all evidence share one original assignment",()=>{
 assert.match(s,/vox_rc56_all_evidence_once_per_original_assignment/);
 assert.match(s,/RC56_CROSS_EVIDENCE_RESTORATION_COLLISION_REVIEW_REQUIRED/);
 assert.match(s,/cash_refunded_minor_units',0/);
 assert.match(s,/automatic_replacement_created',false/);
});
