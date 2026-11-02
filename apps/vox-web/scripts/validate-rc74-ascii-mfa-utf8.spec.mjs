import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../app/mfa/page.tsx",import.meta.url),"utf8");
const form=readFileSync(new URL("../app/mfa/form.tsx",import.meta.url),"utf8");
test("premium MFA glyph source uses ASCII-only escaped entities to survive Windows Staging builds",()=>{
 for(const src of [page,form]){
  assert.doesNotMatch(src,/[^\x00-\x7f]/);
  assert.doesNotMatch(src,/\uFFFD|\u001a/);
 }
 assert.match(page,/&#x2713;/);
 assert.match(page,/&copy; QuickFurno &middot; Internal operations/);
 assert.match(page,/Encrypted &middot; Authorized personnel only/);
 assert.match(form,/&rarr;/);
 assert.match(form,/Six digits &middot; Codes refresh/);
});
test("real MFA remains AAL2 verified, six-digit constrained, and return path safe",()=>{
 assert.match(form,/\/api\/auth\/mfa/);
 assert.match(form,/safeReturnPath\(next\)/);
 assert.match(form,/pattern="\[0-9\]\{6\}"/);
 assert.match(form,/disabled=\{busy\|\|!complete\}/);
 assert.match(page,/withReturn\("\/mfa\/enroll",next\)/);
});
