-- VO6 REVIEW ONLY. Disposable PostgreSQL17 candidate, not a managed migration.
-- Ephemeral manual connection hints. NOT attendance, payroll, EOD or activity tracking.
-- Core MUST verify actual AAL2 via Supabase Auth before passing p_actor.
begin;
create table public.vox_vo6_staff_presence_observations_candidate_v1(
 staff_id uuid primary key references public.vox_staff_memberships_v1(auth_user_id),
 team_id uuid not null references public.vox_staff_teams_v1(id),
 city_id uuid not null references public.cities(id),
 state text not null check(state in ('ONLINE','AWAY','BUSY','IN_MEETING','ON_BREAK')),
 seen_at timestamptz not null default clock_timestamp()
);
create index vox_vo6_presence_team_window_idx
 on public.vox_vo6_staff_presence_observations_candidate_v1(team_id,city_id,seen_at desc);
alter table public.vox_vo6_staff_presence_observations_candidate_v1 enable row level security;
alter table public.vox_vo6_staff_presence_observations_candidate_v1 force row level security;
revoke all on public.vox_vo6_staff_presence_observations_candidate_v1 from public,anon,authenticated;
grant select,insert,update on public.vox_vo6_staff_presence_observations_candidate_v1 to service_role;
create or replace function public.qf_vox_staff_presence_signal_candidate_v1(
 p_actor uuid,p_team uuid,p_state text
) returns table(staff_id uuid,team_id uuid,city_id uuid,state text,seen_at timestamptz)
 language plpgsql security definer set search_path='' as $$
declare
 v_city uuid;
 v_seen timestamptz;
begin
 if p_actor is null or p_team is null or
    p_state is null or p_state not in
      ('ONLINE','AWAY','BUSY','IN_MEETING','ON_BREAK')
 then raise exception 'VO6_PRESENCE_INVALID_SIGNAL' using errcode='P0001'; end if;
 select t.city_id into v_city from public.vox_staff_memberships_v1 m
 join public.vox_staff_teams_v1 t on t.id=m.team_id
 join public.cities c on c.id=t.city_id
 join public.profiles p on p.id=m.auth_user_id
 join auth.users au on au.id=p.id
 where m.auth_user_id=p_actor and m.team_id=p_team
  and m.is_active=true and m.revoked_at is null
  and m.expires_at>clock_timestamp()
  and m.staff_role in ('operations_manager','acquisition_agent',
    'vendor_success_agent','support_agent','team_leader')
  and t.is_active=true and c.is_active=true
  and p.role is null and p.is_active=true
  and au.raw_app_meta_data->>'qf_principal'='vox_staff'
  and au.raw_app_meta_data->>'admin_role' is null
  and (m.staff_role<>'team_leader' or
    au.raw_app_meta_data->>'vox_role'='team_leader');
 if not found then raise exception 'VO6_PRESENCE_CURRENT_STAFF_DENIED'
  using errcode='P0001';end if;
 v_seen:=clock_timestamp();
 insert into public.vox_vo6_staff_presence_observations_candidate_v1
  (staff_id,team_id,city_id,state,seen_at)
 values(p_actor,p_team,v_city,p_state,v_seen)
 on conflict on constraint vox_vo6_staff_presence_observations_candidate_v1_pkey do update
  set team_id=excluded.team_id,city_id=excluded.city_id,
   state=excluded.state,seen_at=excluded.seen_at;
 return query select p_actor,p_team,v_city,p_state,v_seen;
end;
$$;
revoke all on function public.qf_vox_staff_presence_signal_candidate_v1(
 uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.qf_vox_staff_presence_signal_candidate_v1(
 uuid,uuid,text) to service_role;
commit;
