-- RC37 signed-EOD receipt immutability + stored signer-key evidence addendum.
-- REVIEW ONLY: NOT a managed migration. Apply only to disposable PG17 after
-- the RC8 signed-intent DDL and the RC11 revocation addendum. Do NOT install
-- without independent DBA/AppSec+Owner GO. No human key is enrolled here, no
-- EOD is published, no provider message is sent.
--  1. A receipt records the exact two signer keys (id, role, fingerprint, validity
--     window) in the SAME transaction; review no longer guesses keys by signer id.
--  2. Enrolled registry rows are immutable (key material / validity window can not
--     be rewritten or deleted after enrolment), so a stored fingerprint stays
--     comparable. Revocation (RC11) is the only way to end a key early.
--  3. TRUNCATE is blocked on every RC8 append-only table (row triggers do not fire).
BEGIN;
CREATE TABLE public.vox_rc37_receipt_signer_keys_candidate_v1 (
 intent_id uuid NOT NULL
  REFERENCES public.vox_rc8_verified_intents_candidate_v1(id) ON DELETE RESTRICT,
 key_id text NOT NULL
  REFERENCES public.vox_rc8_human_signer_registry_candidate_v1(key_id) ON DELETE RESTRICT,
 signer_id uuid NOT NULL,
 signer_role text NOT NULL CHECK(signer_role IN ('OWNER','TEAM_LEADER')),
 public_key_fingerprint text NOT NULL CHECK(public_key_fingerprint ~ '^[a-f0-9]{64}$'),
 not_before_ms bigint NOT NULL CHECK(not_before_ms>0),
 not_after_ms bigint NOT NULL CHECK(not_after_ms>not_before_ms),
 PRIMARY KEY(intent_id,signer_role),
 UNIQUE(intent_id,key_id)
);
CREATE OR REPLACE FUNCTION public.qf_vox_rc37_registry_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'VOX_RC37_SIGNER_REGISTRY_APPEND_ONLY';
 END IF;
 -- Pre-enrolment staging rows may be corrected; an enrolled row is final.
 IF OLD.human_enrolled THEN
  RAISE EXCEPTION 'VOX_RC37_ENROLLED_SIGNER_KEY_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vox_rc37_registry_immutable BEFORE UPDATE OR DELETE
 ON public.vox_rc8_human_signer_registry_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc37_registry_immutable_v1();
CREATE TRIGGER vox_rc37_receipt_keys_immutable BEFORE UPDATE OR DELETE
 ON public.vox_rc37_receipt_signer_keys_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc8_immutable_candidate_v1();
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'vox_rc8_human_signer_registry_candidate_v1',
  'vox_rc8_signer_revocations_candidate_v1',
  'vox_rc8_approval_claims_candidate_v1',
  'vox_rc8_verified_intents_candidate_v1',
  'vox_rc37_receipt_signer_keys_candidate_v1'] LOOP
  EXECUTE format('CREATE TRIGGER vox_rc37_no_truncate BEFORE TRUNCATE ON public.%I '||
   'FOR EACH STATEMENT EXECUTE FUNCTION public.qf_vox_rc8_immutable_candidate_v1()',t);
 END LOOP;
 EXECUTE 'ALTER TABLE public.vox_rc37_receipt_signer_keys_candidate_v1 ENABLE ROW LEVEL SECURITY';
 EXECUTE 'ALTER TABLE public.vox_rc37_receipt_signer_keys_candidate_v1 FORCE ROW LEVEL SECURITY';
 EXECUTE 'REVOKE ALL ON TABLE public.vox_rc37_receipt_signer_keys_candidate_v1 '||
  'FROM PUBLIC,anon,authenticated,service_role';
END $$;
REVOKE ALL ON FUNCTION public.qf_vox_rc37_registry_immutable_v1()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
