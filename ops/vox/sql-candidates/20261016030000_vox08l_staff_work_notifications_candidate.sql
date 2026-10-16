-- VOX-08L candidate: Staff in-app work-event inbox ONLY.
-- Never auto-send WhatsApp, SMS, push or contact clients/vendors.
-- Requires the reviewed canonical Staff foundation, departments and Core work
-- event ledger. Separate human DBA/security approval before managed migration.
begin;
create table public.vox_staff_work_notifications_candidate_v1(
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 work_item_id uuid not null references public.vox_work_items_candidate_v1(id) on delete restrict,
 work_event_id uuid not null references public.vox_work_events_candidate_v1(id) on delete restrict,
 event_kind text not null check(event_kind in
   ('CLAIM','START','COMPLETE','BLOCK','REQUEST_APPROVAL','WAIT_EXTERNAL','RESUME')),
 revision smallint not null default 0 check(revision in (0,1)),
 read_nonce uuid unique,
 read_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(recipient_id,work_event_id),
 constraint vox_staff_notification_state_v1 check(
  (revision=0 and read_nonce is null and read_at is null)
   or (revision=1 and read_nonce is not null and read_at is not null)
 )
);
create index vox_staff_notification_current_v1
 on public.vox_staff_work_notifications_candidate_v1
 (recipient_id,team_id,city_id,created_at desc,id desc);
alter table public.vox_staff_work_notifications_candidate_v1 enable row level security;
alter table public.vox_staff_work_notifications_candidate_v1 force row level security;
revoke all on public.vox_staff_work_notifications_candidate_v1
 from public,anon,authenticated;
grant select on public.vox_staff_work_notifications_candidate_v1 to service_role;

create function public.qf_vox_staff_notification_immutable_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'VOX_NOTIF_DELETE_FORBIDDEN';end if;
 if (old.id,old.recipient_id,old.team_id,old.city_id,
  old.work_item_id,old.work_event_id,old.event_kind,old.created_at)
 is distinct from
 (new.id,new.recipient_id,new.team_id,new.city_id,
  new.work_item_id,new.work_event_id,new.event_kind,new.created_at)
 then raise exception 'VOX_NOTIF_EVIDENCE_IMMUTABLE';end if;
 if old.revision<>0 or new.revision<>1 or
  old.read_at is not null or old.read_nonce is not null or
  new.read_at is null or new.read_nonce is null
 then raise exception 'VOX_NOTIF_INVALID_READ_TRANSITION';end if;
 return new;
end;
$$;
create trigger qf_vox_staff_notification_immutable_v1
 before update or delete on public.vox_staff_work_notifications_candidate_v1
 for each row execute function public.qf_vox_staff_notification_immutable_v1();

-- A single current Core authorization proof shared by enqueue, inbox and read
-- receipt. It is NOT an alternate Staff login or an override of Core's AAL2.
create function public.qf_vox_staff_notification_scope_v1(
 p_actor uuid,p_work_item uuid
) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare r record;
begin
 if p_actor is null or p_work_item is null then return false;end if;
 select w.id,w.team_id,w.city_id,w.source_kind,w.source_id,w.related_vendor_id
  into r
 from public.vox_work_items_candidate_v1 w
 join public.vox_staff_memberships_v1 m on m.team_id=w.team_id
 join public.vox_staff_teams_v1 t on t.id=m.team_id
 join public.cities c on c.id=t.city_id
 join public.profiles p on p.id=m.auth_user_id
 join auth.users u on u.id=p.id
 where w.id=p_work_item and m.auth_user_id=p_actor
  and t.id=w.team_id and t.city_id=w.city_id
  and m.is_active and m.revoked_at is null
  and m.expires_at>clock_timestamp()
  and m.staff_role in ('operations_manager','acquisition_agent',
   'vendor_success_agent','support_agent','team_leader')
  and t.is_active and c.is_active and p.is_active and p.role is null
  and u.raw_app_meta_data->>'qf_principal'='vox_staff'
  and u.raw_app_meta_data->>'admin_role' is null
  and (m.staff_role<>'team_leader'
   or u.raw_app_meta_data->>'vox_role'='team_leader');
 if not found then return false;end if;

 if not exists(select 1 from public.vox_staff_object_scopes_v1 s
  where s.auth_user_id=p_actor and s.scope_kind=r.source_kind
   and s.object_id=r.source_id and s.revoked_at is null
   and s.expires_at>clock_timestamp())then return false;end if;
 if r.source_kind='support_thread' and not exists(
  select 1 from public.vox_staff_object_scopes_v1 s
  where s.auth_user_id=p_actor and s.scope_kind='vendor'
   and s.object_id=r.related_vendor_id and s.revoked_at is null
   and s.expires_at>clock_timestamp())then return false;end if;
 if r.source_kind='prospect' then
  return exists(select 1 from public.aarohi_prospects ap
   where ap.id=r.source_id and ap.city_id=r.city_id);
 elsif r.source_kind='vendor' then
  return exists(select 1 from public.vendors v
   join public.marketplace_service_zones z on z.id=v.service_zone_id
   where v.id=r.source_id and z.city_id=r.city_id and z.is_active);
 elsif r.source_kind='support_thread' then
  return exists(select 1 from public.vendor_support_threads s
   join public.vendors v on v.id=s.vendor_id
   join public.marketplace_service_zones z on z.id=v.service_zone_id
   where s.id=r.source_id and s.vendor_id=r.related_vendor_id
    and z.city_id=r.city_id and z.is_active);
 end if;
 return false;
end;
$$;

-- A controlled Core worker calls this AFTER one real persisted transition.
-- No trigger or background job is activated by this candidate.
create function public.qf_vox_staff_notification_enqueue_v1(
 p_recipient uuid,p_work_event uuid
) returns table(notification_id uuid,created_time timestamptz)
language plpgsql security definer set search_path='' as $$
declare v record;v_id uuid;
begin
 if p_recipient is null or p_work_event is null
 then raise exception 'VOX_NOTIF_INVALID_EVENT';end if;
 select ev.work_item_id,ev.actor_id,ev.event_type,w.team_id,w.city_id
 into v from public.vox_work_events_candidate_v1 ev
 join public.vox_work_items_candidate_v1 w on w.id=ev.work_item_id
 where ev.id=p_work_event and ev.event_type in
 ('CLAIM','START','COMPLETE','BLOCK','REQUEST_APPROVAL','WAIT_EXTERNAL','RESUME');
 if not found then raise exception 'VOX_NOTIF_NOT_REAL_WORK_EVENT';end if;
 if v.actor_id=p_recipient then raise exception 'VOX_NOTIF_SELF_ACTOR_IGNORED';end if;
 if not public.qf_vox_staff_notification_scope_v1(p_recipient,v.work_item_id)
 then raise exception 'VOX_NOTIF_CURRENT_SCOPE_DENIED';end if;

 insert into public.vox_staff_work_notifications_candidate_v1
  (recipient_id,work_event_id,work_item_id,team_id,city_id,event_kind)
 values(p_recipient,p_work_event,v.work_item_id,v.team_id,v.city_id,v.event_type)
 on conflict(recipient_id,work_event_id) do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.vox_staff_work_notifications_candidate_v1
   where recipient_id=p_recipient and work_event_id=p_work_event;
 end if;
 return query
  select n.id,n.created_at from public.vox_staff_work_notifications_candidate_v1 n
  where n.id=v_id and n.recipient_id=p_recipient and
   n.work_event_id=p_work_event;
end;
$$;

create function public.qf_vox_staff_notification_inbox_v1(p_actor uuid)
returns table(notification_id uuid,event_kind text,revision smallint,
 created_time timestamptz)
language sql volatile security definer set search_path='' as $$
 select n.id,n.event_kind,n.revision,n.created_at
 from public.vox_staff_work_notifications_candidate_v1 n
 where n.recipient_id=p_actor
  and public.qf_vox_staff_notification_scope_v1(p_actor,n.work_item_id)
 order by n.created_at desc,n.id desc limit 26
$$;

create function public.qf_vox_staff_notification_mark_read_v1(
 p_actor uuid,p_notification uuid,p_nonce uuid,p_expected_revision integer
) returns table(notification_id uuid,new_revision smallint,read_time timestamptz)
language plpgsql security definer set search_path='' as $$
declare n public.vox_staff_work_notifications_candidate_v1%rowtype;
begin
 if p_actor is null or p_notification is null or p_nonce is null
  or p_expected_revision<>0 then raise exception 'VOX_NOTIF_INVALID_ACK';end if;
 select * into n from public.vox_staff_work_notifications_candidate_v1
  where id=p_notification for update;
 if not found or n.recipient_id<>p_actor then raise exception 'VOX_NOTIF_NOT_OWNED';end if;
 if not public.qf_vox_staff_notification_scope_v1(p_actor,n.work_item_id)
 then raise exception 'VOX_NOTIF_CURRENT_SCOPE_DENIED';end if;
 if n.revision=1 and n.read_nonce=p_nonce then
  return query select n.id,n.revision,n.read_at;return;
 end if;
 if n.revision<>0 then raise exception 'VOX_NOTIF_STALE_OR_REPLAY';end if;
 update public.vox_staff_work_notifications_candidate_v1
  set revision=1,read_nonce=p_nonce,read_at=clock_timestamp()
  where id=n.id returning id,revision,read_at into n.id,n.revision,n.read_at;
 return query select n.id,n.revision,n.read_at;
end;
$$;

revoke all on function public.qf_vox_staff_notification_immutable_v1()
 from public,anon,authenticated;
revoke all on function public.qf_vox_staff_notification_scope_v1(uuid,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_staff_notification_enqueue_v1(uuid,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_staff_notification_inbox_v1(uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_staff_notification_mark_read_v1(uuid,uuid,uuid,integer)
 from public,anon,authenticated;
grant execute on function public.qf_vox_staff_notification_scope_v1(uuid,uuid)
 to service_role;
grant execute on function public.qf_vox_staff_notification_enqueue_v1(uuid,uuid)
 to service_role;
grant execute on function public.qf_vox_staff_notification_inbox_v1(uuid)
 to service_role;
grant execute on function public.qf_vox_staff_notification_mark_read_v1(uuid,uuid,uuid,integer)
 to service_role;
commit;
