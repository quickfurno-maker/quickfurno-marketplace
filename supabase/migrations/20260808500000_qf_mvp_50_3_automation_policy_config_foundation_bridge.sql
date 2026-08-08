-- ============================================================================
-- QuickFurno - 20260808500000_qf_mvp_50_3_automation_policy_config_foundation_bridge.sql
-- QF-MVP-50.3 / 50.4: post-baseline parity bridge for the automation policy
-- config foundation.
--
-- WHY THIS EXISTS
-- ---------------
-- The canonical automation policy config foundation was created by the
-- historical PRE-BASELINE migration
--   20260706000150_automation_policy_config_foundation.sql
-- The QuickFurno staging baseline squash (20260722000100, schema sha256
-- 269c9265...) was intended to supersede the whole pre-baseline chain, but it
-- does NOT contain these objects. QF-MVP-50.3 (20260809000000) therefore
-- aborted at its own preflight on staging with
--   'QF-MVP-50.3 aborted: the automation policy config tables are missing.'
--
-- SCOPE AND LIMITS
-- ----------------
-- This is a PARITY REPAIR for exactly one omitted canonical foundation. It is
-- NOT an exception that permits replaying the pre-baseline chain: the rule
-- PRE_BASELINE_CHAIN_INTENTIONALLY_SUPERSEDED_FOR_STAGING with
-- mustReplayOnStaging=false remains in force, and 20260706000150 itself is
-- never replayed and never edited.
--
-- This migration is PRESENCE-IDEMPOTENT BY CATALOG PROBE, not by
-- 'create table if not exists'. It distinguishes three states:
--   STATE A  both canonical object sets ABSENT  -> create canonical foundation
--   STATE B  both PRESENT and structurally canonical -> strict NO-OP
--   STATE C  partial or structurally incompatible -> FAIL CLOSED
-- It never drops, never recreates, and never rewrites existing rows.
--
-- ADDITIVE ONLY. It does not publish events, assign vendors, deduct credits,
-- call matching, WhatsApp, n8n, provider outbox, workers, PM2 or UI. It carries
-- NO QF-MVP-50.3 business policy: the vendor low-credit warning threshold
-- remains owned exclusively by 20260809000000.
--
-- Version note: this file is deliberately ordered BETWEEN 20260808000000 and
-- 20260809000000 so that it applies before the QF-MVP-50.3 producer.
-- ============================================================================

do $bridge$
declare
  v_configs_present boolean;
  v_active_present  boolean;
  v_problems        text[] := array[]::text[];
  v_expected        record;
  v_config_id       uuid;
begin
  v_configs_present := to_regclass('public.automation_policy_configs') is not null;
  v_active_present  := to_regclass('public.automation_policy_active_configs') is not null;

  -- -------------------------------------------------------------------------
  -- STATE C (partial): exactly one of the two canonical tables exists.
  -- Never repair an unknown partial state silently.
  -- -------------------------------------------------------------------------
  if v_configs_present <> v_active_present then
    raise exception
      'QF-MVP-50.3/50.4 policy-config bridge aborted: PARTIAL catalog state (automation_policy_configs present=%, automation_policy_active_configs present=%). Refusing to repair an unknown partial state.',
      v_configs_present, v_active_present
      using errcode = 'P0001';
  end if;

  -- -------------------------------------------------------------------------
  -- STATE B: both present. Verify the canonical shape, then NO-OP.
  -- Structural checks are name-independent where practical (column sets on
  -- constraints rather than constraint names).
  -- -------------------------------------------------------------------------
  if v_configs_present then

    for v_expected in
      select *
        from (values
          ('automation_policy_configs',        'id',                 'uuid'),
          ('automation_policy_configs',        'policy_key',         'text'),
          ('automation_policy_configs',        'policy_version',     'text'),
          ('automation_policy_configs',        'config_json',        'jsonb'),
          ('automation_policy_configs',        'config_fingerprint', 'text'),
          ('automation_policy_configs',        'created_by',         'text'),
          ('automation_policy_configs',        'created_at',         'timestamp with time zone'),
          ('automation_policy_active_configs', 'policy_key',         'text'),
          ('automation_policy_active_configs', 'config_id',          'uuid'),
          ('automation_policy_active_configs', 'activated_by',       'text'),
          ('automation_policy_active_configs', 'activated_at',       'timestamp with time zone')
        ) as t(tbl, col, typ)
    loop
      if not exists (
        select 1
          from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name   = v_expected.tbl
           and c.column_name  = v_expected.col
           and c.data_type    = v_expected.typ
      ) then
        v_problems := v_problems
          || format('column public.%s.%s (%s) is missing or has the wrong type',
                    v_expected.tbl, v_expected.col, v_expected.typ);
      end if;
    end loop;

    -- automation_policy_configs: primary key on (id)
    if not exists (
      select 1
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_configs'
         and con.contype = 'p'
         and (select array_agg(a.attname::text order by a.attname)
                from unnest(con.conkey) as k
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
             = array['id']
    ) then
      v_problems := v_problems
        || 'public.automation_policy_configs is missing its primary key on (id)';
    end if;

    -- automation_policy_configs: unique (policy_key, config_fingerprint)
    if not exists (
      select 1
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_configs'
         and con.contype in ('u', 'p')
         and (select array_agg(a.attname::text order by a.attname)
                from unnest(con.conkey) as k
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
             = array['config_fingerprint', 'policy_key']
    ) then
      v_problems := v_problems
        || 'public.automation_policy_configs is missing the unique constraint on (policy_key, config_fingerprint)';
    end if;

    -- automation_policy_configs: unique (policy_key, id) - the composite FK target
    if not exists (
      select 1
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_configs'
         and con.contype in ('u', 'p')
         and (select array_agg(a.attname::text order by a.attname)
                from unnest(con.conkey) as k
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
             = array['id', 'policy_key']
    ) then
      v_problems := v_problems
        || 'public.automation_policy_configs is missing the unique constraint on (policy_key, id)';
    end if;

    -- automation_policy_active_configs: primary key on (policy_key)
    if not exists (
      select 1
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_active_configs'
         and con.contype = 'p'
         and (select array_agg(a.attname::text order by a.attname)
                from unnest(con.conkey) as k
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
             = array['policy_key']
    ) then
      v_problems := v_problems
        || 'public.automation_policy_active_configs is missing its primary key on (policy_key)';
    end if;

    -- automation_policy_active_configs: composite FK -> automation_policy_configs
    if not exists (
      select 1
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_active_configs'
         and con.contype = 'f'
         and con.confrelid = 'public.automation_policy_configs'::regclass
         and (select array_agg(a.attname::text order by a.attname)
                from unnest(con.conkey) as k
                join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
             = array['config_id', 'policy_key']
    ) then
      v_problems := v_problems
        || 'public.automation_policy_active_configs is missing the composite foreign key (policy_key, config_id) -> public.automation_policy_configs(policy_key, id)';
    end if;

    -- Append-only enforcement: the immutability function and a live trigger.
    if to_regprocedure('public.qf_prevent_automation_policy_config_mutation()') is null then
      v_problems := v_problems
        || 'function public.qf_prevent_automation_policy_config_mutation() is missing';
    end if;

    if not exists (
      select 1
        from pg_trigger tg
        join pg_class rel on rel.oid = tg.tgrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_configs'
         and not tg.tgisinternal
    ) then
      v_problems := v_problems
        || 'public.automation_policy_configs has no append-only enforcement trigger';
    end if;

    -- Row level security must be enabled on both tables.
    if not exists (
      select 1 from pg_class rel
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_configs'
         and rel.relrowsecurity
    ) then
      v_problems := v_problems
        || 'row level security is not enabled on public.automation_policy_configs';
    end if;

    if not exists (
      select 1 from pg_class rel
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'
         and rel.relname = 'automation_policy_active_configs'
         and rel.relrowsecurity
    ) then
      v_problems := v_problems
        || 'row level security is not enabled on public.automation_policy_active_configs';
    end if;

    if array_length(v_problems, 1) is not null then
      raise exception
        'QF-MVP-50.3/50.4 policy-config bridge aborted: the automation policy config foundation is present but NOT canonical. Problems: %. Refusing to alter, drop or recreate an existing foundation.',
        array_to_string(v_problems, '; ')
        using errcode = 'P0001';
    end if;

    raise notice
      'QF-MVP-50.3/50.4 policy-config bridge: canonical automation policy config foundation already present and structurally canonical. NO-OP.';
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- STATE A: both absent. Create the canonical foundation, matching the
  -- historical 20260706000150 contract exactly. Plain CREATE (not IF NOT
  -- EXISTS) is correct here because absence has just been proven by probe.
  -- -------------------------------------------------------------------------
  raise notice
    'QF-MVP-50.3/50.4 policy-config bridge: automation policy config foundation absent. Creating canonical foundation.';

  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    execute $ddl$ create extension "pgcrypto" $ddl$;
  end if;

  execute $ddl$
    create table public.automation_policy_configs (
      id uuid primary key default gen_random_uuid(),
      policy_key text not null,
      policy_version text not null,
      config_json jsonb not null,
      config_fingerprint text not null,
      created_by text,
      created_at timestamptz not null default now(),
      constraint automation_policy_configs_policy_key_non_empty
        check (length(trim(policy_key)) > 0),
      constraint automation_policy_configs_policy_version_non_empty
        check (length(trim(policy_version)) > 0),
      constraint automation_policy_configs_config_json_object
        check (jsonb_typeof(config_json) = 'object'),
      constraint automation_policy_configs_fingerprint_sha256_lower_hex
        check (config_fingerprint ~ '^[0-9a-f]{64}$'),
      constraint automation_policy_configs_policy_fingerprint_unique
        unique (policy_key, config_fingerprint),
      constraint automation_policy_configs_policy_id_unique
        unique (policy_key, id)
    )
  $ddl$;

  execute $ddl$
    comment on table public.automation_policy_configs is
      'Immutable automation policy config versions. Rows are append-only; updates and deletes are blocked by trigger.'
  $ddl$;
  execute $ddl$
    comment on column public.automation_policy_configs.config_json is
      'Strict policy config JSON object. Store only policy thresholds/gates; no client PII or secrets.'
  $ddl$;
  execute $ddl$
    comment on column public.automation_policy_configs.config_fingerprint is
      'Lowercase SHA-256 fingerprint computed by the Phase 4A policy fingerprint helper.'
  $ddl$;

  execute $ddl$
    create index idx_automation_policy_configs_policy_version
      on public.automation_policy_configs(policy_key, policy_version)
  $ddl$;
  execute $ddl$
    create index idx_automation_policy_configs_created_at
      on public.automation_policy_configs(created_at desc)
  $ddl$;

  execute $ddl$
    create or replace function public.qf_prevent_automation_policy_config_mutation()
    returns trigger
    language plpgsql
    set search_path = pg_catalog, public, pg_temp
    as $fn$
    begin
      raise exception 'AUTOMATION_POLICY_CONFIG_IMMUTABLE' using errcode = 'P0001';
    end;
    $fn$
  $ddl$;

  execute $ddl$
    create trigger trg_automation_policy_configs_immutable
    before update or delete on public.automation_policy_configs
    for each row execute function public.qf_prevent_automation_policy_config_mutation()
  $ddl$;

  execute $ddl$
    create table public.automation_policy_active_configs (
      policy_key text primary key,
      config_id uuid not null,
      activated_by text,
      activated_at timestamptz not null default now(),
      constraint automation_policy_active_configs_policy_key_non_empty
        check (length(trim(policy_key)) > 0),
      constraint automation_policy_active_configs_config_fk
        foreign key (policy_key, config_id)
        references public.automation_policy_configs(policy_key, id)
        on update restrict
        on delete restrict
    )
  $ddl$;

  execute $ddl$
    comment on table public.automation_policy_active_configs is
      'Mutable pointer to the currently active immutable automation policy config. Service-role only in Phase 4B-1.'
  $ddl$;

  execute $ddl$
    create index idx_automation_policy_active_configs_config_id
      on public.automation_policy_active_configs(config_id)
  $ddl$;

  -- -------------------------------------------------------------------------
  -- Canonical seed, created ONLY on the proven-absent path so nothing existing
  -- can ever be overwritten: lead_distribution_authorization_v1, byte-identical
  -- to the historical contract (fingerprint expected by
  -- scripts/phase4b1-policy-inputs-contract-harness.mjs).
  --
  -- QF-MVP-50.3's vendor_low_credit_warning_threshold seed is deliberately NOT
  -- here; it stays owned by 20260809000000.
  -- -------------------------------------------------------------------------
  insert into public.automation_policy_configs (
    policy_key,
    policy_version,
    config_json,
    config_fingerprint,
    created_by
  )
  values (
    'lead_distribution_authorization',
    'lead_distribution_authorization_v1',
    '{
      "policyVersion": "lead_distribution_authorization_v1",
      "mode": "human_approval_only",
      "enabled": false,
      "minimumAutoAuthorizeScore": 90,
      "allowedAutoAuthorizeScoreClasses": ["A+"],
      "requireNoHardBlock": true,
      "requiredRecommendedAction": "auto_distribute",
      "minimumRecommendationCount": 1,
      "maximumRecommendationCount": 3
    }'::jsonb,
    '1ecca567b6564e9188d4aab7cb7557614c87f2131c947b42929475b4e592901c',
    'phase4b1_safe_default_seed'
  )
  returning id into v_config_id;

  insert into public.automation_policy_active_configs (
    policy_key,
    config_id,
    activated_by
  )
  values (
    'lead_distribution_authorization',
    v_config_id,
    'phase4b1_safe_default_seed'
  );

  -- -------------------------------------------------------------------------
  -- RLS / privileges, matching the historical contract.
  -- -------------------------------------------------------------------------
  execute $ddl$ alter table public.automation_policy_configs enable row level security $ddl$;
  execute $ddl$ alter table public.automation_policy_active_configs enable row level security $ddl$;

  execute $ddl$ revoke all on public.automation_policy_configs from anon $ddl$;
  execute $ddl$ revoke all on public.automation_policy_configs from authenticated $ddl$;
  execute $ddl$ revoke all on public.automation_policy_active_configs from anon $ddl$;
  execute $ddl$ revoke all on public.automation_policy_active_configs from authenticated $ddl$;

  execute $ddl$ grant select, insert on public.automation_policy_configs to service_role $ddl$;
  execute $ddl$ grant select, insert, update, delete on public.automation_policy_active_configs to service_role $ddl$;

  execute $ddl$ revoke all on function public.qf_prevent_automation_policy_config_mutation() from public $ddl$;
  execute $ddl$ revoke all on function public.qf_prevent_automation_policy_config_mutation() from anon $ddl$;
  execute $ddl$ revoke all on function public.qf_prevent_automation_policy_config_mutation() from authenticated $ddl$;
  execute $ddl$ grant execute on function public.qf_prevent_automation_policy_config_mutation() to service_role $ddl$;
end
$bridge$;

-- ---------------------------------------------------------------------------
-- Post-condition: whichever state we came from, the QF-MVP-50.3 preflight
-- dependency must now hold. This never repairs anything; it only refuses to
-- report success on a foundation the next migration cannot use.
-- ---------------------------------------------------------------------------
do $verify$
begin
  if to_regclass('public.automation_policy_configs') is null
     or to_regclass('public.automation_policy_active_configs') is null then
    raise exception
      'QF-MVP-50.3/50.4 policy-config bridge aborted: the canonical foundation is still absent after the bridge.'
      using errcode = 'P0001';
  end if;
end
$verify$;
