-- RC11 signer-revocation serialization addendum.
-- REVIEW ONLY: apply only to disposable PG17 after RC8 signer registry.
-- No managed DDL, no public/provider API, no human enrollment performed.
BEGIN;
ALTER TABLE public.vox_rc8_signer_revocations_candidate_v1
 ADD CONSTRAINT vox_rc11_signer_revocation_registry_fk
 FOREIGN KEY (key_id) REFERENCES public.vox_rc8_human_signer_registry_candidate_v1(key_id)
 ON DELETE RESTRICT;
CREATE TRIGGER vox_rc11_signer_revocations_immutable BEFORE UPDATE OR DELETE
 ON public.vox_rc8_signer_revocations_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc8_immutable_candidate_v1();
CREATE OR REPLACE FUNCTION public.qf_vox_rc11_revoke_signed_human_key_candidate_v1(
 p_key text,p_evidence_sha256 text)
 RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r text;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{1,64}$'
    OR p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'RC11_SIGNER_REVOCATION_INVALID'; END IF;
 -- Share locks acquired by the signed-intent writer and this FOR UPDATE
 -- are incompatible; key revocation cannot commit in the writer's window.
 SELECT key_id INTO r FROM public.vox_rc8_human_signer_registry_candidate_v1
  WHERE key_id=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RC11_SIGNER_NOT_ENROLLED'; END IF;
 INSERT INTO public.vox_rc8_signer_revocations_candidate_v1
  (key_id,review_evidence_sha256) VALUES (p_key,p_evidence_sha256);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.qf_vox_rc11_revoke_signed_human_key_candidate_v1(text,text)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
