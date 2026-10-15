-- VOX TO-02E candidate ONLY: DO NOT apply to managed Supabase staging/production.
-- Core must remotely verify Supabase bearer AAL2 BEFORE passing p_actor.
-- Independent DBA/security review + historical migration parity + rollback required.
begin;
create table public.vox_work_items_candidate_v1 (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.vox_staff_teams_v1(id),
 city_id uuid not null references public.cities(id),
 source_kind text not null check(source_kind in ('prospect','vendor','support_thread')),
 source_id uuid not null,
 related_vendor_id uuid,
 state text not null default 'NEW' check(state in
 ('NEW','ASSIGNED','IN_PROGRESS','WAITING_EXTERNAL','WAITING_APPROVAL','BLOCKED','DONE')),
 assignee_id uuid references public.vox_staff_memberships_v1(auth_user_id),
 revision integer not null default 0 check(revision>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint vox_work_support_vendor_proof check
 (source_kind<>'support_thread' or related_vendor_id is not null)
);
create index vox_work_city_team_state_idx on public.vox_work_items_candidate_v1(team_id,city_id,state,created_at);
create table public.vox_work_events_candidate_v1(
 id uuid primary key default gen_random_uuid(),
 work_item_id uuid not null references public.vox_work_items_candidate_v1(id),
 actor_id uuid not null references public.profiles(id),
 event_nonce uuid not null unique,
 event_type text not null,
 from_state text not null,
 to_state text not null,
 from_revision integer not null,
 to_revision integer not null,
 reason text not null,
 created_at timestamptz not null default now(),
 unique(work_item_id,to_revision)
);
alter table public.vox_work_items_candidate_v1 enable row level security;
alter table public.vox_work_items_candidate_v1 force row level security;
alter table public.vox_work_events_candidate_v1 enable row level security;
alter table public.vox_work_events_candidate_v1 force row level security;
revoke all on public.vox_work_items_candidate_v1,public.vox_work_events_candidate_v1 from public,anon,authenticated;
grant select,insert,update on public.vox_work_items_candidate_v1 to service_role;
grant select,insert on public.vox_work_events_candidate_v1 to service_role;

create or replace function public.qf_vox_work_transition_candidate_v1(
 p_actor uuid,p_item uuid,p_expected_revision integer,p_nonce uuid,
 p_action text,p_reason text
) returns table(work_item_id uuid,new_state text,new_revision integer)
language plpgsql security definer set search_path='' as $$
declare w public.vox_work_items_candidate_v1%rowtype;
 v_pack text; v_next text; v_from text; v_reason text;
begin
 if p_actor is null or p_item is null or p_nonce is null or p_expected_revision is null or
   p_expected_revision<0 or p_action not in
   ('CLAIM','START','WAIT_EXTERNAL','REQUEST_APPROVAL','BLOCK','RESUME','COMPLETE') or
   p_reason is null or length(p_reason)>300 or p_reason<>btrim(p_reason)
 then raise exception 'VOX_WORK_BAD_COMMAND' using errcode='P0001'; end if;
 v_reason:=p_reason;
 if p_action in ('BLOCK','REQUEST_APPROVAL','COMPLETE') and length(v_reason)<12
 then raise exception 'VOX_WORK_REASON_REQUIRED' using errcode='P0001'; end if;
 if p_action='CLAIM' and length(v_reason)<>0
 then raise exception 'VOX_WORK_CLAIM_REASON_FORBIDDEN' using errcode='P0001'; end if;
 -- Row lock serializes all revisions; nonce and (work_item_id,to_revision)
 -- jointly reject duplicate/multiple accepted transitions on retries.
 select * into w from public.vox_work_items_candidate_v1
  where id=p_item for update;
 if not found or w.revision<>p_expected_revision
 then raise exception 'VOX_WORK_STALE' using errcode='P0001'; end if;
 -- Verified current Core neutral staff; no owner/admin RLS identity.
 if not exists(
  select 1 from public.profiles p join auth.users a on a.id=p.id
  join public.vox_staff_memberships_v1 m on m.auth_user_id=p.id
  join public.vox_staff_teams_v1 t on t.id=m.team_id
  join public.cities c on c.id=t.city_id
  where p.id=p_actor and p.role is null and p.is_active=true
   and a.raw_app_meta_data->>'qf_principal'='vox_staff'
   and a.raw_app_meta_data->>'admin_role' is null
   and m.staff_role not in ('team_leader','auditor')
   and m.is_active=true and m.revoked_at is null and m.expires_at>now()
   and t.is_active=true and c.is_active=true
   and m.team_id=w.team_id and t.city_id=w.city_id
 ) then raise exception 'VOX_WORK_ACTOR_OR_CITY_DENIED' using errcode='P0001'; end if;
 -- Capabilities never replace exact source-object grants; both are required.
 v_pack:=case w.source_kind
  when 'prospect' then 'acquisition'
  when 'vendor' then 'vendor_success'
  when 'support_thread' then 'service_support'
 end;
 if not exists(
  select 1 from public.vox_staff_department_capabilities_v1 g
  join public.vox_staff_department_requests_v1 r on r.id=g.request_id
  join public.vox_staff_department_decisions_v1 d on d.request_id=r.id
  join public.vox_staff_department_activations_v1 x
   on x.request_id=r.id and x.capability_id=g.id
  join public.profiles reviewer on reviewer.id=r.decided_by
  join auth.users auth_reviewer on auth_reviewer.id=reviewer.id
  join public.vox_staff_memberships_v1 tl on tl.auth_user_id=reviewer.id
  join public.vox_staff_teams_v1 reviewer_team on reviewer_team.id=tl.team_id
  where g.auth_user_id=p_actor and g.team_id=w.team_id
   and g.city_id=w.city_id and g.department=v_pack
   and g.revoked_at is null and g.revision=2 and g.expires_at>now()
   and r.state='APPROVED' and r.revision=1 and r.expires_at>now()
   and r.target_staff_id=p_actor and r.team_id=w.team_id
   and r.city_id=w.city_id and r.department=v_pack
   and r.decided_by<>r.requested_by and r.decided_by<>r.target_staff_id
   and d.reviewer_id=r.decided_by and d.decision='APPROVED'
   and d.decision_reference=r.decision_reference
   and x.activated_by=r.requested_by and g.granted_by=r.requested_by
   and reviewer.role is null and reviewer.is_active=true
   and auth_reviewer.raw_app_meta_data->>'qf_principal'='vox_staff'
   and auth_reviewer.raw_app_meta_data->>'vox_role'='team_leader'
   and auth_reviewer.raw_app_meta_data->>'admin_role' is null
   and tl.staff_role='team_leader' and tl.is_active=true
   and tl.revoked_at is null and tl.expires_at>now()
   and reviewer_team.id=r.team_id and reviewer_team.is_active=true
   and reviewer_team.city_id=r.city_id
 ) then raise exception 'VOX_WORK_DEPARTMENT_NOT_REVIEWED' using errcode='P0001'; end if;
 if not exists(select 1 from public.vox_staff_object_scopes_v1 s
   where s.auth_user_id=p_actor and s.scope_kind=w.source_kind
   and s.object_id=w.source_id and s.revoked_at is null
   and s.expires_at>now())
 then raise exception 'VOX_WORK_SUBJECT_GRANT_DENIED' using errcode='P0001'; end if;
 if w.source_kind='support_thread' and not exists(
  select 1 from public.vox_staff_object_scopes_v1 s
   where s.auth_user_id=p_actor and s.scope_kind='vendor'
   and s.object_id=w.related_vendor_id and s.revoked_at is null
   and s.expires_at>now())
 then raise exception 'VOX_WORK_VENDOR_DUAL_GRANT_REQUIRED' using errcode='P0001'; end if;
 v_from:=w.state;
 v_next:=case
  when p_action='CLAIM' and w.state='NEW' and w.assignee_id is null then 'ASSIGNED'
  when p_action='START' and w.state='ASSIGNED' and w.assignee_id=p_actor then 'IN_PROGRESS'
  when p_action='WAIT_EXTERNAL' and w.state='IN_PROGRESS' and w.assignee_id=p_actor then 'WAITING_EXTERNAL'
  when p_action='REQUEST_APPROVAL' and w.state in ('IN_PROGRESS','BLOCKED')
   and w.assignee_id=p_actor then 'WAITING_APPROVAL'
  when p_action='BLOCK' and w.state in ('ASSIGNED','IN_PROGRESS')
   and w.assignee_id=p_actor then 'BLOCKED'
  when p_action='RESUME' and w.state in ('WAITING_EXTERNAL','BLOCKED')
   and w.assignee_id=p_actor then 'IN_PROGRESS'
  when p_action='COMPLETE' and w.state='IN_PROGRESS' and w.assignee_id=p_actor then 'DONE'
  else null end;
 if v_next is null then raise exception 'VOX_WORK_TRANSITION_DENIED' using errcode='P0001'; end if;
 update public.vox_work_items_candidate_v1
 set state=v_next,assignee_id=case when p_action='CLAIM' then p_actor else assignee_id end,
  revision=w.revision+1,updated_at=now()
 where id=w.id;
 insert into public.vox_work_events_candidate_v1(work_item_id,actor_id,event_nonce,
   event_type,from_state,to_state,from_revision,to_revision,reason)
 values(w.id,p_actor,p_nonce,p_action,v_from,v_next,w.revision,w.revision+1,v_reason);
 return query select w.id,v_next,w.revision+1;
end;
$$;
revoke all on function public.qf_vox_work_transition_candidate_v1(uuid,uuid,integer,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.qf_vox_work_transition_candidate_v1(uuid,uuid,integer,uuid,text,text)
 to service_role;
commit;
