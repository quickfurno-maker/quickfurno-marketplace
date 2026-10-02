-- Vendor V3 connection response must follow provider-confirmed delivery.
begin;

create or replace function public.qf_record_vendor_client_response_v1(
  p_vendor_id uuid,
  p_assignment_id uuid,
  p_outcome text
)
returns public.lead_connection_assurance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assignment public.lead_assignments%rowtype;
  v_existing public.lead_connection_assurance%rowtype;
  v_result public.lead_connection_assurance%rowtype;
  v_now timestamptz := now();
  v_step integer;
begin
  if p_vendor_id is null or p_assignment_id is null then
    raise exception 'QF_CONNECTION_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('responded', 'no_response') then
    raise exception 'QF_CONNECTION_OUTCOME_INVALID' using errcode = 'P0001';
  end if;

  select * into v_assignment
    from public.lead_assignments
   where id = p_assignment_id and vendor_id = p_vendor_id
   for update;
  if not found or v_assignment.lead_id is null then
    raise exception 'QF_CONNECTION_ASSIGNMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- V3: response evidence can only exist after provider-confirmed delivery.
  if v_assignment.lifecycle_status not in ('delivered','accepted') then
    raise exception 'QF_CONNECTION_DELIVERY_REQUIRED' using errcode = 'P0001';
  end if;

  if v_assignment.assigned_at is null or v_now > v_assignment.assigned_at + interval '24 hours' then
    raise exception 'QF_CONNECTION_WINDOW_CLOSED' using errcode = 'P0001';
  end if;

  select * into v_existing from public.lead_connection_assurance where assignment_id = p_assignment_id;
  if v_existing.assignment_id is not null then
    raise exception 'QF_CONNECTION_RESPONSE_LOCKED' using errcode = 'P0001';
  end if;

  -- A vendor reporting the real contact outcome is also an acknowledgement.
  if v_assignment.lifecycle_status = 'delivered' then
    update public.lead_assignments
       set lifecycle_status='accepted', lifecycle_updated_at=v_now
     where id=v_assignment.id and lifecycle_status='delivered';

    insert into public.lead_assignment_events (
      assignment_id,lead_id,vendor_id,operation_id,event_type,lifecycle_from,lifecycle_to,
      occurred_at,recorded_at,actor_kind,actor_id,reason_code,source_kind,source_reference,
      event_idempotency_key,metadata
    ) values (
      v_assignment.id,v_assignment.lead_id,v_assignment.vendor_id,v_assignment.operation_id,
      'lifecycle_transition','delivered','accepted',v_now,v_now,'worker',null,
      'vendor_response_implied_ack','canonical_authority',v_assignment.id::text,
      'vendor_response_ack:'||v_assignment.id::text,
      jsonb_build_object('outcome',p_outcome)
    )
    on conflict (event_idempotency_key) do nothing;

    update public.lead_delivery_logs
       set acknowledged_at=coalesce(acknowledged_at,v_now), updated_at=v_now
     where assignment_id=v_assignment.id and communication_message_id is not null;
  end if;

  insert into public.lead_connection_assurance (
    assignment_id, lead_id, vendor_id, vendor_outcome, vendor_reported_at,
    window_expires_at, client_responded_at, client_response_source,
    riya_handoff_due_at, riya_handoff_status
  ) values (
    p_assignment_id, v_assignment.lead_id, p_vendor_id, p_outcome, v_now,
    v_assignment.assigned_at + interval '24 hours',
    case when p_outcome = 'responded' then v_now else null end,
    case when p_outcome = 'responded' then 'vendor_confirmation' else null end,
    case when p_outcome = 'no_response' then v_now + interval '120 hours' else null end,
    case when p_outcome = 'no_response' then 'scheduled' else 'not_required' end
  ) returning * into v_result;

  if p_outcome = 'no_response' then
    for v_step in 1..5 loop
      perform public.qf_enqueue_client_automation_v1(
        'client.transactional_followup', v_assignment.lead_id,
        'conn_' || replace(p_assignment_id::text, '-', '') || '_r' || v_step::text,
        v_now + ((v_step - 1) * interval '24 hours')
      );
    end loop;
  end if;
  return v_result;
end;
$$;

revoke all on function public.qf_record_vendor_client_response_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_record_vendor_client_response_v1(uuid, uuid, text) to service_role;

commit;
