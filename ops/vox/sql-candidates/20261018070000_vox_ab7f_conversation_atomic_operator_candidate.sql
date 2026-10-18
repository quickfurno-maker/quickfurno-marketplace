-- AB7F real native Core conversation state/event atomicity candidate.
-- UNINSTALLED. Signed Jarvis command, active Owner AAL2 and nonce authority
-- must be verified by trusted Core endpoint BEFORE privileged RPC call.
-- Only human take-over or pause; NEVER resume/send/opt-in.
begin;
create table public.vox_ab7f_conversation_operator_receipts_candidate_v1(
 nonce uuid primary key,
 conversation_id uuid not null references public.communication_conversations(id) on delete restrict,
 operator_id uuid not null references public.profiles(id) on delete restrict,
 action text not null check(action in ('PAUSE_AI','TAKEOVER')),
 event_id uuid not null unique references public.communication_conversation_events(id) on delete restrict,
 revision bigint not null check(revision>=1),
 occurred_at timestamptz not null default clock_timestamp()
);
alter table public.vox_ab7f_conversation_operator_receipts_candidate_v1 enable row level security;
alter table public.vox_ab7f_conversation_operator_receipts_candidate_v1 force row level security;
revoke all on public.vox_ab7f_conversation_operator_receipts_candidate_v1 from public,anon,authenticated;
grant select on public.vox_ab7f_conversation_operator_receipts_candidate_v1 to service_role;
create function public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1(
 p_conversation uuid,p_revision bigint,p_operator uuid,p_nonce uuid,p_action text
) returns table(event_id uuid,revision bigint,new_state text,receipt_nonce uuid)
language plpgsql security definer set search_path='' as $$
declare c record; v_event uuid;v_revision bigint;
begin
 if p_conversation is null or p_operator is null or p_nonce is null or
   p_revision is null or p_revision<0 or
   p_action not in ('PAUSE_AI','TAKEOVER') then
  raise exception 'AB7F_INVALID_OPERATOR_INPUT';
 end if;
 if not exists(select 1 from public.profiles p where p.id=p_operator
   and p.role='admin' and p.is_active=true) then
  raise exception 'AB7F_CURRENT_CORE_OWNER_REQUIRED';
 end if;
 select id,tenant_id,state,assigned_actor,human_takeover,revision
   into c from public.communication_conversations
   where id=p_conversation for update;
 if not found or c.tenant_id<>'quickfurno' or
   c.revision<>p_revision or c.human_takeover is distinct from false or
   c.assigned_actor not in ('RIYA','ANISHA','AAROHI') or
   (p_action='PAUSE_AI' and c.state<>'OPEN') or
   (p_action='TAKEOVER' and c.state not in ('OPEN','PAUSED')) then
  raise exception 'AB7F_STALE_OR_FORBIDDEN_CONVERSATION';
 end if;
 v_revision:=p_revision+1;
 update public.communication_conversations set
   state=case when p_action='TAKEOVER' then 'HUMAN' else 'PAUSED' end,
   assigned_actor=case when p_action='TAKEOVER' then 'HUMAN' else assigned_actor end,
   human_takeover=(p_action='TAKEOVER'),
   jarvis_enabled=false,revision=v_revision,updated_at=clock_timestamp()
   where id=p_conversation and revision=p_revision;
 insert into public.communication_conversation_events(
   conversation_id,event_type,actor_type,safe_summary,event_data
 ) values(p_conversation,
   case when p_action='TAKEOVER' then 'human.takeover_started'
    else 'ai.paused_by_operator' end,
   'HUMAN','Core atomic operator control; no provider message',
   jsonb_build_object('operatorUserId',p_operator,'revision',v_revision))
 returning id into v_event;
 insert into public.vox_ab7f_conversation_operator_receipts_candidate_v1(
   nonce,conversation_id,operator_id,action,event_id,revision)
 values(p_nonce,p_conversation,p_operator,p_action,v_event,v_revision);
 return query select v_event,v_revision,
   case when p_action='TAKEOVER' then 'HUMAN' else 'PAUSED' end,p_nonce;
end;
$$;
revoke all on function public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1(
 uuid,bigint,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1(
 uuid,bigint,uuid,uuid,text) to service_role;
commit;
