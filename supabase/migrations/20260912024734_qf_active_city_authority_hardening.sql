-- QuickFurno active-city authority hardening.
-- Operational rule: public.cities.is_active is the single launch-city authority.
-- Preserve historical rows; block new leads/assignments in inactive cities and
-- force vendors in inactive cities non-operational without deleting them.

create or replace function public.qf_city_is_active(p_city text)
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.cities c
     where c.is_active is true
       and lower(btrim(c.name)) = lower(btrim(coalesce(p_city, '')))
  );
$function$;

revoke all on function public.qf_city_is_active(text) from public;
grant execute on function public.qf_city_is_active(text) to anon, authenticated, service_role;

-- Fail closed at lead persistence. Existing historical inactive-city leads stay
-- untouched, but no new inactive-city lead (or city rewrite) can enter runtime.
create or replace function public.qf_enforce_active_city_on_lead()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if not public.qf_city_is_active(new.city) then
    raise exception using errcode = 'P0001', message = 'QF_CITY_NOT_ACTIVE';
  end if;
  return new;
end;
$function$;

revoke all on function public.qf_enforce_active_city_on_lead() from public, anon, authenticated, service_role;

drop trigger if exists trg_00_qf_leads_active_city_gate on public.leads;
create trigger trg_00_qf_leads_active_city_gate
before insert or update of city on public.leads
for each row execute function public.qf_enforce_active_city_on_lead();

-- Preserve vendor applications/data for future expansion, but an inactive-city
-- vendor can never be active, publicly visible, or accepting leads. When a city
-- is later activated, an explicit vendor re-enable remains required.
create or replace function public.qf_enforce_active_city_on_vendor()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if not public.qf_city_is_active(new.city)
     or (nullif(btrim(new.office_city), '') is not null
         and not public.qf_city_is_active(new.office_city)) then
    new.is_active := false;
    new.public_visibility := false;
    new.accepting_leads := false;
  end if;
  return new;
end;
$function$;

revoke all on function public.qf_enforce_active_city_on_vendor() from public, anon, authenticated, service_role;

drop trigger if exists trg_00_qf_vendors_active_city_gate on public.vendors;
create trigger trg_00_qf_vendors_active_city_gate
before insert or update of city, office_city, is_active, public_visibility, accepting_leads on public.vendors
for each row execute function public.qf_enforce_active_city_on_vendor();

-- Universal assignment backstop. This protects canonical and legacy service-role
-- paths, so n8n remains an orchestrator and never needs launch-city logic.
create or replace function public.qf_enforce_active_city_on_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_lead_city text;
  v_vendor_city text;
begin
  select l.city into v_lead_city from public.leads l where l.id = new.lead_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_LEAD_NOT_FOUND';
  end if;

  select coalesce(nullif(btrim(v.city), ''), nullif(btrim(v.office_city), ''))
    into v_vendor_city
    from public.vendors v
   where v.id = new.vendor_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_VENDOR_NOT_FOUND';
  end if;

  if not public.qf_city_is_active(v_lead_city)
     or not public.qf_city_is_active(v_vendor_city) then
    raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_CITY_NOT_ACTIVE';
  end if;

  if lower(btrim(v_lead_city)) is distinct from lower(btrim(v_vendor_city)) then
    raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_CITY_MISMATCH';
  end if;

  return new;
end;
$function$;

revoke all on function public.qf_enforce_active_city_on_assignment() from public, anon, authenticated, service_role;

drop trigger if exists trg_00_qf_lead_assignments_active_city_gate on public.lead_assignments;
create trigger trg_00_qf_lead_assignments_active_city_gate
before insert or update of lead_id, vendor_id on public.lead_assignments
for each row execute function public.qf_enforce_active_city_on_assignment();

-- Canonical assignment eligibility should reject cleanly before the trigger.
create or replace function public.qf_vendor_assignment_eligible(p_lead_id uuid, p_vendor_id uuid, p_credit_cost integer)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_lead public.leads%rowtype;
  v_vendor public.vendors%rowtype;
  v_cost integer := greatest(coalesce(p_credit_cost,1),0);
  v_vendor_city text;
begin
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','lead_not_found'); end if;
  if coalesce(v_lead.is_duplicate,false) then return jsonb_build_object('eligible',false,'reason_code','lead_not_eligible'); end if;
  if not public.qf_city_is_active(v_lead.city) then return jsonb_build_object('eligible',false,'reason_code','inactive_city'); end if;

  select * into v_vendor from public.vendors where id=p_vendor_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  v_vendor_city := coalesce(nullif(btrim(v_vendor.city),''), v_vendor.office_city);
  if not public.qf_city_is_active(v_vendor_city) then return jsonb_build_object('eligible',false,'reason_code','inactive_city'); end if;
  if lower(trim(coalesce(v_vendor.status,''))) not in ('approved','active') then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if coalesce(v_vendor.is_active,false) is not true or coalesce(v_vendor.accepting_leads,true) is not true then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if v_vendor.assignment_suspended_at is not null and (v_vendor.assignment_suspended_until is null or v_vendor.assignment_suspended_until > now()) then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if coalesce(v_vendor.remaining_credits,0) < v_cost then return jsonb_build_object('eligible',false,'reason_code','insufficient_credits'); end if;
  if public.qf_norm_text(v_vendor_city) is distinct from public.qf_norm_text(v_lead.city) then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if not public.qf_lead_vendor_parent_group_compatible(v_lead.service_required,v_lead.category,v_lead.subcategory,v_vendor.service_categories,v_vendor.selected_category,v_vendor.selected_subcategories) then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if exists(select 1 from public.lead_assignments where lead_id=p_lead_id and vendor_id=p_vendor_id) then return jsonb_build_object('eligible',false,'reason_code','duplicate_assignment'); end if;
  return jsonb_build_object('eligible',true,'reason_code',null);
end;
$function$;

-- Public eligible-vendor discovery must return nothing for an inactive city.
create or replace function public.get_public_eligible_vendors(p_city text, p_area text, p_service text)
returns table(id uuid, business_name text, city text, areas_covered text[], service_categories text[], experience text, portfolio_urls text[], profile_image_url text, rating numeric, completed_projects integer)
language sql
stable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select v.id, v.business_name, v.city, v.areas_covered, v.service_categories,
         v.experience, v.portfolio_urls, v.profile_image_url, v.rating, v.completed_projects
    from public.vendor_public_v v
   where public.qf_city_is_active(p_city)
     and public.qf_city_is_active(v.city)
     and v.city = p_city
     and p_service = any(v.service_categories)
     and (v.covers_full_city or (p_area is not null and p_area = any(v.areas_covered)))
   order by
     (case when p_area is not null and p_area = any(v.areas_covered) then 0 else 1 end),
     v.rating desc,
     v.completed_projects desc,
     random();
$function$;

-- Keep the pre-existing privilege surfaces exact.
revoke all on function public.qf_vendor_assignment_eligible(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.qf_vendor_assignment_eligible(uuid,uuid,integer) to service_role;
grant execute on function public.get_public_eligible_vendors(text,text,text) to public, anon, authenticated, service_role;

-- Explicitly keep Mumbai off in the city authority.
update public.cities
   set is_active = false
 where lower(btrim(name)) = 'mumbai'
   and is_active is distinct from false;

-- Quiesce every vendor whose canonical or office city is currently inactive.
-- Package/credit/history data is deliberately preserved for future reactivation.
update public.vendors v
   set is_active = false,
       public_visibility = false,
       accepting_leads = false
 where (not public.qf_city_is_active(v.city)
        or (nullif(btrim(v.office_city),'') is not null and not public.qf_city_is_active(v.office_city)))
   and (coalesce(v.is_active,false) is true
        or coalesce(v.public_visibility,false) is true
        or coalesce(v.accepting_leads,false) is true);

-- Apply-time invariants.
do $verify$
begin
  if not public.qf_city_is_active('Pune') then
    raise exception 'QF_ACTIVE_CITY_VERIFY_PUNE_NOT_ACTIVE';
  end if;
  if public.qf_city_is_active('Mumbai') then
    raise exception 'QF_ACTIVE_CITY_VERIFY_MUMBAI_ACTIVE';
  end if;
  if exists (
    select 1 from public.vendors v
     where (not public.qf_city_is_active(v.city)
            or (nullif(btrim(v.office_city),'') is not null and not public.qf_city_is_active(v.office_city)))
       and (coalesce(v.is_active,false) or coalesce(v.public_visibility,false) or coalesce(v.accepting_leads,false))
  ) then
    raise exception 'QF_ACTIVE_CITY_VERIFY_VENDOR_LEAK';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.leads'::regclass and tgname='trg_00_qf_leads_active_city_gate' and not tgisinternal) then
    raise exception 'QF_ACTIVE_CITY_VERIFY_LEAD_TRIGGER_MISSING';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.vendors'::regclass and tgname='trg_00_qf_vendors_active_city_gate' and not tgisinternal) then
    raise exception 'QF_ACTIVE_CITY_VERIFY_VENDOR_TRIGGER_MISSING';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.lead_assignments'::regclass and tgname='trg_00_qf_lead_assignments_active_city_gate' and not tgisinternal) then
    raise exception 'QF_ACTIVE_CITY_VERIFY_ASSIGNMENT_TRIGGER_MISSING';
  end if;
end;
$verify$;
