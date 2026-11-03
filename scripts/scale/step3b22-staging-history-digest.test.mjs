import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const base=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const path=resolve(base,"ops/vox/sql-review/STEP3B22-STAGING-PROTECTED-HISTORY-DIGEST-READ_ONLY.sql");
const sql=readFileSync(path,"utf8");
const executable=sql.split("\n").filter(s=>!s.trim().startsWith("--")).join("\n");
test("H1 digest query is in a read-only transaction which rolls back",()=>{
 assert.match(executable,/^BEGIN READ ONLY;/m);
 assert.match(executable,/^SET LOCAL TIME ZONE 'UTC';/m);
 assert.match(executable,/^ROLLBACK;/m);
 assert.doesNotMatch(executable,/\b(?:CREATE|ALTER|DROP|TRUNCATE|DELETE|INSERT|UPDATE|GRANT|REVOKE|COPY|EXECUTE|DO|CALL|PERFORM)\b/i);
});
test("H2 digest query covers all four protected Staging history families",()=>{
 for(const name of ["lead_assignment_events","vendor_campaign_audience_members",
  "vendor_internal_notes","automation_action_requests"])
  assert.ok(sql.includes("public."+name),name);
});
test("H3 digest query does not select or display raw rows/PII",()=>{
 assert.match(sql,/sha256\(convert_to/);
 assert.match(sql,/string_agg\(canonical,E'/);
 assert.match(sql,/ORDER BY canonical/);
 assert.match(sql,/SELECT family,count\(\*\) AS row_count,encode/);
 assert.doesNotMatch(sql,/SELECT\s+\*/i);
 assert.doesNotMatch(sql,/\b(?:phone|mobile|email|aadhaar|password)\b/i);
});
test("H4 target selection includes vendor, lead and assignment UUIDs",()=>{
 assert.match(sql,/SELECT a\.id::text FROM public\.lead_assignments/);
 assert.match(sql,/lower\(trim\(coalesce\(city,''\)\)\) IN \('pune','mumbai'\)/);
 assert.match(sql,/to_jsonb\(x\)::text ~\* \(SELECT p FROM pat\)/);
});
