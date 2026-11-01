import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const sql=read("ops/vox/rc42-review-candidates/20261101020000_vox_rc42_bad_lead_credit_only_atomic_REVIEW_ONLY.sql");
test("reviewed SQL rejects replay status as proof of newly granted LEAD credit",()=>{
 assert.match(sql,/RC60_CANONICAL_CREDIT_NOT_NEWLY_APPLIED/);
 assert.match(sql,/coalesce\(credit->>'status',''\) <> 'applied'/);
 assert.match(sql,/nullif\(credit->>'ledger_id',''\) IS NULL/);
 assert.doesNotMatch(sql,/credit->>'status',''\) NOT IN \('applied','already_applied'\)/);
});
test("canonical ledger receipt must match original consumed assignment and approval",()=>{
 assert.match(sql,/RC60_CANONICAL_LEDGER_RECEIPT_MISMATCH/);
 assert.match(sql,/WHERE id=approval_id AND original_assignment_id=a.id/);
 assert.match(sql,/vendor_id=a.vendor_id AND status='applied'/);
 assert.match(sql,/restoration_ledger_id=\(credit->>'ledger_id'\)::uuid/);
 assert.match(sql,/cash_refunded_minor_units',0/);
 assert.match(sql,/automatic_replacement_created',false/);
 assert.match(read("services/badLeadRecoveryService.ts"),/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
});
