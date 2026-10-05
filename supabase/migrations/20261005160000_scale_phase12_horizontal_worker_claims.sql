-- SCALE-P12: horizontal communication/Jarvis worker claims.
--
-- Correctness goals:
--   * one claimed item per conversation per durable lane across all replicas;
--   * strict head-of-line ordering inside a conversation;
--   * SKIP LOCKED concurrency across unrelated conversations;
--   * feature-lane filtering before a Jarvis turn is claimed.
--
-- These functions own only queue lifecycle. Conversation, consent, provider,
-- human-takeover and business authority remain in the existing Core services.

do $preflight$
begin
  if exists (
    select conversation_id
      from public.communication_conversation_outbox
     where status = 'claimed'
     group by conversation_id
    having count(*) > 1
  ) then
    raise exception
      'SCALE-P12 refused: multiple claimed conversational outbox rows exist for one conversation'
      using errcode = 'integrity_constraint_violation';
  end if;

  if exists (
    select conversation_id
      from public.communication_jarvis_turn_outbox
     where status = 'claimed'
     group by conversation_id
    having count(*) > 1
  ) then
    raise exception
      'SCALE-P12 refused: multiple claimed Jarvis turns exist for one conversation'
      using errcode = 'integrity_constraint_violation';
  end if;
end
$preflight$;

create unique index if not exists communication_conversation_outbox_one_claim_per_conversation
  on public.communication_conversation_outbox(conversation_id)
  where status = 'claimed';

create index if not exists communication_conversation_outbox_conversation_order_idx
  on public.communication_conversation_outbox(conversation_id, created_at, id)
  where status in ('pending', 'claimed');

create unique index if not exists communication_jarvis_turn_outbox_one_claim_per_conversation
  on public.communication_jarvis_turn_outbox(conversation_id)
  where status = 'claimed';

create index if not exists communication_jarvis_turn_outbox_conversation_order_idx
  on public.communication_jarvis_turn_outbox(conversation_id, created_at, id)
  where status in ('pending', 'retry_scheduled', 'claimed');

create or replace function public.qf_claim_conversation_outbox_v1()
returns setof public.communication_conversation_outbox
language sql
security definer
set search_path = pg_catalog, public
as $$
  with candidate as (
    select work.id
      from public.communication_conversation_outbox as work
     where work.status = 'pending'
       and not exists (
         select 1
           from public.communication_conversation_outbox as prior
          where prior.conversation_id = work.conversation_id
            and (
              prior.status = 'claimed'
              or (
                prior.status = 'pending'
                and row(prior.created_at, prior.id) < row(work.created_at, work.id)
              )
            )
       )
     order by work.created_at, work.id
     for update of work skip locked
     limit 1
  )
  update public.communication_conversation_outbox as work
     set status = 'claimed',
         claimed_at = clock_timestamp(),
         updated_at = clock_timestamp()
    from candidate
   where work.id = candidate.id
     and work.status = 'pending'
  returning work.*;
$$;

comment on function public.qf_claim_conversation_outbox_v1() is
  'SCALE-P12 atomic horizontal-worker claim. Serializes each conversation while SKIP LOCKED allows unrelated conversations to run concurrently.';

revoke all on function public.qf_claim_conversation_outbox_v1() from public, anon, authenticated;
grant execute on function public.qf_claim_conversation_outbox_v1() to service_role;

create or replace function public.qf_claim_jarvis_turn_outbox_v1(
  p_allow_conversation boolean,
  p_allow_qualification boolean
)
returns setof public.communication_jarvis_turn_outbox
language sql
security definer
set search_path = pg_catalog, public
as $$
  with candidate as (
    select work.id
      from public.communication_jarvis_turn_outbox as work
     where work.status in ('pending', 'retry_scheduled')
       and (work.next_retry_at is null or work.next_retry_at <= clock_timestamp())
       and (
         (p_allow_conversation and work.turn_purpose = 'conversation')
         or
         (p_allow_qualification and work.turn_purpose = 'lead_qualification')
       )
       and not exists (
         select 1
           from public.communication_jarvis_turn_outbox as prior
          where prior.conversation_id = work.conversation_id
            and (
              prior.status = 'claimed'
              or (
                prior.status in ('pending', 'retry_scheduled')
                and row(prior.created_at, prior.id) < row(work.created_at, work.id)
              )
            )
       )
     order by work.created_at, work.id
     for update of work skip locked
     limit 1
  )
  update public.communication_jarvis_turn_outbox as work
     set status = 'claimed',
         claimed_at = clock_timestamp(),
         updated_at = clock_timestamp()
    from candidate
   where work.id = candidate.id
     and work.status in ('pending', 'retry_scheduled')
  returning work.*;
$$;

comment on function public.qf_claim_jarvis_turn_outbox_v1(boolean, boolean) is
  'SCALE-P12 atomic Jarvis turn claim. Feature filters run before claim and earlier turns block later turns in the same conversation across replicas.';

revoke all on function public.qf_claim_jarvis_turn_outbox_v1(boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.qf_claim_jarvis_turn_outbox_v1(boolean, boolean)
  to service_role;
