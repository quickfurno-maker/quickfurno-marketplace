-- QuickFurno V3 resilience bridge.
-- Project provider-confirmed vendor lead delivery from canonical communication truth
-- inside Postgres so deployment order cannot strand the response gate.
begin;

create or replace function public.qf_project_vendor_lead_delivery_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.channel is distinct from 'whatsapp'
     or new.template_key is distinct from 'lead_assignment_alert'
     or new.status not in ('delivered','read') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.delivered_at is not distinct from new.delivered_at
     and old.read_at is not distinct from new.read_at then
    return new;
  end if;
  perform public.qf_project_vendor_lead_delivery_v1(new.id);
  return new;
end;
$$;

revoke all on function public.qf_project_vendor_lead_delivery_trigger_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_qf_vendor_lead_delivery_projection
  on public.communication_messages;

create trigger trg_qf_vendor_lead_delivery_projection
after insert or update on public.communication_messages
for each row
when (
  new.channel = 'whatsapp'
  and new.template_key = 'lead_assignment_alert'
  and new.status in ('delivered','read')
)
execute function public.qf_project_vendor_lead_delivery_trigger_v1();

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_qf_vendor_lead_delivery_projection'
      and tgrelid = 'public.communication_messages'::regclass
      and not tgisinternal
  ) then
    raise exception 'VENDOR_V3_DELIVERY_TRIGGER_MISSING';
  end if;

  if has_function_privilege(
       'anon',
       'public.qf_project_vendor_lead_delivery_trigger_v1()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.qf_project_vendor_lead_delivery_trigger_v1()',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.qf_project_vendor_lead_delivery_trigger_v1()',
       'EXECUTE'
     ) then
    raise exception 'VENDOR_V3_DELIVERY_TRIGGER_AUTHORITY_EXPOSED';
  end if;
end $$;

commit;
