import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const text=readFileSync(resolve(import.meta.dirname,"validate-vox-action-eod-disabled-20261030.mjs"),"utf8");
let n=0;function check(name,test){test();n++;console.log("PASS",name);}
check("Staging only",()=>assert.match(text,/ORIGIN="https:\/\/staging-core\.quickfurno\.in"/));
check("no authorization credentials or mutation payloads",()=>assert.doesNotMatch(text,/authorization:|process\.env\.SUPABASE|body:|process\.env\.SERVICE_ROLE_KEY/i));
check("post request is empty and denied before handler",()=>assert.match(text,/method:"POST",expected:post\?503:404/));
check("protects work transition and EOD",()=>{for(const p of ["work-transitions","eod-preview","eod-source-status"])assert.ok(text.includes(p));});
check("post read EOD is 503",()=>assert.match(text,/method:"GET",expected:post\?503:404/));
check("no body in diagnostics",()=>assert.doesNotMatch(text,/console\.log\([^\n]*responseBody/));
check("timeouts fail closed",()=>assert.match(text,/AbortSignal\.timeout\(6500\)/));
console.log("VOX_ACTION_EOD_NEGATIVE_HTTP_CONTRACT_PASS "+n+"/"+n);
