import test from "node:test";import assert from "node:assert/strict";
import {buildFinanceReviewManifest} from "./financePay4bSqlReview.mjs";
import {inspectPay4bSourceReadiness} from "./financePay4bReadiness.mjs";
import {readFileSync} from "node:fs";import path from "node:path";
const root=path.resolve(import.meta.dirname,"../../..");
test("PAY4B1 pinned SQL candidate review pack source-only",()=>{
 const a=buildFinanceReviewManifest({root});
 assert.equal(a.checksPassed,true,JSON.stringify(a.issues));assert.equal(a.candidateCount,12);
 assert.ok(a.hashes.every(x=>/^[0-9a-f]{64}$/.test(x.sha256)));
 assert.equal(a.applySqlAuthorized,false);assert.equal(a.stagingAuthorized,false);
});
test("PAY4B1 tampered SQL candidate rejected",()=>{
 const original=readFileSync;
 const a=buildFinanceReviewManifest({root,read:p=>
   String(p).includes("20261022090200")?Buffer.from("tampered"):original(p)});
 assert.equal(a.hashes[1].sha256===buildFinanceReviewManifest({root}).hashes[1].sha256,false);
});
test("PAY4B5 signed-source fingerprint does not authorize actual deployment",()=>{
 const a=inspectPay4bSourceReadiness({root});
 assert.equal(a.sourceIntegrityOk,true,JSON.stringify(a.issues));
 assert.equal(a.releaseStatus,"HOLD");assert.equal(a.productionAllowed,false);
 assert.equal(a.requiresExternalDBA,true);assert.equal(a.workerScheduled,false);
});
test("PAY4B5 finance flags present fail source preflight",()=>{
 const a=inspectPay4bSourceReadiness({root,env:{FINANCE_V2_PAY4A_CRON_ENABLED:"staging"}});
 assert.equal(a.sourceIntegrityOk,false);
 assert.ok(a.issues.includes("FINANCE_MUTATION_FEATURE_FLAG_PRESENT"));
});
test("PAY4B3 guarded vendor search is paginated and rechecks scope",()=>{
 const code=readFileSync(path.join(root,"app/api/vox/v1/finance-orders/route.ts"),"utf8");
 assert.match(code,/FINANCE_V2_PAY4B_ORDER_SEARCH_ENABLED!=="staging"/);
 assert.match(code,/financeStaffAllowed\(fresh,vendorId\)/);
 assert.match(code,/\.eq\("vendor_id",vendorId\)/);
 assert.match(code,/\.range\(page\*20,page\*20\+20\)/);
 assert.doesNotMatch(code,/\.insert\(|\.delete\(|\.update\(/);
});
test("PAY4B2 expired lease recovery remains service-role only",()=>{
 const sql=readFileSync(path.join(root,
 "ops/finance/sql-candidates/20261022145000_finance_v2_pay4b_inbox_recovery_candidate.sql"),"utf8");
 assert.match(sql,/for update skip locked/i);
 assert.match(sql,/state='DEAD_LETTER'/);
 assert.match(sql,/revoke all on function public.qf_finance_v2_expire_exhausted_inbox/);
});
