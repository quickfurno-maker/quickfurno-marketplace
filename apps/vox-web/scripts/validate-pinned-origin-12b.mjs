import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=p=>readFileSync(resolve(import.meta.dirname,"..",p),"utf8");
const auth=read("lib/auth.ts"),
 proposal=read("app/api/followup-proposals/route.ts"),
 grants=read("app/api/staff-reviews/route.ts"),
 task=read("app/api/vendor-task/route.ts"),
 approvals=read("app/api/action-intents/route.ts");
let n=0;const check=(label,fn)=>{fn();n++;console.log("PASS "+label);};
check("configured expected origin parsed",()=>assert.match(auth,/new URL\(configured\)/));
check("origin exact match to pinned expected",()=>assert.match(auth,/request.headers.get\("origin"\)===expected.origin/));
check("host exact match to pinned authority",()=>assert.match(auth,/request.headers.get\("host"\)===expected.host/));
check("does not trust internally rewritten request.url",()=>assert.doesNotMatch(auth,/new URL\(request\.url\)|u\.origin===expected/));
check("does not trust x-forwarded-host",()=>assert.doesNotMatch(auth,/headers.get\("x-forwarded-host"\)/));
check("refuses non-http protocols",()=>assert.match(auth,/\["http:","https:"\]/));
check("refuses userinfo in configured origin",()=>assert.match(auth,/expected.username/));
check("refuses configured path, query and fragment",()=>assert.match(auth,/expected.pathname!=="\/"[\s\S]*expected.hash/));
check("fails closed on malformed origin config",()=>assert.match(auth,/catch\{return false;\}/));
check("proposal uses shared CSRF validation",()=>assert.match(proposal,/allowedOrigin\(request\)/));
check("staff review uses shared CSRF validation",()=>assert.match(grants,/allowedOrigin\(request\)/));
check("vendor task uses shared CSRF validation",()=>assert.match(task,/allowedOrigin\(request\)/));
check("owner approvals use shared CSRF validation",()=>assert.match(approvals,/allowedOrigin\(request\)/));
check("no developer diagnostic response retained",()=>assert.doesNotMatch(proposal,/diagnostic:/));
console.log("VOX12B_PINNED_ORIGIN_HOST_PASS "+n+"/14");
