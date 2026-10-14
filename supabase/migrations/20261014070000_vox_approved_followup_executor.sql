-- VOX-12A. UNAPPLIED. Atomic exactly-once internal Aarohi follow-up task.
-- No WhatsApp, no provider send, no vendor, KYC, balance or matching mutation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.vox_approved_followup_executions_v1(
 intent_id uuid PRIMARY KEY REFERENCES public.vox_operational_intents_v1(id),
 task_id uuid NOT NULL UNIQUE REFERENCES public.aarohi_tasks(id),
 executed_by uuid NOT NULL REFERENCES public.profiles(id),
 executed_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT vox_followup_internal_receipt_once UNIQUE(intent_id,task_id)
);
ALTER TABLE public.vox_approved_followup_executions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vox_approved_followup_executions_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.vox_approved_followup_executions_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.vox_approved_followup_executions_v1 TO service_role;
CREATE OR REPLACE FUNCTION public.qf_vox_execute_approved_aarohi_followup_v1(
 p_intent_id uuid,p_owner_id uuid,p_expected_revision integer
) RETURNS TABLE(task_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v public.vox_operational_intents_v1%rowtype;
 existing uuid;
 new_task uuid;
BEGIN
 IF p_intent_id IS NULL OR p_owner_id IS NULL OR p_expected_revision<>1
 THEN RAISE EXCEPTION 'VOX_FOLLOWUP_BAD_INPUT' USING errcode='P0001'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
  WHERE p.id=p_owner_id AND p.role='admin' AND p.is_active=true
    AND u.raw_app_meta_data->>'admin_role'='Superadmin'
 ) THEN RAISE EXCEPTION 'VOX_FOLLOWUP_OWNER_REQUIRED' USING errcode='P0001'; END IF;
 -- Serialize by the approved intent, never process-local locks.
 SELECT * INTO v FROM public.vox_operational_intents_v1
  WHERE id=p_intent_id FOR UPDATE;
 IF NOT FOUND OR v.action_kind<>'AAROHI_FOLLOWUP'
    OR v.target_kind<>'prospect' OR v.state<>'APPROVED'
    OR v.revision<>p_expected_revision OR v.expires_at<=now()
    OR v.requester_id=p_owner_id OR v.decided_by<>p_owner_id
 THEN RAISE EXCEPTION 'VOX_FOLLOWUP_NOT_APPROVED' USING errcode='P0001'; END IF;
 -- No stale authority even AFTER owner approval: current requester scope.
 IF NOT EXISTS(
  SELECT 1 FROM public.vox_staff_memberships_v1 m
  JOIN public.vox_staff_teams_v1 t ON t.id=m.team_id
  JOIN public.profiles p ON p.id=m.auth_user_id
  WHERE m.auth_user_id=v.requester_id AND m.team_id=v.team_id
    AND t.city_id=v.city_id AND t.is_active=true
    AND p.is_active=true AND m.is_active=true
    AND m.revoked_at IS NULL AND m.expires_at>now()
    AND m.staff_role IN('acquisition_agent','operations_manager')
 ) OR NOT EXISTS(
  SELECT 1 FROM public.vox_staff_object_scopes_v1 s
  WHERE s.auth_user_id=v.requester_id AND s.scope_kind='prospect'
    AND s.object_id=v.target_id AND s.revoked_at IS NULL AND s.expires_at>now()
 ) OR NOT EXISTS(
  SELECT 1 FROM public.aarohi_prospects a
  WHERE a.id=v.target_id AND a.city_id=v.city_id
 ) THEN RAISE EXCEPTION 'VOX_FOLLOWUP_SCOPE_REVOKED' USING errcode='P0001'; END IF;
 SELECT e.task_id INTO existing
 FROM public.vox_approved_followup_executions_v1 e WHERE e.intent_id=v.id;
 IF FOUND THEN
  RETURN QUERY SELECT existing,false; RETURN;
 END IF;
 -- Native canonical Aarohi CRM schema and event (single SQL transaction).
 INSERT INTO public.aarohi_tasks(
  prospect_id,task_type,due_at,priority,reason,assigned_to,created_by,workflow_reference
 ) VALUES(
  v.target_id,'FOLLOW_UP',now()+interval '1 day','NORMAL',
  'Owner-approved internal follow-up',v.requester_id,v.requester_id,
  'vox.operational.intent.'||v.id::text
 ) RETURNING id INTO new_task;
 INSERT INTO public.aarohi_events(prospect_id,event_type,actor_type,actor_reference,
   safe_summary,reference_type,reference_id,idempotency_key)
 VALUES(v.target_id,'task.created','HUMAN',v.requester_id::text,
  'Core owner-approved internal follow-up task created','task',new_task::text,
  'vox.followup.'||v.id::text);
 INSERT INTO public.vox_approved_followup_executions_v1(intent_id,task_id,executed_by)
 VALUES(v.id,new_task,p_owner_id);
 RETURN QUERY SELECT new_task,true;
END;
$$;
REVOKE ALL ON FUNCTION public.qf_vox_execute_approved_aarohi_followup_v1(uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qf_vox_execute_approved_aarohi_followup_v1(uuid,uuid,integer)
 TO service_role;
COMMIT;
