-- Vendor OS V3: durable, PII-minimal approval events. PENDING GOVERNED RELEASE.
-- Prerequisite: qf_approve_vendor_profile_update_v3 and its audited decisions.
-- Providers/agents are DISABLED by default. Do not activate as part of migration.
begin;

create table if not exists public.vendor_approval_event_consumers_v1 (
  target text primary key check (target in ('anisha','automation','aos','agni')),
  enabled boolean not null default false,
  changed_at timestamptz not null default now()
);
insert into public.vendor_approval_event_consumers_v1(target,enabled)
values ('anisha',false),('automation',false),('aos',false),('agni',false)
on conflict (target) do nothing;
alter table public.vendor_approval_event_consumers_v1 enable row level security;
revoke all on public.vendor_approval_event_consumers_v1 from public,anon,authenticated;
grant select on public.vendor_approval_event_consumers_v1 to service_role;

create table if not exists public.vendor_approval_delivery_outbox_v1 (
  id uuid primary key default gen_random_uuid(),
  audit_id bigint not null references public.vendor_change_review_audit_v3(id) on delete restrict,
  vendor_id uuid not null,
  request_id uuid not null,
  target text not null check (target in ('anisha','automation','aos','agni')),
  event_type text not null check (event_type in ('vendor.approval.approved.v1','vendor.approval.rejected.v1')),
  safe_payload jsonb not null check (jsonb_typeof(safe_payload)='object' and length(safe_payload::text)<=1200),
  status text not null default 'pending' check (status in ('pending','processing','retry','completed','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count>=0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 8),
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_reason_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint uq_vendor_approval_target_once unique (audit_id,target)
);
create index if not exists ix_vendor_approval_outbox_claim_v1
  on public.vendor_approval_delivery_outbox_v1(target,status,next_attempt_at,created_at);
alter table public.vendor_approval_delivery_outbox_v1 enable row level security;
revoke all on public.vendor_approval_delivery_outbox_v1 from public,anon,authenticated;
grant select,insert,update on public.vendor_approval_delivery_outbox_v1 to service_role;

create or replace function public.qf_vendor_approval_audit_fanout_v1()
returns trigger language plpgsql security definer set search_path=''
as $fanout$
declare v_event_type text;
declare v_payload jsonb;
begin
  if new.decision not in ('approved','rejected') then
    raise exception 'QF_VENDOR_APPROVAL_EVENT_BAD_DECISION';
  end if;
  v_event_type := 'vendor.approval.'||new.decision||'.v1';
  -- Never distribute proposed_changes, snapshots, phone, email, notes,
  -- addresses, identity evidence or private document content.
  v_payload := jsonb_build_object(
    'version',1,'audit_id',new.id,'request_id',new.request_id,
    'vendor_id',new.vendor_id,'request_type',new.request_type,
    'decision',new.decision,'reviewed_at',new.reviewed_at
  );
  -- A durable in-dashboard receipt commits atomically with the decision.
  insert into public.vendor_notifications
    (vendor_id,title,message,type,priority,cta_label,cta_url,is_read,dedupe_key)
  values (new.vendor_id,
    case when new.decision='approved' then 'Vendor change approved' else 'Vendor change rejected' end,
    case when new.decision='approved'
      then 'Your reviewed change was approved. Open your profile for details.'
      else 'Your requested change was rejected. Open your profile for details.' end,
    'profile','normal','View request','/vendor/dashboard/profile',false,
    'vendor_approval:'||new.request_id::text||':'||new.decision)
  on conflict do nothing;

  insert into public.vendor_approval_delivery_outbox_v1
    (audit_id,vendor_id,request_id,target,event_type,safe_payload)
  select new.id,new.vendor_id,new.request_id,t.target,v_event_type,v_payload
    from (values ('anisha'),('automation'),('aos'),('agni')) as t(target)
  on conflict (audit_id,target) do nothing;
  return new;
end
$fanout$;
revoke all on function public.qf_vendor_approval_audit_fanout_v1() from public,anon,authenticated;
drop trigger if exists qf_vendor_approval_audit_fanout_v1 on public.vendor_change_review_audit_v3;
create trigger qf_vendor_approval_audit_fanout_v1
after insert on public.vendor_change_review_audit_v3
for each row execute function public.qf_vendor_approval_audit_fanout_v1();

create or replace function public.qf_claim_vendor_approval_event_v1(
  p_target text, p_worker_id text
) returns public.vendor_approval_delivery_outbox_v1
language plpgsql security definer set search_path=''
as $claim$
declare v public.vendor_approval_delivery_outbox_v1%rowtype;
begin
  if p_target not in ('anisha','automation','aos','agni')
    or p_worker_id is null or length(trim(p_worker_id)) not between 8 and 120
    or p_worker_id !~ '^[A-Za-z0-9:_-]+$' then
    raise exception 'QF_VENDOR_EVENT_BAD_WORKER' using errcode='22023';
  end if;
  if not exists(select 1 from public.vendor_approval_event_consumers_v1
      where target=p_target and enabled=true) then return null; end if;
  update public.vendor_approval_delivery_outbox_v1 set status='dead_letter',
     locked_at=null,locked_by=null,last_reason_code='LEASE_EXHAUSTED'
    where target=p_target and status='processing' and attempt_count>=max_attempts
      and locked_at < now()-interval '10 minutes';
  select * into v from public.vendor_approval_delivery_outbox_v1
  where target=p_target and attempt_count<max_attempts and (
      (status in ('pending','retry') and next_attempt_at<=now())
      or (status='processing' and locked_at < now()-interval '10 minutes')
    )
  order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.vendor_approval_delivery_outbox_v1
    set status='processing',locked_by=p_worker_id,locked_at=now(),
        attempt_count=attempt_count+1 where id=v.id returning * into v;
  return v;
end
$claim$;
revoke all on function public.qf_claim_vendor_approval_event_v1(text,text)
  from public,anon,authenticated;
grant execute on function public.qf_claim_vendor_approval_event_v1(text,text) to service_role;

create or replace function public.qf_ack_vendor_approval_event_v1(
  p_event_id uuid,p_worker_id text,p_success boolean,p_reason text default null
) returns boolean language plpgsql security definer set search_path=''
as $ack$
declare v public.vendor_approval_delivery_outbox_v1%rowtype;
begin
  select * into v from public.vendor_approval_delivery_outbox_v1
    where id=p_event_id for update;
  if not found or v.status<>'processing' or v.locked_by is distinct from p_worker_id
    or v.locked_at < now()-interval '10 minutes' then return false; end if;
  if p_success is true then
    update public.vendor_approval_delivery_outbox_v1
      set status='completed',completed_at=now(),locked_by=null,
          locked_at=null,last_reason_code=null where id=v.id;
  else
    update public.vendor_approval_delivery_outbox_v1
      set status=case when v.attempt_count>=v.max_attempts then 'dead_letter' else 'retry' end,
        next_attempt_at=now()+make_interval(
          secs=>least(3600.0,30.0*power(2,least(v.attempt_count,7)))::double precision),
        last_reason_code=left(coalesce(p_reason,'RETRYABLE'),80),
        locked_by=null,locked_at=null where id=v.id;
  end if;
  return true;
end
$ack$;
revoke all on function public.qf_ack_vendor_approval_event_v1(uuid,text,boolean,text)
  from public,anon,authenticated;
grant execute on function public.qf_ack_vendor_approval_event_v1(uuid,text,boolean,text) to service_role;

commit;
