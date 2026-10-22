import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const source=(x)=>readFileSync(resolve(root,x),"utf8");
test("PAY3A Finance endpoint defaults OFF, requires owner AAL2 twice and blocks mutations",()=>{
 const r=source("app/api/vox/v1/finance-history/route.ts");
 assert.match(r,/FINANCE_V2_PAY3_READ_ENABLED!=="staging"/);
 assert.match(r,/VOX_STAFF_PORTAL_ENABLED!=="staging"/);
 assert.equal((r.match(/verifyVoxOwnerBearer\(/g)||[]).length,2);
 assert.match(r,/OWNER_AUTH_REVOKED_DURING_FINANCE_READ/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.match(r,new RegExp("export function "+method+"\\(\\).*FINANCE_READ_ONLY"));
 assert.doesNotMatch(r,/\.insert\(|\.update\(|\.delete\(|createRefund|activatePackage/);
});
test("PAY3A VOX web uses same verified MFA and strict Core origin, never tokens in client",()=>{
 const r=source("apps/vox-web/lib/finance.ts"),p=source("apps/vox-web/app/finance/page.tsx");
 assert.match(r,/verifiedMfaSession\(\)/);assert.match(r,/origin\(\)/);
 assert.match(r,/VOX_FINANCE_PAY3_UI_ENABLED!=="staging"/);
 assert.match(r,/response\.json\(\)/);assert.match(r,/actionsEnabled!==false/);
 assert.doesNotMatch(p,/service_role|localStorage|NEXT_PUBLIC_RAZORPAY/);
});
test("PAY3B-C-D no provider outbound and database candidate is quarantined",()=>{
 const s=source("lib/payments/financeV2Pay3.mjs");
 assert.doesNotMatch(s,/fetch\(|https:|axios|adminClient|service_role/);
 assert.match(s,/creditActivationAllowed:false/);
 assert.match(s,/gatewayExecutionAllowed:false/);
 assert.match(s,/bankStatementVerified:false/);
 const sql=source("ops/finance/sql-candidates/20261022120100_finance_v2_pay3_evidence_candidate.sql");
 assert.match(sql,/force row level security/);
 assert.match(sql,/finance_manual_receipt_evidence/);
 assert.match(sql,/submitted_by<>independently_verified_by/);
 assert.match(sql,/qf_finance_v2_reject_history_mutation/);
 assert.equal(existsSync(resolve(root,"supabase/migrations/20261022120100_finance_v2_pay3_evidence_candidate.sql")),false);
});
