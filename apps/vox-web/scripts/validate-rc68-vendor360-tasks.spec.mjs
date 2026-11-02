import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("..",import.meta.url);
const page=readFileSync(new URL("app/vendor360/page.tsx",root),"utf8");
const adapter=readFileSync(new URL("lib/core.ts",root),"utf8");
const core=readFileSync(new URL("../../services/vox/crmScopedReads.ts",root),"utf8");
test("real Vendor 360 shows a dedicated scoped Core task queue",()=>{
 assert.match(page,/const taskRows=r\.view\.tasks\.map/);
 assert.match(page,/<ScopedQueue kicker="TASKS" title="Assigned vendor follow-ups"/);
 assert.match(page,/Assigned vendor #/);
 assert.match(page,/No scoped vendor follow-up tasks/);
});
test("task rows remain Core-projected; no browser SQL, provider sends or elevated mutations",()=>{
 assert.match(adapter,/const tasks=array\(view\.tasks\)/);
 assert.match(core,/db\.from\("vendor_tasks"\)/);
 assert.match(core,/\.in\("vendor_id",verified\)/);
 assert.doesNotMatch(page,/createClient\(|service_role|NEXT_PUBLIC_SUPABASE|sendWhatsApp|chargeCredit\(/i);
});
