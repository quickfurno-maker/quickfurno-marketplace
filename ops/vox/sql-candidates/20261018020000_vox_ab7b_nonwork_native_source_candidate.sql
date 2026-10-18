-- AB-7B three non-Work source event ORIGINAL candidate, not live source hook.
-- A native CRM/support/conversation writer must produce this row in SAME tx.
-- NO historical backfill, no agent/AI-generated Staff actor attribution.
-- Requires independent source-table/DBA verification before migration.
begin;
create table public.vox_ab7b_native_source_actions_candidate_v1 (
 id uuid primary key,
 source text not null check(source in
  ('CRM_AAROHI','SUPPORT_DESK','CORE_CONVERSATION')),
 subject_kind text not null check(subject_kind in
  ('prospect','support_thread','conversation')),
 subject_id uuid not null,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 revision integer not null check(revision>=1),
 event_kind text not null check(event_kind ~ '^[A-Z_]{3,32}$'),
 nonce uuid not null unique,
 occurred_at timestamptz not null default clock_timestamp(),
 constraint vox_ab7b_strict_source_subject check(
  (source='CRM_AAROHI' and subject_kind='prospect') or
  (source='SUPPORT_DESK' and subject_kind='support_thread') or
  (source='CORE_CONVERSATION' and subject_kind='conversation')),
 constraint vox_ab7b_one_source_revision unique
  (source,subject_id,revision)
);
create or replace function public.qf_vox_ab7b_native_source_guard_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_current record;v_department text;v_role text;
begin
 v_department:=case new.source when 'CRM_AAROHI' then 'acquisition'
 when 'SUPPORT_DESK' then 'service_support'
 when 'CORE_CONVERSATION' then 'client_success' end;
 v_role:=case new.source when 'CRM_AAROHI' then 'acquisition_agent'
 when 'SUPPORT_DESK' then 'support_agent'
 when 'CORE_CONVERSATION' then 'client_success_agent' end;
 select m.auth_user_id,t.city_id,m.staff_role into v_current
 from public.vox_staff_memberships_v1 m
 join public.vox_staff_teams_v1 t on t.id=m.team_id
 join public.profiles p on p.id=m.auth_user_id
 where m.auth_user_id=new.actor_id
 and m.team_id=new.team_id and t.city_id=new.city_id
 and m.staff_role=v_role and m.is_active=true
 and m.revoked_at is null and m.expires_at>clock_timestamp()
 and t.is_active=true and p.is_active=true and p.role is null;
 if not found then raise exception 'AB7B_CURRENT_STAFF_REVOKED';end if;
 if not exists(select 1 from public.vox_staff_object_scopes_v1 g
  where g.auth_user_id=new.actor_id and g.scope_kind=new.subject_kind
  and g.object_id=new.subject_id and g.revoked_at is null
  and g.expires_at>clock_timestamp())
 then raise exception 'AB7B_SOURCE_OBJECT_GRANT_REVOKED';end if;
 if not exists(select 1 from public.vox_staff_department_capabilities_v1 c
  where c.auth_user_id=new.actor_id and c.team_id=new.team_id
  and c.city_id=new.city_id and c.department=v_department
  and c.expires_at>clock_timestamp() and c.revoked_at is null)
 then raise exception 'AB7B_DEPARTMENT_CAPABILITY_REVOKED';end if;
 if new.source='CORE_CONVERSATION' and not exists(
  select 1 from public.vox_ab7b_current_consent_candidate_v1 z
   where z.conversation_id=new.subject_id and z.status='ALLOWED'
   and z.current_revision>=1 and z.revoked_at is null)
 then raise exception 'AB7B_CONVERSATION_CONSENT_REQUIRED';end if;
 return new;
end;
$$;
create trigger vox_ab7b_verify_original_source before insert
 on public.vox_ab7b_native_source_actions_candidate_v1
 for each row execute function public.qf_vox_ab7b_native_source_guard_candidate_v1();
create or replace function public.qf_vox_ab7b_canonical_source_append_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 -- This AFTER trigger must be installed only on an independently approved
 -- genuine original mutation path in the eventual protected release.
 insert into public.vox_staff_source_events_candidate_v1
 (id,source,source_event_id,actor_id,team_id,city_id,object_id,
 revision,event_kind,occurred_at,subject_kind,subject_id)
 values(new.id,new.source,new.id,new.actor_id,new.team_id,new.city_id,
 new.subject_id,new.revision,new.event_kind,new.occurred_at,
 new.subject_kind,new.subject_id);
 insert into public.vox_staff_source_nonce_candidate_v1
 (nonce,source,source_event_id,actor_id,team_id,city_id)
 values(new.nonce,new.source,new.id,new.actor_id,new.team_id,new.city_id);
 return new;
end;
$$;
create trigger vox_ab7b_canonical_f1_same_transaction
 after insert on public.vox_ab7b_native_source_actions_candidate_v1
 for each row execute function public.qf_vox_ab7b_canonical_source_append_candidate_v1();
create trigger vox_ab7b_append_only before update or delete on
 public.vox_ab7b_native_source_actions_candidate_v1
 for each row execute function public.qf_vox_f1_immutable_audit_candidate_v1();
alter table public.vox_ab7b_native_source_actions_candidate_v1 enable row level security;
alter table public.vox_ab7b_native_source_actions_candidate_v1 force row level security;
revoke all on public.vox_ab7b_native_source_actions_candidate_v1
 from public,anon,authenticated;
grant select,insert on public.vox_ab7b_native_source_actions_candidate_v1
 to service_role;
revoke all on function public.qf_vox_ab7b_native_source_guard_candidate_v1()
 from public,anon,authenticated;
revoke all on function public.qf_vox_ab7b_canonical_source_append_candidate_v1()
 from public,anon,authenticated;
commit;
