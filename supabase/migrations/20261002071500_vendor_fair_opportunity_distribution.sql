-- QuickFurno fair-opportunity distribution v1
-- Deterministic, credit-gated, provider-delivery-confirmed fairness.
--
-- Locked product rules:
--   • one successful assignment costs one credit (existing Core authority)
--   • one provider-confirmed delivered lead consumes one fairness opportunity
--   • credits are a HARD ELIGIBILITY gate, never a rank multiplier
--   • only hard-eligible vendors are snapshotted
--   • snapshotting alone changes no fairness balance
--   • a real delivery accrues fair share only within the delivered vendor's
--     comparable relevance group: same category tier + same distance band
--   • the delivered vendor consumes exactly one fairness opportunity
--   • human-validated bad-lead recovery restores that vendor's fairness turn
--   • no capacity, popularity, revenue, package-price or subjective quality input
begin;

create table if not exists public.lead_fairness_opportunities (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  scope_key text not null,
  city_key text not null,
  category_key text not null,
  service_zone_id uuid,
  eligible_vendor_count integer not null check (eligible_vendor_count > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.lead_fairness_candidates (
  lead_id uuid not null
    references public.lead_fairness_opportunities(lead_id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  match_tier smallint not null check (match_tier in (0,1)),
  distance_band smallint not null check (distance_band between 0 and 4),
  created_at timestamptz not null default now(),
  primary key (lead_id, vendor_id)
);

create table if not exists public.vendor_opportunity_fairness (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  scope_key text not null,
  city_key text not null,
  category_key text not null,
  service_zone_id uuid,
  -- Raw reversible ledger truth. Ranking clamps this to +/-3 so old debt
  -- cannot monopolize turns, but persistence itself remains exactly reversible.
  fair_share_balance numeric(14,6) not null default 0,
  eligible_opportunity_count bigint not null default 0
    check (eligible_opportunity_count >= 0),
  delivered_opportunity_count bigint not null default 0
    check (delivered_opportunity_count >= 0),
  restored_opportunity_count bigint not null default 0
    check (restored_opportunity_count >= 0),
  last_eligible_at timestamptz,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (vendor_id, scope_key)
);

create table if not exists public.vendor_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  assignment_id uuid references public.lead_assignments(id) on delete set null,
  scope_key text not null,
  event_type text not null check (
    event_type in (
      'eligible',
      'fair_share_accrued',
      'delivered',
      'restored_bad_lead',
      'fair_share_reversed_bad_lead'
    )
  ),
  balance_delta numeric(12,6) not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_fairness_candidates_group
  on public.lead_fairness_candidates(
    lead_id,
    match_tier,
    distance_band,
    vendor_id
  );

create unique index if not exists uq_vendor_opportunity_event_eligible
  on public.vendor_opportunity_events(lead_id, vendor_id)
  where event_type='eligible';

create unique index if not exists uq_vendor_opportunity_event_fair_share
  on public.vendor_opportunity_events(assignment_id, vendor_id)
  where event_type='fair_share_accrued' and assignment_id is not null;

create unique index if not exists uq_vendor_opportunity_event_delivered
  on public.vendor_opportunity_events(assignment_id)
  where event_type='delivered' and assignment_id is not null;

create unique index if not exists uq_vendor_opportunity_event_restored
  on public.vendor_opportunity_events(assignment_id)
  where event_type='restored_bad_lead' and assignment_id is not null;

create unique index if not exists uq_vendor_opportunity_event_fair_share_reversed
  on public.vendor_opportunity_events(assignment_id, vendor_id)
  where event_type='fair_share_reversed_bad_lead' and assignment_id is not null;

create index if not exists idx_vendor_opportunity_fairness_scope_rank
  on public.vendor_opportunity_fairness(
    scope_key,
    fair_share_balance desc,
    last_delivered_at asc nulls first
  );

create index if not exists idx_vendor_opportunity_events_scope_recent
  on public.vendor_opportunity_events(scope_key, vendor_id, occurred_at desc);

alter table public.lead_fairness_opportunities enable row level security;
alter table public.lead_fairness_candidates enable row level security;
alter table public.vendor_opportunity_fairness enable row level security;
alter table public.vendor_opportunity_events enable row level security;

revoke all on public.lead_fairness_opportunities
  from public, anon, authenticated;
revoke all on public.lead_fairness_candidates
  from public, anon, authenticated;
revoke all on public.vendor_opportunity_fairness
  from public, anon, authenticated;
revoke all on public.vendor_opportunity_events
  from public, anon, authenticated;

grant select on public.lead_fairness_opportunities to authenticated;
grant select on public.lead_fairness_candidates to authenticated;
grant select on public.vendor_opportunity_fairness to authenticated;
grant select on public.vendor_opportunity_events to authenticated;

grant select, insert, update, delete
  on public.lead_fairness_opportunities to service_role;
grant select, insert, update, delete
  on public.lead_fairness_candidates to service_role;
grant select, insert, update, delete
  on public.vendor_opportunity_fairness to service_role;
grant select, insert, update, delete
  on public.vendor_opportunity_events to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='lead_fairness_opportunities'
      and policyname='lead_fairness_opportunities admin read'
  ) then
    execute 'create policy "lead_fairness_opportunities admin read" on public.lead_fairness_opportunities for select to authenticated using (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='lead_fairness_candidates'
      and policyname='lead_fairness_candidates admin read'
  ) then
    execute 'create policy "lead_fairness_candidates admin read" on public.lead_fairness_candidates for select to authenticated using (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='vendor_opportunity_fairness'
      and policyname='vendor_opportunity_fairness admin read'
  ) then
    execute 'create policy "vendor_opportunity_fairness admin read" on public.vendor_opportunity_fairness for select to authenticated using (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='vendor_opportunity_events'
      and policyname='vendor_opportunity_events admin read'
  ) then
    execute 'create policy "vendor_opportunity_events admin read" on public.vendor_opportunity_events for select to authenticated using (public.is_admin())';
  end if;
end $$;

create or replace function public.qf_read_vendor_fair_opportunity_v1(
  p_scope_key text,
  p_vendor_ids uuid[]
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'vendor_id', f.vendor_id,
        'scope_key', f.scope_key,
        'fair_share_balance', f.fair_share_balance,
        'eligible_opportunity_count', f.eligible_opportunity_count,
        'delivered_opportunity_count', f.delivered_opportunity_count,
        'restored_opportunity_count', f.restored_opportunity_count,
        'delivered_7d', (
          select count(*)
          from public.vendor_opportunity_events d
          where d.scope_key=f.scope_key
            and d.vendor_id=f.vendor_id
            and d.event_type='delivered'
            and d.occurred_at >= now() - interval '7 days'
            and not exists (
              select 1
              from public.vendor_opportunity_events r
              where r.assignment_id=d.assignment_id
                and r.event_type='restored_bad_lead'
            )
        ),
        'last_eligible_at', f.last_eligible_at,
        'last_delivered_at', f.last_delivered_at
      )
      order by f.vendor_id
    ),
    '[]'::jsonb
  )
  from public.vendor_opportunity_fairness f
  where f.scope_key=p_scope_key
    and f.vendor_id=any(coalesce(p_vendor_ids,'{}'::uuid[]));
$$;

revoke all on function public.qf_read_vendor_fair_opportunity_v1(text,uuid[])
  from public, anon, authenticated;
grant execute on function public.qf_read_vendor_fair_opportunity_v1(text,uuid[])
  to service_role;

create or replace function public.qf_snapshot_vendor_fair_opportunity_v1(
  p_lead_id uuid,
  p_scope_key text,
  p_city_key text,
  p_category_key text,
  p_service_zone_id uuid,
  p_vendor_groups jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_existing public.lead_fairness_opportunities%rowtype;
  v_count integer;
  v_snapshot_inserted integer;
  v_vendor record;
  v_inserted integer;
  v_vendor_ids uuid[];
  v_vendors jsonb;
begin
  if p_lead_id is null
     or nullif(btrim(coalesce(p_scope_key,'')),'') is null
     or nullif(btrim(coalesce(p_city_key,'')),'') is null
     or nullif(btrim(coalesce(p_category_key,'')),'') is null
     or jsonb_typeof(coalesce(p_vendor_groups,'[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'status','rejected',
      'reason_code','scope_or_pool_required',
      'vendors','[]'::jsonb
    );
  end if;

  if not exists (select 1 from public.leads where id=p_lead_id) then
    return jsonb_build_object(
      'status','rejected',
      'reason_code','lead_not_found',
      'vendors','[]'::jsonb
    );
  end if;

  with parsed as (
    select distinct on (lower(e.item->>'vendor_id'))
      lower(e.item->>'vendor_id')::uuid as vendor_id,
      case
        when coalesce((e.item->>'match_tier')::integer,0)=1 then 1
        else 0
      end::smallint as match_tier,
      least(
        4,
        greatest(0,coalesce((e.item->>'distance_band')::integer,4))
      )::smallint as distance_band
    from jsonb_array_elements(p_vendor_groups) as e(item)
    where jsonb_typeof(e.item)='object'
      and coalesce(e.item->>'vendor_id','') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    order by lower(e.item->>'vendor_id')
  )
  select count(*) into v_count from parsed;

  if v_count <= 0 then
    return jsonb_build_object(
      'status','rejected',
      'reason_code','eligible_pool_empty',
      'vendors','[]'::jsonb
    );
  end if;

  insert into public.lead_fairness_opportunities(
    lead_id,
    scope_key,
    city_key,
    category_key,
    service_zone_id,
    eligible_vendor_count
  ) values (
    p_lead_id,
    btrim(p_scope_key),
    btrim(p_city_key),
    btrim(p_category_key),
    p_service_zone_id,
    v_count
  )
  on conflict (lead_id) do nothing;

  get diagnostics v_snapshot_inserted = row_count;

  select * into v_existing
  from public.lead_fairness_opportunities
  where lead_id=p_lead_id
  for update;

  if v_existing.scope_key is distinct from btrim(p_scope_key) then
    return jsonb_build_object(
      'status','rejected',
      'reason_code','fairness_scope_mismatch',
      'scope_key',v_existing.scope_key,
      'vendors','[]'::jsonb
    );
  end if;

  if v_snapshot_inserted=1 then
    insert into public.lead_fairness_candidates(
      lead_id,
      vendor_id,
      match_tier,
      distance_band,
      created_at
    )
    select
      p_lead_id,
      parsed.vendor_id,
      parsed.match_tier,
      parsed.distance_band,
      v_existing.created_at
    from (
      select distinct on (lower(e.item->>'vendor_id'))
        lower(e.item->>'vendor_id')::uuid as vendor_id,
        case
          when coalesce((e.item->>'match_tier')::integer,0)=1 then 1
          else 0
        end::smallint as match_tier,
        least(
          4,
          greatest(0,coalesce((e.item->>'distance_band')::integer,4))
        )::smallint as distance_band
      from jsonb_array_elements(p_vendor_groups) as e(item)
      where jsonb_typeof(e.item)='object'
        and coalesce(e.item->>'vendor_id','') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      order by lower(e.item->>'vendor_id')
    ) parsed;

    for v_vendor in
      select c.vendor_id,c.match_tier,c.distance_band
      from public.lead_fairness_candidates c
      where c.lead_id=p_lead_id
      order by c.vendor_id
    loop
      insert into public.vendor_opportunity_events(
        lead_id,
        vendor_id,
        scope_key,
        event_type,
        balance_delta,
        occurred_at,
        metadata
      ) values (
        p_lead_id,
        v_vendor.vendor_id,
        v_existing.scope_key,
        'eligible',
        0,
        v_existing.created_at,
        jsonb_build_object(
          'match_tier',v_vendor.match_tier,
          'distance_band',v_vendor.distance_band
        )
      )
      on conflict (lead_id,vendor_id)
        where event_type='eligible'
        do nothing;

      get diagnostics v_inserted = row_count;

      if v_inserted=1 then
        insert into public.vendor_opportunity_fairness(
          vendor_id,
          scope_key,
          city_key,
          category_key,
          service_zone_id,
          fair_share_balance,
          eligible_opportunity_count,
          last_eligible_at
        ) values (
          v_vendor.vendor_id,
          v_existing.scope_key,
          v_existing.city_key,
          v_existing.category_key,
          v_existing.service_zone_id,
          0,
          1,
          v_existing.created_at
        )
        on conflict (vendor_id,scope_key) do update set
          eligible_opportunity_count=
            public.vendor_opportunity_fairness.eligible_opportunity_count+1,
          last_eligible_at=greatest(
            coalesce(
              public.vendor_opportunity_fairness.last_eligible_at,
              '-infinity'::timestamptz
            ),
            excluded.last_eligible_at
          ),
          updated_at=now();
      end if;
    end loop;
  end if;

  select coalesce(array_agg(c.vendor_id order by c.vendor_id),'{}'::uuid[])
    into v_vendor_ids
  from public.lead_fairness_candidates c
  where c.lead_id=p_lead_id;

  select public.qf_read_vendor_fair_opportunity_v1(
    v_existing.scope_key,
    v_vendor_ids
  ) into v_vendors;

  return jsonb_build_object(
    'status',case
      when v_snapshot_inserted=1 then 'applied'
      else 'already_applied'
    end,
    'scope_key',v_existing.scope_key,
    'eligible_vendor_count',v_existing.eligible_vendor_count,
    'vendors',v_vendors
  );
end;
$$;

revoke all on function public.qf_snapshot_vendor_fair_opportunity_v1(
  uuid,text,text,text,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.qf_snapshot_vendor_fair_opportunity_v1(
  uuid,text,text,text,uuid,jsonb
) to service_role;

create or replace function public.qf_consume_vendor_fair_opportunity_v1(
  p_assignment_id uuid,
  p_delivered_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assignment public.lead_assignments%rowtype;
  v_opportunity public.lead_fairness_opportunities%rowtype;
  v_candidate public.lead_fairness_candidates%rowtype;
  v_vendor uuid;
  v_group_count integer;
  v_share numeric(12,6);
  v_inserted integer;
  v_share_inserted integer;
  v_at timestamptz := coalesce(p_delivered_at,now());
begin
  if p_assignment_id is null then
    return jsonb_build_object(
      'status','rejected',
      'reason_code','assignment_required'
    );
  end if;

  select * into v_assignment
  from public.lead_assignments
  where id=p_assignment_id;

  if not found
     or v_assignment.vendor_id is null
     or v_assignment.lead_id is null then
    return jsonb_build_object(
      'status','rejected',
      'reason_code','assignment_not_found'
    );
  end if;

  select * into v_opportunity
  from public.lead_fairness_opportunities
  where lead_id=v_assignment.lead_id
  for update;

  if not found then
    return jsonb_build_object(
      'status','ignored',
      'reason_code','no_fairness_opportunity'
    );
  end if;

  select * into v_candidate
  from public.lead_fairness_candidates
  where lead_id=v_assignment.lead_id
    and vendor_id=v_assignment.vendor_id;

  if not found then
    -- Preferred/manual/legacy assignments or a transactional promotion outside
    -- the original hard-eligible pool cannot mutate fairness for that pool.
    return jsonb_build_object(
      'status','ignored',
      'reason_code','vendor_not_in_fairness_pool'
    );
  end if;

  insert into public.vendor_opportunity_events(
    lead_id,
    vendor_id,
    assignment_id,
    scope_key,
    event_type,
    balance_delta,
    occurred_at,
    metadata
  ) values (
    v_assignment.lead_id,
    v_assignment.vendor_id,
    v_assignment.id,
    v_opportunity.scope_key,
    'delivered',
    -1,
    v_at,
    jsonb_build_object(
      'source','provider_confirmed_delivery',
      'match_tier',v_candidate.match_tier,
      'distance_band',v_candidate.distance_band
    )
  )
  on conflict (assignment_id)
    where event_type='delivered' and assignment_id is not null
    do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted=0 then
    return jsonb_build_object(
      'status','already_applied',
      'assignment_id',v_assignment.id
    );
  end if;

  select count(*)
    into v_group_count
  from public.lead_fairness_candidates c
  where c.lead_id=v_assignment.lead_id
    and c.match_tier=v_candidate.match_tier
    and c.distance_band=v_candidate.distance_band;

  if v_group_count <= 0 then
    raise exception 'QF_FAIR_GROUP_EMPTY' using errcode='P0001';
  end if;

  v_share := round((1::numeric / v_group_count::numeric),6);

  -- One REAL delivered slot contributes 1/N entitlement only to vendors that
  -- could reasonably have filled the SAME relevance slot: same category tier
  -- and same straight-line distance band.
  for v_vendor in
    select c.vendor_id
    from public.lead_fairness_candidates c
    where c.lead_id=v_assignment.lead_id
      and c.match_tier=v_candidate.match_tier
      and c.distance_band=v_candidate.distance_band
    order by c.vendor_id
  loop
    insert into public.vendor_opportunity_events(
      lead_id,
      vendor_id,
      assignment_id,
      scope_key,
      event_type,
      balance_delta,
      occurred_at,
      metadata
    ) values (
      v_assignment.lead_id,
      v_vendor,
      v_assignment.id,
      v_opportunity.scope_key,
      'fair_share_accrued',
      v_share,
      v_at,
      jsonb_build_object(
        'delivered_vendor_id',v_assignment.vendor_id,
        'match_tier',v_candidate.match_tier,
        'distance_band',v_candidate.distance_band,
        'comparable_vendor_count',v_group_count
      )
    )
    on conflict (assignment_id,vendor_id)
      where event_type='fair_share_accrued'
        and assignment_id is not null
      do nothing;

    get diagnostics v_share_inserted = row_count;

    if v_share_inserted=1 then
      insert into public.vendor_opportunity_fairness(
        vendor_id,
        scope_key,
        city_key,
        category_key,
        service_zone_id,
        fair_share_balance
      ) values (
        v_vendor,
        v_opportunity.scope_key,
        v_opportunity.city_key,
        v_opportunity.category_key,
        v_opportunity.service_zone_id,
        v_share
      )
      on conflict (vendor_id,scope_key) do update set
        fair_share_balance=
          public.vendor_opportunity_fairness.fair_share_balance
          + excluded.fair_share_balance,
        updated_at=now();
    end if;
  end loop;

  -- The provider-confirmed vendor consumes exactly one fairness opportunity.
  update public.vendor_opportunity_fairness
     set fair_share_balance=fair_share_balance-1,
         delivered_opportunity_count=delivered_opportunity_count+1,
         last_delivered_at=greatest(
           coalesce(last_delivered_at,'-infinity'::timestamptz),
           v_at
         ),
         updated_at=now()
   where vendor_id=v_assignment.vendor_id
     and scope_key=v_opportunity.scope_key;

  return jsonb_build_object(
    'status','applied',
    'assignment_id',v_assignment.id,
    'vendor_id',v_assignment.vendor_id,
    'scope_key',v_opportunity.scope_key,
    'match_tier',v_candidate.match_tier,
    'distance_band',v_candidate.distance_band,
    'comparable_vendor_count',v_group_count,
    'fair_share_per_delivery',v_share
  );
end;
$$;

revoke all on function public.qf_consume_vendor_fair_opportunity_v1(
  uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.qf_consume_vendor_fair_opportunity_v1(
  uuid,timestamptz
) to service_role;

create or replace function public.qf_restore_vendor_fair_opportunity_v1(
  p_assignment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_delivered public.vendor_opportunity_events%rowtype;
  v_share public.vendor_opportunity_events%rowtype;
  v_inserted integer;
  v_reverse_inserted integer;
  v_last_effective_delivery timestamptz;
begin
  if p_assignment_id is null then
    return jsonb_build_object(
      'status','rejected',
      'reason_code','assignment_required'
    );
  end if;

  select * into v_delivered
  from public.vendor_opportunity_events
  where assignment_id=p_assignment_id
    and event_type='delivered'
  limit 1;

  if not found then
    return jsonb_build_object(
      'status','ignored',
      'reason_code','delivery_not_counted'
    );
  end if;

  insert into public.vendor_opportunity_events(
    lead_id,
    vendor_id,
    assignment_id,
    scope_key,
    event_type,
    balance_delta,
    occurred_at,
    metadata
  ) values (
    v_delivered.lead_id,
    v_delivered.vendor_id,
    p_assignment_id,
    v_delivered.scope_key,
    'restored_bad_lead',
    1,
    now(),
    jsonb_build_object('source','human_validated_bad_lead')
  )
  on conflict (assignment_id)
    where event_type='restored_bad_lead' and assignment_id is not null
    do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted=0 then
    return jsonb_build_object(
      'status','already_applied',
      'assignment_id',p_assignment_id
    );
  end if;

  -- Reverse every peer-share event created by this now-invalid delivered slot.
  -- This keeps the ledger zero-sum: nobody gains "missed turn" credit for an
  -- opportunity that human review later determined should not count.
  for v_share in
    select *
    from public.vendor_opportunity_events
    where assignment_id=p_assignment_id
      and event_type='fair_share_accrued'
    order by vendor_id
  loop
    insert into public.vendor_opportunity_events(
      lead_id,
      vendor_id,
      assignment_id,
      scope_key,
      event_type,
      balance_delta,
      occurred_at,
      metadata
    ) values (
      v_share.lead_id,
      v_share.vendor_id,
      p_assignment_id,
      v_share.scope_key,
      'fair_share_reversed_bad_lead',
      -v_share.balance_delta,
      now(),
      jsonb_build_object('source','human_validated_bad_lead')
    )
    on conflict (assignment_id,vendor_id)
      where event_type='fair_share_reversed_bad_lead'
        and assignment_id is not null
      do nothing;

    get diagnostics v_reverse_inserted = row_count;

    if v_reverse_inserted=1 then
      update public.vendor_opportunity_fairness
         set fair_share_balance=fair_share_balance-v_share.balance_delta,
             updated_at=now()
       where vendor_id=v_share.vendor_id
         and scope_key=v_share.scope_key;
    end if;
  end loop;

  select max(d.occurred_at)
    into v_last_effective_delivery
  from public.vendor_opportunity_events d
  where d.vendor_id=v_delivered.vendor_id
    and d.scope_key=v_delivered.scope_key
    and d.event_type='delivered'
    and not exists (
      select 1
      from public.vendor_opportunity_events r
      where r.assignment_id=d.assignment_id
        and r.event_type='restored_bad_lead'
    );

  update public.vendor_opportunity_fairness
     set fair_share_balance=fair_share_balance+1,
         restored_opportunity_count=restored_opportunity_count+1,
         last_delivered_at=v_last_effective_delivery,
         updated_at=now()
   where vendor_id=v_delivered.vendor_id
     and scope_key=v_delivered.scope_key;

  return jsonb_build_object(
    'status','applied',
    'assignment_id',p_assignment_id,
    'vendor_id',v_delivered.vendor_id,
    'scope_key',v_delivered.scope_key
  );
end;
$$;

revoke all on function public.qf_restore_vendor_fair_opportunity_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.qf_restore_vendor_fair_opportunity_v1(uuid)
  to service_role;

-- Provider-confirmed communication truth is the ONLY fairness consumption seam.
create or replace function public.qf_vendor_fairness_delivery_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.assignment_id is not null
     and new.communication_message_id is not null
     and new.delivery_status='delivered'
     and new.provider_delivered_at is not null then
    perform public.qf_consume_vendor_fair_opportunity_v1(
      new.assignment_id,
      new.provider_delivered_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qf_vendor_fairness_delivery
  on public.lead_delivery_logs;

create trigger trg_qf_vendor_fairness_delivery
after insert or update of delivery_status,provider_delivered_at
on public.lead_delivery_logs
for each row
execute function public.qf_vendor_fairness_delivery_trigger_v1();

-- Human-validated bad lead recovery restores the fairness win as well as using
-- the existing governed credit-restoration path.
create or replace function public.qf_vendor_fairness_bad_lead_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.assignment_id is not null
     and new.event_type='lifecycle_transition'
     and new.lifecycle_to='invalid'
     and new.reason_code='bad_lead_validated' then
    perform public.qf_restore_vendor_fair_opportunity_v1(new.assignment_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qf_vendor_fairness_bad_lead
  on public.lead_assignment_events;

create trigger trg_qf_vendor_fairness_bad_lead
after insert on public.lead_assignment_events
for each row
execute function public.qf_vendor_fairness_bad_lead_trigger_v1();

revoke all on function public.qf_vendor_fairness_delivery_trigger_v1()
  from public, anon, authenticated;
revoke all on function public.qf_vendor_fairness_bad_lead_trigger_v1()
  from public, anon, authenticated;

comment on table public.vendor_opportunity_fairness is
  'Canonical automatic-matching fairness ledger. Credits gate eligibility only. Balance moves only from provider-confirmed delivered opportunities and governed bad-lead restoration.';

comment on table public.lead_fairness_opportunities is
  'Idempotent first hard-eligible pool header for an automatic lead. Snapshotting alone creates no fair-share balance.';

comment on table public.lead_fairness_candidates is
  'Per-lead hard-eligible vendor snapshot with canonical category tier and straight-line distance band used to define comparable fairness groups.';

comment on table public.vendor_opportunity_events is
  'Append-only fairness evidence: eligible participation, same-relevance-group fair-share accrual, provider-confirmed delivery consumption, and human-validated bad-lead restoration.';

-- Fail the migration if browser mutation authority or trigger wiring drifts.
do $$
begin
  if has_function_privilege(
       'anon',
       'public.qf_snapshot_vendor_fair_opportunity_v1(uuid,text,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.qf_snapshot_vendor_fair_opportunity_v1(uuid,text,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.qf_consume_vendor_fair_opportunity_v1(uuid,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.qf_consume_vendor_fair_opportunity_v1(uuid,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.qf_restore_vendor_fair_opportunity_v1(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.qf_restore_vendor_fair_opportunity_v1(uuid)',
       'EXECUTE'
     ) then
    raise exception 'QF_FAIRNESS_BROWSER_EXECUTE_LEAK';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.qf_snapshot_vendor_fair_opportunity_v1(uuid,text,text,text,uuid,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.qf_consume_vendor_fair_opportunity_v1(uuid,timestamptz)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.qf_restore_vendor_fair_opportunity_v1(uuid)',
       'EXECUTE'
     ) then
    raise exception 'QF_FAIRNESS_SERVICE_ROLE_EXECUTE_MISSING';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid='public.lead_delivery_logs'::regclass
      and tgname='trg_qf_vendor_fairness_delivery'
      and not tgisinternal
  ) then
    raise exception 'QF_FAIRNESS_DELIVERY_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid='public.lead_assignment_events'::regclass
      and tgname='trg_qf_vendor_fairness_bad_lead'
      and not tgisinternal
  ) then
    raise exception 'QF_FAIRNESS_BAD_LEAD_TRIGGER_MISSING';
  end if;
end $$;

commit;
