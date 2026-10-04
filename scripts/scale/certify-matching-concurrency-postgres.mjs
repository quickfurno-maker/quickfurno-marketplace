#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const url =
  process.env.DATABASE_URL ??
  "postgresql://qf_phase08:phase08local@127.0.0.1:15434/qf_phase08";
const pool = new Pool({ connectionString: url, max: 24 });

function extractFunction(sql, functionName) {
  const marker = `create or replace function public.${functionName}(`;
  const start = sql.toLowerCase().indexOf(marker);
  if (start < 0) throw new Error(`missing function ${functionName}`);
  const tail = sql.slice(start);
  const tagMatch = tail.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/i);
  if (!tagMatch) throw new Error(`missing function body tag for ${functionName}`);
  const tag = tagMatch[1];
  const bodyStart = tagMatch.index + tagMatch[0].length;
  const end = tail.indexOf(tag, bodyStart);
  if (end < 0) throw new Error(`unterminated function ${functionName}`);
  const semicolon = tail.indexOf(";", end + tag.length);
  if (semicolon < 0) throw new Error(`missing function semicolon for ${functionName}`);
  return tail.slice(0, semicolon + 1);
}

async function resetFixture() {
  await pool.query(`
    drop schema if exists public cascade;
    create schema public;
    create extension if not exists pgcrypto;

    create table public.leads (
      id uuid primary key,
      is_duplicate boolean not null default false
    );

    create table public.vendors (
      id uuid primary key,
      status text not null default 'approved',
      is_active boolean not null default true,
      accepting_leads boolean not null default true,
      assignment_suspended_at timestamptz,
      assignment_suspended_until timestamptz,
      remaining_credits integer not null,
      last_assigned_at timestamptz
    );

    create table public.assignment_operations (
      id uuid primary key default gen_random_uuid(),
      idempotency_key text not null unique,
      request_fingerprint text not null,
      lead_id uuid not null,
      mode text not null,
      actor_kind text not null,
      actor_id uuid,
      replacement_request_id uuid,
      reason_code text,
      status text not null,
      completed_at timestamptz,
      result jsonb
    );

    create table public.replacement_requests (
      id uuid primary key default gen_random_uuid(),
      lead_id uuid not null,
      status text not null,
      approved_by uuid
    );

    create table public.lead_assignments (
      id uuid primary key default gen_random_uuid(),
      lead_id uuid not null,
      vendor_id uuid not null,
      assignment_type text not null,
      credit_deducted boolean not null,
      lifecycle_status text not null,
      lifecycle_updated_at timestamptz not null,
      operation_id uuid not null,
      unique(lead_id,vendor_id)
    );

    create table public.lead_assignment_events (
      id uuid primary key default gen_random_uuid(),
      assignment_id uuid,
      lead_id uuid not null,
      vendor_id uuid not null,
      operation_id uuid,
      event_type text not null,
      lifecycle_from text,
      lifecycle_to text,
      occurred_at timestamptz,
      recorded_at timestamptz,
      actor_kind text,
      actor_id uuid,
      reason_code text,
      source_kind text,
      source_reference text,
      event_idempotency_key text not null unique,
      metadata jsonb
    );

    create table public.credit_restoration_approvals (
      id uuid primary key default gen_random_uuid(),
      status text not null
    );

    create table public.vendor_credit_logs (
      id uuid primary key default gen_random_uuid(),
      vendor_id uuid not null,
      change_type text not null,
      credits_before integer not null,
      credits_delta integer not null,
      credits_after integer not null,
      reason text,
      updated_by text,
      reference_type text,
      reference_id text,
      approval_reference uuid,
      idempotency_key text,
      actor_kind text,
      actor_id uuid,
      unique(reference_type,reference_id),
      unique(idempotency_key)
    );

    create table public.communication_intents (
      id uuid primary key default gen_random_uuid(),
      aggregate_type text not null,
      aggregate_id uuid not null,
      channel text not null,
      template_purpose text not null,
      recipient_ref text,
      payload_ref jsonb,
      idempotency_key text not null unique,
      status text not null
    );

    create or replace function public.qf_vendor_assignment_eligible(
      p_lead_id uuid,
      p_vendor_id uuid,
      p_credit_cost integer
    ) returns jsonb
    language plpgsql
    set search_path = pg_catalog, public, pg_temp
    as $stub$
    declare
      v public.vendors%rowtype;
    begin
      select * into v from public.vendors where id=p_vendor_id;
      if not found then
        return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible');
      end if;
      if lower(v.status) not in ('approved','active')
         or v.is_active is not true
         or v.accepting_leads is not true
         or (
           v.assignment_suspended_at is not null
           and (v.assignment_suspended_until is null or v.assignment_suspended_until > now())
         )
         or coalesce(v.remaining_credits,0) < p_credit_cost then
        return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible');
      end if;
      return jsonb_build_object('eligible',true,'reason_code',null);
    end;
    $stub$;
  `);

  const authoritySql = await readFile(
    new URL(
      "../../supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const rankSql = await readFile(
    new URL(
      "../../supabase/migrations/20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql",
      import.meta.url,
    ),
    "utf8",
  );

  await pool.query(extractFunction(authoritySql, "qf_apply_credit_mutation_v2"));
  await pool.query(extractFunction(rankSql, "qf_assign_lead_vendors_v2"));
}

const vendorIds = Array.from(
  { length: 6 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

function rotated(values, offset) {
  return [...values.slice(offset), ...values.slice(0, offset)];
}

async function callAssignment(leadId, candidates, operationKey) {
  const result = await pool.query(
    `select public.qf_assign_lead_vendors_v2(
      $1,'automatic',$2::uuid[],$3,'system',null,null,'phase08_concurrency'
    ) as result`,
    [leadId, candidates, operationKey],
  );
  return result.rows[0].result;
}

async function scalar(query, params = []) {
  const result = await pool.query(query, params);
  return result.rows[0];
}

try {
  await resetFixture();

  await pool.query(
    `insert into public.vendors(id,remaining_credits)
     select x,6 from unnest($1::uuid[]) x`,
    [vendorIds],
  );

  const leadIds = Array.from(
    { length: 12 },
    (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  await pool.query(
    `insert into public.leads(id) select x from unnest($1::uuid[]) x`,
    [leadIds],
  );

  const results = await Promise.all(
    leadIds.map((leadId, index) =>
      callAssignment(
        leadId,
        rotated(vendorIds, index % vendorIds.length),
        `phase08-fair-${index + 1}`,
      ),
    ),
  );

  assert.ok(results.every((value) => ["applied", "partial"].includes(value.status)));
  assert.ok(results.every((value) => value.assigned.length === 3));

  const assignmentStats = await pool.query(`
    select vendor_id,count(*)::int as assignments
    from public.lead_assignments
    group by vendor_id
    order by vendor_id
  `);
  assert.deepEqual(
    assignmentStats.rows.map((row) => row.assignments),
    [6, 6, 6, 6, 6, 6],
    "rotated fair ranked pools must distribute concurrent leads evenly",
  );

  const leadCap = await scalar(`
    select max(c)::int as max_per_lead
    from (
      select lead_id,count(*) c
      from public.lead_assignments
      group by lead_id
    ) x
  `);
  assert.equal(leadCap.max_per_lead, 3);

  const duplicatePairs = await scalar(`
    select count(*)::int as count
    from (
      select lead_id,vendor_id,count(*) c
      from public.lead_assignments
      group by lead_id,vendor_id
      having count(*) > 1
    ) x
  `);
  assert.equal(duplicatePairs.count, 0);

  const credits = await pool.query(
    `select id,remaining_credits from public.vendors order by id`,
  );
  assert.deepEqual(
    credits.rows.map((row) => row.remaining_credits),
    [0, 0, 0, 0, 0, 0],
  );

  const ledger = await scalar(
    `select count(*)::int as count,coalesce(sum(-credits_delta),0)::int as debits
       from public.vendor_credit_logs where change_type='lead_assignment_debit'`,
  );
  assert.equal(ledger.count, 36);
  assert.equal(ledger.debits, 36);

  const replayBefore = await scalar(
    `select count(*)::int as assignments from public.lead_assignments`,
  );
  const replay = await callAssignment(
    leadIds[0],
    rotated(vendorIds, 0),
    "phase08-fair-1",
  );
  assert.equal(replay.status, "already_applied");
  const replayAfter = await scalar(
    `select count(*)::int as assignments from public.lead_assignments`,
  );
  assert.equal(replayAfter.assignments, replayBefore.assignments);

  // Separate same-lead contention proof with fresh vendor credits.
  await pool.query(
    `update public.vendors set remaining_credits=20,last_assigned_at=null`,
  );
  const contestedLead = "20000000-0000-4000-8000-000000000001";
  await pool.query(`insert into public.leads(id) values($1)`, [contestedLead]);

  const sameLead = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      callAssignment(
        contestedLead,
        rotated(vendorIds, index % vendorIds.length),
        `phase08-same-lead-${index + 1}`,
      ),
    ),
  );
  assert.equal(
    sameLead.filter((result) =>
      ["applied", "partial"].includes(result.status) &&
      Array.isArray(result.assigned) &&
      result.assigned.length > 0,
    ).length,
    1,
    "lead row lock must allow only one assigning operation to consume the max-3 headroom",
  );

  const contestedCount = await scalar(
    `select count(*)::int as count from public.lead_assignments where lead_id=$1`,
    [contestedLead],
  );
  assert.equal(contestedCount.count, 3);

  console.log("QuickFurno Phase 08 canonical assignment contention certification PASS");
  console.log(
    JSON.stringify(
      {
        concurrentLeads: 12,
        sharedVendorPool: 6,
        assignmentsPerLead: 3,
        assignmentsPerVendor: 6,
        totalAssignments: 36,
        totalCreditDebits: 36,
        duplicateLeadVendorPairs: 0,
        idempotentReplay: "PASS",
        sameLeadConcurrentOperations: 10,
        sameLeadFinalAssignments: 3,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
