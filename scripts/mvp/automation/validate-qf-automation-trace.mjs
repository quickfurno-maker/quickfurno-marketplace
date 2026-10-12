import assert from "node:assert/strict";
import { isAutomationTraceJobId, safeTraceCode, sortTraceEvents, traceStateForStatus } from "../../../lib/automation/studioTraceContract.ts";

assert.equal(safeTraceCode("QF_EXEC_VARIABLES_UNRESOLVED"), "QF_EXEC_VARIABLES_UNRESOLVED");
assert.equal(safeTraceCode("vendor.response_reminder"), "vendor.response_reminder");
assert.equal(safeTraceCode("phone:+919876543210 somebody's response"), null);
assert.equal(safeTraceCode("<script>alert(1)</script>"), null);
assert.equal(safeTraceCode("A".repeat(101)), null);
assert.equal(traceStateForStatus("authorized"), "observed");
assert.equal(traceStateForStatus("failed"), "failed");
assert.equal(traceStateForStatus("cancelled"), "cancelled");
assert.equal(traceStateForStatus("uncertain"), "unknown");
assert.equal(isAutomationTraceJobId("1454c402-9e58-4be4-9dba-dcd4b23bd55c"), true);
assert.equal(isAutomationTraceJobId("00000000-0000-0000-0000-000000000000"), false);
assert.equal(isAutomationTraceJobId("z".repeat(36)), false);
assert.equal(isAutomationTraceJobId("12345678-0000-0000-0000-000000000000"), false);
assert.equal(traceStateForStatus("provider_delivered"), "unknown");
const records=[
  {id:"2",at:"2026-10-10T12:00:02Z",source:"queue",title:"B",detail:"",state:"observed",safeCode:null},
  {id:"1",at:"2026-10-10T12:00:01Z",source:"core",title:"A",detail:"",state:"observed",safeCode:null},
  {id:"0",at:"2026-10-10T12:00:02Z",source:"worker",title:"C",detail:"",state:"observed",safeCode:null},
];
assert.deepEqual(sortTraceEvents(records).map((x)=>x.id),["1","0","2"]);
assert.deepEqual(records.map((x)=>x.id),["2","1","0"],"sort must not modify original");
console.log("PASS Automation Studio trace contract: safe codes, statuses, stable chronological ordering.");
