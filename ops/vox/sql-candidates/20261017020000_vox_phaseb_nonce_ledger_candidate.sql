-- PHASE B disposable signed-source nonce ledger. CANDIDATE ONLY.
-- Must never be added to managed migrations before independent DBA/AppSec
-- recovery & rollback approval. No legacy row attribution or auto backfill.
-- The original source-row mutation and this ledger MUST be committed together
-- by an independently reviewed native Core serializable transaction.
begin;
create table public.vox_staff_source_nonce_candidate_v1 (
 nonce uuid primary key,
 source text not null check(source in (
  'CORE_WORK_LEDGER','CRM_AAROHI','SUPPORT_DESK','CORE_CONVERSATION')),
 source_event_id uuid not null,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 committed_at timestamptz not null default clock_timestamp(),
 constraint vox_phaseb_nonce_unique_source_event unique(source,source_event_id),
 constraint vox_phaseb_nonce_requires_real_f1_event foreign key
  (source,source_event_id) references
  public.vox_staff_source_events_candidate_v1(source,source_event_id)
  on update restrict on delete restrict
);
create function public.qf_vox_phaseb_nonce_identity_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_actor uuid;v_team uuid;v_city uuid;
begin
 select e.actor_id,e.team_id,e.city_id into v_actor,v_team,v_city
 from public.vox_staff_source_events_candidate_v1 e
 where e.source=new.source and e.source_event_id=new.source_event_id;
 if not found or v_actor<>new.actor_id or v_team<>new.team_id
  or v_city<>new.city_id then
  raise exception 'VOX_PHASEB_NONCE_ACTOR_MISMATCH';
 end if;
 return new;
end;
$$;
create trigger qf_vox_phaseb_nonce_exact_identity_v1
before insert on public.vox_staff_source_nonce_candidate_v1
for each row execute function public.qf_vox_phaseb_nonce_identity_candidate_v1();
create trigger qf_vox_phaseb_nonce_immutable_v1
before update or delete on public.vox_staff_source_nonce_candidate_v1
for each row execute function public.qf_vox_f1_immutable_audit_candidate_v1();
alter table public.vox_staff_source_nonce_candidate_v1 enable row level security;
alter table public.vox_staff_source_nonce_candidate_v1 force row level security;
revoke all on public.vox_staff_source_nonce_candidate_v1
 from public,anon,authenticated;
grant select,insert on public.vox_staff_source_nonce_candidate_v1 to service_role;
revoke all on function public.qf_vox_phaseb_nonce_identity_candidate_v1()
 from public,anon,authenticated;
commit;
