-- VOX-08J, candidate only. NO managed staging or production application.
-- Requires reviewed single Staff foundation + department grant chain + VOX work ledger.
-- Core verifies a genuine bearer JWT/AAL2 and derives p_actor server-side.
-- No service_role client transport, no complete report or external messages.
begin;
create table public.vox_staff_eod_reports_candidate_v1(
 id uuid primary key default gen_random_uuid(),
 event_nonce uuid not null unique,
 staff_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 business_date date not null,
 source text not null default 'CORE_WORK_LEDGER_ONLY'
   check(source='CORE_WORK_LEDGER_ONLY'),
 completeness text not null default 'PARTIAL_UNVERIFIED_TOTAL'
   check(completeness='PARTIAL_UNVERIFIED_TOTAL'),
 event_count integer not null check(event_count between 0 and 100),
 event_counts jsonb not null,
 state text not null default 'PENDING_REVIEW'
   check(state in ('PENDING_REVIEW','ACKNOWLEDGED','REJECTED')),
 revision integer not null default 0 check(revision between 0 and 1),
 reviewer_id uuid references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 review_nonce uuid unique,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 constraint vox_eod_review_state_v1 check (
  (state='PENDING_REVIEW' and revision=0 and reviewer_id is null
   and review_nonce is null and reviewed_at is null)
  or
  (state in ('ACKNOWLEDGED','REJECTED') and revision=1 and reviewer_id is not null
   and review_nonce is not null and reviewed_at is not null and reviewer_id<>staff_id)
 ),
 constraint vox_eod_one_staff_day_v1 unique(staff_id,team_id,business_date),
 constraint vox_eod_count_keys_v1 check(
  jsonb_typeof(event_counts)='object'
  and event_counts ?& array['claims','starts','completions','blocks',
  'approvalRequests','externalWaits','resumptions']
  and jsonb_array_length(jsonb_path_query_array(event_counts,'$.*'))=7
 )
);
create index vox_eod_team_pending_v1 on public.vox_staff_eod_reports_candidate_v1
 (team_id,city_id,created_at) where state='PENDING_REVIEW';

create table public.vox_staff_eod_review_events_candidate_v1(
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null unique references public.vox_staff_eod_reports_candidate_v1(id) on delete restrict,
 event_nonce uuid not null unique,
 reviewer_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 staff_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 decision text not null check(decision in ('ACKNOWLEDGED','REJECTED')),
 expected_revision integer not null check(expected_revision=0),
 created_at timestamptz not null default now(),
 constraint vox_eod_event_independence_v1 check(reviewer_id<>staff_id)
);

-- Immutable evidence cannot be edited by an authorized service_role RPC.
create function public.qf_vox_eod_immutability_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'VOX_EOD_DELETE_FORBIDDEN'; end if;
 if TG_TABLE_NAME='vox_staff_eod_review_events_candidate_v1' then
  raise exception 'VOX_EOD_EVENT_IMMUTABLE';
 end if;
 if (old.id,old.event_nonce,old.staff_id,old.team_id,old.city_id,
  old.business_date,old.source,old.completeness,old.event_count,
  old.event_counts,old.created_at) is distinct from
  (new.id,new.event_nonce,new.staff_id,new.team_id,new.city_id,
  new.business_date,new.source,new.completeness,new.event_count,
  new.event_counts,new.created_at)
 then raise exception 'VOX_EOD_EVIDENCE_IMMUTABLE'; end if;
 if old.state<>'PENDING_REVIEW' or old.revision<>0
  or new.revision<>1 or new.state not in ('ACKNOWLEDGED','REJECTED')
  or new.reviewer_id is null or new.review_nonce is null
  or new.reviewed_at is null or new.reviewer_id=old.staff_id
 then raise exception 'VOX_EOD_ILLEGAL_REVIEW_TRANSITION'; end if;
 return new;
end;
$$;
create trigger qf_vox_eod_report_guard_v1 before update or delete
 on public.vox_staff_eod_reports_candidate_v1 for each row
 execute function public.qf_vox_eod_immutability_candidate_v1();
create trigger qf_vox_eod_event_guard_v1 before update or delete
 on public.vox_staff_eod_review_events_candidate_v1 for each row
 execute function public.qf_vox_eod_immutability_candidate_v1();

-- The report contains ONLY Staff's current-day immutable Core work evidence;
-- never infer CRM, inbox, agent or provider totals from the Core work ledger.
create function public.qf_vox_eod_submit_candidate_v1(
 p_actor uuid,p_nonce uuid,p_business_date date
) returns table(report_id uuid,report_state text,report_revision integer,event_count integer)
language plpgsql security definer set search_path='' as $$
declare
 m record; e record; w record; v_kind text; v_key text;
 v_counts jsonb:=jsonb_build_object(
 'claims',0,'starts',0,'completions',0,'blocks',0,
 'approvalRequests',0,'externalWaits',0,'resumptions',0);
 v_count integer:=0; v_existing public.vox_staff_eod_reports_candidate_v1%rowtype;
 v_report uuid;
begin
 if p_actor is null or p_nonce is null or p_business_date is null or
  p_business_date<> (clock_timestamp() at time zone 'Asia/Kolkata')::date
 then raise exception 'VOX_EOD_CURRENT_IST_DAY_REQUIRED';end if;

 select mbr.team_id,teams.city_id,mbr.staff_role into m
 from public.vox_staff_memberships_v1 mbr
 join public.vox_staff_teams_v1 teams on teams.id=mbr.team_id
 join public.cities c on c.id=teams.city_id
 join public.profiles p on p.id=mbr.auth_user_id
 join auth.users u on u.id=p.id
 where mbr.auth_user_id=p_actor and mbr.is_active=true and mbr.revoked_at is null
  and mbr.expires_at>clock_timestamp()
  and mbr.staff_role in ('operations_manager','acquisition_agent','vendor_success_agent','support_agent')
  and teams.is_active=true and c.is_active=true
  and p.is_active=true and p.role is null
  and u.raw_app_meta_data->>'qf_principal'='vox_staff'
  and u.raw_app_meta_data->>'admin_role' is null;
 if not found then raise exception 'VOX_EOD_NEUTRAL_STAFF_DENIED';end if;

 select * into v_existing from public.vox_staff_eod_reports_candidate_v1
 where event_nonce=p_nonce;
 if found then
  if v_existing.staff_id=p_actor and v_existing.team_id=m.team_id and
   v_existing.city_id=m.city_id and v_existing.business_date=p_business_date
  then return query select v_existing.id,v_existing.state,v_existing.revision,v_existing.event_count;
   return;
  end if;
  raise exception 'VOX_EOD_NONCE_REPLAY_DENIED';
 end if;
 if exists (select 1 from public.vox_staff_eod_reports_candidate_v1
   where staff_id=p_actor and team_id=m.team_id and business_date=p_business_date)
 then raise exception 'VOX_EOD_ONE_PER_DAY';end if;

 for e in select ev.* from public.vox_work_events_candidate_v1 ev
   where ev.actor_id=p_actor
    and ev.created_at >= (p_business_date::timestamp at time zone 'Asia/Kolkata')
    and ev.created_at < ((p_business_date+1)::timestamp at time zone 'Asia/Kolkata')
   order by ev.created_at,ev.id limit 101
 loop
  v_count:=v_count+1;
  if v_count>100 then raise exception 'VOX_EOD_UNBOUNDED_EVENT_WINDOW';end if;
  select * into w from public.vox_work_items_candidate_v1
    where id=e.work_item_id and team_id=m.team_id and city_id=m.city_id;
  if not found or w.revision<e.to_revision or e.to_revision<>e.from_revision+1
  then raise exception 'VOX_EOD_STALE_OR_FOREIGN_WORK';end if;
  v_kind:=case w.source_kind when 'prospect' then 'acquisition'
    when 'vendor' then 'vendor_success'
    when 'support_thread' then 'service_support' else null end;
  -- A historical event is no longer reportable if its current Core department
  -- authorization or exact object grant has been revoked.
  if v_kind is null or not exists(
   select 1 from public.vox_staff_department_capabilities_v1 g
   join public.vox_staff_department_requests_v1 r on r.id=g.request_id
   join public.vox_staff_department_decisions_v1 d on d.request_id=r.id
   join public.vox_staff_department_activations_v1 x
    on x.request_id=r.id and x.capability_id=g.id
   join public.vox_staff_memberships_v1 tl on tl.auth_user_id=r.decided_by
   join public.vox_staff_teams_v1 tt on tt.id=tl.team_id
   join public.profiles reviewer on reviewer.id=r.decided_by
   join auth.users ru on ru.id=r.decided_by
   where g.auth_user_id=p_actor and g.team_id=m.team_id and g.city_id=m.city_id
    and g.department=v_kind and g.revoked_at is null and g.revision=2
    and g.expires_at>clock_timestamp() and r.state='APPROVED'
    and r.revision=1 and r.expires_at>clock_timestamp()
    and r.target_staff_id=p_actor and r.team_id=m.team_id and r.city_id=m.city_id
    and r.department=v_kind and r.decided_by<>r.requested_by
    and r.decided_by<>p_actor and d.reviewer_id=r.decided_by
    and d.decision='APPROVED' and d.decision_reference=r.decision_reference
    and x.activated_by=r.requested_by and g.granted_by=r.requested_by
    and reviewer.role is null and reviewer.is_active=true
    and ru.raw_app_meta_data->>'qf_principal'='vox_staff'
    and ru.raw_app_meta_data->>'vox_role'='team_leader'
    and ru.raw_app_meta_data->>'admin_role' is null
    and tl.staff_role='team_leader' and tl.is_active=true and tl.revoked_at is null
    and tl.expires_at>clock_timestamp() and tt.id=m.team_id and tt.is_active=true
    and tt.city_id=m.city_id
  ) then raise exception 'VOX_EOD_DEPARTMENT_REVOKED';end if;
  if not exists (select 1 from public.vox_staff_object_scopes_v1 s
    where s.auth_user_id=p_actor and s.scope_kind=w.source_kind and
     s.object_id=w.source_id and s.revoked_at is null and s.expires_at>clock_timestamp())
  then raise exception 'VOX_EOD_OBJECT_SCOPE_REVOKED';end if;
  if w.source_kind='prospect' and not exists(
    select 1 from public.aarohi_prospects p
    where p.id=w.source_id and p.city_id=m.city_id)
  then raise exception 'VOX_EOD_PROSPECT_CITY_DENIED';end if;
  if w.source_kind='vendor' and not exists(
    select 1 from public.vendors v join public.marketplace_service_zones z
     on z.id=v.service_zone_id
    where v.id=w.source_id and z.city_id=m.city_id and z.is_active)
  then raise exception 'VOX_EOD_VENDOR_ZONE_DENIED';end if;
  if w.source_kind='support_thread' then
   if not exists(select 1 from public.vox_staff_object_scopes_v1 s
     where s.auth_user_id=p_actor and s.scope_kind='vendor'
      and s.object_id=w.related_vendor_id and s.revoked_at is null
      and s.expires_at>clock_timestamp())
   or not exists(select 1 from public.vendor_support_threads t
     join public.vendors v on v.id=t.vendor_id
     join public.marketplace_service_zones z on z.id=v.service_zone_id
     where t.id=w.source_id and t.vendor_id=w.related_vendor_id
     and z.city_id=m.city_id and z.is_active)
   then raise exception 'VOX_EOD_SUPPORT_DUAL_SCOPE_DENIED';end if;
  end if;
  v_key:=case e.event_type
   when 'CLAIM' then 'claims' when 'START' then 'starts'
   when 'COMPLETE' then 'completions' when 'BLOCK' then 'blocks'
   when 'REQUEST_APPROVAL' then 'approvalRequests'
   when 'WAIT_EXTERNAL' then 'externalWaits'
   when 'RESUME' then 'resumptions' else null end;
  if v_key is null then raise exception 'VOX_EOD_UNKNOWN_WORK_EVENT';end if;
  v_counts:=jsonb_set(v_counts,array[v_key],to_jsonb(((v_counts->>v_key)::int)+1));
 end loop;

 insert into public.vox_staff_eod_reports_candidate_v1
 (event_nonce,staff_id,team_id,city_id,business_date,event_count,event_counts)
 values(p_nonce,p_actor,m.team_id,m.city_id,p_business_date,v_count,v_counts)
 returning id into v_report;
 return query select v_report,'PENDING_REVIEW'::text,0,v_count;
end;
$$;

create function public.qf_vox_eod_review_candidate_v1(
 p_actor uuid,p_report uuid,p_expected_revision integer,p_nonce uuid,p_decision text
) returns table(report_id uuid,report_state text,report_revision integer)
language plpgsql security definer set search_path='' as $$
declare r public.vox_staff_eod_reports_candidate_v1%rowtype;
begin
 if p_actor is null or p_report is null or p_nonce is null or
  p_expected_revision<>0 or p_decision not in ('ACKNOWLEDGED','REJECTED')
 then raise exception 'VOX_EOD_REVIEW_INVALID';end if;
 select * into r from public.vox_staff_eod_reports_candidate_v1
  where id=p_report for update;
 if not found then raise exception 'VOX_EOD_NOT_FOUND';end if;
 if r.state<>'PENDING_REVIEW' or r.revision<>0 or
  p_actor=r.staff_id
 then raise exception 'VOX_EOD_REVIEW_STALE_OR_SELF';end if;
 if not exists(
  select 1 from public.vox_staff_memberships_v1 m
  join public.vox_staff_teams_v1 t on t.id=m.team_id
  join public.cities c on c.id=t.city_id
  join public.profiles p on p.id=m.auth_user_id
  join auth.users a on a.id=p.id
  where m.auth_user_id=p_actor and m.staff_role='team_leader'
    and m.team_id=r.team_id and t.city_id=r.city_id
    and m.is_active and m.revoked_at is null and m.expires_at>clock_timestamp()
    and t.is_active and c.is_active and p.is_active and p.role is null
    and a.raw_app_meta_data->>'qf_principal'='vox_staff'
    and a.raw_app_meta_data->>'vox_role'='team_leader'
    and a.raw_app_meta_data->>'admin_role' is null
 ) then raise exception 'VOX_EOD_INDEPENDENT_TL_REQUIRED';end if;
 update public.vox_staff_eod_reports_candidate_v1 set
  state=p_decision,revision=1,reviewer_id=p_actor,
  review_nonce=p_nonce,reviewed_at=clock_timestamp()
 where id=r.id;
 insert into public.vox_staff_eod_review_events_candidate_v1
 (report_id,event_nonce,reviewer_id,staff_id,decision,expected_revision)
 values(r.id,p_nonce,p_actor,r.staff_id,p_decision,0);
 return query select r.id,p_decision,1;
end;
$$;
-- No authenticated/anon exposure. The Core HTTP layer must verify actual
-- Supabase AAL2 on both actors, then pass immutable verified user IDs here.
alter table public.vox_staff_eod_reports_candidate_v1 enable row level security;
alter table public.vox_staff_eod_reports_candidate_v1 force row level security;
alter table public.vox_staff_eod_review_events_candidate_v1 enable row level security;
alter table public.vox_staff_eod_review_events_candidate_v1 force row level security;
revoke all on public.vox_staff_eod_reports_candidate_v1,
 public.vox_staff_eod_review_events_candidate_v1 from public,anon,authenticated;
grant select on public.vox_staff_eod_reports_candidate_v1 to service_role;
grant select on public.vox_staff_eod_review_events_candidate_v1 to service_role;
revoke all on function public.qf_vox_eod_submit_candidate_v1(uuid,uuid,date)
 from public,anon,authenticated;
grant execute on function public.qf_vox_eod_submit_candidate_v1(uuid,uuid,date)
 to service_role;
revoke all on function public.qf_vox_eod_review_candidate_v1(uuid,uuid,integer,uuid,text)
 from public,anon,authenticated;
grant execute on function public.qf_vox_eod_review_candidate_v1(uuid,uuid,integer,uuid,text)
 to service_role;
revoke all on function public.qf_vox_eod_immutability_candidate_v1()
 from public,anon,authenticated;
commit;
