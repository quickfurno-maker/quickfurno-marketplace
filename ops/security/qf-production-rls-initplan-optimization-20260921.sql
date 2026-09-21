begin;

-- Supabase RLS init-plan performance hardening.
-- Authorization semantics are unchanged; auth.uid() is evaluated once per
-- statement via a scalar SELECT instead of once per candidate row.

alter policy "profiles self read" on public.profiles
  using ((id = (select auth.uid())) or is_admin());

alter policy "profiles self update" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "vendors owner read" on public.vendors
  using ((user_id = (select auth.uid())) or is_admin());

alter policy "vendors owner update" on public.vendors
  using ((user_id = (select auth.uid())) or is_admin())
  with check ((user_id = (select auth.uid())) or is_admin());

alter policy "leads vendor read" on public.leads
  using (
    exists (
      select 1
      from public.lead_assignments la
      join public.vendors v on v.id = la.vendor_id
      where la.lead_id = leads.id
        and v.user_id = (select auth.uid())
    )
  );

alter policy "client_accounts owner read" on public.client_accounts
  using (((select auth.uid()) = user_id) or is_admin());

alter policy "vendor_dashboard_users self read" on public.vendor_dashboard_users
  using (((select auth.uid()) is not null) and ((select auth.uid()) = user_id));

commit;
