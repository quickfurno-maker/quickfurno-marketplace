-- VOX RC41 signed-EOD review snapshot RPC (Supabase Data API / PostgREST).
-- REVIEW ONLY: NOT a managed migration, NOT deployable. Apply only to disposable
-- PG17 after the RC8 signed-intent DDL, the RC11 revocation addendum and the RC37
-- receipt/signer-evidence addendum. Do NOT install without independent
-- DBA/AppSec + Owner GO. No signer is enrolled here, no EOD is published, no
-- provider message is sent, nothing is written.
--
-- One function call = ONE statement = ONE MVCC snapshot (STABLE; the body is a
-- single RETURN of one query). It returns, atomically and bounded:
--   * the durable pending receipt (intent row + its claims) and any other EOD
--     intent for the same subject,
--   * the CURRENT four-source report facts the humans signed over,
--   * the receipt's two STORED signer keys joined to the current enrolled registry
--     and LEFT-joined to revocations (revoked / registryMatches / validity window),
--   * Owner and Team Leader attestations for the receipt's two DISTINCT humans:
--     current authority + a live, verified-MFA AAL2 session. Booleans only: no
--     session id, token, IP or factor secret leaves the database.
-- Private keys do not exist in these tables, and public_key_pem is NOT returned
-- (fingerprint/key id/window only). The decision is NOT taken here: the receipt
-- digest and every predicate live in rc8EvaluateReceiptEvidence (JS), the single
-- source of truth shared with the pg reconciler.
-- SECURITY DEFINER is deliberate and minimal: the RC8/RC37 tables are RLS-forced
-- and revoked from every API role, so the reader role needs EXECUTE only, never
-- table SELECT. Nobody has EXECUTE until the dedicated reader role is granted.
BEGIN;
CREATE OR REPLACE FUNCTION public.qf_vox_rc41_signed_eod_review_snapshot_v1(
 p_intent_id uuid,p_subject_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_intent_id IS NULL OR p_subject_id IS NULL THEN
  RAISE EXCEPTION 'VOX_RC41_REVIEW_INPUT_INVALID';
 END IF;
 RETURN (
  WITH t AS (SELECT statement_timestamp() AS at),
  i AS (
   SELECT * FROM public.vox_rc8_verified_intents_candidate_v1 WHERE id=p_intent_id),
  claims AS (
   SELECT c.claim_kind,c.claim_key FROM public.vox_rc8_approval_claims_candidate_v1 c
   WHERE c.intent_id=p_intent_id ORDER BY c.claim_kind,c.claim_key LIMIT 4),
  subj AS (
   SELECT v.id FROM public.vox_rc8_verified_intents_candidate_v1 v
   WHERE v.type='EOD_OFFICIAL_RELEASE' AND v.subject_id=p_subject_id
   ORDER BY v.id LIMIT 3),
  rep AS (
   SELECT r.team_id,r.city_id,r.staff_id,r.reviewer_id,r.source_count,
          r.source_digest,r.state,r.published
   FROM public.vox_ab7f_four_source_eod_candidate_v1 r
   WHERE r.id=p_subject_id AND EXISTS(SELECT 1 FROM i)),
  keys AS (
   SELECT e.key_id,e.signer_id,e.signer_role,(v.key_id IS NOT NULL) AS revoked,
    (r.public_key_fingerprint=e.public_key_fingerprint AND r.signer_id=e.signer_id AND
     r.signer_role=e.signer_role AND r.not_before_ms=e.not_before_ms AND
     r.not_after_ms=e.not_after_ms AND r.human_enrolled=true) AS registry_matches,
    e.not_before_ms,e.not_after_ms
   FROM public.vox_rc37_receipt_signer_keys_candidate_v1 e
   JOIN public.vox_rc8_human_signer_registry_candidate_v1 r ON r.key_id=e.key_id
   LEFT JOIN public.vox_rc8_signer_revocations_candidate_v1 v ON v.key_id=e.key_id
   WHERE e.intent_id=p_intent_id ORDER BY e.signer_role LIMIT 3),
  owner_att AS (
   SELECT i.owner_id AS user_id,
    EXISTS(SELECT 1 FROM public.profiles p
     JOIN auth.users a ON a.id=p.id
     WHERE p.id=i.owner_id AND p.role='admin' AND p.is_active=true
      AND a.raw_app_meta_data->>'admin_role'='Superadmin') AS authority_current,
    EXISTS(SELECT 1 FROM auth.sessions s
     WHERE s.user_id=i.owner_id AND s.aal='aal2'
      AND (s.not_after IS NULL OR s.not_after>(SELECT at FROM t)))
    AND EXISTS(SELECT 1 FROM auth.mfa_factors f
     WHERE f.user_id=i.owner_id AND f.status='verified') AS aal2_current
   FROM i),
  tl_att AS (
   SELECT i.team_leader_id AS user_id,
    EXISTS(SELECT 1 FROM public.vox_staff_memberships_v1 m
     JOIN public.profiles p ON p.id=m.auth_user_id
     JOIN auth.users a ON a.id=m.auth_user_id
     JOIN public.vox_staff_teams_v1 tm ON tm.id=m.team_id
     WHERE m.auth_user_id=i.team_leader_id AND m.staff_role='team_leader'
      AND m.team_id=i.team_id AND tm.city_id=i.city_id
      AND m.is_active=true AND m.revoked_at IS NULL
      AND m.expires_at>(SELECT at FROM t) AND tm.is_active=true
      AND p.is_active=true AND p.role IS NULL
      AND a.raw_app_meta_data->>'qf_principal'='vox_staff'
      AND a.raw_app_meta_data->>'vox_role'='team_leader'
      AND a.raw_app_meta_data->>'admin_role' IS NULL) AS authority_current,
    EXISTS(SELECT 1 FROM auth.sessions s
     WHERE s.user_id=i.team_leader_id AND s.aal='aal2'
      AND (s.not_after IS NULL OR s.not_after>(SELECT at FROM t)))
    AND EXISTS(SELECT 1 FROM auth.mfa_factors f
     WHERE f.user_id=i.team_leader_id AND f.status='verified') AS aal2_current
   FROM i)
  SELECT jsonb_build_object(
   'schema','qf.vox.rc41.signed-eod-review-snapshot.v1',
   'serverNowMs',(extract(epoch FROM (SELECT at FROM t))*1000)::bigint,
   'intents',COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'id',i.id::text,'type',i.type,'subjectId',i.subject_id::text,'digest',i.digest,
     'teamId',i.team_id::text,'cityId',i.city_id::text,'ownerId',i.owner_id::text,
     'teamLeaderId',i.team_leader_id::text,
     'verifiedSignaturePair',i.verified_signature_pair,'state',i.state)) FROM i),'[]'::jsonb),
   'claims',COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'claimKind',c.claim_kind,'claimKey',c.claim_key)
     ORDER BY c.claim_kind,c.claim_key) FROM claims c),'[]'::jsonb),
   'subjectIntentIds',COALESCE((SELECT jsonb_agg(s.id::text ORDER BY s.id) FROM subj s),'[]'::jsonb),
   'report',(SELECT jsonb_build_object(
     'teamId',r.team_id::text,'cityId',r.city_id::text,'staffId',r.staff_id::text,
     'reviewerId',r.reviewer_id::text,'sourceCount',r.source_count,
     'sourceDigest',r.source_digest,'state',r.state,'published',r.published) FROM rep r),
   'keys',COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'keyId',k.key_id,'signerId',k.signer_id::text,'signerRole',k.signer_role,
     'revoked',k.revoked,'registryMatches',k.registry_matches,
     'notBeforeMs',k.not_before_ms,'notAfterMs',k.not_after_ms)
     ORDER BY k.signer_role) FROM keys k),'[]'::jsonb),
   'attestations',(SELECT jsonb_build_object(
     'owner',jsonb_build_object('userId',o.user_id::text,
      'authorityCurrent',o.authority_current,'aal2Current',o.aal2_current),
     'teamLeader',jsonb_build_object('userId',l.user_id::text,
      'authorityCurrent',l.authority_current,'aal2Current',l.aal2_current))
     FROM owner_att o,tl_att l)
  )
 );
END $$;
REVOKE ALL ON FUNCTION public.qf_vox_rc41_signed_eod_review_snapshot_v1(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Fail closed: EXECUTE goes ONLY to the dedicated reader role, and only if that
-- role was separately created and reviewed. Absent role => nobody can call it.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='vox_rc41_eod_review_reader') THEN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.qf_vox_rc41_signed_eod_review_snapshot_v1(uuid,uuid) '||
   'TO vox_rc41_eod_review_reader';
 ELSE
  RAISE NOTICE 'VOX_RC41_READER_ROLE_ABSENT_NO_EXECUTE_GRANTED';
 END IF;
END $$;
COMMIT;
