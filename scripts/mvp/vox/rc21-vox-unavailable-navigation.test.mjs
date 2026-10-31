import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("unavailable Vendor 360 routes real MFA failure to login, Core denial to operations",()=>{
 const page=read("apps/vox-web/app/vendor360/page.tsx");
 assert.match(page,/fetchScopedCrm\("vendor360"\)/);
 assert.match(page,/r\.status===401\?"\/login":"\/operations"/);
 assert.match(page,/r\.status===403/);
 assert.match(page,/No vendor state was modified/);
 assert.doesNotMatch(page,/adminClient|\.rpc\(/);
});
test("Operations does not send verified sessions back into a login loop when Core fails",()=>{
 const page=read("apps/vox-web/app/operations/page.tsx");
 assert.match(page,/fetchStaffOverview\(\)/);
 assert.match(page,/result\.status===401\?<Link href="\/login">Staff sign-in<\/Link>/);
 assert.match(page,/retry after Core connectivity or authorization is restored/);
 assert.match(page,/Read-only Core projection/);
});
