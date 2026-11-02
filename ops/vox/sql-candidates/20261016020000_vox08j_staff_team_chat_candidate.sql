-- VOX-08J TEAM CHAT. Source-only, NOT applied to managed staging or production.
-- Internal team staff messages only: NO client/vendor WhatsApp, agents, phone,
-- push send, financial change, user creation, or role/permission modification.
-- Requires reviewed VOX Staff foundation and Core verified AAL2 HTTP binding.
begin;
create table public.vox_staff_team_messages_candidate_v1 (
 id uuid primary key default gen_random_uuid(),
 message_nonce uuid not null unique,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 sender_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 -- Explicit comparisons preserve the same accepted body range while avoiding
 -- PostgreSQL BETWEEN parse-tree normalization drift across dump/restore.
 body text not null check(length(body)>=1 and length(body)<=500 and body=btrim(body) and body !~ '[[:cntrl:]]'),
 created_at timestamptz not null default clock_timestamp(),
 constraint vox_chat_no_external_delivery_v1 check(length(body)<=500)
);
create index vox_staff_chat_team_window_v1 on
 public.vox_staff_team_messages_candidate_v1(team_id,created_at desc,id desc);
alter table public.vox_staff_team_messages_candidate_v1 enable row level security;
alter table public.vox_staff_team_messages_candidate_v1 force row level security;
revoke all on public.vox_staff_team_messages_candidate_v1 from public,anon,authenticated;
grant select on public.vox_staff_team_messages_candidate_v1 to service_role;

create function public.qf_vox_staff_chat_immutability_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'VOX_CHAT_APPEND_ONLY';
end;
$$;
create trigger qf_vox_team_chat_immutability_v1 before update or delete
 on public.vox_staff_team_messages_candidate_v1 for each row
 execute function public.qf_vox_staff_chat_immutability_candidate_v1();

-- Only current verified neutral Staff may SEND internal messages to exact team.
-- The Core HTTP route must independently validate the real Supabase AAL2
-- session and derive the server-bound p_actor. Never use app JWT without getUser.
create function public.qf_vox_staff_team_chat_send_candidate_v1(
 p_actor uuid,p_team uuid,p_nonce uuid,p_body text
) returns table(message_id uuid,created_time timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_city uuid; v_saved public.vox_staff_team_messages_candidate_v1%rowtype;
begin
 if p_actor is null or p_team is null or p_nonce is null or p_body is null
  or length(p_body) not between 1 and 500 or p_body<>btrim(p_body)
  or p_body ~ '[[:cntrl:]]'
 then raise exception 'VOX_CHAT_INVALID_COMMAND';end if;
 select t.city_id into v_city
 from public.vox_staff_memberships_v1 m
 join public.vox_staff_teams_v1 t on t.id=m.team_id
 join public.cities c on c.id=t.city_id
 join public.profiles p on p.id=m.auth_user_id
 join auth.users a on a.id=p.id
 where m.auth_user_id=p_actor and m.team_id=p_team and m.is_active=true
  and m.revoked_at is null and m.expires_at>clock_timestamp()
  and m.staff_role in ('operations_manager','acquisition_agent','vendor_success_agent',
    'support_agent','team_leader')
  and t.is_active=true and c.is_active=true
  and p.role is null and p.is_active=true
  and a.raw_app_meta_data->>'qf_principal'='vox_staff'
  and a.raw_app_meta_data->>'admin_role' is null
  and (m.staff_role<>'team_leader'
   or a.raw_app_meta_data->>'vox_role'='team_leader');
 if not found then raise exception 'VOX_CHAT_CURRENT_TEAM_AAL2_REQUIRED';end if;

 select * into v_saved from public.vox_staff_team_messages_candidate_v1
 where message_nonce=p_nonce;
 if found then
  if v_saved.sender_id=p_actor and v_saved.team_id=p_team
     and v_saved.city_id=v_city and v_saved.body=p_body
  then return query select v_saved.id,v_saved.created_at;return;end if;
  raise exception 'VOX_CHAT_NONCE_REPLAY_DENIED';
 end if;
 insert into public.vox_staff_team_messages_candidate_v1
  (message_nonce,team_id,city_id,sender_id,body)
 values(p_nonce,p_team,v_city,p_actor,p_body)
 returning id,created_at into v_saved.id,v_saved.created_at;
 return query select v_saved.id,v_saved.created_at;
end;
$$;
revoke all on function public.qf_vox_staff_team_chat_send_candidate_v1(uuid,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.qf_vox_staff_team_chat_send_candidate_v1(uuid,uuid,uuid,text)
 to service_role;
revoke all on function public.qf_vox_staff_chat_immutability_candidate_v1()
 from public,anon,authenticated;
commit;
