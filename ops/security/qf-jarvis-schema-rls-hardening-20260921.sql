begin;

-- QF-Jarvis defense-in-depth hardening.
-- Browser roles already have no schema/table privileges. RLS makes that boundary
-- explicit if grants ever change later. No policy is intentionally added.
--
-- The tables are owned by qf_jarvis_migrator. Supabase postgres has ADMIN
-- membership but SET is intentionally disabled, so elevate only SET temporarily,
-- perform the owner-only ALTERs, then restore SET=false before commit.
grant qf_jarvis_migrator to postgres with set true;
set local role qf_jarvis_migrator;

alter table qf_jarvis.schema_migration enable row level security;
alter table qf_jarvis.event enable row level security;

reset role;
revoke set option for qf_jarvis_migrator from postgres;

do $$
begin
  if not (select relrowsecurity from pg_class where oid='qf_jarvis.schema_migration'::regclass)
     or not (select relrowsecurity from pg_class where oid='qf_jarvis.event'::regclass) then
    raise exception 'QF Jarvis hardening: RLS did not enable';
  end if;
  if pg_has_role('postgres','qf_jarvis_migrator','SET') then
    raise exception 'QF Jarvis hardening: temporary SET option was not restored';
  end if;
  if has_schema_privilege('anon','qf_jarvis','USAGE')
     or has_schema_privilege('authenticated','qf_jarvis','USAGE')
     or has_table_privilege('anon','qf_jarvis.event','SELECT')
     or has_table_privilege('authenticated','qf_jarvis.event','SELECT') then
    raise exception 'QF Jarvis hardening: browser role acquired access';
  end if;
end
$$;

commit;
