-- AB7H signed Jarvis operator command -> Core native conversation atomic bridge.
-- UNINSTALLED. Exact signed command receipt and independent human approval
-- attestations are required. Neither Jarvis nor service_role can CREATE approval.
-- PAUSE and TAKEOVER stop AI; no resume or external messages.
begin;
create table public.vox_ab7h_operator_review_candidate_v1(
 command_id uuid primary key references
  public.jarvis_os_operator_command_receipts(command_id) on delete restrict,
 conversation_id uuid not null references
  public.communication_conversations(id) on delete restrict,
 owner_id uuid not null references public.profiles(id) on delete restrict,
 reviewer_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 action text not null check(action in ('CONVERSATION_PAUSE_AI','CONVERSATION_TAKEOVER')),
 request_digest text not null check(request_digest~'^[a-f0-9]{64}$'),
 verified_operator_label text not null check(
  verified_operator_label~'^jarvis-os:[A-Za-z0-9._:-]{1,64}$'),
 verified_signature_sha256 text not null check(verified_signature_sha256~'^[a-f0-9]{64}$'),
 expires_at timestamptz not null,
 reviewed_at timestamptz not null default clock_timestamp(),
 constraint ab7h_distinct_review check(owner_id<>reviewer_id),
 constraint ab7h_short_review check(expires_at>reviewed_at and
   expires_at<=reviewed_at+interval '10 minutes')
);
create table public.vox_ab7h_operator_atomic_receipts_candidate_v1(
 command_id uuid primary key references public.jarvis_os_operator_command_receipts(command_id)
  on delete restrict,
 conversation_id uuid not null references public.communication_conversations(id)
  on delete restrict,
 event_id uuid not null unique references public.communication_conversation_events(id)
  on delete restrict,
 revision bigint not null check(revision>=1),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.vox_ab7h_operator_review_candidate_v1 enable row level security;
alter table public.vox_ab7h_operator_review_candidate_v1 force row level security;
alter table public.vox_ab7h_operator_atomic_receipts_candidate_v1 enable row level security;
alter table public.vox_ab7h_operator_atomic_receipts_candidate_v1 force row level security;
revoke all on public.vox_ab7h_operator_review_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7h_operator_atomic_receipts_candidate_v1
 from public,anon,authenticated,service_role;
grant select on public.vox_ab7h_operator_review_candidate_v1 to service_role;
grant select on public.vox_ab7h_operator_atomic_receipts_candidate_v1 to service_role;
create function public.qf_vox_ab7h_signed_operator_atomic_candidate_v1(
 p_command uuid,p_digest text,p_conversation uuid,p_revision bigint,
 p_action text,p_operator_label text
) returns table(event_id uuid,new_revision bigint,new_state text,command_id uuid)
language plpgsql security definer set search_path='' as $$
declare r record; a record; c record; v_event uuid;v_new_rev bigint;
begin
 if p_command is null or p_conversation is null or
  p_digest !~ '^[a-f0-9]{64}$' or p_revision is null or p_revision<0 or
  p_action not in ('CONVERSATION_PAUSE_AI','CONVERSATION_TAKEOVER') or
  p_operator_label !~ '^jarvis-os:[A-Za-z0-9._:-]{1,64}$'
 then raise exception 'AB7H_COMMAND_INPUT_INVALID';end if;
 select q.command_id,q.request_digest,q.action,q.state into r
 from public.jarvis_os_operator_command_receipts q
 where q.command_id=p_command for update;
 if not found or r.request_digest<>p_digest or r.action<>p_action or
  r.state<>'CLAIMED' then raise exception 'AB7H_SIGNED_RECEIPT_MISSING';end if;
 select owner_id,reviewer_id,action,request_digest,conversation_id,
   verified_operator_label,verified_signature_sha256,expires_at into a
 from public.vox_ab7h_operator_review_candidate_v1 approved
 where approved.command_id=p_command for update;
 if not found or a.action<>p_action or a.request_digest<>p_digest or
  a.conversation_id<>p_conversation or
  a.verified_operator_label<>p_operator_label or
  a.expires_at<=clock_timestamp() then
  raise exception 'AB7H_INDEPENDENT_SIGNED_REVIEW_REQUIRED';end if;
 if not exists(select 1 from public.profiles p
  where p.id=a.owner_id and p.role='admin' and p.is_active=true) or
 not exists(select 1 from public.vox_staff_memberships_v1 m
  join public.profiles p on p.id=m.auth_user_id
  where m.auth_user_id=a.reviewer_id and m.staff_role='team_leader'
  and m.is_active=true and m.revoked_at is null
  and m.expires_at>clock_timestamp() and p.is_active=true and p.role is null)
 then raise exception 'AB7H_CURRENT_OWNER_TEAM_LEADER_REQUIRED';end if;
 select cv.id,cv.tenant_id,cv.state,cv.assigned_actor,
  cv.human_takeover,cv.revision into c
 from public.communication_conversations cv
 where cv.id=p_conversation for update;
 if not found or c.tenant_id<>'quickfurno' or c.revision<>p_revision
  or c.human_takeover is distinct from false
  or c.assigned_actor not in ('RIYA','ANISHA','AAROHI')
  or (p_action='CONVERSATION_PAUSE_AI' and c.state<>'OPEN')
  or (p_action='CONVERSATION_TAKEOVER' and c.state not in ('OPEN','PAUSED'))
 then raise exception 'AB7H_CONVERSATION_STALE';end if;
 v_new_rev:=p_revision+1;
 update public.communication_conversations cv set
  state=case when p_action='CONVERSATION_TAKEOVER' then 'HUMAN' else 'PAUSED' end,
  assigned_actor=case when p_action='CONVERSATION_TAKEOVER' then 'HUMAN' else cv.assigned_actor end,
  human_takeover=(p_action='CONVERSATION_TAKEOVER'),
  jarvis_enabled=false,revision=v_new_rev,updated_at=clock_timestamp()
 where cv.id=p_conversation and cv.revision=p_revision;
 insert into public.communication_conversation_events(
  conversation_id,event_type,actor_type,safe_summary,event_data)
 values(p_conversation,
  case when p_action='CONVERSATION_TAKEOVER' then 'human.takeover_started'
  else 'ai.paused_by_operator' end,'HUMAN',
  'Verified signed operator command with independent Core review',
  jsonb_build_object('commandId',p_command,'operator',p_operator_label,
   'revision',v_new_rev))
 returning id into v_event;
 insert into public.vox_ab7h_operator_atomic_receipts_candidate_v1
 (command_id,conversation_id,event_id,revision)
 values(p_command,p_conversation,v_event,v_new_rev);
 return query select v_event,v_new_rev,
  case when p_action='CONVERSATION_TAKEOVER' then 'HUMAN' else 'PAUSED' end,
  p_command;
end;
$$;
revoke all on function public.qf_vox_ab7h_signed_operator_atomic_candidate_v1(
 uuid,text,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.qf_vox_ab7h_signed_operator_atomic_candidate_v1(
 uuid,text,uuid,bigint,text,text) to service_role;
commit;
