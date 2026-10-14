-- VOX-09C Core operational approval intents: unapplied source migration.
-- This owns approval REQUESTS only; execution is intentionally impossible here.
BEGIN;
CREATE TABLE IF NOT EXISTS public.vox_operational_intents_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 requester_id uuid NOT NULL REFERENCES public.profiles(id),
 team_id uuid NOT NULL REFERENCES public.vox_staff_teams_v1(id),
 city_id uuid NOT NULL REFERENCES public.cities(id),
 target_kind text NOT NULL CHECK(target_kind IN('prospect','vendor','support_thread')),
 target_id uuid NOT NULL,
 action_kind text NOT NULL CHECK(action_kind IN('AAROHI_FOLLOWUP','VENDOR_PROFILE_CHANGE','SUPPORT_REPLY')),
 nonce uuid NOT NULL,
 rationale text NOT NULL CHECK(length(rationale) BETWEEN 12 AND 300),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','APPROVED','REJECTED','EXPIRED')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES public.profiles(id),
 decided_at timestamptz,
 CONSTRAINT vox_operational_intent_no_payload CHECK (
  (action_kind='AAROHI_FOLLOWUP' AND target_kind='prospect') OR
  (action_kind='VENDOR_PROFILE_CHANGE' AND target_kind='vendor') OR
  (action_kind='SUPPORT_REPLY' AND target_kind='support_thread')),
 UNIQUE(requester_id,nonce)
);
CREATE TABLE IF NOT EXISTS public.vox_operational_intent_audit_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 intent_id uuid NOT NULL REFERENCES public.vox_operational_intents_v1(id),
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
 decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
 revision integer NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(intent_id,revision)
);
CREATE INDEX IF NOT EXISTS vox_operational_pending_idx ON public.vox_operational_intents_v1(team_id,created_at) WHERE state='PENDING';
ALTER TABLE public.vox_operational_intents_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vox_operational_intents_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vox_operational_intent_audit_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vox_operational_intent_audit_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vox_operational_intents_v1 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.vox_operational_intent_audit_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.vox_operational_intents_v1 TO service_role;
GRANT SELECT,INSERT ON TABLE public.vox_operational_intent_audit_v1 TO service_role;
CREATE OR REPLACE FUNCTION public.qf_vox_decide_operational_intent_v1(
 p_intent_id uuid,p_reviewer_id uuid,p_expected_revision integer,p_decision text
) RETURNS TABLE(intent_id uuid,new_state text,new_revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v public.vox_operational_intents_v1%rowtype;
BEGIN
 IF p_intent_id IS NULL OR p_reviewer_id IS NULL OR p_expected_revision<>0
    OR p_decision NOT IN ('APPROVED','REJECTED')
 THEN RAISE EXCEPTION 'VOX_INVALID_DECISION' USING errcode='P0001'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
  WHERE p.id=p_reviewer_id AND p.is_active=true AND p.role='admin'
    AND u.raw_app_meta_data->>'admin_role'='Superadmin'
 ) THEN RAISE EXCEPTION 'VOX_REVIEWER_NOT_OWNER' USING errcode='P0001'; END IF;
 SELECT * INTO v FROM public.vox_operational_intents_v1
  WHERE id=p_intent_id FOR UPDATE;
 IF NOT FOUND OR v.requester_id=p_reviewer_id OR v.state<>'PENDING'
    OR v.revision<>p_expected_revision OR v.expires_at<=now()
 THEN RAISE EXCEPTION 'VOX_STALE_OR_SELF_REVIEW' USING errcode='P0001'; END IF;
 -- A pending intent does NOT grant enduring authority: recheck active member,
 -- exact same team/city and the unchanged object scope on approval.
 IF NOT EXISTS(
  SELECT 1 FROM public.vox_staff_memberships_v1 m
  JOIN public.vox_staff_teams_v1 t ON t.id=m.team_id
  JOIN public.profiles p ON p.id=m.auth_user_id
  JOIN auth.users a ON a.id=p.id
  WHERE m.auth_user_id=v.requester_id AND m.team_id=v.team_id AND t.city_id=v.city_id
    AND p.is_active=true AND p.role is null
    AND a.raw_app_meta_data->>'qf_principal'='vox_staff'
    AND a.raw_app_meta_data->>'admin_role' is null
    AND m.is_active=true AND t.is_active=true
    AND m.revoked_at IS NULL AND m.expires_at>now()
    AND ( (v.action_kind='AAROHI_FOLLOWUP' AND m.staff_role IN('acquisition_agent','operations_manager'))
       OR (v.action_kind='VENDOR_PROFILE_CHANGE' AND m.staff_role IN('vendor_success_agent','operations_manager'))
       OR (v.action_kind='SUPPORT_REPLY' AND m.staff_role IN('support_agent','vendor_success_agent','operations_manager')))
 ) OR NOT EXISTS(
  SELECT 1 FROM public.vox_staff_object_scopes_v1 s
  WHERE s.auth_user_id=v.requester_id AND s.scope_kind=v.target_kind
    AND s.object_id=v.target_id AND s.revoked_at IS NULL AND s.expires_at>now()
 ) THEN RAISE EXCEPTION 'VOX_SCOPE_REVOKED_BEFORE_REVIEW' USING errcode='P0001'; END IF;
 -- Current canonical subject geography remains authoritative on approval.
 IF (v.target_kind='prospect' AND NOT EXISTS(
       SELECT 1 FROM public.aarohi_prospects a WHERE a.id=v.target_id AND a.city_id=v.city_id))
 OR (v.target_kind='vendor' AND NOT EXISTS(
       SELECT 1 FROM public.vendors ve JOIN public.marketplace_service_zones z
        ON z.id=ve.service_zone_id AND z.is_active=true
       WHERE ve.id=v.target_id AND z.city_id=v.city_id))
 OR (v.target_kind='support_thread' AND NOT EXISTS(
       SELECT 1 FROM public.vendor_support_threads th
       JOIN public.vendors ve ON ve.id=th.vendor_id
       JOIN public.marketplace_service_zones z ON z.id=ve.service_zone_id AND z.is_active=true
       WHERE th.id=v.target_id AND z.city_id=v.city_id
         AND EXISTS(SELECT 1 FROM public.vox_staff_object_scopes_v1 vs
           WHERE vs.auth_user_id=v.requester_id AND vs.scope_kind='vendor'
             AND vs.object_id=ve.id AND vs.revoked_at IS NULL AND vs.expires_at>now())))
 THEN RAISE EXCEPTION 'VOX_TARGET_CITY_REVOKED_BEFORE_REVIEW' USING errcode='P0001'; END IF;
 UPDATE public.vox_operational_intents_v1 SET state=p_decision,revision=v.revision+1,
    decided_by=p_reviewer_id,decided_at=now() WHERE id=v.id;
 INSERT INTO public.vox_operational_intent_audit_v1(intent_id,reviewer_id,decision,revision)
 VALUES(v.id,p_reviewer_id,p_decision,v.revision+1);
 RETURN QUERY SELECT v.id,p_decision,v.revision+1;
END;
$$;
REVOKE ALL ON FUNCTION public.qf_vox_decide_operational_intent_v1(uuid,uuid,integer,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qf_vox_decide_operational_intent_v1(uuid,uuid,integer,text) TO service_role;
COMMIT;
