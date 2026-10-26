-- AB7F genuine four-source closed-day Core EOD submission candidate.
-- UNINSTALLED. External Core must verify pinned Ed25519 source signatures,
-- independent TL AAL2 and exact signed attestation before calling.
-- No approval/official publication without separate Owner release.
begin;
create extension if not exists pgcrypto;
create table public.vox_ab7f_four_source_eod_candidate_v1(
 id uuid primary key default gen_random_uuid(),
 nonce uuid not null unique,
 staff_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 reviewer_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 business_date date not null,
 source_count integer not null check(source_count=4),
 source_digest text not null check(source_digest~'^[a-f0-9]{64}$'),
 state text not null default 'TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE'
  check(state='TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE'),
 published boolean not null default false check(published=false),
 recorded_at timestamptz not null default clock_timestamp(),
 constraint ab7f_eod_distinct_reviewer check(staff_id<>reviewer_id),
 constraint ab7f_eod_unique_staff_day unique(staff_id,team_id,business_date)
);
alter table public.vox_ab7f_four_source_eod_candidate_v1 enable row level security;
alter table public.vox_ab7f_four_source_eod_candidate_v1 force row level security;
revoke all on public.vox_ab7f_four_source_eod_candidate_v1 from public,anon,authenticated;
grant select on public.vox_ab7f_four_source_eod_candidate_v1 to service_role;
create function public.qf_vox_ab7f_four_source_eod_atomic_candidate_v1(
 p_staff uuid,p_tl uuid,p_team uuid,p_city uuid,p_day date,p_nonce uuid,
 p_source_digest text
) returns table(report_id uuid,receipt_nonce uuid,
 source_count integer,report_state text,published boolean)
language plpgsql security definer set search_path='' as $$
declare v_count integer;v_digest text;v_report uuid;
begin
 if p_staff is null or p_tl is null or p_staff=p_tl or
  p_team is null or p_city is null or p_day is null or p_nonce is null or
  p_source_digest !~ '^[a-f0-9]{64}$' or
  ((p_day+1)::timestamp at time zone 'Asia/Kolkata')>clock_timestamp()
 then raise exception 'AB7F_EOD_CURRENT_CLOSED_DAY_REQUIRED';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  join public.vox_staff_teams_v1 t on t.id=m.team_id
  where m.auth_user_id=p_staff and m.team_id=p_team and
  m.is_active and m.revoked_at is null and m.expires_at>clock_timestamp()
  and t.city_id=p_city and t.is_active)
 or not exists(select 1 from public.vox_staff_memberships_v1 m
  where m.auth_user_id=p_tl and m.team_id=p_team and
  m.staff_role='team_leader' and m.is_active and m.revoked_at is null
  and m.expires_at>clock_timestamp())
 then raise exception 'AB7F_EOD_CURRENT_TEAM_TL_DENIED';end if;
 select count(*),encode(public.digest(coalesce(string_agg(
   s.source||':'||s.event_checksum||':'||s.watermark_signature,'|'
   order by s.source),''),'sha256'),'hex') into v_count,v_digest
 from public.vox_ab3_staff_source_snapshots_candidate_v1 s
 where s.actor_id=p_staff and s.team_id=p_team and s.city_id=p_city
  and s.business_date=p_day and s.source in
  ('CORE_WORK_LEDGER','CRM_AAROHI','SUPPORT_DESK','CORE_CONVERSATION');
 if v_count<>4 or v_digest<>p_source_digest then
  raise exception 'AB7F_EOD_ORIGINAL_FOUR_SOURCE_DRIFT';end if;
 insert into public.vox_ab7f_four_source_eod_candidate_v1
 (nonce,staff_id,team_id,city_id,reviewer_id,business_date,source_count,source_digest)
 values(p_nonce,p_staff,p_team,p_city,p_tl,p_day,4,v_digest)
 returning id into v_report;
 return query select v_report,p_nonce,4,
   'TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE'::text,false;
end;
$$;
revoke all on function public.qf_vox_ab7f_four_source_eod_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,date,uuid,text) from public,anon,authenticated;
grant execute on function public.qf_vox_ab7f_four_source_eod_atomic_candidate_v1(
 uuid,uuid,uuid,uuid,date,uuid,text) to service_role;
commit;
