-- RC17-C protected official EOD publication authority.
-- REVIEW ONLY / UNINSTALLED. Apply only after signed writer review and
-- independent DBA/AppSec approved migration sequencing. No human identity
-- enrolment or actual signing is performed by this file.
-- AB7G's current publication RPC accepts only caller UUID/digest, while its
-- attestation can be forged by privileged callers. service_role MUST NOT call
-- it via PostgREST before a dedicated verifier-bound minimal writer exists.
BEGIN;
REVOKE ALL ON FUNCTION public.qf_vox_ab7g_official_eod_publish_candidate_v1(
 uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.vox_ab7g_eod_owner_approvals_candidate_v1
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.vox_ab7g_eod_official_publications_candidate_v1
 FROM PUBLIC,anon,authenticated,service_role;
-- Read-only Owner visibility may be added after separate reviewed role binding.
DO $check$
BEGIN
 IF has_function_privilege('service_role',
  'public.qf_vox_ab7g_official_eod_publish_candidate_v1(uuid,uuid,uuid,uuid,text)','EXECUTE')
  OR has_function_privilege('authenticated',
  'public.qf_vox_ab7g_official_eod_publish_candidate_v1(uuid,uuid,uuid,uuid,text)','EXECUTE')
  OR has_table_privilege('service_role',
  'public.vox_ab7g_eod_owner_approvals_candidate_v1','INSERT') THEN
   RAISE EXCEPTION 'RC17_UNVERIFIED_EOD_PUBLICATION_AUTHORITY_EXPOSED';
 END IF;
END $check$;
COMMIT;
