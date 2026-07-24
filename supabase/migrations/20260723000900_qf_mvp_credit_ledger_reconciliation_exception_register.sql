-- ============================================================================
-- QF-MVP-20.4C — IMMUTABLE HISTORICAL CREDIT-LEDGER RECONCILIATION EXCEPTION
--                REGISTER (SCHEMA-ONLY)
--
-- Forward-only. SCHEMA-ONLY. Inserts NOTHING. STAGING FIRST. NOT AUTHORIZED FOR
-- PRODUCTION by this phase. Generated and reviewed only; application is a
-- separate, separately authorized phase (preflight, then application). Any later
-- population of the 27 QF-MVP-20.4B candidates is a SEPARATE, founder-authorized
-- insertion plan that runs only AFTER this schema is applied and verified.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS
-- ---------------------------------------------------------------------------
-- The QF-MVP-20.4B production SELECT-only audit found 27 credit_deducted
-- assignments with no canonical `lead_assignment_debit` ledger row, and the
-- founder ruling is that ALL 27 remain INSUFFICIENT_EVIDENCE: zero debit, zero
-- refund, zero package change, no vendor_credit_logs backfill, no correction.
--
-- QF-MVP-20.4A §8 proved `vendor_credit_logs` cannot safely hold an evidence-only
-- reconciliation row: it is an arithmetic (before+delta=after), reference-unique
-- balance ledger, so a zero-delta "evidence" row would still perturb the balance
-- sequence, risk a future reference collision, and be indistinguishable from a
-- genuine mutation. This migration therefore creates a SEPARATE, immutable,
-- append-only register that records the founder-reviewed "no financial change"
-- decision WITHOUT any credit-mutation semantics.
--
-- ---------------------------------------------------------------------------
-- LOCKED FINANCIAL / SECURITY INVARIANTS (enforced structurally below)
-- ---------------------------------------------------------------------------
--   * A register row is NOT a credit mutation. This migration, and every trigger
--     and function it creates, mutates NOTHING in vendors, vendor_packages,
--     lead_assignments or vendor_credit_logs. It creates a new table only.
--   * Every row is a locked, immutable, founder/admin-reviewed exception:
--       classification              = 'INSUFFICIENT_EVIDENCE'   (CHECK)
--       correction_mode             = 'EXCEPTION_RECORD_ONLY'    (CHECK)
--       founder_decision            = 'NO_FINANCIAL_CHANGE'      (CHECK)
--       balance_mutation            = false                      (CHECK)
--       package_mutation            = false                      (CHECK)
--       vendor_credit_logs_backfill = false                      (CHECK)
--   * RLS enabled. PUBLIC / anon / authenticated hold NO privilege and have NO
--     policy. service_role holds SELECT + INSERT only. UPDATE / DELETE / TRUNCATE
--     are removed from service_role AND blocked by triggers for EVERY role
--     (including the owner) — the register is append-only and immutable.
--   * No cascading delete can erase reconciliation history: assignment_id and
--     vendor_id are recorded as plain UUIDs with NO foreign key to the
--     operational tables (see §FK note). supersession is append-only.
--   * Owner/postgres retains inherent break-glass authority; that is documented,
--     not an application path. Jarvis/n8n have no authority.
--   * No production UUID, evidence row, PII or secret appears here.
--
-- ---------------------------------------------------------------------------
-- DATA-MODEL DECISION (QF-MVP-20.4C)
-- ---------------------------------------------------------------------------
-- Chosen: ONE immutable exception table with an OPTIONAL self-referencing
-- `supersedes_record_id`. A later, separately-reviewed resolution is a NEW row
-- that points to the record it supersedes; the original row is NEVER updated or
-- deleted (invariant: future evidence must not rewrite an existing decision).
-- Rejected: a two-table (case + resolution-event) design — for a single locked
-- "no financial change" batch it adds a join and a second immutability surface
-- with no benefit; the self-FK gives append-only supersession within one table.
--
-- ---------------------------------------------------------------------------
-- FOREIGN-KEY / DELETION POLICY (QF-MVP-20.4C §5)
-- ---------------------------------------------------------------------------
-- assignment_id and vendor_id are stored as PLAIN UUID columns with NO FK to
-- public.lead_assignments / public.vendors. A hard FK was evaluated and
-- rejected: ON DELETE CASCADE would let an operational delete ERASE
-- reconciliation history (forbidden), and ON DELETE RESTRICT/NO ACTION would
-- couple routine operational deletion of a lead/assignment/vendor to this
-- immutable audit register. Plain UUIDs are the evidence-preserving design the
-- phase explicitly permits: the exception record survives regardless of any
-- operational delete. The ONLY foreign key is the self-reference
-- supersedes_record_id -> this table (id) ON DELETE RESTRICT, which is safe
-- because register rows can never be deleted (the immutability trigger blocks it).
--
-- No explicit transaction control. No data population. No migration-history
-- write. No ALTER DEFAULT PRIVILEGES. No broad schema grant. No secret/project
-- ref. Self-verification uses CATALOG FACTS only (the QF-MVP-20.3B1R2 policy:
-- no lexical assertion over pg_get_functiondef()/prosrc; every catalog `name` is
-- compared as text; any set comparison normalises both sides).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The immutable exception register.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger_reconciliation_exceptions (
  id                          uuid        not null default gen_random_uuid(),
  assignment_id               uuid        not null,
  vendor_id                   uuid        not null,
  assignment_source           text,
  assignment_type             text,
  classification              text        not null,
  correction_mode             text        not null,
  founder_decision            text        not null,
  reason                      text        not null,
  audit_run_id                text        not null,
  audit_sql_sha256            text        not null,
  evidence_manifest_sha256    text        not null,
  reviewer_actor              text        not null,
  reviewed_at                 timestamptz not null,
  balance_mutation            boolean     not null,
  package_mutation            boolean     not null,
  vendor_credit_logs_backfill boolean     not null,
  idempotency_key             text        not null,
  supersedes_record_id        uuid,
  created_at                  timestamptz not null default now(),

  constraint clre_pkey primary key (id),
  constraint clre_idempotency_key_unique unique (idempotency_key),

  -- The founder-locked historical outcome. This register can ONLY record the
  -- approved "insufficient evidence / exception-record-only / no financial
  -- change" ruling; anything else fails closed at INSERT time.
  constraint clre_classification_locked  check (classification  = 'INSUFFICIENT_EVIDENCE'),
  constraint clre_correction_mode_locked check (correction_mode = 'EXCEPTION_RECORD_ONLY'),
  constraint clre_decision_locked        check (founder_decision = 'NO_FINANCIAL_CHANGE'),
  constraint clre_balance_mutation_false check (balance_mutation            = false),
  constraint clre_package_mutation_false check (package_mutation            = false),
  constraint clre_no_ledger_backfill     check (vendor_credit_logs_backfill = false),

  -- Evidence + actor integrity. Hashes are lowercase 64-hex SHA-256; the
  -- reviewer is a named human authority; reason/idempotency are non-empty.
  constraint clre_reviewer_actor_check   check (reviewer_actor in ('FOUNDER','AUTHORIZED_ADMIN')),
  constraint clre_reason_nonempty        check (char_length(btrim(reason)) > 0),
  constraint clre_audit_run_id_nonempty  check (char_length(btrim(audit_run_id)) > 0),
  constraint clre_idempotency_nonempty   check (char_length(btrim(idempotency_key)) > 0),
  constraint clre_audit_sql_sha256_hex   check (audit_sql_sha256 ~ '^[0-9a-f]{64}$'),
  constraint clre_manifest_sha256_hex    check (evidence_manifest_sha256 ~ '^[0-9a-f]{64}$'),

  -- Append-only supersession only: a later reviewed record may point at the row
  -- it supersedes. ON DELETE RESTRICT is belt-and-suspenders (DELETE is trigger-
  -- blocked); it never cascades and never erases history.
  constraint clre_supersedes_self_fk
    foreign key (supersedes_record_id)
    references public.credit_ledger_reconciliation_exceptions (id)
    on update restrict on delete restrict,
  constraint clre_no_self_supersede      check (supersedes_record_id is null or supersedes_record_id <> id)
);

comment on table public.credit_ledger_reconciliation_exceptions is
  'QF-MVP-20.4C immutable, append-only historical credit-ledger reconciliation exception register. Each row is a founder/admin-reviewed decision that a candidate assignment (no canonical lead_assignment_debit ledger evidence) remains INSUFFICIENT_EVIDENCE with NO financial change: no debit, no refund, no package change, no vendor_credit_logs backfill. Records evidence only; carries no credit-mutation semantics. UPDATE/DELETE/TRUNCATE are blocked for every role; supersession is append-only via supersedes_record_id.';


-- ---------------------------------------------------------------------------
-- 2. RLS + least-privilege grants (append-only, service-role-only).
--    RLS on with NO anon/authenticated policy denies those roles. service_role
--    bypasses RLS on the Supabase platform, so table grants + the immutability
--    triggers (which fire regardless of RLS bypass) are the real boundary.
-- ---------------------------------------------------------------------------
alter table public.credit_ledger_reconciliation_exceptions enable row level security;

revoke all privileges on table public.credit_ledger_reconciliation_exceptions
  from public, anon, authenticated;
revoke update, delete, truncate, references, trigger, maintain
  on table public.credit_ledger_reconciliation_exceptions
  from service_role;
grant select, insert on table public.credit_ledger_reconciliation_exceptions
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. Immutability enforcement — append-only for EVERY role, including the owner.
--    A row trigger blocks UPDATE and DELETE; a statement trigger blocks TRUNCATE
--    (which bypasses row triggers). Neither function mutates any other object.
-- ---------------------------------------------------------------------------
create or replace function public.qf_prevent_credit_ledger_exception_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QF_CREDIT_LEDGER_EXCEPTION_IMMUTABLE',
    detail  = 'credit_ledger_reconciliation_exceptions is append-only: UPDATE and DELETE are never permitted, for any role. Supersession is a new row via supersedes_record_id.';
  return null;
end;
$$;

comment on function public.qf_prevent_credit_ledger_exception_mutation() is
  'QF-MVP-20.4C immutability. Refuses every UPDATE and DELETE on the exception register, for every role including the owner. A later decision is recorded as a NEW superseding row; existing decisions are never rewritten.';

create or replace function public.qf_prevent_credit_ledger_exception_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QF_CREDIT_LEDGER_EXCEPTION_TRUNCATE_FORBIDDEN',
    detail  = 'credit_ledger_reconciliation_exceptions is append-only: TRUNCATE is never permitted, for any role.';
  return null;
end;
$$;

comment on function public.qf_prevent_credit_ledger_exception_truncate() is
  'QF-MVP-20.4C immutability. TRUNCATE bypasses row triggers, so it needs its own statement-level guard. service_role holds no TRUNCATE grant; this closes the owner path too.';

drop trigger if exists trg_clre_immutable on public.credit_ledger_reconciliation_exceptions;
create trigger trg_clre_immutable
  before update or delete on public.credit_ledger_reconciliation_exceptions
  for each row execute function public.qf_prevent_credit_ledger_exception_mutation();

drop trigger if exists trg_clre_no_truncate on public.credit_ledger_reconciliation_exceptions;
create trigger trg_clre_no_truncate
  before truncate on public.credit_ledger_reconciliation_exceptions
  for each statement execute function public.qf_prevent_credit_ledger_exception_truncate();

revoke all on function public.qf_prevent_credit_ledger_exception_mutation() from public, anon, authenticated;
revoke all on function public.qf_prevent_credit_ledger_exception_truncate() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Self-verification — fail closed on any deviation from the 20.4C contract.
--    CATALOG FACTS ONLY. No pg_get_functiondef()/prosrc assertion; every catalog
--    `name` is compared as text. pg_get_constraintdef() (a normalised,
--    comment-free constraint expression, NOT function source) is used to prove
--    the financial-lock CHECK values.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_rel     oid;
  v_count   integer;
  v_missing text;
begin
  -- 4.1 the register table exists, with RLS enabled.
  v_rel := to_regclass('public.credit_ledger_reconciliation_exceptions');
  if v_rel is null then
    raise exception 'QF-MVP-20.4C aborted: the exception register table is missing.';
  end if;
  if not exists (select 1 from pg_class c where c.oid = v_rel and c.relrowsecurity) then
    raise exception 'QF-MVP-20.4C aborted: RLS is not enabled on the exception register.';
  end if;

  -- 4.2 exactly the frozen column set (compared as text, both sides normalised).
  if (select array_agg(a.attname::text order by a.attname::text)
        from pg_attribute a
       where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped)
     is distinct from
     (select array_agg(x order by x) from unnest(array[
        'assignment_id','assignment_source','assignment_type','audit_run_id',
        'audit_sql_sha256','balance_mutation','classification','correction_mode',
        'created_at','evidence_manifest_sha256','founder_decision','id',
        'idempotency_key','package_mutation','reason','reviewed_at',
        'reviewer_actor','supersedes_record_id','vendor_credit_logs_backfill',
        'vendor_id']::text[]) x)
  then
    raise exception 'QF-MVP-20.4C aborted: the exception register column set does not match the frozen contract.';
  end if;

  -- 4.3 the financial-lock CHECK constraints exist AND pin the approved values.
  --     pg_get_constraintdef is a normalised constraint expression (never
  --     function source), so a positive lexical assertion over it is allowed.
  for v_missing in
    select needed from (values
      ('clre_classification_locked',  '%(classification = ''insufficient_evidence''::text)%'),
      ('clre_correction_mode_locked', '%(correction_mode = ''exception_record_only''::text)%'),
      ('clre_decision_locked',        '%(founder_decision = ''no_financial_change''::text)%'),
      ('clre_balance_mutation_false', '%(balance_mutation = false)%'),
      ('clre_package_mutation_false', '%(package_mutation = false)%'),
      ('clre_no_ledger_backfill',     '%(vendor_credit_logs_backfill = false)%')
    ) as t(needed, want)
    where not exists (
      select 1 from pg_constraint con
       where con.conrelid = v_rel and con.contype = 'c'
         and con.conname::text = t.needed
         and lower(pg_get_constraintdef(con.oid)) like t.want)
  loop
    raise exception 'QF-MVP-20.4C aborted: financial-lock constraint % missing or not pinning the approved value.', v_missing;
  end loop;

  -- 4.4 the actor / evidence / idempotency integrity constraints exist.
  for v_missing in
    select needed from unnest(array[
      'clre_pkey','clre_idempotency_key_unique','clre_reviewer_actor_check',
      'clre_reason_nonempty','clre_audit_run_id_nonempty','clre_idempotency_nonempty',
      'clre_audit_sql_sha256_hex','clre_manifest_sha256_hex','clre_supersedes_self_fk',
      'clre_no_self_supersede']) as needed
    where not exists (
      select 1 from pg_constraint con where con.conrelid = v_rel and con.conname::text = needed)
  loop
    raise exception 'QF-MVP-20.4C aborted: integrity constraint % is missing.', v_missing;
  end loop;

  -- 4.5 the ONLY foreign key is the self-supersession reference, and it does not
  --     cascade. No FK to lead_assignments / vendors (evidence-preserving).
  if exists (
    select 1 from pg_constraint con
     where con.conrelid = v_rel and con.contype = 'f'
       and (con.confrelid <> v_rel or con.confdeltype not in ('r','a'))
  ) then
    raise exception 'QF-MVP-20.4C aborted: an unexpected or cascading foreign key exists on the register.';
  end if;

  -- 4.6 immutability triggers: BEFORE UPDATE|DELETE ROW (tgtype 27) and BEFORE
  --     TRUNCATE STATEMENT (tgtype 34), both enabled and bound to our functions.
  select count(*) into v_count from pg_trigger t
   where t.tgrelid = v_rel and not t.tgisinternal
     and t.tgname = 'trg_clre_immutable' and t.tgtype = 27 and t.tgenabled = 'O'
     and t.tgfoid = to_regprocedure('public.qf_prevent_credit_ledger_exception_mutation()');
  if v_count <> 1 then
    raise exception 'QF-MVP-20.4C aborted: the UPDATE/DELETE immutability trigger is missing or mis-wired.';
  end if;
  select count(*) into v_count from pg_trigger t
   where t.tgrelid = v_rel and not t.tgisinternal
     and t.tgname = 'trg_clre_no_truncate' and t.tgtype = 34 and t.tgenabled = 'O'
     and t.tgfoid = to_regprocedure('public.qf_prevent_credit_ledger_exception_truncate()');
  if v_count <> 1 then
    raise exception 'QF-MVP-20.4C aborted: the TRUNCATE immutability trigger is missing or mis-wired.';
  end if;

  -- 4.7 privilege posture: untrusted roles hold nothing; service_role has
  --     SELECT + INSERT but NOT UPDATE / DELETE / TRUNCATE.
  if exists (
    select 1 from unnest(array['public','anon','authenticated']) r(role_name)
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
     where has_table_privilege(r.role_name, v_rel, p.priv)
  ) then
    raise exception 'QF-MVP-20.4C aborted: PUBLIC/anon/authenticated hold a privilege on the register.';
  end if;
  if not (has_table_privilege('service_role', v_rel, 'SELECT')
          and has_table_privilege('service_role', v_rel, 'INSERT')) then
    raise exception 'QF-MVP-20.4C aborted: service_role lost required SELECT/INSERT on the register.';
  end if;
  if has_table_privilege('service_role', v_rel, 'UPDATE')
     or has_table_privilege('service_role', v_rel, 'DELETE')
     or has_table_privilege('service_role', v_rel, 'TRUNCATE') then
    raise exception 'QF-MVP-20.4C aborted: service_role holds UPDATE/DELETE/TRUNCATE on the register.';
  end if;

  -- 4.8 NO DATA was inserted by this schema migration.
  execute 'select count(*) from public.credit_ledger_reconciliation_exceptions' into v_count;
  if v_count <> 0 then
    raise exception 'QF-MVP-20.4C aborted: the register is not empty after a schema-only migration (% rows).', v_count;
  end if;

  -- 4.9 the trigger functions are not a callable escalation surface.
  if has_function_privilege('public', to_regprocedure('public.qf_prevent_credit_ledger_exception_mutation()'), 'EXECUTE')
     or has_function_privilege('anon', to_regprocedure('public.qf_prevent_credit_ledger_exception_mutation()'), 'EXECUTE')
     or has_function_privilege('authenticated', to_regprocedure('public.qf_prevent_credit_ledger_exception_truncate()'), 'EXECUTE') then
    raise exception 'QF-MVP-20.4C aborted: an immutability trigger function is executable by an untrusted role.';
  end if;

  -- 4.10 SCOPE FENCE — this migration touched NO financial / operational object.
  --      (Existence + posture of the prior phases is asserted; none is altered.)
  if to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null then
    raise exception 'QF-MVP-20.4C aborted: the canonical B1 authority is missing.';
  end if;
  select count(*) into v_count from pg_trigger t join pg_class c on c.oid=t.tgrelid
     join pg_namespace n on n.oid=c.relnamespace
   where not t.tgisinternal and n.nspname='public'
     and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                      'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate');
  if v_count <> 4 then
    raise exception 'QF-MVP-20.4C aborted: the four B2 enforcement triggers are not all present.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v') then
    raise exception 'QF-MVP-20.4C aborted: the Migration C public projection is missing.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                  where not t.tgisinternal and t.tgname='on_auth_user_created'
                    and n.nspname='auth' and c.relname='users') then
    raise exception 'QF-MVP-20.4C aborted: the Migration D auth onboarding trigger is missing.';
  end if;
  -- E posture: the six legacy RPCs remain service_role-only (untrusted EXECUTE = 0).
  if exists (
    select 1 from unnest(array[
      'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
      'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
      'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
      'public.assign_lead_to_preferred_vendor(uuid, uuid)',
      'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
      'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
      cross join unnest(array['public','anon','authenticated']) r(role_name)
     where has_function_privilege(r.role_name, to_regprocedure(s.sig), 'EXECUTE')
  ) then
    raise exception 'QF-MVP-20.4C aborted: a legacy assignment RPC became untrusted-executable (E posture broken).';
  end if;

  -- 4.11 SCOPE FENCE — no owner binding was implemented.
  if exists (select 1 from pg_attribute
              where attrelid='public.leads'::regclass and not attisdropped
                and attname::text = any(array['client_account_id','user_id','created_by']::text[])) then
    raise exception 'QF-MVP-20.4C aborted: an owner-binding column exists on public.leads (a later phase).';
  end if;

  raise notice 'QF-MVP-20.4C exception register verified: immutable append-only table (RLS on, service_role SELECT+INSERT only, UPDATE/DELETE/TRUNCATE trigger-blocked for every role), financial outcome locked to INSUFFICIENT_EVIDENCE / EXCEPTION_RECORD_ONLY / NO_FINANCIAL_CHANGE with all mutation flags false and no vendor_credit_logs backfill, only a non-cascading self-supersession FK, ZERO rows, and A/A2/B1/G/B2/C/D/E intact.';
end;
$verify$;
