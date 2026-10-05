begin;

alter table public.communication_jarvis_turn_outbox
  add column if not exists traceparent text,
  add column if not exists tracestate text;

alter table public.communication_conversation_outbox
  add column if not exists traceparent text,
  add column if not exists tracestate text;

alter table public.communication_jarvis_turn_outbox
  drop constraint if exists communication_jarvis_turn_outbox_traceparent_chk,
  drop constraint if exists communication_jarvis_turn_outbox_tracestate_chk,
  add constraint communication_jarvis_turn_outbox_traceparent_chk check (
    traceparent is null or (
      traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'
      and substr(traceparent,4,32) <> repeat('0',32)
      and substr(traceparent,37,16) <> repeat('0',16)
    )
  ),
  add constraint communication_jarvis_turn_outbox_tracestate_chk check (
    tracestate is null or (
      octet_length(tracestate) between 1 and 512
      and tracestate !~ E'[\\r\\n]'
    )
  );

alter table public.communication_conversation_outbox
  drop constraint if exists communication_conversation_outbox_traceparent_chk,
  drop constraint if exists communication_conversation_outbox_tracestate_chk,
  add constraint communication_conversation_outbox_traceparent_chk check (
    traceparent is null or (
      traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'
      and substr(traceparent,4,32) <> repeat('0',32)
      and substr(traceparent,37,16) <> repeat('0',16)
    )
  ),
  add constraint communication_conversation_outbox_tracestate_chk check (
    tracestate is null or (
      octet_length(tracestate) between 1 and 512
      and tracestate !~ E'[\\r\\n]'
    )
  );

comment on column public.communication_jarvis_turn_outbox.traceparent is
  'SCALE-P14 W3C trace context only. No business/customer data; resumes observability across durable Jarvis dispatch.';
comment on column public.communication_conversation_outbox.traceparent is
  'SCALE-P14 W3C trace context only. No business/customer data; resumes observability across durable provider delivery.';

commit;
