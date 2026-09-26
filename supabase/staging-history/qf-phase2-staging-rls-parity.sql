-- QuickFurno Phase 2 staging RLS parity.
-- STAGING-ONLY OPERATOR RECORD. Production already carried these optimized forms.
-- Replaces per-row auth.uid() evaluation with initplan-safe (select auth.uid()).

begin;

alter policy "client_accounts owner read" on public.client_accounts
  using (((select auth.uid()) = user_id) or public.is_admin());

alter policy "leads vendor read" on public.leads
  using (exists (
    select 1
    from public.lead_assignments la
    join public.vendors v on v.id = la.vendor_id
    where la.lead_id = leads.id
      and v.user_id = (select auth.uid())
  ));

alter policy "profiles self read" on public.profiles
  using ((id = (select auth.uid())) or public.is_admin());

alter policy "profiles self update" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "vendor_dashboard_users self read" on public.vendor_dashboard_users
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

alter policy "vendors owner read" on public.vendors
  using ((user_id = (select auth.uid())) or public.is_admin());

alter policy "vendors owner update" on public.vendors
  using ((user_id = (select auth.uid())) or public.is_admin())
  with check ((user_id = (select auth.uid())) or public.is_admin());

commit;
