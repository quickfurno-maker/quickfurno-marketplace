-- ============================================================================
-- QuickFurno — 002_rls_policies.sql
-- Row Level Security for every table.
-- (Apply after 001. Helper functions are defined here so policies can use them.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RLS helper functions
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.owns_vendor(p_vendor_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vendors where id = p_vendor_id and user_id = auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS
-- ----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.vendors             enable row level security;
alter table public.leads               enable row level security;
alter table public.packages            enable row level security;
alter table public.vendor_packages     enable row level security;
alter table public.payments            enable row level security;
alter table public.lead_assignments    enable row level security;
alter table public.lead_status_updates enable row level security;
alter table public.bad_lead_reports    enable row level security;
alter table public.whatsapp_logs       enable row level security;
alter table public.service_categories  enable row level security;
alter table public.cities              enable row level security;
alter table public.app_settings        enable row level security;

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
create policy "profiles self read"   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin all"   on public.profiles for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- VENDORS
--   public sees only approved + active + visible + has-credits vendors
-- ----------------------------------------------------------------------------
create policy "vendors public listing" on public.vendors for select to anon, authenticated
  using (status = 'Approved' and is_active = true and public_visibility = true and remaining_credits > 0);

create policy "vendors owner read" on public.vendors for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- public vendor registration (anon submit) + authenticated self-register
create policy "vendors public register" on public.vendors for insert to anon, authenticated
  with check (status = 'Pending' and public_visibility = false);

create policy "vendors owner update" on public.vendors for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "vendors admin all" on public.vendors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- LEADS
--   anyone can submit; nobody public can read (protects client phone);
--   vendors read only leads assigned to them; admin all
-- ----------------------------------------------------------------------------
create policy "leads public insert" on public.leads for insert to anon, authenticated with check (true);

create policy "leads admin all" on public.leads for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "leads vendor read" on public.leads for select to authenticated
  using (exists (
    select 1 from public.lead_assignments la
    join public.vendors v on v.id = la.vendor_id
    where la.lead_id = leads.id and v.user_id = auth.uid()
  ));

-- ----------------------------------------------------------------------------
-- PACKAGES (public browses active packs; admin manages)
-- ----------------------------------------------------------------------------
create policy "packages public read" on public.packages for select to anon, authenticated using (is_active or public.is_admin());
create policy "packages admin write" on public.packages for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- VENDOR_PACKAGES (vendor reads own; admin all; writes via functions)
-- ----------------------------------------------------------------------------
create policy "vendor_pkgs owner read" on public.vendor_packages for select to authenticated
  using (public.owns_vendor(vendor_id) or public.is_admin());
create policy "vendor_pkgs admin all" on public.vendor_packages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- PAYMENTS (vendor reads own; admin manages)
-- ----------------------------------------------------------------------------
create policy "payments owner read" on public.payments for select to authenticated
  using (public.owns_vendor(vendor_id) or public.is_admin());
create policy "payments admin all" on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- LEAD_ASSIGNMENTS (vendor reads/updates own; admin all; inserts via function)
-- ----------------------------------------------------------------------------
create policy "assign owner read" on public.lead_assignments for select to authenticated
  using (public.owns_vendor(vendor_id) or public.is_admin());
create policy "assign owner update" on public.lead_assignments for update to authenticated
  using (public.owns_vendor(vendor_id)) with check (public.owns_vendor(vendor_id));
create policy "assign admin all" on public.lead_assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- LEAD_STATUS_UPDATES (vendor manages own; admin all)
-- ----------------------------------------------------------------------------
create policy "status owner rw" on public.lead_status_updates for all to authenticated
  using (public.owns_vendor(vendor_id) or public.is_admin())
  with check (public.owns_vendor(vendor_id) or public.is_admin());

-- ----------------------------------------------------------------------------
-- BAD_LEAD_REPORTS (vendor files for own assignments; admin reviews)
-- ----------------------------------------------------------------------------
create policy "reports owner read" on public.bad_lead_reports for select to authenticated
  using (public.owns_vendor(vendor_id) or public.is_admin());
create policy "reports owner insert" on public.bad_lead_reports for insert to authenticated
  with check (
    public.owns_vendor(vendor_id)
    and exists (
      select 1 from public.lead_assignments la
      where la.id = lead_assignment_id and la.vendor_id = bad_lead_reports.vendor_id
    )
  );
create policy "reports admin all" on public.bad_lead_reports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- WHATSAPP_LOGS (admin all; vendor reads own messages; writes via service role)
-- ----------------------------------------------------------------------------
create policy "wa admin all" on public.whatsapp_logs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "wa vendor read" on public.whatsapp_logs for select to authenticated
  using (recipient_type = 'vendor' and public.owns_vendor(recipient_id));

-- ----------------------------------------------------------------------------
-- SERVICE_CATEGORIES + CITIES (public read active; admin manage)
-- ----------------------------------------------------------------------------
create policy "categories public read" on public.service_categories for select to anon, authenticated using (is_active or public.is_admin());
create policy "categories admin write" on public.service_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "cities public read" on public.cities for select to anon, authenticated using (is_active or public.is_admin());
create policy "cities admin write" on public.cities for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- APP_SETTINGS (public read; admin write)
-- ----------------------------------------------------------------------------
create policy "settings public read" on public.app_settings for select to anon, authenticated using (true);
create policy "settings admin write" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
