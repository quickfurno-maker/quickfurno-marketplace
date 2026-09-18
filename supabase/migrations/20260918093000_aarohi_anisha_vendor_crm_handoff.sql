-- Aarohi -> Anisha Vendor CRM handoff bridge.
-- Acquisition ends in Aarohi only after Core confirms an active, verified, paid vendor.
-- The same transaction creates/updates the Vendor CRM relationship provenance for Anisha.
-- This migration does not create vendors, packages, payments, assignments, or provider sends.

alter table public.vendor_crm_profiles
  add column acquisition_source text,
  add column acquisition_channel text,
  add column acquisition_owner text,
  add column aarohi_prospect_id uuid,
  add column aarohi_handoff_id uuid,
  add column acquisition_completed_at timestamptz;

alter table public.vendor_crm_profiles
  add constraint vcp_acquisition_source_check
    check (acquisition_source is null or acquisition_source = 'AAROHI'),
  add constraint vcp_acquisition_owner_check
    check (acquisition_owner is null or acquisition_owner = 'ANISHA'),
  add constraint vcp_acquisition_channel_check
    check (
      acquisition_channel is null or acquisition_channel in (
        'CALL','WHATSAPP','INSTAGRAM','FACEBOOK','LINKEDIN','X','WEBSITE','PHONE','EMAIL',
        'GOOGLE','JUSTDIAL','INDIAMART','MANUAL','CSV','FIRECRAWL','OTHER'
      )
    );

alter table public.vendor_crm_profiles
  add constraint vcp_aarohi_prospect_fk
    foreign key (aarohi_prospect_id) references public.aarohi_prospects(id) on delete restrict,
  add constraint vcp_aarohi_handoff_fk
    foreign key (aarohi_handoff_id) references public.aarohi_handoffs(id) on delete restrict;

create unique index vcp_aarohi_prospect_uidx
  on public.vendor_crm_profiles(aarohi_prospect_id)
  where aarohi_prospect_id is not null;

create unique index vcp_aarohi_handoff_uidx
  on public.vendor_crm_profiles(aarohi_handoff_id)
  where aarohi_handoff_id is not null;

create index vcp_acquisition_source_idx
  on public.vendor_crm_profiles(acquisition_source, acquisition_completed_at desc)
  where acquisition_source is not null;

comment on column public.vendor_crm_profiles.acquisition_source
  is 'System-owned acquisition provenance. AAROHI means acquisition completed in Aarohi before Vendor CRM ownership began.';
comment on column public.vendor_crm_profiles.acquisition_channel
  is 'Observed acquisition medium retained for attribution; never communication authorization.';
comment on column public.vendor_crm_profiles.acquisition_owner
  is 'System relationship-agent handoff marker. ANISHA begins only after Aarohi acquisition completion.';
comment on column public.vendor_crm_profiles.aarohi_prospect_id
  is 'Read-only lineage pointer to the completed Aarohi prospect.';
comment on column public.vendor_crm_profiles.aarohi_handoff_id
  is 'Read-only lineage pointer to the governed Aarohi handoff row.';

create or replace function public.qf_aarohi_complete_handoff_v1(
  p_prospect_id uuid,
  p_vendor_id uuid,
  p_actor_id uuid,
  p_core_reference text,
  p_idempotency_key text default null
) returns public.aarohi_handoffs
language plpgsql
security definer
set search_path=public
as $$
declare
  v_vendor public.vendors;
  v_handoff public.aarohi_handoffs;
  v_existing public.aarohi_handoffs;
  v_paid boolean;
  v_channel text;
begin
  perform 1
    from public.aarohi_prospects
    where id=p_prospect_id
    for update;
  if not found then raise exception 'aarohi_prospect_not_found'; end if;

  select * into v_existing
    from public.aarohi_handoffs
    where prospect_id=p_prospect_id;

  if v_existing.id is not null and v_existing.vendor_id <> p_vendor_id then
    raise exception 'aarohi_handoff_already_completed';
  end if;

  select * into v_vendor
    from public.vendors
    where id=p_vendor_id;
  if v_vendor.id is null then raise exception 'canonical_vendor_not_found'; end if;

  if coalesce(v_vendor.status,'') <> 'Approved'
     or coalesce(v_vendor.is_active,false) is not true
     or lower(coalesce(v_vendor.verification_status,'')) <> 'verified' then
    raise exception 'canonical_vendor_not_active';
  end if;

  select exists(
    select 1
      from public.vendor_packages vp
      where vp.vendor_id=p_vendor_id
        and lower(coalesce(vp.payment_status,''))='paid'
        and lower(coalesce(vp.status,''))='active'
    union all
    select 1
      from public.vendor_package_orders vo
      where vo.vendor_id=p_vendor_id
        and lower(coalesce(vo.payment_status,''))='paid'
        and lower(coalesce(vo.activation_status,''))='activated'
  ) into v_paid;
  if not v_paid then raise exception 'canonical_package_payment_not_confirmed'; end if;

  select c.channel into v_channel
    from public.aarohi_conversations c
    where c.prospect_id=p_prospect_id
    order by c.updated_at desc, c.id
    limit 1;

  if v_channel is null then
    select ci.channel into v_channel
      from public.aarohi_channel_identities ci
      where ci.prospect_id=p_prospect_id
      order by ci.updated_at desc, ci.id
      limit 1;
  end if;

  if v_channel is null then
    select s.source_type into v_channel
      from public.aarohi_prospect_sources s
      where s.prospect_id=p_prospect_id
      order by s.imported_at desc, s.id
      limit 1;
  end if;

  if v_existing.id is null then
    if exists (
      select 1 from public.aarohi_handoffs h
      where h.vendor_id=p_vendor_id and h.prospect_id<>p_prospect_id
    ) then
      raise exception 'canonical_vendor_already_handed_off';
    end if;

    insert into public.aarohi_handoffs(
      prospect_id,vendor_id,core_reference,completed_by
    ) values (
      p_prospect_id,p_vendor_id,p_core_reference,p_actor_id
    )
    returning * into v_handoff;

    update public.aarohi_prospects
      set agent_owner='ANISHA',
          prospect_stage='WON',
          registration_stage='COMPLETED',
          payment_stage='PAID',
          ai_paused=true,
          human_takeover=false,
          next_action_type=null,
          next_action_at=null,
          next_action_reason='Acquisition completed; Anisha Vendor CRM relationship started',
          updated_at=now(),
          last_activity_at=now()
      where id=p_prospect_id;

    insert into public.vendor_crm_profiles(
      vendor_id,onboarding_stage,relationship_status,
      acquisition_source,acquisition_channel,acquisition_owner,
      aarohi_prospect_id,aarohi_handoff_id,acquisition_completed_at,
      created_by,updated_by
    ) values (
      p_vendor_id,'active','active',
      'AAROHI',v_channel,'ANISHA',
      p_prospect_id,v_handoff.id,v_handoff.completed_at,
      p_actor_id,p_actor_id
    )
    on conflict (vendor_id) do update
      set acquisition_source='AAROHI',
          acquisition_channel=excluded.acquisition_channel,
          acquisition_owner='ANISHA',
          aarohi_prospect_id=excluded.aarohi_prospect_id,
          aarohi_handoff_id=excluded.aarohi_handoff_id,
          acquisition_completed_at=excluded.acquisition_completed_at,
          updated_at=now(),
          updated_by=excluded.updated_by;

    insert into public.vendor_internal_notes(vendor_id,note,created_by,category)
      values(
        p_vendor_id,
        'Aarohi acquisition completed. Relationship ownership started with Anisha in Vendor CRM.',
        p_actor_id,
        'onboarding'
      );

    insert into public.aarohi_events(
      prospect_id,event_type,actor_type,actor_reference,safe_summary,
      reference_type,reference_id,idempotency_key,event_data
    ) values (
      p_prospect_id,
      'aarohi.handoff_completed',
      'CORE',
      p_actor_id::text,
      'Aarohi acquisition completed; Anisha Vendor CRM relationship started',
      'vendor',
      p_vendor_id::text,
      p_idempotency_key,
      jsonb_build_object(
        'vendor_crm_source','AAROHI',
        'vendor_crm_owner','ANISHA',
        'acquisition_channel',v_channel
      )
    )
    on conflict (tenant_id,idempotency_key)
      where idempotency_key is not null
      do nothing;
  else
    v_handoff := v_existing;

    insert into public.vendor_crm_profiles(
      vendor_id,onboarding_stage,relationship_status,
      acquisition_source,acquisition_channel,acquisition_owner,
      aarohi_prospect_id,aarohi_handoff_id,acquisition_completed_at,
      created_by,updated_by
    ) values (
      p_vendor_id,'active','active',
      'AAROHI',v_channel,'ANISHA',
      p_prospect_id,v_handoff.id,v_handoff.completed_at,
      p_actor_id,p_actor_id
    )
    on conflict (vendor_id) do update
      set acquisition_source='AAROHI',
          acquisition_channel=coalesce(public.vendor_crm_profiles.acquisition_channel,excluded.acquisition_channel),
          acquisition_owner='ANISHA',
          aarohi_prospect_id=excluded.aarohi_prospect_id,
          aarohi_handoff_id=excluded.aarohi_handoff_id,
          acquisition_completed_at=excluded.acquisition_completed_at,
          updated_at=now(),
          updated_by=excluded.updated_by;
  end if;

  return v_handoff;
end
$$;

revoke all on function public.qf_aarohi_complete_handoff_v1(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.qf_aarohi_complete_handoff_v1(uuid,uuid,uuid,text,text)
  to service_role;

-- Backfill provenance for any handoff that existed before this bridge migration.
insert into public.vendor_crm_profiles(
  vendor_id,onboarding_stage,relationship_status,
  acquisition_source,acquisition_channel,acquisition_owner,
  aarohi_prospect_id,aarohi_handoff_id,acquisition_completed_at,
  created_by,updated_by
)
select
  h.vendor_id,'active','active',
  'AAROHI',
  coalesce(
    (select c.channel from public.aarohi_conversations c
      where c.prospect_id=h.prospect_id order by c.updated_at desc,c.id limit 1),
    (select ci.channel from public.aarohi_channel_identities ci
      where ci.prospect_id=h.prospect_id order by ci.updated_at desc,ci.id limit 1),
    (select s.source_type from public.aarohi_prospect_sources s
      where s.prospect_id=h.prospect_id order by s.imported_at desc,s.id limit 1)
  ),
  'ANISHA',
  h.prospect_id,h.id,h.completed_at,h.completed_by,h.completed_by
from public.aarohi_handoffs h
on conflict (vendor_id) do update
  set acquisition_source='AAROHI',
      acquisition_channel=coalesce(public.vendor_crm_profiles.acquisition_channel,excluded.acquisition_channel),
      acquisition_owner='ANISHA',
      aarohi_prospect_id=excluded.aarohi_prospect_id,
      aarohi_handoff_id=excluded.aarohi_handoff_id,
      acquisition_completed_at=excluded.acquisition_completed_at,
      updated_at=now(),
      updated_by=excluded.updated_by;