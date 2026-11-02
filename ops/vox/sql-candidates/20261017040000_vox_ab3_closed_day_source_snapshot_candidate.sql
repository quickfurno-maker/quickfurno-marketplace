-- AB-3B deterministic four-source source-window checkpoint.
-- Candidate only, dependencies from F1 uninstalled SQL. Does NOT certify
-- watermarks cryptographically; Core must verify signed writer externally.
begin;
create extension if not exists pgcrypto;
create table public.vox_ab3_staff_source_snapshots_candidate_v1 (
 source text not null check(source in (
  'CORE_WORK_LEDGER','CRM_AAROHI','SUPPORT_DESK','CORE_CONVERSATION')),
 actor_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 business_date date not null,
 event_count integer not null check(event_count>=0),
 event_checksum text not null check(event_checksum~'^[a-f0-9]{64}$'),
 watermark_signature text not null check(watermark_signature~'^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(source,actor_id,team_id,city_id,business_date)
);
create or replace function public.qf_vox_ab3_source_snapshot_validate_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_signed record;v_count bigint;v_hash text;v_start timestamptz;v_end timestamptz;
begin
 v_start:=new.business_date::timestamp at time zone 'Asia/Kolkata';
 v_end:=(new.business_date+1)::timestamp at time zone 'Asia/Kolkata';
 if v_end>clock_timestamp() then
  raise exception 'VOX_AB3_DAY_NOT_CLOSED';
 end if;
 select w.event_checksum,w.signature,w.cursor_start,w.cursor_end,
  w.signed_at into v_signed
 from public.vox_staff_source_watermarks_candidate_v1 w
 where w.source=new.source and w.actor_id=new.actor_id and
 w.team_id=new.team_id and w.city_id=new.city_id and
 w.business_date=new.business_date;
 if not found or v_signed.cursor_start>v_start or
  v_signed.cursor_end<v_end or v_signed.signed_at<v_end then
  raise exception 'VOX_AB3_CANONICAL_WATERMARK_MISSING';
 end if;
 select count(*),encode(public.digest(coalesce(string_agg(
  e.source_event_id::text||':'||e.revision::text,','
   order by e.source_event_id::text,e.revision),''),'sha256'),'hex')
 into v_count,v_hash
 from public.vox_staff_source_events_candidate_v1 e
 where e.source=new.source and e.actor_id=new.actor_id and
 e.team_id=new.team_id and e.city_id=new.city_id and
 e.occurred_at>=v_start and e.occurred_at<v_end;
 if v_count<>new.event_count or v_hash<>new.event_checksum
  or v_signed.event_checksum<>new.event_checksum
  or v_signed.signature<>new.watermark_signature then
  raise exception 'VOX_AB3_SOURCE_SNAPSHOT_MISMATCH';
 end if;
 return new;
end;
$$;
create trigger qf_vox_ab3_source_snapshot_exact_v1 before insert on
 public.vox_ab3_staff_source_snapshots_candidate_v1 for each row
 execute function public.qf_vox_ab3_source_snapshot_validate_candidate_v1();
create trigger qf_vox_ab3_source_snapshot_immutable_v1 before update or delete on
 public.vox_ab3_staff_source_snapshots_candidate_v1 for each row
 execute function public.qf_vox_f1_immutable_audit_candidate_v1();
alter table public.vox_ab3_staff_source_snapshots_candidate_v1 enable row level security;
alter table public.vox_ab3_staff_source_snapshots_candidate_v1 force row level security;
revoke all on public.vox_ab3_staff_source_snapshots_candidate_v1 from
 public,anon,authenticated;
grant select,insert on public.vox_ab3_staff_source_snapshots_candidate_v1 to service_role;
revoke all on function public.qf_vox_ab3_source_snapshot_validate_candidate_v1()
 from public,anon,authenticated;
commit;
