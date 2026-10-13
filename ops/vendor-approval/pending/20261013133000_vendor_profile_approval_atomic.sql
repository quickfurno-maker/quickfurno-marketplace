-- Vendor OS V3: atomic, stale-safe public profile review.
-- The caller is an existing Superadmin-guarded server action. The function is
-- service_role only: there is no authenticated/anon write or public endpoint.
-- NEVER use this for Google office, wallet, identity or verification overrides.

begin;

-- Existing public insert policy allowed a browser vendor to supply arbitrary
-- proposed_changes/current_snapshot. The Next.js trusted server action already
-- inserts with adminClient, so browsers do not need INSERT.
revoke insert on public.vendor_profile_change_requests from authenticated;
drop policy if exists "vendor_profile_change_requests owner insert" on public.vendor_profile_change_requests;
drop policy if exists "vendor_profile_change_requests admin all" on public.vendor_profile_change_requests;
drop policy if exists "vendor_profile_change_requests admin read" on public.vendor_profile_change_requests;
create policy "vendor_profile_change_requests admin read" on public.vendor_profile_change_requests
  for select to authenticated using (public.is_admin());

-- One active request per category per vendor. Service-level read-before-insert
-- is advisory; this constraint is the concurrent submission authority.
create unique index if not exists uq_vendor_pending_review_kind_v3
  on public.vendor_profile_change_requests(vendor_id,request_type)
  where status = 'pending';

-- Append-only review provenance including the exact submit-time field diff.
-- Authenticated browser roles have no direct authority on this table.
create table if not exists public.vendor_change_review_audit_v3 (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  vendor_id uuid not null,
  request_type text not null,
  decision text not null check (decision in ('approved','rejected')),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  current_snapshot jsonb,
  proposed_changes jsonb not null,
  admin_notes text,
  rejection_reason text
);
alter table public.vendor_change_review_audit_v3 enable row level security;
revoke all on public.vendor_change_review_audit_v3 from public, anon, authenticated;
grant select, insert on public.vendor_change_review_audit_v3 to service_role;

create or replace function public.qf_vendor_review_audit_write_v3()
returns trigger language plpgsql security definer set search_path = ''
as $audit$
begin
  if old.status is distinct from 'pending' or
     new.status not in ('approved','rejected') then
    raise exception 'QF_VENDOR_REVIEW_TRANSITION_DENIED' using errcode = 'P0001';
  end if;
  if new.reviewed_by is null or not exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = new.reviewed_by and p.role = 'admin'
      and u.raw_app_meta_data ->> 'admin_role' = 'Superadmin'
  ) then
    raise exception 'QF_VENDOR_REVIEW_AUDITOR_INVALID' using errcode = '42501';
  end if;
  insert into public.vendor_change_review_audit_v3
    (request_id,vendor_id,request_type,decision,reviewed_by,reviewed_at,
     current_snapshot,proposed_changes,admin_notes,rejection_reason)
  values
    (new.id,new.vendor_id,coalesce(new.request_type,'unknown'),new.status,
     new.reviewed_by,coalesce(new.reviewed_at,now()),new.current_snapshot,
     new.proposed_changes,new.admin_notes,new.rejection_reason);
  return new;
end
$audit$;
revoke all on function public.qf_vendor_review_audit_write_v3() from public, anon, authenticated;
drop trigger if exists qf_vendor_review_decision_audit_v3 on public.vendor_profile_change_requests;
create trigger qf_vendor_review_decision_audit_v3
  after update of status on public.vendor_profile_change_requests
  for each row
  when (old.status is distinct from new.status and new.status in ('approved','rejected'))
  execute function public.qf_vendor_review_audit_write_v3();

create or replace function public.qf_approve_vendor_profile_update_v3(
  p_request_id uuid,
  p_admin_id uuid,
  p_notes text default null
) returns public.vendor_profile_change_requests
language plpgsql
security definer
set search_path = ''
as $body$
declare
  r public.vendor_profile_change_requests%rowtype;
  finished public.vendor_profile_change_requests%rowtype;
  live jsonb;
  snapshot jsonb;
  proposed jsonb;
  field text;
  col text;
  expected jsonb;
  actual jsonb;
  allowed_fields text[] := array[
    'public_business_name', 'public_description',
    'starting_price', 'business_hours',
    'service_area_summary', 'profile_image_url', 'cover_image_url',
    'portfolio_image_urls'
  ];
  baseline_cols text[] := array[
    'business_name', 'public_description', 'selected_category',
    'service_categories', 'starting_price', 'public_business_hours',
    'public_service_area_summary', 'profile_image_url',
    'cover_image_url', 'portfolio_urls'
  ];
  idx integer;
  v_field_limit integer;
begin
  if p_request_id is null or p_admin_id is null or
     char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'QF_VENDOR_REVIEW_INVALID' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = p_admin_id and p.role = 'admin'
      and u.raw_app_meta_data ->> 'admin_role' = 'Superadmin'
  ) then
    raise exception 'QF_VENDOR_REVIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into r from public.vendor_profile_change_requests
    where id = p_request_id for update;
  if not found or r.status is distinct from 'pending' or
     r.request_type is distinct from 'profile_update' then
    raise exception 'QF_VENDOR_REVIEW_NOT_PENDING' using errcode = 'P0001';
  end if;
  proposed := r.proposed_changes;
  snapshot := r.current_snapshot;
  if proposed is null or jsonb_typeof(proposed) <> 'object' or
     proposed = '{}'::jsonb or snapshot is null or
     jsonb_typeof(snapshot) <> 'object' then
    raise exception 'QF_VENDOR_REVIEW_INVALID_PAYLOAD' using errcode = 'P0001';
  end if;

  -- Lock the vendor immediately after the request. Other concurrent reviews
  -- serialize here, and stale baselines are rejected rather than overwritten.
  select to_jsonb(v) into live from public.vendors v
    where v.id = r.vendor_id for update;
  if not found then
    raise exception 'QF_VENDOR_REVIEW_VENDOR_MISSING' using errcode = 'P0001';
  end if;
  for idx in 1..array_length(baseline_cols, 1) loop
    col := baseline_cols[idx];
    if not snapshot ? col or (live -> col) is distinct from (snapshot -> col) then
      raise exception 'QF_VENDOR_REVIEW_STALE' using errcode = 'P0001';
    end if;
  end loop;
  for field in select jsonb_object_keys(proposed) loop
    if not field = any(allowed_fields) then
      raise exception 'QF_VENDOR_REVIEW_UNEXPECTED_FIELD' using errcode = 'P0001';
    end if;
    if field in ('services_offered', 'portfolio_image_urls') then
      if jsonb_typeof(proposed -> field) <> 'array' or
         jsonb_array_length(proposed -> field) > 12 then
        raise exception 'QF_VENDOR_REVIEW_WRONG_ARRAY' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from jsonb_array_elements(proposed -> field) item
        where jsonb_typeof(item) <> 'string'
          or char_length(item #>> '{}') > case when field = 'services_offered' then 80 else 500 end
          or char_length(trim(item #>> '{}')) = 0
          or (field = 'portfolio_image_urls' and
            not ((item #>> '{}') like '/%' and (item #>> '{}') not like '//%'
              or (item #>> '{}') ~* '^https?://'))
      ) then raise exception 'QF_VENDOR_REVIEW_ARRAY_INVALID' using errcode = 'P0001'; end if;
    elsif jsonb_typeof(proposed -> field) <> 'string' then
      raise exception 'QF_VENDOR_REVIEW_WRONG_TEXT' using errcode = 'P0001';
    else
      v_field_limit := case field
        when 'public_business_name' then 100
        when 'public_description' then 700
        when 'public_category' then 80
        when 'starting_price' then 80
        when 'business_hours' then 140
        when 'service_area_summary' then 220
        else 500 end;
      if char_length(proposed ->> field) > v_field_limit
        or char_length(trim(proposed ->> field)) = 0 then
          raise exception 'QF_VENDOR_REVIEW_FIELD_INVALID' using errcode = 'P0001';
      end if;
      if field in ('profile_image_url','cover_image_url') and
         not ((proposed ->> field) like '/%' and (proposed ->> field) not like '//%'
           or (proposed ->> field) ~* '^https?://') then
        raise exception 'QF_VENDOR_REVIEW_BAD_IMAGE_URL' using errcode = 'P0001';
      end if;
      if field = 'public_category' and
         (proposed ->> field) <> all(array[
            'Interior Designers','Carpenters','Modular Factory','Premium Interiors',
            'Sofa','Painter','Civil Work','False Ceiling'
         ]) then
         raise exception 'QF_VENDOR_REVIEW_BAD_CATEGORY' using errcode = 'P0001';
      end if;
    end if;
  end loop;
  -- Fail closed on attacker-controlled oversized content, even if an old
  -- request predates the browser-INSERT privilege revocation.
  if char_length(proposed::text) > 10000 then
    raise exception 'QF_VENDOR_REVIEW_OVERSIZED' using errcode = 'P0001';
  end if;

  update public.vendors v set
    business_name = case when proposed ? 'public_business_name' then proposed ->> 'public_business_name' else v.business_name end,
    public_description = case when proposed ? 'public_description' then proposed ->> 'public_description' else v.public_description end,
    -- Category and matching-service mutations are governed by a separate
    -- eligibility review, never the general public-profile approval.
    starting_price = case when proposed ? 'starting_price' then proposed ->> 'starting_price' else v.starting_price end,
    public_business_hours = case when proposed ? 'business_hours' then proposed ->> 'business_hours' else v.public_business_hours end,
    public_service_area_summary = case when proposed ? 'service_area_summary'
      then proposed ->> 'service_area_summary' else v.public_service_area_summary end,
    profile_image_url = case when proposed ? 'profile_image_url' then proposed ->> 'profile_image_url' else v.profile_image_url end,
    cover_image_url = case when proposed ? 'cover_image_url' then proposed ->> 'cover_image_url' else v.cover_image_url end,
    portfolio_urls = case when proposed ? 'portfolio_image_urls'
      then array(select jsonb_array_elements_text(proposed -> 'portfolio_image_urls'))
      else v.portfolio_urls end
  where v.id = r.vendor_id;

  update public.vendor_profile_change_requests q set
    status = 'approved', reviewed_by = p_admin_id,
    reviewed_at = now(), updated_at = now(),
    admin_notes = nullif(trim(p_notes), ''),
    rejection_reason = null
    where q.id = r.id and q.status = 'pending' returning * into finished;
  if not found then
    raise exception 'QF_VENDOR_REVIEW_RACE' using errcode = 'P0001';
  end if;
  return finished;
end
$body$;

revoke all on function public.qf_approve_vendor_profile_update_v3(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.qf_approve_vendor_profile_update_v3(uuid,uuid,text) to service_role;

commit;
