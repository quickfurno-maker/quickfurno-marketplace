-- F1 canonical immutable per-source EOD record inventory. CANDIDATE ONLY.
-- NEVER deploy until independent DBA migration/recovery + AppSec attestations.
-- This file is deliberately OUTSIDE supabase/migrations and changes NO live DB.
-- All legacy Aarohi/support/communication activity MUST be recorded by an
-- independently reviewed Core actor-verifying writer; there is no free-text
-- migration or backfill which could invent historical Staff attribution.
begin;
create table public.vox_staff_source_events_candidate_v1 (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in
  ('CORE_WORK_LEDGER','CRM_AAROHI','SUPPORT_DESK','CORE_CONVERSATION')),
 source_event_id uuid not null,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 object_id uuid not null,
 revision integer not null check(revision>=0),
 event_kind text not null check(event_kind ~ '^[A-Z_]{3,32}$'),
 occurred_at timestamptz not null,
 subject_kind text not null check(subject_kind in
  ('prospect','vendor','support_thread','conversation')),
 subject_id uuid not null,
 recorded_at timestamptz not null default clock_timestamp(),
 constraint vox_f1_unique_source_event unique(source,source_event_id),
 constraint vox_f1_one_action_revision unique(source,object_id,revision),
 constraint vox_f1_kind_matches_source check(
  (source='CRM_AAROHI' and subject_kind='prospect') or
  (source='SUPPORT_DESK' and subject_kind='support_thread') or
  (source='CORE_CONVERSATION' and subject_kind='conversation') or
  (source='CORE_WORK_LEDGER' and subject_kind in
    ('prospect','vendor','support_thread'))
 )
);
create index vox_f1_source_actor_window on
 public.vox_staff_source_events_candidate_v1(actor_id,team_id,city_id,occurred_at);
create table public.vox_staff_source_watermarks_candidate_v1 (
 source text not null check(source in
  ('CORE_WORK_LEDGER','CRM_AAROHI','SUPPORT_DESK','CORE_CONVERSATION')),
 actor_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 business_date date not null,
 cursor_start timestamptz not null,
 cursor_end timestamptz not null,
 event_checksum text not null check(event_checksum ~ '^[a-f0-9]{64}$'),
 signed_at timestamptz not null,
 signature text not null check(signature ~ '^[a-f0-9]{64}$'),
 constraint vox_f1_one_watermark_per_day primary key
  (source,actor_id,team_id,city_id,business_date),
 constraint vox_f1_watermark_covers_closed_ist_day check(
  cursor_start<=(business_date::timestamp at time zone 'Asia/Kolkata') and
  cursor_end>=((business_date+1)::timestamp at time zone 'Asia/Kolkata') and
  signed_at>=cursor_end
 )
);
create or replace function public.qf_vox_f1_immutable_audit_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'VOX_F1_APPEND_ONLY' using errcode='P0001';
end;
$$;
create trigger vox_f1_no_event_mutation before update or delete
 on public.vox_staff_source_events_candidate_v1 for each row
 execute function public.qf_vox_f1_immutable_audit_candidate_v1();
-- An unexpired watermark may be superseded only by a dedicated, audited
-- correction protocol. No UPDATE/DELETE grants, including to service_role.
create trigger vox_f1_no_watermark_mutation before update or delete
 on public.vox_staff_source_watermarks_candidate_v1 for each row
 execute function public.qf_vox_f1_immutable_audit_candidate_v1();
alter table public.vox_staff_source_events_candidate_v1 enable row level security;
alter table public.vox_staff_source_events_candidate_v1 force row level security;
alter table public.vox_staff_source_watermarks_candidate_v1 enable row level security;
alter table public.vox_staff_source_watermarks_candidate_v1 force row level security;
revoke all on public.vox_staff_source_events_candidate_v1,
 public.vox_staff_source_watermarks_candidate_v1 from PUBLIC,anon,authenticated;
grant select,insert on public.vox_staff_source_events_candidate_v1,
 public.vox_staff_source_watermarks_candidate_v1 to service_role;
revoke all on function public.qf_vox_f1_immutable_audit_candidate_v1()
 from PUBLIC,anon,authenticated;
commit;
