// VL-01 — disposable PostgreSQL role/column authority migration proof.
// Runs only against a synthetic, isolated Docker database created here.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const migration=path.join(root,"supabase/migrations/20261012213000_vendor_assignment_update_authority_closeout.sql");
const container="qf-vl01-grants-cert-"+process.pid;
const secret=randomBytes(24).toString("hex");
let started=false, db=null,passed=0;
const call=(args)=>execFileSync("docker",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const test=async(name,run)=>{await run();passed++;console.log("PASS",name);};
try {
  if(process.env.DATABASE_URL||process.env.SUPABASE_URL||process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error("VL01_EXTERNAL_DB_ENV_FORBIDDEN");
  assert(fs.existsSync(migration));
  call(["run","--rm","-d","--name",container,"-e","POSTGRES_USER=vl01","-e","POSTGRES_PASSWORD="+secret,"-e","POSTGRES_DB=vl01","-p","127.0.0.1::5432","postgres:16-alpine"]);started=true;
  const binding=call(["port",container,"5432/tcp"]).match(/127\.0\.0\.1:(\d+)/);assert(binding,"local-only Docker network");
  for(let i=0;i<35;i++){try{db=new pg.Client({host:"127.0.0.1",port:Number(binding[1]),user:"vl01",password:secret,database:"vl01",connectionTimeoutMillis:1000});await db.connect();break;}catch{try{await db?.end()}catch{};db=null;await new Promise(r=>setTimeout(r,500));}}
  assert(db,"isolated PostgreSQL started");
  await db.query(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
CREATE TABLE public.lead_assignments(id uuid PRIMARY KEY, vendor_id uuid NOT NULL, lead_id uuid NOT NULL, credit_deducted boolean NOT NULL, lifecycle_status text);
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assign owner read" ON public.lead_assignments FOR SELECT TO authenticated USING(true);
CREATE POLICY "assign owner update" ON public.lead_assignments FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY "assign admin all" ON public.lead_assignments FOR ALL TO authenticated USING(false) WITH CHECK(false);
GRANT SELECT, UPDATE ON public.lead_assignments TO authenticated, service_role;
INSERT INTO public.lead_assignments VALUES
('e58f8531-1f1f-41e5-a517-000000000001','e58f8531-1f1f-41e5-a517-000000000002','e58f8531-1f1f-41e5-a517-000000000003',true,'delivered');
`);
  await test("pre-fix authenticated write grant reproduced", async()=>{
    const r=await db.query("SELECT has_table_privilege('authenticated','public.lead_assignments','UPDATE') AS can_edit");
    assert.equal(r.rows[0].can_edit,true);
  });
  const source=fs.readFileSync(migration,"utf8");
  await db.query(source);
  await test("authenticated role cannot update financial field",async()=>{
    const r=await db.query("SELECT has_column_privilege('authenticated','public.lead_assignments','credit_deducted','UPDATE') AS permitted");
    assert.equal(r.rows[0].permitted,false);
    await db.query("SET ROLE authenticated");
    try{
      await assert.rejects(db.query("UPDATE public.lead_assignments SET credit_deducted=false"),(e)=>e.code==="42501");
    }finally{await db.query("RESET ROLE");}
  });
  await test("cross-vendor reassignment columns denied", async()=>{
    const r=await db.query("SELECT has_column_privilege('authenticated','public.lead_assignments','vendor_id','UPDATE') AS vendor_id, has_column_privilege('authenticated','public.lead_assignments','lead_id','UPDATE') AS lead_id");
    assert.equal(r.rows[0].vendor_id,false);assert.equal(r.rows[0].lead_id,false);
  });
  await test("owner read policy preserved",async()=>{
    const r=await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='lead_assignments' AND policyname='assign owner read' AND cmd='SELECT'");
    assert.equal(r.rows[0].n,1);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.lead_assignments','SELECT') AS permitted")).rows[0].permitted,true);
  });
  await test("service role retains Core write authority", async()=>{
    assert.equal((await db.query("SELECT has_table_privilege('service_role','public.lead_assignments','UPDATE') AS permitted")).rows[0].permitted,true);
    await db.query("BEGIN");
    try{
      await db.query("SET LOCAL ROLE service_role");
      const r=await db.query("UPDATE public.lead_assignments SET credit_deducted=false RETURNING id");
      assert.equal(r.rowCount,1);
    }finally{await db.query("ROLLBACK");}
  });
  await test("idempotent migration and no real data change",async()=>{
    await db.query(source);
    const r=await db.query("SELECT count(*)::int AS n, bool_and(credit_deducted) AS untouched FROM public.lead_assignments");
    assert.equal(r.rows[0].n,1);assert.equal(r.rows[0].untouched,true);
  });
  console.log("VL01_ASSIGNMENT_AUTHORITY_CERT_PASS: "+passed+"/"+passed+" checks; synthetic PostgreSQL only");
}finally{
  try{await db?.end()}catch{}
  if(started)try{call(["rm","-f",container])}catch{}
  console.log("VL01_ASSIGNMENT_CERT_CLEANUP_COMPLETE");
}
