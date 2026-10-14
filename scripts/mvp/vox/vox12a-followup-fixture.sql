-- Use the existing VOX-09C synthetic Owner-reviewed intent fixture first.
DO $$
DECLARE out1 record;out2 record;denied boolean:=false;
BEGIN
 SELECT * INTO out1 FROM public.qf_vox_execute_approved_aarohi_followup_v1(
 '50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002',1);
 IF out1.created IS NOT TRUE THEN RAISE EXCEPTION 'FIRST_EXEC_NOT_CREATED'; END IF;
 SELECT * INTO out2 FROM public.qf_vox_execute_approved_aarohi_followup_v1(
 '50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002',1);
 IF out2.created IS NOT FALSE OR out2.task_id<>out1.task_id
 THEN RAISE EXCEPTION 'NON_IDEMPOTENT_RETRY';END IF;
 BEGIN PERFORM public.qf_vox_execute_approved_aarohi_followup_v1(
 '50000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000003',1);
 EXCEPTION WHEN sqlstate 'P0001' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'UNTRUSTED_EXECUTOR_ALLOWED';END IF;
 IF (SELECT count(*) FROM public.vox_approved_followup_executions_v1)<>1
 OR (SELECT count(*) FROM public.aarohi_tasks WHERE workflow_reference
 ='vox.operational.intent.50000000-0000-4000-8000-000000000001')<>1
 OR (SELECT count(*) FROM public.aarohi_events
 WHERE idempotency_key='vox.followup.50000000-0000-4000-8000-000000000001')<>1
 THEN RAISE EXCEPTION 'NOT_EXACTLY_ONCE_TASK_AND_EVENT';END IF;
 RAISE NOTICE 'VOX12A_NATIVE_AAROHI_TASK_FIRST_AND_REPLAY_PASS task=1 event=1 receipt=1';
END $$;
-- A separate, independently approved proposal: scope revocation MUST block execution.
INSERT INTO public.vox_operational_intents_v1(id,requester_id,team_id,city_id,
 target_kind,target_id,action_kind,nonce,rationale)
VALUES('50000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001',
 'prospect','40000000-0000-4000-8000-000000000001','AAROHI_FOLLOWUP',
 '60000000-0000-4000-8000-000000000003','Governed second follow-up after approval');
SELECT * FROM public.qf_vox_decide_operational_intent_v1(
 '50000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000002',0,'APPROVED');
UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=now()
 WHERE auth_user_id='10000000-0000-4000-8000-000000000001'
   AND scope_kind='prospect';
DO $$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM public.qf_vox_execute_approved_aarohi_followup_v1(
 '50000000-0000-4000-8000-000000000003',
 '10000000-0000-4000-8000-000000000002',1);
 EXCEPTION WHEN sqlstate 'P0001' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'REVOKED_SCOPE_EXECUTED';END IF;
 IF (SELECT count(*) FROM public.aarohi_tasks WHERE workflow_reference LIKE
 'vox.operational.intent.%')<>1 THEN RAISE EXCEPTION 'EXTRA_TASK_CREATED';END IF;
 RAISE NOTICE 'VOX12A_REVOKED_SCOPE_BLOCKED true';
END $$;
