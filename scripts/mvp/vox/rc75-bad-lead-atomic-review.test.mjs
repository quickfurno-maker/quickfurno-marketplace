import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const path=resolve(root,"ops/vox/rc75-review-only/20261102040000_vox_rc75_bad_lead_review_atomic_REVIEW_ONLY.sql");
const sql=readFileSync(path,"utf8");
test("review-only canonical bad-lead status candidate is one atomic SQL transaction",()=>{
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/COMMIT;/);
 assert.match(sql,/LANGUAGE plpgsql SECURITY INVOKER/);
 assert.match(sql,/FROM public\.bad_lead_reports WHERE id=p_report_id FOR UPDATE/);
 assert.match(sql,/FROM public\.lead_assignments\s+WHERE id=v_assignment FOR UPDATE/);
 assert.match(sql,/UPDATE public\.bad_lead_reports SET/);
 assert.match(sql,/UPDATE public\.lead_assignments SET is_bad_lead_reported=true/);
 assert.match(sql,/v_flagged:=NULL/);
 assert.match(sql,/BAD_LEAD_ASSIGNMENT_UPDATE_FAILED/);
 assert.match(sql,/REVOKE ALL ON FUNCTION .* FROM PUBLIC/);
 assert.match(sql,/leadCreditsIssued',0/);
 assert.match(sql,/providerMessagesSent',0/);
 assert.doesNotMatch(sql,/CREATE.*(?:wallet|vendor_credit_logs|credit_restoration_approvals)/i);
});
test("SQL is quarantined away from managed migrations, and release flag is absent",()=>{
 assert.match(path,/ops[/\\]vox[/\\]rc75-review-only[/\\]/);
 assert.match(path,/REVIEW_ONLY\.sql$/);
 assert.match(sql,/DO NOT install on managed Staging or Production/);
 assert.doesNotMatch(sql,/(?:GRANT\s+EXECUTE|SECURITY\s+DEFINER|refunded_minor_units|cash_refund)/i);
});
