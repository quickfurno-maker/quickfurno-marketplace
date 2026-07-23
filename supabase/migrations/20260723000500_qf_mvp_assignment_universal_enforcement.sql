-- ============================================================================
-- QF-MVP-20.3B2 — UNIVERSAL ASSIGNMENT ENFORCEMENT
--
-- Forward-only. Additive. Non-destructive. STAGING FIRST.
-- NOT AUTHORIZED FOR PRODUCTION by this phase. Generated and reviewed only;
-- application is a separate, separately authorized phase (B2 preflight, then
-- B2 application).
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS
-- ---------------------------------------------------------------------------
-- Migration B1 (20260723000300) made public.qf_assign_lead_vendors_v2 the sole
-- assignment authority and enforced active-3 / lifetime-6 INSIDE it. B1 shipped
-- with ZERO enforcement triggers ON PURPOSE, because it landed before the R1
-- runtime consumer release: constraining every writer while legacy consumers
-- were still live would have broken them (staging test T48, the B1/B2 boundary
-- proof).
--
-- R1 (commit 5c78ea3) migrated every compatible runtime consumer onto the
-- canonical authority and made every client-selected path fail closed. No
-- application code path can now reach a legacy assignment RPC.
--
-- B2 therefore closes the remaining gap: a write that BYPASSES the canonical
-- authority — legacy SQL, a future rogue writer, a direct psql session, an
-- owner-privileged script — is still uncapped. This migration makes the locked
-- invariants UNIVERSAL at the database boundary, for every write path and every
-- role including the table owner.
--
-- ---------------------------------------------------------------------------
-- SCOPE — EXACTLY THE LOCKED INVARIANTS, NOTHING ELSE
-- ---------------------------------------------------------------------------
-- ENFORCED HERE:
--   I1  max 3 ACTIVE assignments per lead; ACTIVE = {assigned, delivered, accepted}
--   I2  max 6 DISTINCT vendors over a lead lifetime, evidenced ONLY by
--       assignment_created events reaching lifecycle_to = 'assigned'
--   I3  public.lead_assignment_events is append-only: no UPDATE, no DELETE,
--       no TRUNCATE, for ANY role including the owner
--
-- ALREADY ENFORCED — NOTHING ADDED HERE (see section 5's assertions):
--   uq_replacement_requests_open_per_lead  (Migration A) — one open replacement
--       request per lead, open = {requested, approved, activating}
--   lead_assignments UNIQUE (lead_id, vendor_id)  (pre-existing)
--   uq_lead_assignment_events_idempotency        (Migration A)
--   idx_lead_assignments_active / idx_lead_assignment_events_lifetime
--       (Migration A) — these already serve both cap counts exactly, so B2
--       creates NO new index.
--
-- DELIBERATELY NOT IN THIS MIGRATION:
--   Migration C  — public vendor projection, anon revokes, policy replacement
--   Migration D  — the auth.users trigger
--   Migration E  — legacy RPC EXECUTE revocation (legacy RPCs stay callable)
--   QF-MVP-20.4  — historical ledger reconciliation / any backfill
--   R1_BLOCKED_PENDING_OWNER_BINDING — no client_account_id / user_id /
--       created_by column, no client-selection request table, no phone-based
--       ownership inference, no reactivation of client-selected assignment.
--       It remains UNRESOLVED and OUT OF SCOPE.
--
-- No caller-controlled bypass flag exists. No session GUC is trusted. No
-- lifecycle state is invented — in_progress remains CRM-only and is not a
-- lifecycle value.
--
-- ---------------------------------------------------------------------------
-- CONCURRENCY POSTURE
-- ---------------------------------------------------------------------------
-- Both cap triggers serialize on the SAME lock the canonical authority already
-- takes first: SELECT ... FROM public.leads WHERE id = <lead> FOR UPDATE.
--   * Inside B1 that lock is already held, so re-taking it is a no-op and adds
--     no new lock and no new wait.
--   * For a direct/legacy writer it is the ONLY lock B2 takes, and it is taken
--     before the count, so the count runs on a fresh READ COMMITTED snapshot
--     that sees whatever the previous lock holder committed.
--   * B2 never locks public.vendors, so the global lead -> vendors(ascending)
--     lock order used by B1 is preserved and no new deadlock cycle exists.
-- Neither trigger function writes to any table, so trigger recursion is
-- impossible by construction.
--
-- ROLLBACK / FAILURE BEHAVIOUR
--   Every rejection is `raise exception` with errcode P0001, which aborts the
--   whole statement and transaction. B1's only exception handler catches
--   unique_violation (errcode 23505) and therefore CANNOT swallow a B2
--   rejection. A rejected write leaves no assignment, no lineage event, no
--   ledger row and no communication intent.
--
-- No explicit transaction control appears below: the Supabase CLI wraps this
-- file and its migration-history insert in ONE transaction. An inner COMMIT
-- would break that atomicity.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. I1 — max 3 ACTIVE assignments per lead
--
--    ACTIVE is exactly {assigned, delivered, accepted}, matching
--    lead_assignments_lifecycle_status_check, idx_lead_assignments_active and
--    qf_assign_lead_vendors_v2 step 6. Any other lifecycle value consumes no
--    active slot.
--
--    SECURITY DEFINER is deliberate and load-bearing: RLS is enabled on
--    public.lead_assignments, so an INVOKER-rights trigger could be shown a
--    filtered subset of rows and would then permit a cap breach. The definer
--    always sees the true active set.
-- ---------------------------------------------------------------------------

create or replace function public.qf_enforce_lead_assignment_active_cap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_active_cap constant integer := 3;
  v_active     integer;
begin
  -- A row that is not ACTIVE cannot consume an active slot.
  if new.lifecycle_status is null
     or new.lifecycle_status not in ('assigned', 'delivered', 'accepted') then
    return new;
  end if;

  -- An UPDATE that leaves an ALREADY-ACTIVE row active on the SAME lead cannot
  -- increase the active count, so it needs neither the lock nor the count.
  if tg_op = 'UPDATE'
     and old.lead_id = new.lead_id
     and old.lifecycle_status in ('assigned', 'delivered', 'accepted') then
    return new;
  end if;

  -- Serialize every writer for this lead. Already held inside B1.
  perform 1 from public.leads where id = new.lead_id for update;

  -- Separate statement => fresh READ COMMITTED snapshot => sees rows committed
  -- by the transaction that just released the lead lock.
  select count(*) into v_active
    from public.lead_assignments
   where lead_id = new.lead_id
     and lifecycle_status in ('assigned', 'delivered', 'accepted')
     and id <> new.id;

  if v_active >= c_active_cap then
    raise exception using
      errcode = 'P0001',
      message = 'QF_ASSIGNMENT_ACTIVE_LIMIT_REACHED',
      detail  = format(
        'lead %s already holds %s active assignments; the cap is %s.',
        new.lead_id, v_active, c_active_cap);
  end if;

  return new;
end;
$$;

comment on function public.qf_enforce_lead_assignment_active_cap() is
  'QF-MVP-20.3B2 universal active-three enforcement. ACTIVE = {assigned, delivered, accepted}. Serializes on the leads row lock, the same lock qf_assign_lead_vendors_v2 takes first. Never writes, so it cannot recurse.';

drop trigger if exists trg_lead_assignments_active_cap on public.lead_assignments;
create trigger trg_lead_assignments_active_cap
before insert or update on public.lead_assignments
for each row execute function public.qf_enforce_lead_assignment_active_cap();


-- ---------------------------------------------------------------------------
-- 2. I2 — max 6 DISTINCT vendors over a lead lifetime
--
--    Lifetime evidence is EXACTLY assignment_created events reaching
--    lifecycle_to = 'assigned'. It is never storage sequence, never a caller
--    counter, and never the live lead_assignments rows (which may transition
--    away from ACTIVE). This is the same predicate as
--    idx_lead_assignment_events_lifetime and qf_assign_lead_vendors_v2 step 5.
--
--    A REPEAT qualifying event for a vendor already counted for this lead
--    consumes NO new lifetime slot: the count is COUNT(DISTINCT vendor_id).
-- ---------------------------------------------------------------------------

create or replace function public.qf_enforce_lead_lifetime_vendor_cap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_lifetime_cap  constant integer := 6;
  v_is_new_vendor boolean;
  v_lifetime      integer;
begin
  -- Only the qualifying lineage event is lifetime evidence.
  if new.event_type <> 'assignment_created' or new.lifecycle_to <> 'assigned' then
    return new;
  end if;

  perform 1 from public.leads where id = new.lead_id for update;

  select not exists (
    select 1
      from public.lead_assignment_events
     where lead_id = new.lead_id
       and vendor_id = new.vendor_id
       and event_type = 'assignment_created'
       and lifecycle_to = 'assigned')
    into v_is_new_vendor;

  -- Already counted => this event adds no distinct vendor. Always allowed, and
  -- this is also why an idempotent replay (ON CONFLICT DO NOTHING on
  -- event_idempotency_key) is never rejected at the boundary.
  if not v_is_new_vendor then
    return new;
  end if;

  select count(distinct vendor_id) into v_lifetime
    from public.lead_assignment_events
   where lead_id = new.lead_id
     and event_type = 'assignment_created'
     and lifecycle_to = 'assigned';

  if v_lifetime >= c_lifetime_cap then
    raise exception using
      errcode = 'P0001',
      message = 'QF_ASSIGNMENT_LIFETIME_LIMIT_REACHED',
      detail  = format(
        'lead %s already has %s distinct lifetime vendors; the cap is %s.',
        new.lead_id, v_lifetime, c_lifetime_cap);
  end if;

  return new;
end;
$$;

comment on function public.qf_enforce_lead_lifetime_vendor_cap() is
  'QF-MVP-20.3B2 universal lifetime-six enforcement. Lifetime is COUNT(DISTINCT vendor_id) over assignment_created events with lifecycle_to = assigned. A repeat event for an already-counted vendor consumes no slot. Never writes, so it cannot recurse.';

drop trigger if exists trg_lead_assignment_events_lifetime_cap on public.lead_assignment_events;
create trigger trg_lead_assignment_events_lifetime_cap
before insert on public.lead_assignment_events
for each row execute function public.qf_enforce_lead_lifetime_vendor_cap();


-- ---------------------------------------------------------------------------
-- 3. I3 — public.lead_assignment_events is APPEND-ONLY, universally
--
--    Migration G already revoked UPDATE/DELETE/TRUNCATE from every application
--    role, so PUBLIC, anon, authenticated and service_role hold nothing beyond
--    SELECT + INSERT. The remaining writer is the OWNER (postgres), which is
--    documented break-glass, not an application-role failure. This trigger
--    extends immutability to the owner too — the defence-in-depth layer behind
--    staging test T70 — WITHOUT reclassifying owner authority as a failure.
--
--    ONE NARROW, DELIBERATE EXCEPTION.
--    Migration A declares the retention contract for this table:
--        assignment_id -> lead_assignments ON DELETE SET NULL
--        operation_id  -> assignment_operations ON DELETE SET NULL
--    "lineage must survive assignment-row cleanup (SET NULL, never delete)".
--    PostgreSQL implements those referential actions as real UPDATE statements,
--    which fire this trigger. Blocking them would CONTRADICT Migration A and
--    make assignment rows undeletable. So an UPDATE is permitted if, and only
--    if, the ONLY change is assignment_id and/or operation_id being nulled.
--    Every other column must be byte-identical, and neither reference may be
--    changed to a DIFFERENT value. Lineage content is still immutable.
-- ---------------------------------------------------------------------------

create or replace function public.qf_prevent_lead_assignment_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE',
      detail  = 'lead_assignment_events is append-only: DELETE is never permitted, for any role.';
  end if;

  -- Everything except the two nullable back-references must be unchanged.
  -- Comparing whole-row jsonb keeps this correct if columns are added later.
  if (to_jsonb(new) - 'assignment_id' - 'operation_id')
     is distinct from
     (to_jsonb(old) - 'assignment_id' - 'operation_id') then
    raise exception using
      errcode = 'P0001',
      message = 'QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE',
      detail  = 'lead_assignment_events is append-only: lineage content can never be updated.';
  end if;

  -- A back-reference may only be CLEARED (the ON DELETE SET NULL contract),
  -- never repointed at a different row.
  if new.assignment_id is distinct from old.assignment_id
     and new.assignment_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE',
      detail  = 'lead_assignment_events.assignment_id may only be cleared by the ON DELETE SET NULL contract.';
  end if;

  if new.operation_id is distinct from old.operation_id
     and new.operation_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE',
      detail  = 'lead_assignment_events.operation_id may only be cleared by the ON DELETE SET NULL contract.';
  end if;

  return new;
end;
$$;

comment on function public.qf_prevent_lead_assignment_event_mutation() is
  'QF-MVP-20.3B2 lineage immutability. DELETE is always refused. UPDATE is refused unless the ONLY change is assignment_id and/or operation_id being nulled, which is Migration A''s declared ON DELETE SET NULL retention contract. Applies to every role including the owner.';

drop trigger if exists trg_lead_assignment_events_immutable on public.lead_assignment_events;
create trigger trg_lead_assignment_events_immutable
before update or delete on public.lead_assignment_events
for each row execute function public.qf_prevent_lead_assignment_event_mutation();

create or replace function public.qf_prevent_lead_assignment_event_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QF_LEAD_ASSIGNMENT_EVENTS_TRUNCATE_FORBIDDEN',
    detail  = 'lead_assignment_events is append-only: TRUNCATE is never permitted, for any role.';
end;
$$;

comment on function public.qf_prevent_lead_assignment_event_truncate() is
  'QF-MVP-20.3B2 lineage immutability. TRUNCATE bypasses row triggers entirely, so it needs its own statement-level guard. Migration G removed TRUNCATE from every application role; this closes the owner path too.';

drop trigger if exists trg_lead_assignment_events_no_truncate on public.lead_assignment_events;
create trigger trg_lead_assignment_events_no_truncate
before truncate on public.lead_assignment_events
for each statement execute function public.qf_prevent_lead_assignment_event_truncate();


-- ---------------------------------------------------------------------------
-- 4. Least-privilege on the new functions
--
--    Trigger functions are invoked internally by the executor; EXECUTE is
--    checked when the trigger is CREATED, not when it fires. Revoking from
--    PUBLIC, anon and authenticated therefore costs nothing and removes the
--    functions as a directly callable surface. No GRANT is issued: no role
--    needs to call these by hand.
-- ---------------------------------------------------------------------------

revoke all on function public.qf_enforce_lead_assignment_active_cap()
  from public, anon, authenticated;
revoke all on function public.qf_enforce_lead_lifetime_vendor_cap()
  from public, anon, authenticated;
revoke all on function public.qf_prevent_lead_assignment_event_mutation()
  from public, anon, authenticated;
revoke all on function public.qf_prevent_lead_assignment_event_truncate()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Self-verification — fail closed on any deviation from the B2 contract
--
--    LOCKED POLICY (QF-MVP-20.3B1R2): no in-database self-verification may make
--    a lexical assertion, positive or negative, over pg_get_functiondef(),
--    pg_proc.prosrc or information_schema routine-definition text. That text
--    retains comments, and a negative regex over it is what failed
--    QF-MVP-20.3B1A. Everything below is a CATALOG FACT.
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_fn        text;
  v_sigs      text[] := array[
    'public.qf_enforce_lead_assignment_active_cap()',
    'public.qf_enforce_lead_lifetime_vendor_cap()',
    'public.qf_prevent_lead_assignment_event_mutation()',
    'public.qf_prevent_lead_assignment_event_truncate()'
  ];
  v_b1_sigs   text[] := array[
    'public.qf_vendor_assignment_eligible(uuid, uuid, integer)',
    'public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)',
    'public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)',
    'public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)',
    'public.qf_approve_credit_restoration_v2(uuid, uuid, text)'
  ];
  v_expected  text[] := array[
    'trg_lead_assignments_active_cap',
    'trg_lead_assignment_events_lifetime_cap',
    'trg_lead_assignment_events_immutable',
    'trg_lead_assignment_events_no_truncate'
  ];
  v_name      text;
  v_count     integer;
  v_tgtype    smallint;
  v_enabled   text;
  v_relname   text;
begin
  -- 5.1 every B2 function exists with the exact frozen (zero-argument) signature.
  foreach v_fn in array v_sigs loop
    if to_regprocedure(v_fn) is null then
      raise exception
        'QF-MVP-20.3B2 aborted: % is missing. B2 enforcement is incomplete.', v_fn;
    end if;
    if has_function_privilege('public', to_regprocedure(v_fn), 'EXECUTE')
       or has_function_privilege('anon', to_regprocedure(v_fn), 'EXECUTE')
       or has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE') then
      raise exception
        'QF-MVP-20.3B2 aborted: % is executable by PUBLIC, anon or authenticated.', v_fn;
    end if;
  end loop;

  -- 5.2 the two cap functions must be SECURITY DEFINER with a pinned
  --     search_path, or RLS could hide rows and let a cap be exceeded.
  --     The search_path is matched STRUCTURALLY (a proconfig entry that sets
  --     search_path and pins pg_catalog), never by exact string equality:
  --     PostgreSQL normalises GUC list spelling, so an exact match would be a
  --     brittle false alarm.
  foreach v_fn in array array[
    'public.qf_enforce_lead_assignment_active_cap()',
    'public.qf_enforce_lead_lifetime_vendor_cap()'
  ] loop
    if not exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure(v_fn)
         and p.prosecdef
         and exists (
           select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
            where cfg like 'search_path=%' and cfg like '%pg_catalog%')
    ) then
      raise exception
        'QF-MVP-20.3B2 aborted: % must be SECURITY DEFINER with a search_path pinning pg_catalog.', v_fn;
    end if;
  end loop;

  -- 5.3 each expected trigger exists EXACTLY ONCE, is enabled, is attached to
  --     the right table, and fires on exactly the right events.
  --     tgtype bits: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE.
  foreach v_name in array v_expected loop
    select count(*) into v_count from pg_trigger t
     where t.tgname = v_name and not t.tgisinternal;
    if v_count <> 1 then
      raise exception
        'QF-MVP-20.3B2 aborted: trigger % exists % times, expected exactly 1.', v_name, v_count;
    end if;

    select t.tgtype, t.tgenabled::text, c.relname
      into v_tgtype, v_enabled, v_relname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where t.tgname = v_name and not t.tgisinternal;

    if v_enabled <> 'O' then
      raise exception
        'QF-MVP-20.3B2 aborted: trigger % is not enabled in origin mode (tgenabled=%).', v_name, v_enabled;
    end if;

    if v_name = 'trg_lead_assignments_active_cap' then
      if v_relname <> 'lead_assignments' or v_tgtype <> 23 then
        raise exception
          'QF-MVP-20.3B2 aborted: % must be BEFORE INSERT OR UPDATE FOR EACH ROW on lead_assignments (table=%, tgtype=%).', v_name, v_relname, v_tgtype;
      end if;
    elsif v_name = 'trg_lead_assignment_events_lifetime_cap' then
      if v_relname <> 'lead_assignment_events' or v_tgtype <> 7 then
        raise exception
          'QF-MVP-20.3B2 aborted: % must be BEFORE INSERT FOR EACH ROW on lead_assignment_events (table=%, tgtype=%).', v_name, v_relname, v_tgtype;
      end if;
    elsif v_name = 'trg_lead_assignment_events_immutable' then
      if v_relname <> 'lead_assignment_events' or v_tgtype <> 27 then
        raise exception
          'QF-MVP-20.3B2 aborted: % must be BEFORE UPDATE OR DELETE FOR EACH ROW on lead_assignment_events (table=%, tgtype=%).', v_name, v_relname, v_tgtype;
      end if;
    elsif v_name = 'trg_lead_assignment_events_no_truncate' then
      if v_relname <> 'lead_assignment_events' or v_tgtype <> 34 then
        raise exception
          'QF-MVP-20.3B2 aborted: % must be BEFORE TRUNCATE FOR EACH STATEMENT on lead_assignment_events (table=%, tgtype=%).', v_name, v_relname, v_tgtype;
      end if;
    end if;
  end loop;

  -- 5.4 SCOPE FENCE: these two tables carry the B2 triggers and NOTHING else.
  --     A stray trigger here would be undeclared enforcement.
  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal
     and n.nspname = 'public'
     and c.relname in ('lead_assignments', 'lead_assignment_events')
     and t.tgname <> all (v_expected);
  if v_count <> 0 then
    raise exception
      'QF-MVP-20.3B2 aborted: % unexpected trigger(s) on lead_assignments / lead_assignment_events.', v_count;
  end if;

  -- 5.5 the canonical B1 authority is untouched: every frozen signature is
  --     still present. B2 changes no API.
  foreach v_fn in array v_b1_sigs loop
    if to_regprocedure(v_fn) is null then
      raise exception
        'QF-MVP-20.3B2 aborted: canonical B1 function % is missing. B2 must never replace the authority.', v_fn;
    end if;
  end loop;

  -- 5.6 the invariants B2 relies on but does NOT create must still exist.
  if not exists (select 1 from pg_class where relname = 'uq_replacement_requests_open_per_lead' and relkind = 'i') then
    raise exception
      'QF-MVP-20.3B2 aborted: uq_replacement_requests_open_per_lead is missing. One-open-replacement-per-lead is a Migration A invariant.';
  end if;
  if not exists (select 1 from pg_class where relname = 'uq_lead_assignment_events_idempotency' and relkind = 'i') then
    raise exception
      'QF-MVP-20.3B2 aborted: uq_lead_assignment_events_idempotency is missing. Event idempotency is a Migration A invariant.';
  end if;
  if not exists (select 1 from pg_class where relname = 'idx_lead_assignments_active' and relkind = 'i') then
    raise exception
      'QF-MVP-20.3B2 aborted: idx_lead_assignments_active is missing. The active-three count depends on it.';
  end if;
  if not exists (select 1 from pg_class where relname = 'idx_lead_assignment_events_lifetime' and relkind = 'i') then
    raise exception
      'QF-MVP-20.3B2 aborted: idx_lead_assignment_events_lifetime is missing. The lifetime-six count depends on it.';
  end if;

  -- 5.7 lead_assignments UNIQUE (lead_id, vendor_id) survives. Assignment
  --     uniqueness is what settles duplicate races inside the authority.
  if not exists (
    select 1
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'lead_assignments'
       and con.contype = 'u'
       -- attname is catalog type `name`; cast to text on BOTH sides so the
       -- comparison is text[] = text[]. A bare name[] = text[] has no operator
       -- (SQLSTATE 42883) and is what rolled back the first B2 apply attempt.
       and (select array_agg(a.attname::text order by a.attname::text)
              from unnest(con.conkey) k
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
           = array['lead_id', 'vendor_id']::text[]
  ) then
    raise exception
      'QF-MVP-20.3B2 aborted: the lead_assignments UNIQUE (lead_id, vendor_id) constraint is missing.';
  end if;

  -- 5.8 SCOPE FENCE: B2 must not have done C, D or E work.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'vendor_public_v') then
    raise exception
      'QF-MVP-20.3B2 aborted: the Migration C public vendor projection exists. C is a later phase.';
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              join pg_namespace n on n.oid = c.relnamespace
             where not t.tgisinternal and n.nspname = 'auth' and c.relname = 'users') then
    raise exception
      'QF-MVP-20.3B2 aborted: an auth.users trigger exists. That is Migration D.';
  end if;
  -- Legacy assignment RPCs are RETAINED at this phase; revoking or dropping them
  -- is Migration E. Checked by NAME, because their overload signatures are not
  -- frozen by any QF-MVP-20 contract and guessing one would abort on a false alarm.
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'assign_lead_to_vendors',
       'admin_smart_assign_lead_to_vendors',
       'assign_lead_to_paid_vendors_phase26a',
       'assign_lead_to_preferred_vendor',
       'assign_client_selected_vendor_to_group',
       'assign_vendor_to_requirement_group');
  if v_count = 0 then
    raise exception
      'QF-MVP-20.3B2 aborted: the legacy assignment RPCs are gone. Removing them is Migration E, not B2.';
  end if;

  raise notice 'QF-MVP-20.3B2 universal assignment enforcement verified: 4 functions, 4 triggers, 0 unexpected triggers, B1 authority intact.';
end;
$verify$;
