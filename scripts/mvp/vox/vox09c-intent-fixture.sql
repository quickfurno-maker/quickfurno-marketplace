INSERT INTO public.profiles(id,role,is_active) VALUES
('10000000-0000-4000-8000-000000000001','admin',true),
('10000000-0000-4000-8000-000000000002','admin',true),
('10000000-0000-4000-8000-000000000003','admin',true);
INSERT INTO auth.users(id,raw_app_meta_data) VALUES
('10000000-0000-4000-8000-000000000001','{}'),
('10000000-0000-4000-8000-000000000002','{"admin_role":"Superadmin"}'),
('10000000-0000-4000-8000-000000000003','{}');
INSERT INTO public.cities(id,is_active) VALUES ('20000000-0000-4000-8000-000000000001',true);
INSERT INTO public.vox_staff_teams_v1(id,team_name,city_id,is_active,created_by)
 VALUES('30000000-0000-4000-8000-000000000001','Synthetic Team',
 '20000000-0000-4000-8000-000000000001',true,'10000000-0000-4000-8000-000000000001');
INSERT INTO public.vox_staff_memberships_v1(auth_user_id,team_id,staff_role,
 is_active,expires_at,granted_by)
 VALUES('10000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001','operations_manager',
 true,now()+interval '7 days','10000000-0000-4000-8000-000000000002');
INSERT INTO public.marketplace_service_zones(id,city_id,is_active)
 VALUES('70000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001',true);
INSERT INTO public.vendors(id,service_zone_id) VALUES(
 '80000000-0000-4000-8000-000000000001',
 '70000000-0000-4000-8000-000000000001');
INSERT INTO public.vendor_support_threads(id,vendor_id) VALUES(
 '40000000-0000-4000-8000-000000000002',
 '80000000-0000-4000-8000-000000000001');
INSERT INTO public.aarohi_prospects(id,city_id) VALUES(
 '40000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001');
INSERT INTO public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id,
 granted_by,expires_at,reason) VALUES
 ('10000000-0000-4000-8000-000000000001','prospect',
 '40000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002',now()+interval '7 days',
 'Synthetic prospect assignment'),
 ('10000000-0000-4000-8000-000000000001','vendor',
 '80000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002',now()+interval '7 days',
 'Synthetic vendor assignment'),
 ('10000000-0000-4000-8000-000000000001','support_thread',
 '40000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000002',now()+interval '7 days',
 'Synthetic support thread assignment');
INSERT INTO public.vox_operational_intents_v1(id,requester_id,team_id,city_id,
 target_kind,target_id,action_kind,nonce,rationale) VALUES
 ('50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'prospect','40000000-0000-4000-8000-000000000001','AAROHI_FOLLOWUP',
  '60000000-0000-4000-8000-000000000001',
  'Schedule a governed acquisition follow-up'),
 ('50000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'support_thread','40000000-0000-4000-8000-000000000002','SUPPORT_REPLY',
  '60000000-0000-4000-8000-000000000002',
  'Review support case before replying');
DO $$
DECLARE denied_self boolean:=false;denied_untrusted boolean:=false;replay boolean:=false;
BEGIN
 BEGIN
 PERFORM public.qf_vox_decide_operational_intent_v1(
 '50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001',0,'APPROVED');
 EXCEPTION WHEN sqlstate 'P0001' THEN denied_self:=true; END;
 IF NOT denied_self THEN RAISE EXCEPTION 'SELF_APPROVAL_ALLOWED'; END IF;
 BEGIN
 PERFORM public.qf_vox_decide_operational_intent_v1(
 '50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000003',0,'APPROVED');
 EXCEPTION WHEN sqlstate 'P0001' THEN denied_untrusted:=true; END;
 IF NOT denied_untrusted THEN RAISE EXCEPTION 'UNTRUSTED_APPROVAL_ALLOWED'; END IF;
 PERFORM public.qf_vox_decide_operational_intent_v1(
 '50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002',0,'APPROVED');
 PERFORM public.qf_vox_decide_operational_intent_v1(
 '50000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000002',0,'REJECTED');
 BEGIN
 PERFORM public.qf_vox_decide_operational_intent_v1(
 '50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002',0,'APPROVED');
 EXCEPTION WHEN sqlstate 'P0001' THEN replay:=true; END;
 IF NOT replay THEN RAISE EXCEPTION 'REPLAY_APPROVAL_ALLOWED'; END IF;
 IF (SELECT count(*) FROM public.vox_operational_intent_audit_v1)<>2 THEN
  RAISE EXCEPTION 'AUDIT_MISSING'; END IF;
 IF (SELECT count(*) FROM public.vox_operational_intents_v1 WHERE state='APPROVED')<>1
 OR (SELECT count(*) FROM public.vox_operational_intents_v1 WHERE state='REJECTED')<>1
 THEN RAISE EXCEPTION 'INCORRECT_DECISIONS'; END IF;
 RAISE NOTICE 'VOX09C_REAL_PG17_INTENT_REVIEW_PASS self_denied=true untrusted_denied=true replay_denied=true audit=2 execution=none';
END $$;
