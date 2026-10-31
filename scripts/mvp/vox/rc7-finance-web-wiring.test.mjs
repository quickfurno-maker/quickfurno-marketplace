import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const bff=read("apps/vox-web/lib/core.ts");
const page=read("apps/vox-web/app/finance/page.tsx");
const nav=read("apps/vox-web/app/operations/page.tsx");
const overview=read("app/api/vox/v1/overview/route.ts");
test("Finance web BFF requires local verified MFA plus pinned Core origin",()=>{
 const fn=bff.slice(bff.indexOf("export async function fetchOwnerFinancePreview()"),
  bff.indexOf("export async function fetchStaffOverview()"));
 assert.ok(fn.length>100);
 assert.match(fn,/VOX_FINANCE_READ_UI_ENABLED!=="staging"/);
 assert.match(fn,/VOX_STAFF_PORTAL_ENABLED!=="staging"/);
 assert.match(fn,/verifiedMfaSession\(\)/);assert.match(fn,/const base=origin\(\)/);
 assert.match(fn,/cache:"no-store"/);assert.match(fn,/redirect:"error"/);
 assert.match(fn,/\/api\/vox\/v1\/finance/);
 assert.match(fn,/canRefund!==false/);assert.match(fn,/canReconcile!==false/);
 assert.match(fn,/hasProviderConfirmation!==false/);
 assert.match(fn,/isCompleteHistory!==false/);
 assert.match(fn,/for\(const raw of v.orders\)/);
 assert.doesNotMatch(fn,/\.rpc\(|\.insert\(|\.update\(|\.delete\(|razorpayFetch\(/);
});
test("Finance page is a read-only projection with explicit incompleteness and safe navigation",()=>{
 assert.match(page,/fetchOwnerFinancePreview/);
 assert.match(page,/recordedOrderAmount/);assert.match(page,/not independent confirmation/);
 assert.match(page,/cannot refund, capture, reconcile, grant credits or activate/);
 assert.doesNotMatch(page,/\bfetch\(|adminClient|provider_payment_id|RAZORPAY_/);
 assert.match(nav,/href="\/finance"/);
});
test("Owner overview now revalidates current AAL2 after sensitive reads",()=>{
 assert.equal((overview.match(/await verifyVoxOwnerBearer\(/g)||[]).length,2);
 assert.match(overview,/OWNER_AUTH_REVOKED_DURING_READ/);
 assert.match(overview,/no-store/);
});
