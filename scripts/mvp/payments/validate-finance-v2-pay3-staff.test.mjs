import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateFinanceReadGrant as eligible} from "../../../contracts/vox/financeReadGrant.mjs";
const ids={
 staff:"10000000-0000-4000-8000-000000000001",
 team:"10000000-0000-4000-8000-000000000002",
 city:"10000000-0000-4000-8000-000000000003",
 vendor:"10000000-0000-4000-8000-000000000004",
 request:"10000000-0000-4000-8000-000000000005",
 approve:"10000000-0000-4000-8000-000000000006",
 grant:"10000000-0000-4000-8000-000000000007",
 reference:"10000000-0000-4000-8000-000000000008"
};
const scope=()=>({userId:ids.staff,teamId:ids.team,cityId:ids.city,
 role:"vendor_success_agent",verifiedDepartments:["vendor_success"],vendorIds:[ids.vendor],
 canReadContent:true});
const grant=()=>({id:ids.grant,staff_user_id:ids.staff,team_id:ids.team,
 city_id:ids.city,vendor_id:ids.vendor,requested_by:ids.request,
 approved_by:ids.approve,approval_reference:ids.reference,
 expires_at:"2030-01-01T00:00:00.000Z"});
const input=()=>({scope:scope(),grant:grant(),revoked:false,
 vendorId:ids.vendor,now:Date.parse("2026-10-22T00:00:00Z")});
test("PAY3A finance read needs current independent grant AND assigned vendor/finance department",()=>{
 assert.equal(eligible(input()),true);
 assert.equal(eligible({...input(),revoked:true}),false);
 assert.equal(eligible({...input(),scope:{...scope(),vendorIds:[]}}),false);
 assert.equal(eligible({...input(),scope:{...scope(),verifiedDepartments:["acquisition"]}}),false);
 assert.equal(eligible({...input(),scope:{...scope(),role:"auditor"}}),false);
 assert.equal(eligible({...input(),grant:{...grant(),approved_by:ids.staff}}),false);
 assert.equal(eligible({...input(),grant:{...grant(),requested_by:ids.approve}}),false);
 assert.equal(eligible({...input(),grant:{...grant(),expires_at:"2020-01-01T00:00:00Z"}}),false);
});
test("PAY3A source route rechecks AAL2, staff assignment and revocation after read",()=>{
 const route=readFileSync(new URL("../../../app/api/vox/v1/finance-history/route.ts",import.meta.url),"utf8");
 assert.match(route,/FINANCE_V2_STAFF_READ_ENABLED==="staging"/);
 assert.match(route,/getVerifiedScopedStaff\(bearer\)/);
 assert.match(route,/financeStaffAllowed\(staff,order\.data\.vendor_id\)/);
 assert.match(route,/financeStaffAllowed\(refreshed,order\.data\.vendor_id\)/);
 assert.match(route,/FINANCE_STAFF_AUTH_REVOKED_DURING_READ/);
 assert.doesNotMatch(route,/\.insert\(|\.update\(|\.delete\(/);
});
