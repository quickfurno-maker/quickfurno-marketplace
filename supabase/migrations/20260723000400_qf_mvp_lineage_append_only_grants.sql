-- ============================================================================
-- QuickFurno — QF-MVP-20.3B1G — Lineage append-only application grants
--
-- PHASE
--   QF-MVP-20.3B1G. Forward repair after the successful staging application
--   of Migration A, A2 and B1.
--
-- PURPOSE
--   Repair the application-role privilege posture of
--   public.lead_assignment_events. Supabase default table privileges left
--   service_role with mutation capabilities even though Migration A later
--   granted only SELECT and INSERT.
--
-- DEPENDENCIES
--   20260723000100_qf_mvp_marketplace_authority_foundation.sql
--   20260723000200_qf_mvp_assignment_lineage_backfill.sql
--   20260723000300_qf_mvp_canonical_assignment_authority.sql
--
-- APPLICATION-ROLE CONTRACT
--   PUBLIC, anon and authenticated: no table privileges.
--   service_role: SELECT and INSERT only.
--   service_role: no UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN.
--
-- OWNER BOUNDARY
--   The PostgreSQL table owner and superusers retain implicit break-glass
--   administrative authority. They are deliberately excluded from the normal
--   application-role append-only evaluation. Migration B2 will later add an
--   additional universal trigger-based immutability mechanism.
--
-- DELIBERATELY NOT DONE
--   No GRANT.
--   No table, function, trigger, policy, view or column change.
--   No data mutation.
--   No ALTER DEFAULT PRIVILEGES; Migration C owns broader default-privilege
--   hardening.
--   No owner/postgres privilege alteration.
--
-- ROLLBACK
--   No automatic down migration. If a proven application requirement emerges,
--   route it through reviewed canonical authority rather than broadly
--   re-granting lineage mutation privileges.
--
-- TRANSACTION BOUNDARY
--   Deliberately NO explicit begin/commit, matching Migrations A, A2, B1 and
--   every other migration in this repository. The Supabase CLI already wraps
--   each migration file and its supabase_migrations.schema_migrations insert in
--   one transaction. A nested BEGIN only warns, but a COMMIT inside the file
--   would end the CLI's transaction early and break the atomicity between this
--   migration's effects and its own history row.
--
-- PUBLIC DETECTION
--   Privilege proofs below use has_table_privilege(), never
--   information_schema.role_table_grants. That view is documented to omit
--   grants made to PUBLIC, so a predicate of the form
--   "grantee = 'PUBLIC'" against it can never match and would silently pass.
-- ============================================================================

do $verify_pre$
begin
  if to_regclass('public.lead_assignment_events') is null then
    raise exception
      'QF-MVP-20.3B1G aborted: public.lead_assignment_events does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role'
  ) then
    raise exception 'QF-MVP-20.3B1G aborted: service_role does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'anon'
  ) then
    raise exception 'QF-MVP-20.3B1G aborted: anon does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'authenticated'
  ) then
    raise exception 'QF-MVP-20.3B1G aborted: authenticated does not exist';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.lead_assignment_events',
    'SELECT'
  ) then
    raise exception
      'QF-MVP-20.3B1G aborted: service_role lacks required SELECT privilege';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.lead_assignment_events',
    'INSERT'
  ) then
    raise exception
      'QF-MVP-20.3B1G aborted: service_role lacks required INSERT privilege';
  end if;
end
$verify_pre$;

revoke all privileges
on table public.lead_assignment_events
from public, anon, authenticated;

revoke update, delete, truncate, references, trigger, maintain
on table public.lead_assignment_events
from service_role;

do $verify_post$
begin
  -- Untrusted application roles must hold NO effective privilege.
  --
  -- has_table_privilege() is used deliberately, and 'public' is included as a
  -- role name: PostgreSQL resolves it to the PUBLIC pseudo-role, and the result
  -- is the EFFECTIVE privilege, so a grant made to PUBLIC is caught directly
  -- rather than only by inheritance. information_schema.role_table_grants is
  -- NOT used here because it omits PUBLIC grants entirely.
  if exists (
    select 1
    from unnest(array['public', 'anon', 'authenticated']) as r(role_name)
    cross join unnest(
      array[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'MAINTAIN'
      ]
    ) as p(privilege_name)
    where has_table_privilege(
      r.role_name,
      'public.lead_assignment_events',
      p.privilege_name
    )
  ) then
    raise exception
      'QF-MVP-20.3B1G verification failed: PUBLIC, anon or authenticated has effective table access';
  end if;

  if exists (
    select 1
    from unnest(
      array[
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'MAINTAIN'
      ]
    ) as p(privilege_name)
    where has_table_privilege(
      'service_role',
      'public.lead_assignment_events',
      p.privilege_name
    )
  ) then
    raise exception
      'QF-MVP-20.3B1G verification failed: service_role retains a forbidden lineage privilege';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.lead_assignment_events',
    'SELECT'
  ) then
    raise exception
      'QF-MVP-20.3B1G verification failed: service_role SELECT was removed';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.lead_assignment_events',
    'INSERT'
  ) then
    raise exception
      'QF-MVP-20.3B1G verification failed: service_role INSERT was removed';
  end if;
end
$verify_post$;
