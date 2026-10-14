-- Synthetic-only pg16 fixtures and transactional negative gates.
create schema auth;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}'::jsonb);
create table public.profiles(id uuid primary key,role text,is_active boolean);
create table public.cities(id uuid primary key,is_active boolean not null default true);
create table public.aarohi_prospects(id uuid primary key,city_id uuid not null references public.cities(id));
create table public.marketplace_service_zones(id uuid primary key,city_id uuid not null references public.cities(id),is_active boolean not null);
create table public.vendors(id uuid primary key,service_zone_id uuid);
create table public.vendor_support_threads(id uuid primary key,vendor_id uuid);
create table public.communication_conversations(id uuid primary key,subject_type text,subject_id uuid);
grant usage on schema public to anon,authenticated,service_role;

-- Synthetic profiles: requestor, active owner reviewer, staff target, unauthorized reviewer.
insert into public.profiles(id,role,is_active) values
 ('10000000-0000-4000-8000-000000000001','admin',true),
 ('10000000-0000-4000-8000-000000000002','admin',true),
 ('10000000-0000-4000-8000-000000000003','admin',true),
 ('10000000-0000-4000-8000-000000000004','admin',true);
insert into auth.users(id,raw_app_meta_data) values
 ('10000000-0000-4000-8000-000000000001','{}'),
 ('10000000-0000-4000-8000-000000000002','{"admin_role":"Superadmin"}'),
 ('10000000-0000-4000-8000-000000000003','{}'),
 ('10000000-0000-4000-8000-000000000004','{"admin_role":"Basic Staff"}');
insert into public.cities(id,is_active) values
 ('20000000-0000-4000-8000-000000000001',true),
 ('20000000-0000-4000-8000-000000000002',true);
insert into public.aarohi_prospects(id,city_id) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002');
insert into public.vox_staff_teams_v1(id,team_name,city_id,is_active,created_by)
 values('30000000-0000-4000-8000-000000000001','Synthetic Pune team',
 '20000000-0000-4000-8000-000000000001',true,'10000000-0000-4000-8000-000000000001');

-- Fully approved membership, same team's GOOD and WRONG-CITY object scopes.
insert into public.vox_staff_access_requests_v1
 (id,request_nonce,requested_by,target_profile_id,team_id,request_kind,requested_role,
  desired_expires_at,reason) values
 ('50000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
 '30000000-0000-4000-8000-000000000001','STAFF_MEMBERSHIP','acquisition_agent',
 now()+interval '7 days','Synthetic staff role request');
insert into public.vox_staff_access_requests_v1
 (id,request_nonce,requested_by,target_profile_id,team_id,request_kind,scope_kind,scope_object_id,
  desired_expires_at,reason) values
 ('50000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
 '30000000-0000-4000-8000-000000000001','OBJECT_SCOPE','prospect',
 '40000000-0000-4000-8000-000000000001',now()+interval '3 days','Synthetic city verified prospect'),
 ('50000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
 '30000000-0000-4000-8000-000000000001','OBJECT_SCOPE','prospect',
 '40000000-0000-4000-8000-000000000002',now()+interval '3 days','Synthetic wrong city prospect'),
 ('50000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
 '30000000-0000-4000-8000-000000000001','OBJECT_SCOPE','prospect',
 '40000000-0000-4000-8000-000000000001',now()+interval '3 days','Synthetic unreviewed scope case');

DO $$
declare
 x record;
 v_replay_denied boolean:=false;
 v_city_denied boolean:=false;
 v_unreviewed_denied boolean:=false;
 v_wrong_actor_denied boolean:=false;
begin
 select * into x from public.qf_vox_review_staff_access_v1(
 '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',0,'APPROVE','TEST-REVIEW-MEMBER-001');
 if x.new_revision<>1 or x.decision<>'APPROVED' then raise exception 'MISSING_REVIEW'; end if;
 perform public.qf_vox_activate_reviewed_access_v1(
 '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',1,'TEST-ACTIVATION-MEMBER-001');
 if (select count(*) from public.vox_staff_memberships_v1 where is_active)=0 then raise exception 'MEMBERSHIP_NOT_CREATED'; end if;
 begin
  perform public.qf_vox_activate_reviewed_access_v1(
  '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',1,'TEST-ACTIVATION-MEMBER-001');
 exception when sqlstate 'P0001' then v_replay_denied:=true; end;
 if not v_replay_denied then raise exception 'REPLAY_NOT_DENIED'; end if;
 perform public.qf_vox_review_staff_access_v1('50000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000002',0,'APPROVE','TEST-REVIEW-SCOPE-001');
 perform public.qf_vox_activate_reviewed_access_v1('50000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000002',1,'TEST-ACTIVATION-SCOPE-001');
 if (select count(*) from public.vox_staff_object_scopes_v1 where revoked_at is null)<>1
 then raise exception 'SCOPE_NOT_CREATED'; end if;
 perform public.qf_vox_review_staff_access_v1('50000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000002',0,'APPROVE','TEST-REVIEW-SCOPE-002');
 begin
  perform public.qf_vox_activate_reviewed_access_v1('50000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',1,'TEST-ACTIVATION-SCOPE-002');
 exception when sqlstate 'P0001' then v_city_denied:=true; end;
 if not v_city_denied then raise exception 'CROSS_CITY_NOT_DENIED'; end if;
 begin
  perform public.qf_vox_activate_reviewed_access_v1('50000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000002',1,'TEST-ACTIVATION-NOREVIEW');
 exception when sqlstate 'P0001' then v_unreviewed_denied:=true; end;
 if not v_unreviewed_denied then raise exception 'UNREVIEWED_NOT_DENIED'; end if;
 begin
  perform public.qf_vox_activate_reviewed_access_v1('50000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',1,'TEST-ACTIVATION-NOADMIN');
 exception when sqlstate 'P0001' then v_wrong_actor_denied:=true; end;
 if not v_wrong_actor_denied then raise exception 'BAD_REVIEWER_NOT_DENIED'; end if;
 if (select count(*) from public.vox_staff_grant_audit_v1)<>2 or
 (select count(*) from public.vox_staff_access_activations_v1)<>2
 then raise exception 'AUDIT_OR_ACTIVATION_NOT_ATOMIC'; end if;
 raise notice 'VOX07_FINALIZER_POSITIVE_NEGATIVE_GATES_PASS';
end $$;
