import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const a=resolve(root,"app/api/vox/v1/staff-department-actions/route.ts");
const b=resolve(root,"app/api/vox/v1/staff-departments/route.ts");
test("never compile both competing department mutation HTTP implementations",()=>{
 // At most one is permitted in a future reviewed integrated candidate.
 assert.equal(existsSync(a)&&existsSync(b),false,
  "TWO_ACTIVE_DEPARTMENT_ROUTES_FORBIDDEN: independent canonical-chain selection required");
});
test("unreviewed TO-02C SQL candidates never silently enter managed migrations",()=>{
 const folder=resolve(root,"supabase/migrations");
 const matches=existsSync(folder)?readdirSync(folder).filter(x=>
  /vox_to02c_(?:reviewed_department_actions|staff_department_atomic_actions)/.test(x)):[];
 assert.deepEqual(matches,[],"UNREVIEWED_GRANT_SQL_MIGRATION_BLOCKED");
});
