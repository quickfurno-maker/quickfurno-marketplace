#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://qf_phase21:qf_phase21_ci_only@127.0.0.1:5432/qf_phase21";
const pool = new Pool({ connectionString, max: 8 });

const ddl = [
  "drop schema if exists qf_phase21 cascade;",
  "create schema qf_phase21;",
  "create table qf_phase21.vendor (id uuid primary key, owner_id uuid not null, credits integer not null check (credits >= 0));",
  "alter table qf_phase21.vendor enable row level security;",
  "create policy vendor_owner on qf_phase21.vendor for select using (owner_id = nullif(current_setting('qf.subject_id', true),'')::uuid);",
  "create table qf_phase21.lead (id uuid primary key, city text not null, category text not null);",
  "create table qf_phase21.assignment (lead_id uuid not null references qf_phase21.lead(id), vendor_id uuid not null references qf_phase21.vendor(id), created_at timestamptz not null default now(), primary key (lead_id,vendor_id));",
  "create table qf_phase21.credit_ledger (lead_id uuid not null, vendor_id uuid not null, delta integer not null check (delta in (-1,1)), reason text not null, primary key (lead_id,vendor_id,reason));",
  "create table qf_phase21.consent_event (id bigint generated always as identity primary key, subject_id uuid not null, state text not null check (state in ('OPT_IN','OPT_OUT')), occurred_at timestamptz not null default now());",
  "create function qf_phase21.reject_mutation() returns trigger language plpgsql as $$ begin raise exception 'append_only'; end $$;",
  "create trigger consent_append_only before update or delete on qf_phase21.consent_event for each row execute function qf_phase21.reject_mutation();",
  "create table qf_phase21.payment_order (id uuid primary key, provider_order_id text not null unique, vendor_id uuid not null references qf_phase21.vendor(id), amount_paise bigint not null check (amount_paise > 0));",
  "create table qf_phase21.worker_job (id uuid primary key, state text not null check (state in ('PENDING','PROCESSING','DONE')), claimed_by text, lease_until timestamptz);",
  "create function qf_phase21.assign_once(p_lead uuid,p_vendor uuid) returns boolean language plpgsql as $$ declare inserted_count integer; begin insert into qf_phase21.assignment(lead_id,vendor_id) values(p_lead,p_vendor) on conflict do nothing; get diagnostics inserted_count = row_count; if inserted_count = 1 then update qf_phase21.vendor set credits=credits-1 where id=p_vendor and credits>0; if not found then raise exception 'no_credit'; end if; insert into qf_phase21.credit_ledger(lead_id,vendor_id,delta,reason) values(p_lead,p_vendor,-1,'assignment'); return true; end if; return false; end $$;",
].join("\n");

async function provision() {
  await pool.query(ddl);
  const result = await pool.query(
    "select count(*)::int tables from information_schema.tables where table_schema='qf_phase21' and table_type='BASE TABLE'",
  );
  assert.equal(result.rows[0].tables, 7);
}

try {
  await provision();
  await provision();

  const owner = "00000000-0000-0000-0000-000000000001";
  const vendor = "10000000-0000-0000-0000-000000000001";
  const lead = "20000000-0000-0000-0000-000000000001";
  await pool.query(
    "insert into qf_phase21.vendor(id,owner_id,credits) values($1,$2,5)",
    [vendor, owner],
  );
  await pool.query(
    "insert into qf_phase21.lead(id,city,category) values($1,'Pune','modular_kitchen')",
    [lead],
  );

  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      pool.query("select qf_phase21.assign_once($1,$2) assigned", [
        lead,
        vendor,
      ]),
    ),
  );
  assert.equal(attempts.filter((x) => x.rows[0].assigned).length, 1);
  const state = await pool.query(
    "select (select count(*)::int from qf_phase21.assignment) assignments, (select count(*)::int from qf_phase21.credit_ledger) debits, (select credits from qf_phase21.vendor where id=$1) credits",
    [vendor],
  );
  assert.deepEqual(state.rows[0], { assignments: 1, debits: 1, credits: 4 });

  await pool.query(
    "insert into qf_phase21.consent_event(subject_id,state) values($1,'OPT_IN')",
    [owner],
  );
  let blocked = false;
  try {
    await pool.query("update qf_phase21.consent_event set state='OPT_OUT'");
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true);

  await pool.query(
    "insert into qf_phase21.payment_order(id,provider_order_id,vendor_id,amount_paise) values(gen_random_uuid(),'order_phase21',$1,89900)",
    [vendor],
  );
  await pool.query(
    "insert into qf_phase21.payment_order(id,provider_order_id,vendor_id,amount_paise) values(gen_random_uuid(),'order_phase21',$1,89900) on conflict(provider_order_id) do nothing",
    [vendor],
  );
  const payments = await pool.query(
    "select count(*)::int n from qf_phase21.payment_order",
  );
  assert.equal(payments.rows[0].n, 1);

  await pool.query(
    "insert into qf_phase21.worker_job(id,state) select md5('job-'||g)::uuid,'PENDING' from generate_series(1,12) g",
  );
  const claim = async (name) => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const r = await c.query(
        "with picked as (select id from qf_phase21.worker_job where state='PENDING' order by id for update skip locked limit 1) update qf_phase21.worker_job j set state='PROCESSING',claimed_by=$1,lease_until=now()+interval '30 seconds' from picked where j.id=picked.id returning j.id",
        [name],
      );
      await c.query("commit");
      return r.rows[0]?.id;
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  };
  const claimed = await Promise.all(
    Array.from({ length: 12 }, (_, i) => claim("w" + i)),
  );
  assert.equal(new Set(claimed.filter(Boolean)).size, 12);

  const policy = await pool.query(
    "select count(*)::int n from pg_policies where schemaname='qf_phase21' and tablename='vendor' and policyname='vendor_owner'",
  );
  assert.equal(policy.rows[0].n, 1);

  console.log("QuickFurno Phase21 portable PostgreSQL certification PASS");
  console.log(
    JSON.stringify(
      {
        reconstructionRerun: true,
        assignmentConcurrency: { attempts: 8, effects: 1, debits: 1 },
        consentAppendOnly: true,
        paymentIdempotency: true,
        workerClaims: { claims: 12, unique: 12 },
        rlsPolicyPresent: true,
        providerSpecificRuntimeRequired: false,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.query("drop schema if exists qf_phase21 cascade").catch(() => {});
  await pool.end();
}
