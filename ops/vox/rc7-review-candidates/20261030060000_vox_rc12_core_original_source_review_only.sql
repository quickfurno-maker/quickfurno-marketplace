-- RC12 AB7B CORE_CONVERSATION original-source proof (DISPOSABLE ONLY).
-- Must be applied after pinned F1 / PhaseB / AB7B / RC8 review candidates.
-- NOT a managed migration; no browser or service_role DML authorization.
-- This forward correction must undergo independent DBA+AppSec and real
-- Auth/AAL2/D2-C consent trust-boundary review BEFORE staging installation.
BEGIN;
ALTER TABLE public.vox_ab7b_native_source_actions_candidate_v1
 DROP CONSTRAINT vox_ab7b_core_conversation_blocked;
CREATE OR REPLACE FUNCTION public.qf_vox_ab7b_native_source_guard_candidate_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r record;v_current record;v_department text;v_role text;
BEGIN
 IF NEW.source='CORE_CONVERSATION' THEN
  IF NEW.subject_kind<>'conversation' OR NEW.event_kind NOT IN
   ('HUMAN_TAKEOVER','AI_PAUSED') THEN
   RAISE EXCEPTION 'RC12_CORE_SOURCE_KIND_INVALID';
  END IF;
  -- SOURCE RECORD MAY BE APPENDED ONLY AFTER genuine SAME-TX conversation,
  -- immutable event, D2-C validated receipt, and live Staff scope.
  SELECT q.nonce,q.actor_id,q.conversation_id,q.new_revision,q.action,
    q.consent_scope,c.tenant_id,c.subject_type,c.id AS current_conversation,
    c.revision,c.state,c.human_takeover,
    ev.conversation_id AS event_conversation,ev.actor_type,ev.event_type,
    ev.event_data
   INTO r
  FROM public.vox_rc8_conversation_operator_receipts_candidate_v1 q
  JOIN public.communication_conversations c ON c.id=q.conversation_id
  JOIN public.communication_conversation_events ev ON ev.id=q.event_id
  WHERE q.nonce=NEW.nonce FOR SHARE OF q,c,ev;
  IF NOT FOUND OR r.actor_id<>NEW.actor_id OR
   r.conversation_id<>NEW.subject_id OR
   r.new_revision<>NEW.revision OR
   r.event_conversation<>NEW.subject_id OR
   r.revision<>NEW.revision OR
   r.tenant_id<>'quickfurno' OR
   r.consent_scope<>'transactional' OR
   r.actor_type<>'HUMAN' OR
   r.event_data->>'operatorUserId'<>NEW.actor_id::text OR
   (NEW.event_kind='HUMAN_TAKEOVER' AND
     (r.action<>'TAKEOVER' OR r.event_type<>'human.takeover_started'
       OR r.state<>'HUMAN' OR r.human_takeover IS DISTINCT FROM TRUE)) OR
   (NEW.event_kind='AI_PAUSED' AND
     (r.action<>'PAUSE_AI' OR r.event_type<>'ai.paused_by_operator'
       OR r.state<>'PAUSED' OR r.human_takeover IS DISTINCT FROM FALSE))
  THEN RAISE EXCEPTION 'RC12_NO_MATCHING_CONSENT_BOUND_SOURCE';END IF;
  SELECT m.auth_user_id,t.city_id,m.staff_role INTO v_current
  FROM public.vox_staff_memberships_v1 m
  JOIN public.vox_staff_teams_v1 t ON t.id=m.team_id
  JOIN public.profiles p ON p.id=m.auth_user_id
  JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.auth_user_id=NEW.actor_id AND m.team_id=NEW.team_id
  AND t.city_id=NEW.city_id AND m.staff_role='operations_manager'
  AND m.is_active=true AND m.revoked_at IS NULL
  AND m.expires_at>clock_timestamp() AND t.is_active=true
  AND p.is_active=true AND p.role IS NULL
  AND u.raw_app_meta_data->>'qf_principal'='vox_staff'
  AND u.raw_app_meta_data->>'admin_role' IS NULL
  FOR SHARE OF m,t,p,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'RC12_CURRENT_STAFF_DENIED'; END IF;
  IF NOT EXISTS(
   SELECT 1 FROM public.vox_staff_object_scopes_v1 g
    WHERE g.auth_user_id=NEW.actor_id AND g.scope_kind='conversation'
    AND g.object_id=NEW.subject_id AND g.revoked_at IS NULL
    AND g.expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'RC12_OBJECT_GRANT_REVOKED'; END IF;
  RETURN NEW;
 END IF;
 -- Preserve legacy CRM and Support guard semantics, not a blanket bypass.
 IF NEW.source NOT IN ('CRM_AAROHI','SUPPORT_DESK') THEN
  RAISE EXCEPTION 'AB7B_UNSUPPORTED_SOURCE';END IF;
 v_department:=CASE NEW.source WHEN 'CRM_AAROHI' THEN 'acquisition'
  WHEN 'SUPPORT_DESK' THEN 'service_support' END;
 v_role:=CASE NEW.source WHEN 'CRM_AAROHI' THEN 'acquisition_agent'
  WHEN 'SUPPORT_DESK' THEN 'support_agent' END;
 SELECT m.auth_user_id,t.city_id,m.staff_role INTO v_current
 FROM public.vox_staff_memberships_v1 m
 JOIN public.vox_staff_teams_v1 t ON t.id=m.team_id
 JOIN public.profiles p ON p.id=m.auth_user_id
 WHERE m.auth_user_id=NEW.actor_id
 AND m.team_id=NEW.team_id AND t.city_id=NEW.city_id
 AND m.staff_role=v_role AND m.is_active=true
 AND m.revoked_at IS NULL AND m.expires_at>clock_timestamp()
 AND t.is_active=true AND p.is_active=true AND p.role IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'AB7B_CURRENT_STAFF_REVOKED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vox_staff_object_scopes_v1 g
  WHERE g.auth_user_id=NEW.actor_id AND g.scope_kind=NEW.subject_kind
  AND g.object_id=NEW.subject_id AND g.revoked_at IS NULL
  AND g.expires_at>clock_timestamp())
 THEN RAISE EXCEPTION 'AB7B_SOURCE_OBJECT_GRANT_REVOKED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vox_staff_department_capabilities_v1 c
  WHERE c.auth_user_id=NEW.actor_id AND c.team_id=NEW.team_id
  AND c.city_id=NEW.city_id AND c.department=v_department
  AND c.expires_at>clock_timestamp() AND c.revoked_at IS NULL)
 THEN RAISE EXCEPTION 'AB7B_DEPARTMENT_CAPABILITY_REVOKED';END IF;
 RETURN NEW;
END $$;
-- This candidate changes no table grants: only future DBA-approved
-- minimum-privilege native writer role may insert. service_role INSERT is
-- explicitly REVOKED, preventing direct PostgREST source spoofing.
REVOKE INSERT ON public.vox_ab7b_native_source_actions_candidate_v1 FROM service_role;
-- Existing F1 and nonce candidates otherwise permit service_role to forge
-- source rows directly. Remove those grants together with the forward source
-- binding; a separately reviewed minimal native writer role must be installed.
REVOKE INSERT ON public.vox_staff_source_events_candidate_v1,
 public.vox_staff_source_nonce_candidate_v1 FROM service_role;
COMMIT;
