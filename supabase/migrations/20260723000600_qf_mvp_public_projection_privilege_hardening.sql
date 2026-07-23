-- ============================================================================
-- QF-MVP-20.3C — PUBLIC VENDOR PROJECTION AND DIRECT-TABLE PRIVILEGE HARDENING
--
-- Forward-only. Additive + privilege-hardening. Non-destructive to DATA.
-- STAGING FIRST. NOT AUTHORIZED FOR PRODUCTION by this phase. Generated and
-- reviewed only; application is a separate, separately authorized phase.
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS
-- ---------------------------------------------------------------------------
-- Two anonymous exposures survived into the marketplace engine:
--
--   1. VENDOR MONETIZATION LEAK. RLS policy "vendors public listing" let anon
--      (and authenticated) run `select *` on any approved/active/visible vendor
--      row with credits > 0 — exposing EVERY column, including remaining_credits,
--      total_credits, package_name, package_status, paid_status, gst_number,
--      phone, email, whatsapp_number, user_id and precise office address/geo.
--
--   2. UNSAFE ANONYMOUS LEAD MUTATION. RLS policy "leads public insert" was
--      `WITH CHECK (true)` for anon/authenticated — any anonymous caller could
--      INSERT arbitrary lead rows, setting any internal column.
--
-- The QF-MVP-20.3C consumer trace proved that NO application code depends on
-- either exposure: every runtime read of public.vendors and every write to
-- public.leads already runs server-side through the service role (adminClient)
-- or, for the vendor-own dashboard, through an authenticated session under the
-- "vendors owner read" RLS policy. registerVendor and createLead both use the
-- service role. No "use client" component reads these tables, and no browser
-- bundle holds the service-role key. The anon direct-table paths are therefore
-- PURE ATTACK SURFACE with zero legitimate consumer.
--
-- C closes both holes at the database boundary and provides the sanctioned safe
-- public discovery surface, public.vendor_public_v.
--
-- ---------------------------------------------------------------------------
-- SCOPE — EXACTLY THIS, NOTHING ELSE
-- ---------------------------------------------------------------------------
-- IN C:
--   * create public.vendor_public_v — explicit safe-column projection over the
--     exact rows anon could previously see (Approved + active + public_visibility
--     + remaining_credits > 0), exposing ZERO monetization/PII/internal fields;
--   * revoke ALL direct privileges on public.vendors from PUBLIC and anon;
--     restrict authenticated to SELECT only (for the vendor-own dashboard and
--     admin reads that run under RLS via a session client);
--   * drop the unsafe "vendors public listing" and "vendors public register"
--     RLS policies (anon full-row read + anon self-INSERT — both unused);
--   * revoke ALL direct privileges on public.leads from PUBLIC, anon and
--     authenticated (no application path uses non-service-role lead access);
--   * drop the unsafe always-true "leads public insert" RLS policy;
--   * grant SELECT on vendor_public_v to anon, authenticated, service_role only.
--
-- DELIBERATELY NOT IN C:
--   * Migration D — the auth.users trigger (C leaves it absent);
--   * Migration E — legacy assignment-RPC EXECUTE revocation (C leaves every
--     legacy RPC and its current EXECUTE posture untouched);
--   * QF-MVP-20.4 — historical ledger reconciliation / any data backfill;
--   * R1_BLOCKED_PENDING_OWNER_BINDING — no ownership column, no client-selection
--     table, no reactivation of client-selected assignment.
--   * No B1/B2/G object is altered. No canonical function or trigger is touched.
--   * get_public_eligible_vendors keeps its existing anon EXECUTE grant.
--
-- ---------------------------------------------------------------------------
-- VIEW SECURITY MODEL — why vendor_public_v cannot bypass base-table privacy
-- ---------------------------------------------------------------------------
-- vendor_public_v is a PLAIN (owner-rights) view — security_invoker is left OFF.
-- It is created by the migration role (a privileged owner), so a query against
-- it executes the underlying SELECT with the owner's rights, which is what lets
-- anon read the projection WITHOUT any base-table privilege.
--
-- This CANNOT leak private data, for two independent structural reasons:
--   (a) COLUMN ABSENCE. The denied columns are physically not part of the view
--       definition. No privilege, RLS setting or client filter can surface a
--       column that the view never selects. The safety is structural, not
--       policy-dependent.
--   (b) DETERMINISTIC ROW FILTER. The publicly-visible predicate lives INSIDE
--       the view (status='Approved' AND is_active AND public_visibility AND
--       remaining_credits > 0) — identical to the row set the dropped
--       "vendors public listing" policy exposed. It never trusts a client filter.
--
-- security_invoker is deliberately NOT enabled: enabling it would require anon
-- to hold base-table SELECT, which is exactly the full-row exposure this
-- migration removes. Owner-rights + full base revocation is the only posture
-- that satisfies "anon has no direct vendors privileges; public browsing uses
-- vendor_public_v". A Supabase `security_definer_view` advisor notice on this
-- view is therefore EXPECTED and ACCEPTED — the projection's safety is the
-- column allowlist and row filter, not the invoker mode.
--
-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------
-- Forward-only. No explicit BEGIN/COMMIT (the CLI wraps file + history in one
-- transaction). No data INSERT/UPDATE/DELETE. No DROP TABLE/RESET/REPAIR. No
-- GRANT ALL. No ALTER DEFAULT PRIVILEGES. No migration-history write. No secret
-- or project ref. Self-verification is runtime type-safe: every catalog `name`
-- array is cast to text before comparison (the QF-MVP-20.3B2R1 defect class).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Safe public vendor projection
--
--    Explicit allowlist ONLY. Every column below is a public discovery/profile/
--    SEO display field actually consumed by services/publicVendorService.ts
--    (mapToPublicVendor) or the get_public_eligible_vendors precedent. No
--    package/credit/subscription/plan/verification/PII/precise-geo/internal
--    field appears. business_name is NOT NULL, so no owner_name (PII) fallback
--    is needed. remaining_credits is used ONLY as a row filter, never selected.
-- ---------------------------------------------------------------------------

create or replace view public.vendor_public_v as
  select
    v.id,
    v.business_name,
    v.city,
    v.office_city,
    v.areas_covered,
    v.covers_full_city,
    v.service_categories,
    v.selected_subcategories,
    v.selected_category,
    v.business_type,
    v.experience,
    v.years_experience,
    v.starting_price,
    v.public_description,
    v.public_service_area_summary,
    v.public_business_hours,
    v.profile_image_url,
    v.cover_image_url,
    v.portfolio_urls,
    v.rating,
    v.completed_projects
  from public.vendors v
  where v.status = 'Approved'
    and v.is_active = true
    and v.public_visibility = true
    and v.remaining_credits > 0;

comment on view public.vendor_public_v is
  'QF-MVP-20.3C safe public vendor projection. Owner-rights view exposing ONLY allowlisted public discovery/profile fields for Approved + active + publicly-visible + credited vendors. NEVER exposes package, plan, credit, verification, contact PII, precise address/geo or internal fields. The base table public.vendors is fully revoked from PUBLIC/anon; public browsing goes through this view.';


-- ---------------------------------------------------------------------------
-- 2. vendor_public_v grants — narrow, explicit, never PUBLIC
-- ---------------------------------------------------------------------------

revoke all on table public.vendor_public_v from public;
grant select on table public.vendor_public_v to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. Harden public.vendors direct-table privileges
--
--    PUBLIC and anon lose ALL direct access. authenticated keeps SELECT ONLY —
--    the vendor-own dashboard (getMyVendor) and admin reads run under a session
--    client and are gated by the "vendors owner read" / "vendors admin all" RLS
--    policies; both require table-level SELECT. All write privileges are removed
--    from authenticated (every vendor write path uses the service role).
--    service_role keeps its existing GRANT ALL (not touched here).
-- ---------------------------------------------------------------------------

revoke all privileges on table public.vendors from public;
revoke all privileges on table public.vendors from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.vendors from authenticated;
grant select on table public.vendors to authenticated;

-- Drop the two unsafe anonymous policies. "vendors public listing" exposed the
-- full row to anon; "vendors public register" allowed anon self-INSERT. Neither
-- has an application consumer (registration uses the service role).
drop policy if exists "vendors public listing" on public.vendors;
drop policy if exists "vendors public register" on public.vendors;


-- ---------------------------------------------------------------------------
-- 4. Harden public.leads direct-table privileges
--
--    PUBLIC, anon AND authenticated lose ALL direct access — no application path
--    reads or writes leads outside the service role (createLead uses adminClient;
--    admin reads use adminClient). Lead intake stays server-owned. service_role
--    keeps its existing GRANT ALL. The safe admin/vendor RLS policies remain.
-- ---------------------------------------------------------------------------

revoke all privileges on table public.leads from public;
revoke all privileges on table public.leads from anon;
revoke all privileges on table public.leads from authenticated;

-- Drop the always-true anonymous INSERT policy. Lead intake is server-owned
-- through the service role; no browser/anon INSERT exists to preserve.
drop policy if exists "leads public insert" on public.leads;


-- ---------------------------------------------------------------------------
-- 5. Self-verification — fail closed on any deviation from the C contract.
--
--    LOCKED POLICY (QF-MVP-20.3B1R2 / B2R1): no lexical assertion over
--    comment-retaining source text, and every catalog `name` value/array is
--    cast to text before comparison (avoids the name[] = text[] defect).
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_expected_cols text[] := array[
    'id','business_name','city','office_city','areas_covered','covers_full_city',
    'service_categories','selected_subcategories','selected_category','business_type',
    'experience','years_experience','starting_price','public_description',
    'public_service_area_summary','public_business_hours','profile_image_url',
    'cover_image_url','portfolio_urls','rating','completed_projects'
  ];
  v_forbidden_cols text[] := array[
    'user_id','phone','email','whatsapp_number','gst_number','total_credits',
    'remaining_credits','package_name','package_status','package_expires_at',
    'paid_status','verification_status','status','is_active','public_visibility',
    'accepting_leads','message','last_assigned_at','created_at','utm_source',
    'utm_medium','utm_campaign','source_url','location_permission_status',
    'latitude','longitude','google_place_id','formatted_address',
    'office_address_line1','office_address_line2','office_landmark','office_pincode',
    'office_state','office_latitude','office_longitude','service_radius_km',
    'custom_service_area','owner_name','area_normalized','sublocality','neighborhood',
    'monthly_capacity','team_size'
  ];
  v_view_oid  oid;
  v_actual    text[];
  v_leak      text;
  v_priv      text;
begin
  -- 5.1 the view exists exactly once, as a view.
  select c.oid into v_view_oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'vendor_public_v' and c.relkind = 'v';
  if v_view_oid is null then
    raise exception 'QF-MVP-20.3C aborted: public.vendor_public_v is missing or not a view.';
  end if;

  -- 5.2 the view columns are EXACTLY the allowlist (order-independent, text[]).
  select array_agg(a.attname::text order by a.attname::text) into v_actual
    from pg_attribute a
   where a.attrelid = v_view_oid and a.attnum > 0 and not a.attisdropped;

  if v_actual is distinct from (
       select array_agg(x order by x) from unnest(v_expected_cols) x) then
    raise exception
      'QF-MVP-20.3C aborted: vendor_public_v columns % do not match the reviewed allowlist.', v_actual;
  end if;

  -- 5.3 no forbidden column may appear in the view, ever.
  foreach v_leak in array v_forbidden_cols loop
    if exists (
      select 1 from pg_attribute a
       where a.attrelid = v_view_oid and a.attnum > 0 and not a.attisdropped
         and a.attname::text = v_leak) then
      raise exception
        'QF-MVP-20.3C aborted: vendor_public_v exposes the forbidden column "%".', v_leak;
    end if;
  end loop;

  -- 5.4 the unsafe policies are gone; the safe ones remain.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='vendors'
              and policyname in ('vendors public listing','vendors public register')) then
    raise exception 'QF-MVP-20.3C aborted: an unsafe vendors anon policy still exists.';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='leads'
              and policyname = 'leads public insert') then
    raise exception 'QF-MVP-20.3C aborted: the always-true "leads public insert" policy still exists.';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vendors'
                  and policyname = 'vendors owner read') then
    raise exception 'QF-MVP-20.3C aborted: the vendor-own dashboard policy "vendors owner read" is missing.';
  end if;

  -- 5.5 PUBLIC and anon hold NO privilege on vendors or leads; authenticated
  --     holds no leads privilege and no vendors WRITE privilege.
  foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('public', 'public.vendors', v_priv)
       or has_table_privilege('anon', 'public.vendors', v_priv) then
      raise exception 'QF-MVP-20.3C aborted: PUBLIC/anon still hold % on vendors.', v_priv;
    end if;
    if has_table_privilege('public', 'public.leads', v_priv)
       or has_table_privilege('anon', 'public.leads', v_priv)
       or has_table_privilege('authenticated', 'public.leads', v_priv) then
      raise exception 'QF-MVP-20.3C aborted: PUBLIC/anon/authenticated still hold % on leads.', v_priv;
    end if;
  end loop;
  foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('authenticated', 'public.vendors', v_priv) then
      raise exception 'QF-MVP-20.3C aborted: authenticated still holds % on vendors.', v_priv;
    end if;
  end loop;

  -- 5.6 authenticated keeps vendors SELECT (vendor-own dashboard + admin RLS),
  --     and every trusted principal keeps what it needs on the projection.
  if not has_table_privilege('authenticated', 'public.vendors', 'SELECT') then
    raise exception 'QF-MVP-20.3C aborted: authenticated lost vendors SELECT (breaks the vendor dashboard).';
  end if;
  if not (has_table_privilege('anon', 'public.vendor_public_v', 'SELECT')
          and has_table_privilege('authenticated', 'public.vendor_public_v', 'SELECT')
          and has_table_privilege('service_role', 'public.vendor_public_v', 'SELECT')) then
    raise exception 'QF-MVP-20.3C aborted: vendor_public_v is not readable by anon/authenticated/service_role.';
  end if;
  if has_table_privilege('public', 'public.vendor_public_v', 'SELECT') then
    raise exception 'QF-MVP-20.3C aborted: vendor_public_v is granted to PUBLIC (must be explicit roles only).';
  end if;
  if not (has_table_privilege('service_role', 'public.vendors', 'SELECT')
          and has_table_privilege('service_role', 'public.leads', 'SELECT')) then
    raise exception 'QF-MVP-20.3C aborted: service_role lost required table access.';
  end if;

  -- 5.7 scope fence: B1/B2/G intact; legacy RPCs retained (E not done);
  --     D auth trigger absent; owner-binding still deferred.
  if to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null then
    raise exception 'QF-MVP-20.3C aborted: canonical B1 authority is missing.';
  end if;
  if (select count(*) from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname='public'
         and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                          'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate')) <> 4 then
    raise exception 'QF-MVP-20.3C aborted: the four B2 enforcement triggers are not all present.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public'
         and p.proname in ('assign_lead_to_vendors','admin_smart_assign_lead_to_vendors',
                           'assign_lead_to_paid_vendors_phase26a','assign_lead_to_preferred_vendor',
                           'assign_client_selected_vendor_to_group','assign_vendor_to_requirement_group')) = 0 then
    raise exception 'QF-MVP-20.3C aborted: legacy assignment RPCs are gone — that is Migration E, not C.';
  end if;
  if to_regprocedure('public.get_public_eligible_vendors(text, text, text)') is null
     or not has_function_privilege('anon',
              to_regprocedure('public.get_public_eligible_vendors(text, text, text)'), 'EXECUTE') then
    raise exception 'QF-MVP-20.3C aborted: get_public_eligible_vendors must remain anon-executable.';
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
              join pg_namespace n on n.oid=c.relnamespace
             where not t.tgisinternal and n.nspname='auth' and c.relname='users') then
    raise exception 'QF-MVP-20.3C aborted: an auth.users trigger exists — that is Migration D, not C.';
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = 'public.leads'::regclass and not attisdropped
                and attname::text in ('client_account_id','user_id','created_by')) then
    raise exception 'QF-MVP-20.3C aborted: an owner-binding column was added to leads.';
  end if;

  raise notice 'QF-MVP-20.3C public projection + privilege hardening verified: vendor_public_v (21 cols, 0 leaks), vendors/leads anon access revoked, unsafe policies dropped, B1/B2/G/legacy intact, D absent.';
end;
$verify$;
