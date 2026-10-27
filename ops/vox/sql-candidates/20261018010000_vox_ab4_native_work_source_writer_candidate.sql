-- AB-4 native Core Work Staff activity writer -- CANDIDATE ONLY.
-- Requires independent DBA/AppSec review of prior TO02E/F1/PhaseB SQL.
-- Lives OUTSIDE managed migrations; NO staging/production changes.
-- The trusted Core qf_vox_work_transition_candidate_v1 mutation inserts
-- vox_work_events_candidate_v1; this trigger performs canonical F1 Staff
-- attribution and one-use nonce registration in THAT SAME SQL transaction.
begin;
create function public.qf_vox_ab4_native_work_source_event_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare w record;
begin
 if new.event_type not in
  ('CLAIM','START','WAIT_EXTERNAL','REQUEST_APPROVAL','BLOCK','RESUME','COMPLETE')
  or new.to_revision<>new.from_revision+1
  or new.to_revision<1 or new.event_nonce is null
 then raise exception 'VOX_AB4_INVALID_NATIVE_WORK_EVENT';end if;
 select id,team_id,city_id,source_kind,source_id,related_vendor_id,
  state,revision,assignee_id into w
 from public.vox_work_items_candidate_v1
 where id=new.work_item_id for share;
 if not found or w.state<>new.to_state or
  w.revision<>new.to_revision or w.assignee_id<>new.actor_id
 then raise exception 'VOX_AB4_SOURCE_STATE_OR_ACTOR_MISMATCH';end if;
 perform 1 from public.vox_staff_memberships_v1 m
 join public.profiles p on p.id=m.auth_user_id
 join public.vox_staff_teams_v1 t on t.id=m.team_id
 where m.auth_user_id=new.actor_id and m.team_id=w.team_id
 and t.city_id=w.city_id and t.is_active=true
 and m.is_active=true and m.revoked_at is null
 and m.expires_at>clock_timestamp()
 and m.staff_role not in ('team_leader','auditor')
 and p.role is null and p.is_active=true;
 if not found then
  raise exception 'VOX_AB4_NEUTRAL_ACTOR_REVOKED';end if;
 -- Native writer must never attribute a stale ungranted source object.
 if not exists(select 1 from public.vox_staff_object_scopes_v1 s
  where s.auth_user_id=new.actor_id and s.scope_kind=w.source_kind
  and s.object_id=w.source_id and s.revoked_at is null
  and s.expires_at>clock_timestamp())
 then raise exception 'VOX_AB4_OBJECT_GRANT_REVOKED';end if;
 if w.source_kind='support_thread' and not exists(
  select 1 from public.vox_staff_object_scopes_v1 s
  where s.auth_user_id=new.actor_id and s.scope_kind='vendor'
   and s.object_id=w.related_vendor_id and s.revoked_at is null
   and s.expires_at>clock_timestamp())
 then raise exception 'VOX_AB4_SUPPORT_VENDOR_GRANT_REQUIRED';end if;
 -- Original Core Work transition RPC independently checks signed Core Auth,
 -- current TL-reviewed department, source city and support dual entitlement.
 -- This DB trigger adds a second source/actor/grant verification, not a
 -- replacement for the protected Core RPC or independent release review.
 insert into public.vox_staff_source_events_candidate_v1
 (id,source,source_event_id,actor_id,team_id,city_id,object_id,
  revision,event_kind,occurred_at,subject_kind,subject_id)
 values(new.id,'CORE_WORK_LEDGER',new.id,new.actor_id,
  w.team_id,w.city_id,w.id,new.to_revision,new.event_type,
  new.created_at,w.source_kind,w.source_id);
 insert into public.vox_staff_source_nonce_candidate_v1
 (nonce,source,source_event_id,actor_id,team_id,city_id)
 values(new.event_nonce,'CORE_WORK_LEDGER',new.id,new.actor_id,
  w.team_id,w.city_id);
 return new;
end;
$$;
create trigger qf_vox_ab4_native_work_source_event_v1
 after insert on public.vox_work_events_candidate_v1
 for each row execute function
 public.qf_vox_ab4_native_work_source_event_candidate_v1();
revoke all on function public.qf_vox_ab4_native_work_source_event_candidate_v1()
 from public,anon,authenticated;
commit;
