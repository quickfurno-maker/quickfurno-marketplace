-- Synthetic-only team leader reviewer acceptance and escalation refusal.
insert into public.profiles(id,role,is_active) values
 ('10000000-0000-4000-8000-000000000005',NULL,true),
 ('10000000-0000-4000-8000-000000000006',NULL,true);
insert into auth.users(id,raw_app_meta_data) values
 ('10000000-0000-4000-8000-000000000005','{"vox_role":"team_leader","qf_principal":"vox_staff"}'),
 ('10000000-0000-4000-8000-000000000006','{"qf_principal":"vox_staff"}');
insert into public.vox_staff_memberships_v1
 (auth_user_id,team_id,staff_role,is_active,expires_at,granted_by)
 values('10000000-0000-4000-8000-000000000005',
 '30000000-0000-4000-8000-000000000001','team_leader',true,
 now()+interval '10 days','10000000-0000-4000-8000-000000000002');
insert into public.vox_staff_access_requests_v1
 (id,request_nonce,requested_by,target_profile_id,team_id,request_kind,
  requested_role,desired_expires_at,reason)
 values
 ('50000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000010',
 '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006',
 '30000000-0000-4000-8000-000000000001','STAFF_MEMBERSHIP','support_agent',
 now()+interval '3 days','Owner-requested staff grant; Team Leader approval required'),
 ('50000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000011',
 '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006',
 '30000000-0000-4000-8000-000000000001','STAFF_MEMBERSHIP','operations_manager',
 now()+interval '3 days','Manager escalation must be blocked for Team Leader'),
 ('50000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000012',
 '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006',
 '30000000-0000-4000-8000-000000000001','STAFF_MEMBERSHIP','vendor_success_agent',
 now()+interval '3 days','Superadmin cannot bypass independent reviewer');
do $$
declare escalated boolean:=false; owner_review boolean:=false;
 owner_review_finalizer boolean:=false; inactive_leader boolean:=false;
begin
 perform public.qf_vox_review_staff_access_v1(
 '50000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000005',
 0,'APPROVE','TEAM-LEADER-REVIEW-001');
 perform public.qf_vox_activate_reviewed_access_v1(
 '50000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002',
 1,'OWNER-ACTIVATE-001');
 if not exists(select 1 from public.vox_staff_memberships_v1
   where auth_user_id='10000000-0000-4000-8000-000000000006' and is_active
   and staff_role='support_agent')
 then raise exception 'TEAM_LEADER_CHAIN_NOT_ACTIVATED'; end if;
 begin
  perform public.qf_vox_review_staff_access_v1(
  '50000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000005',
  0,'APPROVE','TEAM-LEADER-ESCALATION');
 exception when sqlstate 'P0001' then escalated:=true;end;
 if not escalated then raise exception 'TEAM_LEADER_ELEVATION_ALLOWED';end if;
 begin
  perform public.qf_vox_review_staff_access_v1(
  '50000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000002',
  0,'APPROVE','OWNER-REVIEW-BYPASS');
 exception when sqlstate 'P0001' then owner_review:=true;end;
 if not owner_review then raise exception 'OWNER_REVIEW_BYPASS_ALLOWED';end if;
 begin
  perform public.qf_vox_activate_reviewed_access_v1(
   '50000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000002',
   1,'OWNER-UNREVIEWED-ACTIVATE');
 exception when sqlstate 'P0001' then owner_review_finalizer:=true;end;
 if not owner_review_finalizer then raise exception 'UNREVIEWED_OWNER_ACTIVATED';end if;
 update public.vox_staff_memberships_v1 set is_active=false,revoked_at=now()
 where auth_user_id='10000000-0000-4000-8000-000000000005';
 begin
  perform public.qf_vox_review_staff_access_v1(
   '50000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000005',
   0,'APPROVE','REVOKED-REVIEW-ATTEMPT');
 exception when sqlstate 'P0001' then inactive_leader:=true;end;
 if not inactive_leader then raise exception 'REVOKED_LEADER_CAN_REVIEW';end if;
 if (select count(*) from public.vox_staff_access_activations_v1)<>3
 then raise exception 'ACTIVATION_RECEIPTS_WRONG';end if;
 raise notice 'VOX08_OWNER_LEADER_OWNER_SUCCESS no_privilege_escalation=true no_owner_review_bypass=true revoked_leader_denied=true';
end $$;
