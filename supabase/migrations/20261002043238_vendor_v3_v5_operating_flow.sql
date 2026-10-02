-- QuickFurno Vendor V3-V5 operating flow
-- V3 provider-confirmed delivery + vendor acknowledgement
-- V4 human-approved bad-lead recovery + canonical replacement handoff
-- V5 advisory vendor intelligence signals (no marketplace authority)
begin;

-- ---------------------------------------------------------------------------
-- V3: provider-confirmed delivery is the fairness/lifecycle authority.
-- ---------------------------------------------------------------------------
alter table public.vendors
  add column if not exists last_delivered_at timestamptz;

comment on column public.vendors.last_delivered_at is
  'Latest provider-confirmed lead delivery/read instant. Used as the fair-turn signal; assignment creation alone does not consume delivery fairness.';

alter table public.lead_delivery_logs
  add column if not exists communication_intent_id uuid references public.communication_intents(id) on delete set null,
  add column if not exists communication_message_id uuid references public.communication_messages(id) on delete set null,
  add column if not exists provider_status text,
  add column if not exists provider_delivered_at timestamptz,
  add column if not exists acknowledged_at timestamptz;

create unique index if not exists uq_lead_delivery_logs_communication_message
  on public.lead_delivery_logs(communication_message_id)
  where communication_message_id is not null;

create index if not exists idx_lead_delivery_logs_assignment_real
  on public.lead_delivery_logs(assignment_id, provider_delivered_at desc)
  where communication_message_id is not null;

create or replace function public.qf_project_vendor_lead_delivery_v1(
  p_message_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_message public.communication_messages%rowtype;
  v_intent public.communication_intents%rowtype;
  v_assignment public.lead_assignments%rowtype;
  v_delivery_at timestamptz;
  v_previous text;
  v_event_key text;
begin
  if p_message_id is null then
    return jsonb_build_object('status','rejected','reason_code','message_required');
  end if;

  select * into v_message
  from public.communication_messages
  where id = p_message_id
  for update;

  if not found
     or v_message.entity_type is distinct from 'communication_intent'
     or v_message.entity_id is null
     or v_message.channel is distinct from 'whatsapp'
     or v_message.template_key is distinct from 'lead_assignment_alert'
     or v_message.status not in ('delivered','read') then
    return jsonb_build_object('status','rejected','reason_code','delivery_not_confirmed');
  end if;

  v_delivery_at := coalesce(v_message.delivered_at, v_message.read_at);
  if v_delivery_at is null then
    return jsonb_build_object('status','rejected','reason_code','delivery_timestamp_missing');
  end if;

  select * into v_intent
  from public.communication_intents
  where id = v_message.entity_id;

  if not found
     or v_intent.aggregate_type is distinct from 'lead_assignment'
     or v_intent.template_purpose is distinct from 'vendor_lead_assigned'
     or v_intent.channel is distinct from 'whatsapp' then
    return jsonb_build_object('status','rejected','reason_code','intent_not_lead_assignment');
  end if;

  select * into v_assignment
  from public.lead_assignments
  where id = v_intent.aggregate_id
  for update;

  if not found or v_assignment.vendor_id is null or v_assignment.lead_id is null then
    return jsonb_build_object('status','rejected','reason_code','assignment_not_found');
  end if;

  if v_assignment.lifecycle_status in ('invalid','replaced','cancelled','expired','rejected','completed') then
    return jsonb_build_object('status','rejected','reason_code','assignment_terminal');
  end if;

  v_previous := v_assignment.lifecycle_status;

  -- Monotonic lifecycle: provider truth moves assigned -> delivered only.
  if v_assignment.lifecycle_status = 'assigned' then
    update public.lead_assignments
       set lifecycle_status = 'delivered',
           lifecycle_updated_at = v_delivery_at
     where id = v_assignment.id
       and lifecycle_status = 'assigned';
  end if;

  v_event_key := 'delivery_confirmed:' || v_assignment.id::text || ':' || v_message.id::text;
  insert into public.lead_assignment_events (
    assignment_id, lead_id, vendor_id, operation_id,
    event_type, lifecycle_from, lifecycle_to, occurred_at, recorded_at,
    actor_kind, actor_id, reason_code, source_kind, source_reference,
    event_idempotency_key, metadata
  ) values (
    v_assignment.id, v_assignment.lead_id, v_assignment.vendor_id, v_assignment.operation_id,
    'lifecycle_transition',
    case when v_previous = 'assigned' then 'assigned' else v_previous end,
    case when v_previous = 'assigned' then 'delivered' else v_previous end,
    v_delivery_at, now(),
    'worker', null, 'provider_delivery_confirmed', 'reconciliation',
    coalesce(v_message.provider_message_id, v_message.id::text),
    v_event_key,
    jsonb_build_object('communication_message_id', v_message.id, 'provider_status', v_message.status)
  )
  on conflict (event_idempotency_key) do nothing;

  insert into public.lead_delivery_logs (
    lead_id, vendor_id, assignment_id,
    delivery_channel, delivery_status, contact_shared, credit_deducted,
    whatsapp_status, assignment_source,
    communication_intent_id, communication_message_id,
    provider_status, provider_delivered_at
  ) values (
    v_assignment.lead_id, v_assignment.vendor_id, v_assignment.id,
    'whatsapp', 'delivered', true, coalesce(v_assignment.credit_deducted,false),
    v_message.status, v_assignment.assignment_source,
    v_intent.id, v_message.id, v_message.status, v_delivery_at
  )
  on conflict (communication_message_id) where communication_message_id is not null
  do update set
    delivery_status = 'delivered',
    whatsapp_status = excluded.whatsapp_status,
    provider_status = excluded.provider_status,
    provider_delivered_at = least(
      coalesce(public.lead_delivery_logs.provider_delivered_at, excluded.provider_delivered_at),
      excluded.provider_delivered_at
    ),
    updated_at = now();

  -- Fairness is consumed only by a real provider-confirmed delivery.
  update public.vendors
     set last_delivered_at = greatest(
       coalesce(last_delivered_at, '-infinity'::timestamptz),
       v_delivery_at
     )
   where id = v_assignment.vendor_id;

  return jsonb_build_object(
    'status', 'applied',
    'assignment_id', v_assignment.id,
    'vendor_id', v_assignment.vendor_id,
    'lifecycle_status', case when v_previous = 'assigned' then 'delivered' else v_previous end,
    'delivered_at', v_delivery_at
  );
end;
$$;

revoke all on function public.qf_project_vendor_lead_delivery_v1(uuid) from public, anon, authenticated;
grant execute on function public.qf_project_vendor_lead_delivery_v1(uuid) to service_role;

create or replace function public.qf_acknowledge_vendor_lead_v1(
  p_vendor_id uuid,
  p_assignment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assignment public.lead_assignments%rowtype;
  v_now timestamptz := now();
  v_event_key text;
begin
  if p_vendor_id is null or p_assignment_id is null then
    return jsonb_build_object('status','rejected','reason_code','identity_required');
  end if;

  select * into v_assignment
  from public.lead_assignments
  where id = p_assignment_id and vendor_id = p_vendor_id
  for update;

  if not found then
    return jsonb_build_object('status','rejected','reason_code','assignment_not_found');
  end if;

  if v_assignment.lifecycle_status = 'accepted' then
    return jsonb_build_object('status','already_applied','assignment_id',v_assignment.id);
  end if;

  if v_assignment.lifecycle_status <> 'delivered' then
    return jsonb_build_object('status','rejected','reason_code','delivery_not_confirmed');
  end if;

  update public.lead_assignments
     set lifecycle_status='accepted', lifecycle_updated_at=v_now
   where id=v_assignment.id and lifecycle_status='delivered';

  v_event_key := 'vendor_acknowledged:' || v_assignment.id::text;
  insert into public.lead_assignment_events (
    assignment_id, lead_id, vendor_id, operation_id,
    event_type, lifecycle_from, lifecycle_to, occurred_at, recorded_at,
    actor_kind, actor_id, reason_code, source_kind, source_reference,
    event_idempotency_key, metadata
  ) values (
    v_assignment.id, v_assignment.lead_id, v_assignment.vendor_id, v_assignment.operation_id,
    'lifecycle_transition','delivered','accepted',v_now,v_now,
    'worker',null,'vendor_acknowledged','canonical_authority',
    v_assignment.id::text,v_event_key,'{}'::jsonb
  )
  on conflict (event_idempotency_key) do nothing;

  update public.lead_delivery_logs
     set acknowledged_at=coalesce(acknowledged_at,v_now), updated_at=v_now
   where assignment_id=v_assignment.id
     and communication_message_id is not null;

  return jsonb_build_object('status','applied','assignment_id',v_assignment.id,'lifecycle_status','accepted');
end;
$$;

revoke all on function public.qf_acknowledge_vendor_lead_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.qf_acknowledge_vendor_lead_v1(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- V4: bad-lead recovery remains human-approved and uses existing authorities.
-- ---------------------------------------------------------------------------
alter table public.bad_lead_reports
  add column if not exists recovery_recommendation text,
  add column if not exists recovery_status text not null default 'not_requested',
  add column if not exists credit_restoration_approval_id uuid references public.credit_restoration_approvals(id) on delete set null,
  add column if not exists replacement_request_id uuid references public.replacement_requests(id) on delete set null,
  add column if not exists recovery_applied_at timestamptz;

alter table public.bad_lead_reports
  drop constraint if exists bad_lead_reports_recovery_recommendation_check;
alter table public.bad_lead_reports
  add constraint bad_lead_reports_recovery_recommendation_check
  check (recovery_recommendation is null or recovery_recommendation in (
    'none','restore_credit','replace','restore_credit_and_replace'
  ));

alter table public.bad_lead_reports
  drop constraint if exists bad_lead_reports_recovery_status_check;
alter table public.bad_lead_reports
  add constraint bad_lead_reports_recovery_status_check
  check (recovery_status in ('not_requested','recommended','approved','applied','rejected','failed'));

create or replace function public.qf_recommend_bad_lead_recovery_v1(
  p_report_id uuid,
  p_recommendation text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_report public.bad_lead_reports%rowtype;
begin
  if p_report_id is null or p_recommendation not in ('none','restore_credit','replace','restore_credit_and_replace') then
    return jsonb_build_object('status','rejected','reason_code','invalid_recommendation');
  end if;

  select * into v_report from public.bad_lead_reports where id=p_report_id for update;
  if not found then return jsonb_build_object('status','rejected','reason_code','report_not_found'); end if;
  if coalesce(v_report.status,'') not in ('Pending','Under Review','Valid','Approved') then
    return jsonb_build_object('status','rejected','reason_code','report_not_reviewable');
  end if;
  if v_report.recovery_status in ('approved','applied','rejected') then
    return jsonb_build_object('status','rejected','reason_code','recovery_locked');
  end if;

  update public.bad_lead_reports
     set recovery_recommendation=p_recommendation,
         recovery_status='recommended',
         updated_at=now()
   where id=p_report_id;

  return jsonb_build_object('status','applied','report_id',p_report_id,'recommendation',p_recommendation);
end;
$$;

revoke all on function public.qf_recommend_bad_lead_recovery_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.qf_recommend_bad_lead_recovery_v1(uuid,text) to service_role;

create or replace function public.qf_apply_bad_lead_recovery_v1(
  p_report_id uuid,
  p_actor_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_report public.bad_lead_reports%rowtype;
  v_assignment public.lead_assignments%rowtype;
  v_credit_approval_id uuid;
  v_replacement_id uuid;
  v_credit_result jsonb;
  v_now timestamptz := now();
begin
  if p_report_id is null or p_actor_id is null
     or p_action not in ('restore_credit','replace','restore_credit_and_replace','reject') then
    return jsonb_build_object('status','rejected','reason_code','invalid_recovery_action');
  end if;

  select * into v_report from public.bad_lead_reports where id=p_report_id for update;
  if not found then return jsonb_build_object('status','rejected','reason_code','report_not_found'); end if;

  if v_report.recovery_status='applied' then
    return jsonb_build_object(
      'status','already_applied','report_id',v_report.id,
      'credit_restoration_approval_id',v_report.credit_restoration_approval_id,
      'replacement_request_id',v_report.replacement_request_id
    );
  end if;

  if p_action='reject' then
    update public.bad_lead_reports
       set recovery_status='rejected', reviewed_by=p_actor_id,
           reviewed_at=coalesce(reviewed_at,v_now), updated_at=v_now
     where id=v_report.id;
    return jsonb_build_object('status','applied','report_id',v_report.id,'recovery_status','rejected');
  end if;

  -- A recovery mutation is a HUMAN approval. The report itself must have passed review.
  if coalesce(v_report.status,'') not in ('Valid','Approved') then
    return jsonb_build_object('status','rejected','reason_code','human_review_required');
  end if;

  select * into v_assignment
  from public.lead_assignments
  where id=v_report.lead_assignment_id and vendor_id=v_report.vendor_id
  for update;

  if not found or v_assignment.lead_id is null or v_assignment.vendor_id is null then
    return jsonb_build_object('status','rejected','reason_code','assignment_not_found');
  end if;

  if v_assignment.lifecycle_status not in ('assigned','delivered','accepted','invalid') then
    return jsonb_build_object('status','rejected','reason_code','assignment_not_recoverable');
  end if;

  -- Invalidating the original assignment frees one active slot before replacement.
  if v_assignment.lifecycle_status <> 'invalid' then
    insert into public.lead_assignment_events (
      assignment_id,lead_id,vendor_id,operation_id,event_type,lifecycle_from,lifecycle_to,
      occurred_at,recorded_at,actor_kind,actor_id,reason_code,source_kind,source_reference,
      event_idempotency_key,metadata
    ) values (
      v_assignment.id,v_assignment.lead_id,v_assignment.vendor_id,v_assignment.operation_id,
      'lifecycle_transition',v_assignment.lifecycle_status,'invalid',
      v_now,v_now,'admin',p_actor_id,'bad_lead_validated','canonical_authority',
      v_report.id::text,'bad_lead_invalid:'||v_report.id::text,'{}'::jsonb
    )
    on conflict (event_idempotency_key) do nothing;

    update public.lead_assignments
       set lifecycle_status='invalid', lifecycle_updated_at=v_now
     where id=v_assignment.id;
  end if;

  if p_action in ('restore_credit','restore_credit_and_replace') then
    select id into v_credit_approval_id
    from public.credit_restoration_approvals
    where idempotency_key='bad_lead_recovery:'||v_report.id::text||':credit'
    limit 1;

    if v_credit_approval_id is null then
      insert into public.credit_restoration_approvals (
        original_assignment_id,vendor_id,lead_id,evidence_type,evidence_reference,
        reason_code,requested_by,status,approved_by,decided_at,idempotency_key
      ) values (
        v_assignment.id,v_assignment.vendor_id,v_assignment.lead_id,
        'bad_lead_report',v_report.id::text,
        coalesce(v_report.reason_code,v_report.report_type,'bad_lead_validated'),
        p_actor_id,'approved',p_actor_id,v_now,
        'bad_lead_recovery:'||v_report.id::text||':credit'
      ) returning id into v_credit_approval_id;
    else
      update public.credit_restoration_approvals
         set status=case when status='requested' then 'approved' else status end,
             approved_by=coalesce(approved_by,p_actor_id),
             decided_at=coalesce(decided_at,v_now),
             updated_at=v_now
       where id=v_credit_approval_id and status in ('requested','approved','applied');
    end if;

    select public.qf_approve_credit_restoration_v2(
      v_credit_approval_id,p_actor_id,'human_approved_bad_lead_recovery'
    ) into v_credit_result;

    if coalesce(v_credit_result->>'status','') not in ('applied','already_applied') then
      raise exception 'BAD_LEAD_CREDIT_RESTORATION_FAILED' using errcode='P0001';
    end if;
  end if;

  if p_action in ('replace','restore_credit_and_replace') then
    select id into v_replacement_id
    from public.replacement_requests
    where idempotency_key='bad_lead_recovery:'||v_report.id::text||':replacement'
    limit 1;

    if v_replacement_id is null then
      insert into public.replacement_requests (
        lead_id,original_assignment_id,original_vendor_id,reason_code,evidence_reference,
        status,requested_by,approved_by,decided_at,idempotency_key
      ) values (
        v_assignment.lead_id,v_assignment.id,v_assignment.vendor_id,
        coalesce(v_report.reason_code,v_report.report_type,'bad_lead_validated'),
        v_report.id::text,'approved',p_actor_id,p_actor_id,v_now,
        'bad_lead_recovery:'||v_report.id::text||':replacement'
      ) returning id into v_replacement_id;
    else
      update public.replacement_requests
         set status=case when status='requested' then 'approved' else status end,
             approved_by=coalesce(approved_by,p_actor_id),
             decided_at=coalesce(decided_at,v_now),
             updated_at=v_now
       where id=v_replacement_id and status in ('requested','approved','activating','completed');
    end if;
  end if;

  update public.bad_lead_reports
     set recovery_recommendation=p_action,
         recovery_status='approved',
         credit_restoration_approval_id=v_credit_approval_id,
         replacement_request_id=v_replacement_id,
         reviewed_by=p_actor_id,
         reviewed_at=coalesce(reviewed_at,v_now),
         updated_at=v_now
   where id=v_report.id;

  return jsonb_build_object(
    'status','applied','report_id',v_report.id,'recovery_status','approved',
    'lead_id',v_assignment.lead_id,'original_assignment_id',v_assignment.id,
    'credit_restoration_approval_id',v_credit_approval_id,
    'replacement_request_id',v_replacement_id
  );
end;
$$;

revoke all on function public.qf_apply_bad_lead_recovery_v1(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.qf_apply_bad_lead_recovery_v1(uuid,uuid,text) to service_role;

create or replace function public.qf_finalize_replacement_request_v1(
  p_replacement_request_id uuid,
  p_replacement_assignment_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.replacement_requests%rowtype;
  v_new public.lead_assignments%rowtype;
  v_old public.lead_assignments%rowtype;
  v_now timestamptz:=now();
begin
  select * into v_request from public.replacement_requests where id=p_replacement_request_id for update;
  if not found or v_request.status not in ('approved','activating','completed') then
    return jsonb_build_object('status','rejected','reason_code','replacement_not_approved');
  end if;
  if v_request.status='completed' and v_request.replacement_assignment_id=p_replacement_assignment_id then
    return jsonb_build_object('status','already_applied','replacement_assignment_id',p_replacement_assignment_id);
  end if;

  select * into v_new from public.lead_assignments
   where id=p_replacement_assignment_id and lead_id=v_request.lead_id;
  select * into v_old from public.lead_assignments
   where id=v_request.original_assignment_id
   for update;

  if v_new.id is null or v_old.id is null or v_new.vendor_id=v_old.vendor_id then
    return jsonb_build_object('status','rejected','reason_code','replacement_assignment_invalid');
  end if;

  update public.lead_assignments
     set lifecycle_status='replaced', lifecycle_updated_at=v_now,
         replaced_by_assignment_id=v_new.id
   where id=v_old.id and lifecycle_status='invalid';

  insert into public.lead_assignment_events (
    assignment_id,lead_id,vendor_id,operation_id,event_type,lifecycle_from,lifecycle_to,
    occurred_at,recorded_at,actor_kind,actor_id,reason_code,source_kind,source_reference,
    event_idempotency_key,metadata
  ) values (
    v_old.id,v_old.lead_id,v_old.vendor_id,v_old.operation_id,'replacement_linked',
    'invalid','replaced',v_now,v_now,'admin',p_actor_id,'replacement_completed',
    'canonical_authority',v_request.id::text,
    'replacement_linked:'||v_request.id::text,
    jsonb_build_object('replacement_assignment_id',v_new.id)
  )
  on conflict (event_idempotency_key) do nothing;

  update public.replacement_requests
     set status='completed', replacement_assignment_id=v_new.id, updated_at=v_now
   where id=v_request.id;

  update public.bad_lead_reports
     set recovery_status='applied', recovery_applied_at=v_now, updated_at=v_now
   where replacement_request_id=v_request.id;

  return jsonb_build_object('status','applied','replacement_assignment_id',v_new.id);
end;
$$;

revoke all on function public.qf_finalize_replacement_request_v1(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.qf_finalize_replacement_request_v1(uuid,uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- V5: idempotent advisory notifications. They never mutate Core authority.
-- ---------------------------------------------------------------------------
alter table public.vendor_notifications
  add column if not exists dedupe_key text;

create unique index if not exists uq_vendor_notifications_dedupe_key
  on public.vendor_notifications(dedupe_key)
  where dedupe_key is not null;

comment on column public.vendor_notifications.dedupe_key is
  'Idempotency key for advisory vendor-intelligence notices. Does not grant or mutate marketplace authority.';

-- Browser roles must never execute lifecycle/recovery authority directly.
do $$
begin
  if has_function_privilege('anon','public.qf_project_vendor_lead_delivery_v1(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.qf_project_vendor_lead_delivery_v1(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.qf_acknowledge_vendor_lead_v1(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.qf_apply_bad_lead_recovery_v1(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.qf_finalize_replacement_request_v1(uuid,uuid,uuid)','EXECUTE') then
    raise exception 'VENDOR_V3_V5_AUTHORITY_EXPOSED';
  end if;
end $$;

commit;
