import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../../../"+p,import.meta.url),"utf8");
const sql=read("ops/vendor-approval/pending/20261013160000_vendor_approval_event_fanout_v1.sql");
const notification=read("services/vendorNotificationService.ts");
const review=read("services/vendorProfileChangeService.ts");
const checks=[
 ["require certified prior audit",sql.includes("vendor_change_review_audit_v3")],
 ["consumers default to disabled",sql.includes("enabled boolean not null default false")],
 ["all four consumers disabled at creation",["anisha","automation","aos","agni"].every(k=>sql.includes("('"+k+"',false)"))],
 ["consumer and outbox have RLS",sql.match(/enable row level security/g)?.length===2],
 ["event audit identity unique",sql.includes("unique (audit_id,target)")],
 ["event emission is transaction trigger",sql.includes("after insert on public.vendor_change_review_audit_v3")],
 ["durable deduped dashboard notification",sql.includes("on conflict do nothing")&&sql.includes("'vendor_approval:'||new.request_id")],
 ["PII not projected into fanout payload",!/(?:'phone'|'email'|'proposed_changes'|'current_snapshot'|'rejection_reason')\s*,\s*new\./.test(sql)],
 ["lease-claim uses row locking",sql.includes("for update skip locked")],
 ["retries bounded and dead-lettered",sql.includes("'dead_letter'")&&sql.includes("max_attempts")],
 ["ack checks exact worker ownership",sql.includes("v.locked_by is distinct from p_worker_id")],
 ["service role RPC grants explicit",sql.match(/grant execute on function/g)?.length===2],
 ["client notification dedupe key support",notification.includes("dedupe_key?: string;")&&notification.includes("error?.code === \"23505\"")],
 ["approval/rejection carry stable receipt keys",review.match(/dedupe_key:/g)?.length===2&&review.includes(":approved")&&review.includes(":rejected")],
];
for (const [name,pass] of checks) {assert.ok(pass,"FAILED: "+name);console.log("PASS",name);}
console.log("Vendor Approval Event Bridge: "+checks.length+"/"+checks.length+" PASS. SQL requires separate database transaction certificate.");
