import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 checkEnvTemplate,checkRuntimeSourceForDirectPg,checkPackageJson,checkRc38Reader,
 checkWorkflow,checkGateWiring,runGate,RC38_DB_SOURCE,RC17_WORKFLOW,REVIEWED_DIRECT_PG_RUNTIME_FILES
} from "./rc39-protected-features-off-gate.mjs";

test("the real checkout passes the gate (no skip, no downgrade)",()=>{
 assert.deepEqual(runGate(),[]);
});
test("no direct-pg runtime file has been pre-approved",()=>{
 assert.deepEqual(REVIEWED_DIRECT_PG_RUNTIME_FILES,[]);
});

test("env flags: any enabled VOX flag fails, disabled/commented passes",()=>{
 assert.deepEqual(checkEnvTemplate("e","VOX_STAFF_PORTAL_ENABLED=disabled\nVOX_STAFF_VIEW_MODE=disabled\n# VOX_STAFF_VIEW_MODE=dual\nVOX_CORE_ORIGIN=https://x\n"),[]);
 for(const v of ["VOX_STAFF_PORTAL_ENABLED=staging","VOX_STAFF_PORTAL_ENABLED=enabled","VOX_STAFF_VIEW_MODE=owner",
  "VOX_DEMO_PREVIEW=true","VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED=\"on\"","export VOX_WORK_QUEUE_UI_ENABLED=1",
  "RC38_SIGNED_EOD_REVIEW_ENABLED=true"])
  assert.equal(checkEnvTemplate("e",v).length,1,v);
});
test("env templates in the repo contain every flag as disabled",()=>{
 const t=readFileSync(new URL("../../../apps/vox-web/.env.example",import.meta.url),"utf8");
 assert.match(t,/^VOX_STAFF_PORTAL_ENABLED=disabled$/m);
 assert.deepEqual(checkEnvTemplate("apps/vox-web/.env.example",t),[]);
});

test("direct pg: imports, requires, indirect specifiers and pools are all caught",()=>{
 for(const s of [
  'import {Pool} from "pg";','const pg=require("pg");','const m=await import("pg");',
  'const specifier="pg"; await import(/* webpackIgnore: true */ specifier);',
  'await import(/* webpackIgnore: true */ "pg")','const p=new Pool({connectionString:u});',
  'const p=new pg.Pool({});','new Client({connectionString:u})'])
  assert.ok(checkRuntimeSourceForDirectPg("services/x.ts",s).length>0,s);
 assert.deepEqual(checkRuntimeSourceForDirectPg("services/x.ts",'// new Pool() was removed\n/* import("pg") */\nconst a=1;'),[]);
});
test("package.json: pg only allowed as devDependency",()=>{
 assert.deepEqual(checkPackageJson("p",JSON.stringify({devDependencies:{pg:"8"}})),[]);
 assert.equal(checkPackageJson("p",JSON.stringify({dependencies:{pg:"8"}})).length,1);
 assert.equal(checkPackageJson("p",JSON.stringify({optionalDependencies:{postgres:"3"}})).length,1);
});

test("RC38 reader: real file passes; installed=true, env use or non-null source fail",()=>{
 const real=readFileSync(new URL("../../../"+RC38_DB_SOURCE,import.meta.url),"utf8");
 assert.deepEqual(checkRc38Reader(real),[]);
 assert.ok(checkRc38Reader(real.replace("INSTALLED=false","INSTALLED=true")).length>0);
 assert.ok(checkRc38Reader(real.replace(/return null;/,"return async()=>({query:async()=>({rows:[],rowCount:0}),release(){}});")).length>0);
 assert.ok(checkRc38Reader(real.replace(/return null;/,"return process.env.X?null:null;")).length>0);
 assert.ok(checkRc38Reader("export function rc38SignedEodReviewDbSource(){return null;}").length>0);
});

test("workflows: source-only workflow passes; each unsafe capability fails",()=>{
 const ok="on:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - run: node --test x\n      - run: echo 'synthetic secrets. postgresql://u:p@localhost:5432/d'\n";
 assert.deepEqual(checkWorkflow("w",ok),[]);
 for(const s of [
  "      - run: echo ${{ secrets.SUPABASE_KEY }}","    environment: staging","on: pull_request_target",
  "permissions:\n  contents: write","      - run: supabase db push","      - run: supabase link --project-ref abc",
  "      - run: vercel deploy --prod","      - run: psql postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co/postgres",
  "      - run: x postgresql://u:p@aws-0.pooler.example.com:6543/postgres","      - run: curl https://abcdefghijklmnopqrst.supabase.co/rest/v1",
  "      - run: echo $SUPABASE_ACCESS_TOKEN"])
  assert.ok(checkWorkflow("w",s).length>0,s);
 assert.deepEqual(checkWorkflow("w","# supabase db push is forbidden\n"),[]);
 assert.deepEqual(checkWorkflow("w",'          test -z "${SUPABASE_SERVICE_ROLE_KEY:-}"\n'),[]);
 assert.ok(checkWorkflow("w",'          export SUPABASE_SERVICE_ROLE_KEY=abc\n').length>0);
 assert.ok(checkWorkflow("w",'          test -z "${X:-}" && echo $SUPABASE_SERVICE_ROLE_KEY\n').length>0);
});

test("gate is wired into the existing RC17 workflow (paths, tests and step)",()=>{
 const wf=readFileSync(new URL("../../../"+RC17_WORKFLOW,import.meta.url),"utf8");
 assert.deepEqual(checkGateWiring(wf),[]);
 assert.ok(checkGateWiring("").length===3);
});
