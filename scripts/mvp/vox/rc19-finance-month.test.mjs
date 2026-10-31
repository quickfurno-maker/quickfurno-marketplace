import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {indiaOrderMonth,selectBoundedFinanceMonth} from "../../../apps/vox-web/lib/financeMonth.mjs";

test("India month uses Asia/Kolkata across UTC and year boundaries",()=>{
 assert.equal(indiaOrderMonth("2026-09-30T18:29:59.000Z"),"2026-09");
 assert.equal(indiaOrderMonth("2026-09-30T18:30:00.000Z"),"2026-10");
 assert.equal(indiaOrderMonth("2026-12-31T18:29:59.000Z"),"2026-12");
 assert.equal(indiaOrderMonth("2026-12-31T18:30:00.000Z"),"2027-01");
 for(const invalid of [null,undefined,"not-a-date","",12])
  assert.equal(indiaOrderMonth(invalid),null);
});
test("only exact months within bounded Core snapshot are filterable",()=>{
 const months=["2026-10","2026-09"];
 assert.equal(selectBoundedFinanceMonth("2026-10",months),"2026-10");
 for(const value of ["2026-08","2026-13","2019-12","2026-1","2026-10?state=paid",
  null,undefined,["2026-10"]])
  assert.equal(selectBoundedFinanceMonth(value,months),null);
});
test("Finance UI preserves status and month filters without refund or revenue authority",()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
 const ui=readFileSync(resolve(root,"apps/vox-web/app/finance/page.tsx"),"utf8");
 assert.match(ui,/indiaOrderMonth\(o\.createdAt\)/);
 assert.match(ui,/selectBoundedFinanceMonth\(params\.month,months\)/);
 assert.match(ui,/Filter recent records by India month/);
 assert.match(ui,/financeHref\(state,selectedMonth\)/);
 assert.match(ui,/No matching records in this bounded Core preview/);
 assert.match(ui,/This page cannot refund, capture, reconcile, grant credits or activate packages/);
});
