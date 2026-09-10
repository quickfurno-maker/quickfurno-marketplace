-- ============================================================================
-- QF LAUNCH SECURITY CLOSEOUT — public read boundary, definer surface, search_path
--
-- Forward-only. Privilege-hardening + function redefinition. NO DATA CHANGE.
-- SOURCE ONLY: this file is NOT applied to any remote project by the phase that
-- authored it. Remote application is a separate, separately authorised step.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CLOSES
-- ---------------------------------------------------------------------------
--   1. public.vendor_public_v — anonymous WRITE capability on the public
--      projection. Public vendor discovery is read-only; nothing may reach the
--      base table through the view. (See the NOTE below on view security mode.)
--
--   2. public.get_public_eligible_vendors(text,text,text) — SECURITY DEFINER is
--      removed. It now reads the already-trusted projection instead of the base
--      table, so it no longer needs the definer's rights at all.
--
--   3. Unnecessary browser EXECUTE on SECURITY DEFINER functions whose ONLY
--      application callers run under the service role.
--
--   4. Six functions with a mutable search_path.
--
-- ---------------------------------------------------------------------------
-- NOTE — WHY vendor_public_v REMAINS AN OWNER-RIGHTS VIEW
-- ---------------------------------------------------------------------------
-- QF-MVP-20.3C (20260723000600) deliberately left security_invoker OFF and
-- documented the reason. That reasoning still holds and is re-stated here so a
-- future reader does not "fix" it by accident:
--
--   * 20.3C revoked ALL privileges on public.vendors from PUBLIC and anon.
--   * Under security_invoker, a view executes the underlying SELECT with the
--     CALLER's rights. anon holds no privilege on public.vendors, so an invoker
--     view would return nothing for the exact audience it exists to serve.
--   * The only ways to make an invoker view work would be to grant anon SELECT
--     on public.vendors (re-opening the full-row monetization/PII exposure that
--     20.3C closed) or to add an anon RLS policy back onto vendors (re-adding the
--     attack surface 20.3C removed). Both are explicitly out of scope.
--
-- The projection's safety is STRUCTURAL, not mode-dependent: the denied columns
-- are physically absent from the view, and the row filter lives inside the view
-- rather than in a client predicate. A Supabase `security_definer_view` advisor
-- notice on this object is therefore EXPECTED AND ACCEPTED, exactly as 20.3C
-- recorded. What was NOT acceptable — and is fixed below — is any write path.
--
-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------
-- No INSERT/UPDATE/DELETE of rows. No vendor/lead/customer data touched. No
-- DROP TABLE. No RLS disabled. No policy dropped. No GRANT ALL. No ALTER DEFAULT
-- PRIVILEGES. No secret, project ref or environment identifier. No Meta/WhatsApp
-- behaviour. Every historical migration is left byte-identical. Self-verification
-- raises rather than warning, so the migration cannot leave a write path behind.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Preflight — everything this migration hardens must already exist.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_name text;
begin
  if to_regclass('public.vendor_public_v') is null then
    raise exception 'QF launch closeout aborted: public.vendor_public_v is missing.';
  end if;
  if to_regclass('public.vendors') is null then
    raise exception 'QF launch closeout aborted: public.vendors is missing.';
  end if;
  if to_regprocedure('public.get_public_eligible_vendors(text,text,text)') is null then
    raise exception 'QF launch closeout aborted: get_public_eligible_vendors is missing.';
  end if;

  foreach v_name in array array[
    'public.communication_consent_receipt_results_valid(jsonb)',
    'public.communication_consent_receipt_scope_result_valid(jsonb,text)',
    'public.qf_lead_vendor_parent_group_compatible(text,text,text,text[],text,text[])',
    'public.qf_norm_text(text)',
    'public.qf_normalize_category_label(text)',
    'public.qf_parent_category_group(text)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'QF launch closeout aborted: % is missing.', v_name;
    end if;
  end loop;

  -- The RLS helpers must survive this migration untouched; prove they exist now
  -- so a later assertion comparing against them cannot pass vacuously.
  if to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.owns_vendor(uuid)') is null then
    raise exception 'QF launch closeout aborted: an RLS helper is missing.';
  end if;
end;
$preflight$;


-- ---------------------------------------------------------------------------
-- 1. public.vendor_public_v — READ ONLY, explicitly and permanently.
--
--    A single-table view is auto-updatable in PostgreSQL, so INSERT/UPDATE/DELETE
--    through it would reach public.vendors with the view owner's rights. 20.3C
--    granted only SELECT, but never REVOKED the write verbs explicitly, so any
--    later default-privilege or manual grant could reintroduce them silently.
--    This makes the read-only posture explicit and asserted.
--
--    The column contract and row filter are NOT changed by this migration.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
  on table public.vendor_public_v from public;
revoke insert, update, delete, truncate, references, trigger
  on table public.vendor_public_v from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.vendor_public_v from authenticated;

-- The intended read access is unchanged and re-stated idempotently.
grant select on table public.vendor_public_v to anon, authenticated, service_role;

comment on view public.vendor_public_v is
  'QF-MVP-20.3C safe public vendor projection, hardened by the QF launch security closeout. '
  'Owner-rights (security_invoker OFF) BY DESIGN: anon holds no privilege on public.vendors, so an '
  'invoker view could only work by re-exposing the base table. Safety is structural — denied columns '
  'are absent from the definition and the public row filter lives inside the view. READ ONLY: every '
  'write verb is revoked from PUBLIC, anon and authenticated and asserted by the migration.';


-- ---------------------------------------------------------------------------
-- 2. public.get_public_eligible_vendors — SECURITY DEFINER removed.
--
--    The function previously needed definer rights only because it read
--    public.vendors directly, which anon cannot. Pointing it at the already
--    trusted public projection removes that need entirely: anon holds SELECT on
--    vendor_public_v, and the view supplies exactly the columns this function
--    returns plus covers_full_city.
--
--    SEMANTICS ARE UNCHANGED. The four eligibility predicates
--      status = 'Approved' AND is_active AND public_visibility AND remaining_credits > 0
--    are not dropped — they are the view's own row filter, applied identically.
--    The city / service / area predicates and the ordering are byte-for-byte the
--    original. The signature and returned schema are identical.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_eligible_vendors(p_city text, p_area text, p_service text)
returns table (
  id uuid,
  business_name text,
  city text,
  areas_covered text[],
  service_categories text[],
  experience text,
  portfolio_urls text[],
  profile_image_url text,
  rating numeric,
  completed_projects integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
  select v.id, v.business_name, v.city, v.areas_covered, v.service_categories,
         v.experience, v.portfolio_urls, v.profile_image_url, v.rating, v.completed_projects
  from public.vendor_public_v v
  where v.city = p_city
    and p_service = any(v.service_categories)
    and (v.covers_full_city or (p_area is not null and p_area = any(v.areas_covered)))
  order by
    (case when p_area is not null and p_area = any(v.areas_covered) then 0 else 1 end),
    v.rating desc,
    v.completed_projects desc,
    random();
$$;

comment on function public.get_public_eligible_vendors(text, text, text) is
  'Public vendor discovery for lead matching. SECURITY INVOKER: it reads public.vendor_public_v, '
  'which already applies the Approved + active + publicly-visible + credited row filter, so no '
  'definer privilege is required and the function cannot bypass the public visibility boundary. '
  'Called with the anon key from services/leadService.ts.';

-- Execution stays exactly where it was: this is the public discovery path.
grant execute on function public.get_public_eligible_vendors(text, text, text)
  to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. Remove browser EXECUTE where the ONLY application caller is service_role.
--
--    Each revocation below is justified by a traced call site, not by a naming
--    convention:
--
--      check_duplicate_lead          services/leadService.ts:80  via adminClient()
--      get_setting_int               services/vendorService.ts:449 via adminClient()
--      refresh_requirement_group_counters  no application caller; invoked from
--                                    inside another SQL authority, and its own
--                                    migration already grants only service_role.
--
--    DELIBERATELY NOT REVOKED — these would break authenticated RLS or the
--    public discovery path, and are therefore left exactly as they are:
--      public.is_admin()                    used by RLS policies (profiles, and others)
--      public.owns_vendor(uuid)             used by vendor-ownership RLS policies
--      public.get_public_eligible_vendors   the anon discovery path (section 2)
-- ---------------------------------------------------------------------------

do $revoke_browser_execute$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.check_duplicate_lead(text,text,text)',
    'public.get_setting_int(text,integer)',
    'public.refresh_requirement_group_counters(uuid)'
  ] loop
    -- Tolerate a signature that does not exist in this lineage rather than
    -- aborting the whole closeout: the revocation is defence in depth.
    if to_regprocedure(v_sig) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_sig);
      execute format('grant execute on function %s to service_role', v_sig);
    end if;
  end loop;
end;
$revoke_browser_execute$;


-- ---------------------------------------------------------------------------
-- 4. Pin search_path on the six functions the advisor flagged.
--
--    ALTER FUNCTION is used deliberately instead of CREATE OR REPLACE: it changes
--    ONLY the configuration parameter, leaving the body, signature, volatility,
--    parallel safety and ownership provably untouched.
-- ---------------------------------------------------------------------------

alter function public.communication_consent_receipt_results_valid(jsonb)
  set search_path = pg_catalog, public, pg_temp;
alter function public.communication_consent_receipt_scope_result_valid(jsonb, text)
  set search_path = pg_catalog, public, pg_temp;
alter function public.qf_lead_vendor_parent_group_compatible(text, text, text, text[], text, text[])
  set search_path = pg_catalog, public, pg_temp;
alter function public.qf_norm_text(text)
  set search_path = pg_catalog, public, pg_temp;
alter function public.qf_normalize_category_label(text)
  set search_path = pg_catalog, public, pg_temp;
alter function public.qf_parent_category_group(text)
  set search_path = pg_catalog, public, pg_temp;


-- ---------------------------------------------------------------------------
-- 5. Self-verification — fail closed on any deviation.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_priv text;
  v_role text;
  v_sig  text;
  v_oid  oid;
  v_cols text[];
begin
  -- 5.1 the public projection is READ ONLY for every browser role.
  foreach v_role in array array['public', 'anon', 'authenticated'] loop
    foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(v_role, 'public.vendor_public_v', v_priv) then
        raise exception
          'QF launch closeout aborted: % still holds % on vendor_public_v.', v_role, v_priv;
      end if;
    end loop;
  end loop;

  -- 5.2 the intended read path still works, and is never granted to PUBLIC.
  if not (has_table_privilege('anon', 'public.vendor_public_v', 'SELECT')
          and has_table_privilege('authenticated', 'public.vendor_public_v', 'SELECT')
          and has_table_privilege('service_role', 'public.vendor_public_v', 'SELECT')) then
    raise exception 'QF launch closeout aborted: vendor_public_v lost required SELECT.';
  end if;
  if has_table_privilege('public', 'public.vendor_public_v', 'SELECT') then
    raise exception 'QF launch closeout aborted: vendor_public_v is granted to PUBLIC.';
  end if;

  -- 5.3 the base table stays closed to browser roles — this migration must never
  --     have "fixed" discovery by re-opening public.vendors.
  foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('public', 'public.vendors', v_priv)
       or has_table_privilege('anon', 'public.vendors', v_priv) then
      raise exception 'QF launch closeout aborted: PUBLIC/anon regained % on vendors.', v_priv;
    end if;
  end loop;
  foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('authenticated', 'public.vendors', v_priv) then
      raise exception 'QF launch closeout aborted: authenticated regained % on vendors.', v_priv;
    end if;
  end loop;

  -- 5.4 the view column contract is unchanged (21 allowlisted columns) and still
  --     carries no monetization/PII/internal column.
  select c.oid into v_oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'vendor_public_v' and c.relkind = 'v';
  select array_agg(a.attname::text order by a.attname::text) into v_cols
    from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped;
  if array_length(v_cols, 1) <> 21 then
    raise exception 'QF launch closeout aborted: vendor_public_v no longer has 21 columns (has %).',
      array_length(v_cols, 1);
  end if;
  foreach v_sig in array array[
    'user_id','phone','email','whatsapp_number','gst_number','total_credits',
    'remaining_credits','package_name','package_status','paid_status',
    'verification_status','latitude','longitude','office_address_line1','owner_name'
  ] loop
    if v_sig = any(v_cols) then
      raise exception 'QF launch closeout aborted: vendor_public_v exposes forbidden column "%".', v_sig;
    end if;
  end loop;

  -- 5.5 the public discovery RPC is no longer SECURITY DEFINER, keeps its exact
  --     signature, and remains executable by the anon path that calls it.
  v_oid := to_regprocedure('public.get_public_eligible_vendors(text,text,text)');
  if v_oid is null then
    raise exception 'QF launch closeout aborted: get_public_eligible_vendors disappeared.';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception 'QF launch closeout aborted: get_public_eligible_vendors is still SECURITY DEFINER.';
  end if;
  if not has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'QF launch closeout aborted: anon lost EXECUTE on get_public_eligible_vendors.';
  end if;
  if (select array_to_string(coalesce(p.proconfig, array[]::text[]), ',') from pg_proc p where p.oid = v_oid)
       not like '%search_path=pg_catalog, public, pg_temp%' then
    raise exception 'QF launch closeout aborted: get_public_eligible_vendors lacks the pinned search_path.';
  end if;

  -- 5.6 the six flagged functions now carry a pinned search_path.
  foreach v_sig in array array[
    'public.communication_consent_receipt_results_valid(jsonb)',
    'public.communication_consent_receipt_scope_result_valid(jsonb,text)',
    'public.qf_lead_vendor_parent_group_compatible(text,text,text,text[],text,text[])',
    'public.qf_norm_text(text)',
    'public.qf_normalize_category_label(text)',
    'public.qf_parent_category_group(text)'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'QF launch closeout aborted: % disappeared.', v_sig;
    end if;
    if (select array_to_string(coalesce(p.proconfig, array[]::text[]), ',') from pg_proc p where p.oid = v_oid)
         not like '%search_path=pg_catalog, public, pg_temp%' then
      raise exception 'QF launch closeout aborted: % still has a mutable search_path.', v_sig;
    end if;
  end loop;

  -- 5.7 browser EXECUTE is gone ONLY where it was proven unnecessary.
  foreach v_sig in array array[
    'public.check_duplicate_lead(text,text,text)',
    'public.get_setting_int(text,integer)',
    'public.refresh_requirement_group_counters(uuid)'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is not null then
      if has_function_privilege('anon', v_oid, 'EXECUTE')
         or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
        raise exception 'QF launch closeout aborted: % still carries browser EXECUTE.', v_sig;
      end if;
      if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
        raise exception 'QF launch closeout aborted: service_role lost EXECUTE on %.', v_sig;
      end if;
    end if;
  end loop;

  -- 5.8 the RLS helpers were NOT collateral damage. authenticated must keep
  --     EXECUTE or every ownership/admin policy that calls them starts failing.
  foreach v_sig in array array['public.is_admin()', 'public.owns_vendor(uuid)'] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'QF launch closeout aborted: RLS helper % disappeared.', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'QF launch closeout aborted: authenticated lost EXECUTE on RLS helper %.', v_sig;
    end if;
  end loop;

  -- 5.9 RLS itself is untouched on the two tables this closeout reasons about.
  if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'vendors') then
    raise exception 'QF launch closeout aborted: RLS was disabled on public.vendors.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendors'
                  and policyname = 'vendors owner read') then
    raise exception 'QF launch closeout aborted: the vendor-own dashboard policy disappeared.';
  end if;

  raise notice 'QF launch security closeout verified: vendor_public_v read-only (21 cols), discovery RPC is INVOKER over the projection, 3 browser EXECUTE revocations, 6 search_path pins, RLS helpers and vendors RLS intact.';
end;
$verify$;

commit;
