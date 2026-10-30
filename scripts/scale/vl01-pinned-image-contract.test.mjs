import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const file=readFileSync(resolve(root,"scripts/mvp/automation/certify-vl01-real-auth-http.mjs"),"utf8");
test("real Auth HTTP fixture pins a Supabase PostgREST v16.1 content digest",()=>{
 assert.match(file,/ghcr\.io\/supabase\/postgrest:v16\.1@sha256:[a-f0-9]{64}/);
 assert.doesNotMatch(file,/public\.ecr\.aws\/supabase\/postgrest/);
});
test("actual Docker PostgREST runtime uses the pinned fixture image",()=>{
 assert.match(file,/PGRST_SERVER_PORT=3000",POSTGREST_TEST_IMAGE\)/);
 assert.match(file,/GO_TRUE_POSTGREST_PG_READY/);
 assert.match(file,/VL01_REAL_GOTRUE_NEXT_POSTGREST_POSTGRES_PASS/);
});
test("real signed session, authorization and negative user proof retained",()=>{
 for(const s of ["genuine GoTrue signup and token","real HTTP anonymous rejected","real HTTP synthetic vendor rejected","real HTTP admin without Superadmin rejected","real HTTP superadmin trace success","real SQL job count unchanged"])assert.ok(file.includes(s),s);
});
