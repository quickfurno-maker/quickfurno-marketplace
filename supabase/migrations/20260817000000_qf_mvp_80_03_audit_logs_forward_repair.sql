-- ============================================================================
-- QuickFurno — QF-MVP-80.03 — AUDIT LOG FORWARD REPAIR
--
-- PHASE
--   QF-MVP-80.03. Single migration. Forward-only. Additive only.
--
-- PURPOSE
--   Restore `public.audit_logs` so superadmin admin/vendor actions leave a
--   durable trail. Today they leave none.
--
-- WHY THIS MIGRATION EXISTS AT ALL — the QF-MVP-80.03 audit finding.
--   `audit_logs` was defined in 20260621000006_superadmin_foundation.sql, and
--   that migration WAS NEVER APPLIED to production. The evidence is direct:
--   eleven of its twelve tables are absent from the live database, and the one
--   that is present (`vendor_internal_notes`) plus all four of its column
--   additions are ALSO created by later migrations (20260723001100,
--   20260620000001, 20260627000013 / 20260628000015 / 20260701000028). Nothing
--   that survives in production traces to that file.
--
--   Meanwhile services/adminService.recordAuditLog and
--   services/vendorAdminService.bestEffortAudit both insert into `audit_logs`
--   and both tolerate its absence, so every approve / reject / suspend /
--   activate / deactivate / credit / package action since launch has been
--   discarded silently. That is why the QF-MVP-80.02 investigation could not
--   determine which admin action an operator had actually invoked.
--
-- WHY THIS IS NOT A REPLAY OF 20260621000006.
--   That file also creates `localities`, `admin_notifications`, `reviews`,
--   `ai_agents`, `ai_agent_runs`, `ai_suggestions`, `automations`,
--   `automation_logs`, `lead_timeline_events` and `lead_internal_notes`.
--   The AI/automation/review scaffolding was superseded by the later AOS and
--   CRM phases; `lead_timeline_events` and `aos_audit_logs` have ZERO consumers
--   anywhere in services/, lib/, app/ or components/. Replaying the file
--   verbatim would resurrect eight dead tables to obtain one live one.
--   This migration therefore creates the audit object and nothing else.
--
-- WHAT THIS MIGRATION IS NOT.
--   * NOT a history backfill. Admin actions taken before this migration were
--     never recorded and are genuinely unrecoverable. No row is fabricated to
--     make the trail look continuous; the gap is real and stays visible.
--   * NOT a behaviour change. Audit writing remains FAIL-OPEN: a failed audit
--     insert must never block or roll back the admin action it describes.
--     QF-MVP-80.03 only makes that failure visible in server logs.
--   * NOT an authorization change beyond this one table. It adds two policies
--     on `audit_logs` and touches no other table's RLS, grants or policies.
--   * NOT destructive. There is no DROP TABLE, no DROP COLUMN, no TRUNCATE and
--     no DELETE anywhere in this file.
--
-- SAFETY / RE-RUNNABILITY
--   Safe when `audit_logs` is absent (the production case) and safe when it
--   already exists in the canonical shape (the local/dev case). If a table of
--   that name exists in an INCOMPATIBLE shape, the guard below RAISES and the
--   migration fails closed rather than silently adopting a foreign object as
--   the audit trail.
--
-- DEPENDENCIES
--   public.profiles          — 20260620000001_create_tables.sql
--   public.is_admin()        — 20260620000002_rls_policies.sql
--   Both are present in production; verified before writing this file.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) FAIL CLOSED on an incompatible pre-existing object.
--
--    `create table if not exists` would silently accept a table that merely
--    shares the name, and every later statement would then attach policies to
--    the wrong object. The audit trail is only worth having if we know what it
--    is, so an unexpected shape stops the migration instead.
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  if to_regclass('public.audit_logs') is null then
    return;  -- absent: the create below will make it.
  end if;

  select string_agg(required.column_name, ', ' order by required.column_name)
    into v_missing
  from (values ('id'), ('created_at'), ('action'), ('entity_type'),
               ('entity_id'), ('metadata'), ('admin_user_id'),
               ('ip_address'), ('user_agent')) as required(column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'audit_logs'
      and c.column_name = required.column_name
  );

  if v_missing is not null then
    raise exception
      'QF-MVP-80.03: public.audit_logs already exists but is missing column(s): %. Refusing to adopt an incompatible object as the audit trail.',
      v_missing;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) The canonical audit object.
--
--    Column-for-column identical to the definition in 20260621000006 so a
--    database that DID apply that migration is already conformant and this file
--    is a no-op there. `created_at` is NOT NULL here: the original relied on the
--    default alone, and an audit row without a timestamp is not an audit row.
--    `metadata` carries only sanitized, non-credential context — the writers
--    are constrained in code and pinned by the QF-MVP-80.03 harness.
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  admin_user_id uuid references public.profiles(id) on delete set null,
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb default '{}'::jsonb,
  ip_address    text,
  user_agent    text
);

-- A database that applied 20260621000006 has `created_at` nullable. Bring it in
-- line without touching any existing row's value.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs'
      and column_name = 'created_at' and is_nullable = 'YES'
  ) then
    update public.audit_logs set created_at = now() where created_at is null;
    alter table public.audit_logs alter column created_at set not null;
  end if;
end $$;

comment on table public.audit_logs is
  'QF-MVP-80.03 forward repair. Durable trail of admin/superadmin actions. Written fail-open by services/adminService.recordAuditLog and services/vendorAdminService.bestEffortAudit: a failed insert never blocks the action it describes. metadata carries sanitized context ONLY — never a password, token, recovery link, JWT, cookie, authorization header or service-role value. Rows before 2026-08-31 do not exist: the defining migration was never applied and that history is genuinely unrecoverable, not backfilled.';

-- ----------------------------------------------------------------------------
-- 3) Read index. The only query shape today is the bounded admin viewer in
--    services/adminSectionService.getAdminAuditLogsPage, newest first.
-- ----------------------------------------------------------------------------
create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);

-- ----------------------------------------------------------------------------
-- 4) RLS. Identical policy model to 20260621000006: admins read, admins insert.
--    No update policy and no delete policy — an audit trail that participants
--    can edit or erase is not a trail. `service_role` bypasses RLS, which is how
--    the server-side writers reach the table.
-- ----------------------------------------------------------------------------
alter table public.audit_logs enable row level security;

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated
  using (public.is_admin());

drop policy if exists "audit admin insert" on public.audit_logs;
create policy "audit admin insert" on public.audit_logs for insert to authenticated
  with check (public.is_admin());
