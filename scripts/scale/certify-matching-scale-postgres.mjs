#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import pg from "pg";

const { Pool } = pg;
const url =
  process.env.DATABASE_URL ??
  "postgresql://qf_phase08:phase08local@127.0.0.1:15434/qf_phase08";

const pool = new Pool({ connectionString: url, max: 8 });
const MIGRATION = new URL(
  "../../supabase/migrations/20261004190001_scale_phase08_matching_prefilter.sql",
  import.meta.url,
);
const PHASE18_MIGRATION = new URL(
  "../../supabase/migrations/20261006113000_scale_phase18_matching_slo.sql",
  import.meta.url,
);

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const ZONE_ID = "22222222-2222-4222-8222-222222222222";
const WINNER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SCOPE = `zone:${ZONE_ID}|category:interior`;
const TIER0 = [
  "interior designer",
  "interior",
  "interior design",
  "interior designers",
  "home interior",
  "full home interior",
];
const TIER1 = [
  ...TIER0,
  "carpenter",
  "carpentry",
  "carpenters",
  "modular kitchen",
  "modular factory",
  "wardrobe",
  "premium interior",
  "premium interiors",
];

async function setup() {
  await pool.query(`
    drop schema if exists public cascade;
    drop schema if exists extensions cascade;
    create schema public;
    create schema extensions;
    create extension if not exists pgcrypto with schema extensions;
    create extension if not exists postgis with schema extensions;

    do $roles$
    begin
      if not exists (select 1 from pg_roles where rolname='anon') then
        create role anon noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then
        create role authenticated noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then
        create role service_role noinherit;
      end if;
    end;
    $roles$;

    create table public.marketplace_service_zones (
      id uuid primary key,
      is_active boolean not null default true,
      matching_enabled boolean not null default true,
      requires_resolved_location boolean not null default true
    );

    create table public.leads (
      id uuid primary key,
      latitude double precision,
      longitude double precision,
      city text,
      area text,
      service_zone_id uuid references public.marketplace_service_zones(id),
      geo_point extensions.geography(Point,4326)
        generated always as (
          case when latitude is not null and longitude is not null
            then extensions.ST_SetSRID(
              extensions.ST_MakePoint(longitude,latitude),4326
            )::extensions.geography(Point,4326)
            else null end
        ) stored
    );

    create table public.vendors (
      id uuid primary key,
      business_name text,
      city text,
      office_city text,
      area_normalized text,
      areas_covered text[],
      covers_full_city boolean,
      service_categories text[],
      selected_category text,
      selected_subcategories text[],
      status text,
      remaining_credits integer,
      is_active boolean,
      accepting_leads boolean,
      assignment_suspended_at timestamptz,
      assignment_suspended_until timestamptz,
      location_verification_status text,
      office_latitude numeric,
      office_longitude numeric,
      latitude numeric,
      longitude numeric,
      rating numeric,
      last_delivered_at timestamptz,
      service_zone_id uuid references public.marketplace_service_zones(id),
      geo_point extensions.geography(Point,4326)
        generated always as (
          case
            when office_latitude is not null and office_longitude is not null
              then extensions.ST_SetSRID(
                extensions.ST_MakePoint(
                  office_longitude::double precision,
                  office_latitude::double precision
                ),4326
              )::extensions.geography(Point,4326)
            when latitude is not null and longitude is not null
              then extensions.ST_SetSRID(
                extensions.ST_MakePoint(
                  longitude::double precision,
                  latitude::double precision
                ),4326
              )::extensions.geography(Point,4326)
            else null
          end
        ) stored
    );
    create index idx_vendors_geo_point_gist on public.vendors using gist(geo_point);

    create table public.vendor_opportunity_fairness (
      vendor_id uuid not null references public.vendors(id) on delete cascade,
      scope_key text not null,
      fair_share_balance numeric(14,6) not null default 0,
      last_delivered_at timestamptz,
      primary key(vendor_id,scope_key)
    );

    create table public.vendor_opportunity_events (
      id uuid primary key default extensions.gen_random_uuid(),
      vendor_id uuid not null references public.vendors(id) on delete cascade,
      scope_key text not null,
      assignment_id uuid,
      event_type text not null,
      occurred_at timestamptz not null default now()
    );
    create index idx_vendor_opportunity_events_scope_recent
      on public.vendor_opportunity_events(scope_key,vendor_id,occurred_at desc);
  `);

  const migration = await readFile(MIGRATION, "utf8");
  await pool.query(migration);
  const phase18Migration = await readFile(PHASE18_MIGRATION, "utf8");
  await pool.query(phase18Migration);

  await pool.query(
    `insert into public.marketplace_service_zones(id,is_active,matching_enabled,requires_resolved_location)
     values($1,true,true,true)
     on conflict(id) do nothing`,
    [ZONE_ID],
  );
  await pool.query(`
    insert into public.marketplace_service_zones(id,is_active,matching_enabled,requires_resolved_location)
    select md5('phase08-zone-' || g::text)::uuid,true,true,true
    from generate_series(1,19) g
    on conflict(id) do nothing
  `);
  await pool.query(
    `insert into public.leads(id,latitude,longitude,city,area,service_zone_id)
     values($1,18.5204,73.8567,'Pune','Shivajinagar',$2)`,
    [LEAD_ID, ZONE_ID],
  );
}

async function seedRange(start, finish) {
  await pool.query(
    `
    insert into public.vendors(
      id,business_name,city,office_city,area_normalized,areas_covered,covers_full_city,
      service_categories,selected_category,selected_subcategories,
      status,remaining_credits,is_active,accepting_leads,location_verification_status,
      office_latitude,office_longitude,rating,last_delivered_at,service_zone_id
    )
    select
      md5('phase08-vendor-' || g::text)::uuid,
      'Synthetic Vendor ' || g::text,
      case when g % 20 = 0 then 'Mumbai' else 'Pune' end,
      'Pune',
      case when g % 5 = 0 then 'shivajinagar' else 'other' end,
      case when g % 5 = 0 then array['shivajinagar']::text[] else array['other']::text[] end,
      (g % 7 = 0),
      case
        when g % 10 = 0 then array['Interior Designers']::text[]
        when g % 10 = 1 then array['Carpenters']::text[]
        when g % 10 = 2 then array['Painter']::text[]
        else array['Sofa']::text[]
      end,
      case
        when g % 10 = 0 then 'Interior Designers'
        when g % 10 = 1 then 'Carpenters'
        when g % 10 = 2 then 'Painter'
        else 'Sofa'
      end,
      '{}'::text[],
      case when g % 37 = 0 then 'pending' else 'approved' end,
      case when g % 41 = 0 then 0 else 10 end,
      (g % 43 <> 0),
      (g % 47 <> 0),
      'verified',
      18.5204 + ((g % 2000)::numeric - 1000) / 100000.0,
      73.8567 + (((g * 7) % 2000)::numeric - 1000) / 100000.0,
      4.5,
      now() - make_interval(days => (g % 30)::int),
      case
        when g % 20 = 0 then $3::uuid
        else md5('phase08-zone-' || ((g % 19) + 1)::text)::uuid
      end
    from generate_series($1::int,$2::int) g
    on conflict(id) do nothing
    `,
    [start, finish, ZONE_ID],
  );
}

async function ensureHighIdWinner() {
  await pool.query(
    `insert into public.vendors(
      id,business_name,city,office_city,area_normalized,areas_covered,covers_full_city,
      service_categories,selected_category,selected_subcategories,
      status,remaining_credits,is_active,accepting_leads,location_verification_status,
      office_latitude,office_longitude,rating,last_delivered_at,service_zone_id
    ) values (
      $1,'High ID owed vendor','Pune','Pune','shivajinagar',array['shivajinagar'],false,
      array['Interior Designers'],'Interior Designers','{}',
      'approved',10,true,true,'verified',
      18.52041,73.85671,4.0,null,$2
    )
    on conflict(id) do update set remaining_credits=10,status='approved',is_active=true,accepting_leads=true`,
    [WINNER_ID, ZONE_ID],
  );
  await pool.query(
    `insert into public.vendor_opportunity_fairness(vendor_id,scope_key,fair_share_balance,last_delivered_at)
     values($1,$2,3,null)
     on conflict(vendor_id,scope_key) do update set fair_share_balance=3,last_delivered_at=null`,
    [WINNER_ID, SCOPE],
  );
}

async function runPrefilter() {
  const start = performance.now();
  const result = await pool.query(
    `select vendor
       from public.qf_match_vendor_prefilter_v1($1,$2,$3::text[],$4::text[],$5)`,
    [LEAD_ID, SCOPE, TIER0, TIER1, 512],
  );
  return { rows: result.rows, ms: performance.now() - start };
}

async function explainPrefilter() {
  const result = await pool.query(
    `explain (analyze,buffers,format json)
     select vendor
       from public.qf_match_vendor_prefilter_v1($1,$2,$3::text[],$4::text[],$5)`,
    [LEAD_ID, SCOPE, TIER0, TIER1, 512],
  );
  const root = result.rows[0]["QUERY PLAN"][0];
  const nodes = [];
  const walk = (node, depth = 0) => {
    nodes.push({
      depth,
      nodeType: node["Node Type"],
      relation: node["Relation Name"] ?? null,
      index: node["Index Name"] ?? null,
      actualTotalTime: node["Actual Total Time"] ?? null,
      actualRows: node["Actual Rows"] ?? null,
      actualLoops: node["Actual Loops"] ?? null,
      rowsRemovedByFilter: node["Rows Removed by Filter"] ?? null,
    });
    for (const child of node.Plans ?? []) walk(child, depth + 1);
  };
  walk(root.Plan);
  return { executionTime: root["Execution Time"], planningTime: root["Planning Time"], nodes };
}

async function explainIndexProbe() {
  const result = await pool.query(
    `explain (analyze,buffers,format json)
     select id
       from public.vendors
      where service_zone_id=$1
        and lower(btrim(coalesce(status,''))) in ('approved','active')
        and is_active is distinct from false
        and accepting_leads is distinct from false
        and coalesce(remaining_credits,0) >= 1
        and coalesce(location_verification_status,'') <> 'outside_service_area'
        and matching_terms && $2::text[]
      order by id
      limit 512`,
    [ZONE_ID, TIER0],
  );
  return result.rows[0]["QUERY PLAN"][0];
}

async function certify(size, maxMs) {
  await pool.query("analyze public.vendors");
  await pool.query("analyze public.vendor_opportunity_fairness");
  await pool.query("analyze public.vendor_opportunity_events");

  // warm once, then measure three runs and use the worst warm latency
  await runPrefilter();
  const timings = [];
  let lastRows = [];
  for (let i = 0; i < 3; i += 1) {
    const run = await runPrefilter();
    timings.push(run.ms);
    lastRows = run.rows;
  }
  const worstMs = Math.max(...timings);
  const ids = lastRows.map((row) => row.vendor?.id).filter(Boolean);
  assert.ok(ids.includes(WINNER_ID), `high-ID vendor missing at ${size} vendors`);
  assert.ok(lastRows.length > 0 && lastRows.length <= 512);
  if (worstMs >= maxMs) {
    const diagnostic = await explainPrefilter();
    console.error("PHASE18_MATCHING_SLO_DIAGNOSTIC");
    console.error(JSON.stringify(diagnostic, null, 2));
  }
  assert.ok(worstMs < maxMs, `${size} prefilter worst ${worstMs.toFixed(1)}ms >= ${maxMs}ms SLO`);

  const plan = await explainIndexProbe();
  const planText = JSON.stringify(plan);
  assert.match(
    planText,
    /idx_vendors_matching_terms_gin|idx_vendors_auto_match_scope|Bitmap|Index Scan|Index Only Scan/i,
  );
  return {
    vendorCount: size,
    timingsMs: timings.map((value) => Number(value.toFixed(1))),
    worstMs: Number(worstMs.toFixed(1)),
    indexProbeExecutionMs: Number(plan["Execution Time"].toFixed(1)),
    rowsReturned: lastRows.length,
    highIdWinnerPresent: true,
    indexedPlan: true,
  };
}

try {
  await setup();
  await seedRange(1, 100_000);
  await ensureHighIdWinner();
  const at100k = await certify(100_001, 750);

  await seedRange(100_001, 1_000_000);
  await ensureHighIdWinner();
  const at1m = await certify(1_000_001, 1_500);

  console.log("QuickFurno Phase 08 matching scale certification PASS");
  console.log(JSON.stringify({ at100k, at1m }, null, 2));
} finally {
  await pool.end();
}
