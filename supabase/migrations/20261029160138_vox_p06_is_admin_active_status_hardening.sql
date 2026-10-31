-- VOX P0-6: prevent an inactive/NULL-active administrator from retaining RLS privileges.
-- Changes only public.is_admin(); policy definitions and owns_vendor() stay untouched.
-- Roll back by creating a NEW, later migration using the reviewed rollback SQL.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active is true
  );
$$;
