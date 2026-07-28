-- ============================================================================
-- QF-MVP-30.5B2B — FREQUENCY POLICY HISTORY HARDENING
--
-- WHY THIS EXISTS
--   QF-MVP-30.5B2A proved every functional behaviour of the campaign handoff
--   against staging, and in doing so exposed ONE real database-authority defect
--   (its FINDING-1):
--
--     service_role could DELETE (and TRUNCATE) communication_frequency_policies.
--
--   Migration 1500 wrote:
--       revoke all ... from public, anon, authenticated;
--       grant select, insert, update ... to service_role;
--   The revokes never named service_role, and the grant is ADDITIVE. Supabase's
--   pg_default_acl for `postgres` in schema `public` already grants arwdDxtm
--   (ALL) to anon, authenticated AND service_role on every new table, so
--   service_role kept DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.
--   Observed on staging: relacl = {postgres=arwdDxtm/postgres,
--   service_role=arwdDxtm/postgres}.
--
--   The frequency policy is the Core authority that bounds how often a person
--   may be contacted. Its history must be auditable after the fact, so it must
--   not be erasable or rewritable in place.
--
-- WHAT THIS DOES
--   1. Resets the table ACL to exactly the intended authority.
--   2. Makes historical policy MEANING immutable: identity, scope, thresholds,
--      window and effective_from can never be rewritten. Only the canonical
--      retirement transition remains possible.
--   3. Blocks DELETE and TRUNCATE outright, so history survives even the table
--      owner, for whom grants do not apply.
--
-- WHAT THIS DOES NOT DO
--   Seeds NO policy row and chooses NO business frequency number — that remains
--   an owner decision. Creates no second policy model, no new table, no provider
--   or network object. Sends nothing.
--
-- Migrations 0001-1500 are NOT edited. This is forward-only.
--
-- ROLLBACK BOUNDARY
--   drop trigger trg_cfp_no_delete on public.communication_frequency_policies;
--   drop trigger trg_cfp_no_truncate on public.communication_frequency_policies;
--   drop trigger trg_cfp_history_immutable on public.communication_frequency_policies;
--   drop function public.qf_prevent_frequency_policy_delete();
--   drop function public.qf_prevent_frequency_policy_history_rewrite();
--   -- and, only if deliberately re-widening: grant delete ... to service_role;
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Reset the ACL to exactly the intended authority
-- ---------------------------------------------------------------------------
-- `revoke all` FIRST (including from service_role, which 1500 omitted), then
-- re-grant only what the backend genuinely needs: read the policy, insert a new
-- one, and retire an existing one. No DELETE, no TRUNCATE.
revoke all on table public.communication_frequency_policies from public;
revoke all on table public.communication_frequency_policies from anon;
revoke all on table public.communication_frequency_policies from authenticated;
revoke all on table public.communication_frequency_policies from service_role;

grant select, insert, update on table public.communication_frequency_policies to service_role;

-- ---------------------------------------------------------------------------
-- 2. Historical MEANING is immutable; only retirement may change
-- ---------------------------------------------------------------------------
-- Without this, an UPDATE could silently rewrite max_per_window or window_length
-- on an already-used policy, and every past handoff decision would afterwards
-- appear to have been made under a rule that never applied to it.
create or replace function public.qf_prevent_frequency_policy_history_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_changed text;
begin
  select string_agg(col, ', ' order by col) into v_changed from (
    select 'id'               as col where new.id               is distinct from old.id
    union all select 'channel'          where new.channel          is distinct from old.channel
    union all select 'scope'            where new.scope            is distinct from old.scope
    union all select 'min_interval'     where new.min_interval     is distinct from old.min_interval
    union all select 'max_per_window'   where new.max_per_window   is distinct from old.max_per_window
    union all select 'window_length'    where new.window_length    is distinct from old.window_length
    union all select 'effective_from'   where new.effective_from   is distinct from old.effective_from
    union all select 'policy_reference' where new.policy_reference is distinct from old.policy_reference
    union all select 'created_by'       where new.created_by       is distinct from old.created_by
    union all select 'created_at'       where new.created_at       is distinct from old.created_at
  ) t;

  if v_changed is not null then
    raise exception
      'QF-MVP-30.5B2B: communication_frequency_policies history is immutable; refused rewrite of (%). Insert a NEW policy row instead.', v_changed
      using errcode = 'check_violation';
  end if;

  -- Retirement is one-way. Re-activating a retired policy would resurrect a rule
  -- that the audit trail already shows as closed.
  if old.is_active is false and new.is_active is true then
    raise exception
      'QF-MVP-30.5B2B: a retired frequency policy cannot be re-activated; insert a NEW policy row instead.'
      using errcode = 'check_violation';
  end if;

  -- effective_to records WHEN a policy stopped applying. It may be set once and
  -- never cleared or moved.
  if old.effective_to is not null and new.effective_to is distinct from old.effective_to then
    raise exception
      'QF-MVP-30.5B2B: effective_to is write-once and cannot be cleared or moved.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cfp_history_immutable on public.communication_frequency_policies;
create trigger trg_cfp_history_immutable
  before update on public.communication_frequency_policies
  for each row execute function public.qf_prevent_frequency_policy_history_rewrite();

-- ---------------------------------------------------------------------------
-- 3. DELETE and TRUNCATE are refused outright
-- ---------------------------------------------------------------------------
-- Revoking the privilege stops every granted role, but NOT the table owner, for
-- whom grants are not consulted. A trigger is what actually makes the history
-- durable. This mirrors the append-only pattern already used for
-- vendor_campaign_events and lead_assignment_events.
create or replace function public.qf_prevent_frequency_policy_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception
    'QF-MVP-30.5B2B: communication_frequency_policies is append-only; retire a policy with is_active = false instead of deleting it.'
    using errcode = 'check_violation';
  return null;
end;
$$;

drop trigger if exists trg_cfp_no_delete on public.communication_frequency_policies;
create trigger trg_cfp_no_delete
  before delete on public.communication_frequency_policies
  for each row execute function public.qf_prevent_frequency_policy_delete();

drop trigger if exists trg_cfp_no_truncate on public.communication_frequency_policies;
create trigger trg_cfp_no_truncate
  before truncate on public.communication_frequency_policies
  for each statement execute function public.qf_prevent_frequency_policy_delete();

comment on function public.qf_prevent_frequency_policy_history_rewrite() is
  'QF-MVP-30.5B2B: freezes the MEANING of a frequency policy (identity, scope, thresholds, window, effective_from). Only the canonical one-way retirement (is_active true->false, effective_to set once) is permitted; a changed rule requires a NEW row.';
comment on function public.qf_prevent_frequency_policy_delete() is
  'QF-MVP-30.5B2B: refuses DELETE and TRUNCATE on communication_frequency_policies so policy history survives even the table owner, for whom table grants are not consulted.';

revoke all on function public.qf_prevent_frequency_policy_history_rewrite() from public, anon, authenticated;
revoke all on function public.qf_prevent_frequency_policy_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_n integer;
begin
  -- 4.1 DELETE and TRUNCATE are denied to every untrusted role AND to service_role.
  if has_table_privilege('service_role', 'public.communication_frequency_policies', 'delete')
     or has_table_privilege('anon', 'public.communication_frequency_policies', 'delete')
     or has_table_privilege('authenticated', 'public.communication_frequency_policies', 'delete') then
    raise exception 'QF-MVP-30.5B2B aborted: DELETE is still granted on the frequency policy table.';
  end if;
  if has_table_privilege('service_role', 'public.communication_frequency_policies', 'truncate') then
    raise exception 'QF-MVP-30.5B2B aborted: TRUNCATE is still granted to service_role.';
  end if;

  -- 4.2 the intended backend authority is preserved EXACTLY.
  if not (has_table_privilege('service_role', 'public.communication_frequency_policies', 'select')
      and has_table_privilege('service_role', 'public.communication_frequency_policies', 'insert')
      and has_table_privilege('service_role', 'public.communication_frequency_policies', 'update')) then
    raise exception 'QF-MVP-30.5B2B aborted: service_role lost the create/retire authority it needs.';
  end if;

  -- 4.3 untrusted roles retain no access at all.
  if has_table_privilege('anon', 'public.communication_frequency_policies', 'select')
     or has_table_privilege('authenticated', 'public.communication_frequency_policies', 'insert')
     or has_table_privilege('authenticated', 'public.communication_frequency_policies', 'update') then
    raise exception 'QF-MVP-30.5B2B aborted: an untrusted role can still reach the frequency policy table.';
  end if;

  -- 4.4 all three protective triggers exist.
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.communication_frequency_policies'::regclass
     and not tgisinternal
     and tgname in ('trg_cfp_history_immutable', 'trg_cfp_no_delete', 'trg_cfp_no_truncate');
  if v_n <> 3 then
    raise exception 'QF-MVP-30.5B2B aborted: expected 3 protective triggers, found %.', v_n;
  end if;

  -- 4.5 both functions have a fixed search_path.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('qf_prevent_frequency_policy_history_rewrite', 'qf_prevent_frequency_policy_delete')
     and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=pg_catalog, public, pg_temp%';
  if v_n <> 2 then
    raise exception 'QF-MVP-30.5B2B aborted: a protective function has no fixed search_path.';
  end if;

  -- 4.6 STILL no seeded policy and no business number chosen.
  select count(*) into v_n from public.communication_frequency_policies where is_active;
  if v_n <> 0 then
    raise exception 'QF-MVP-30.5B2B aborted: an ACTIVE frequency policy exists (% row(s)); the value is an owner decision.', v_n;
  end if;

  -- 4.7 the handoff RPC is untouched and still fail-closed.
  if to_regprocedure('public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)') is null
     or has_function_privilege('anon',
          'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute') then
    raise exception 'QF-MVP-30.5B2B aborted: the handoff RPC is missing or became executable by anon.';
  end if;

  -- 4.8 no provider/network object was introduced.
  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')) then
    raise exception 'QF-MVP-30.5B2B aborted: a network extension is installed.';
  end if;
end;
$verify$;

commit;
