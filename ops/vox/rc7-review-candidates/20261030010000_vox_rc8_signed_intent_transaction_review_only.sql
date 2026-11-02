-- VOX RC8 Native PG approval intent review candidate (2026-10-30).
-- NOT a managed migration. This file is NOT under supabase/migrations or
-- ops/vox/sql-candidates; do NOT install without independent DBA/AppSec+Owner GO.
-- Durable immutable nonce/subject claims + signed-intent receipts in ONE transaction.
-- This structure NEVER publishes EOD, changes staff, sends provider messages,
-- or records an official human approval. Human key enrollment is external.
BEGIN;
CREATE TABLE public.vox_rc8_human_signer_registry_candidate_v1 (
 key_id text PRIMARY KEY CHECK(key_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
 signer_id uuid NOT NULL,
 signer_role text NOT NULL CHECK(signer_role IN ('OWNER','TEAM_LEADER')),
 public_key_pem text NOT NULL,
 public_key_fingerprint text NOT NULL CHECK(public_key_fingerprint ~ '^[a-f0-9]{64}$'),
 not_before_ms bigint NOT NULL CHECK(not_before_ms>0),
 not_after_ms bigint NOT NULL CHECK(not_after_ms>not_before_ms),
 human_enrolled boolean NOT NULL DEFAULT false,
 enrolled_at timestamptz,
 CHECK((human_enrolled AND enrolled_at IS NOT NULL) OR
       (NOT human_enrolled AND enrolled_at IS NULL))
);
CREATE TABLE public.vox_rc8_signer_revocations_candidate_v1 (
 key_id text PRIMARY KEY,
 revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 review_evidence_sha256 text NOT NULL CHECK(review_evidence_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public.vox_rc8_approval_claims_candidate_v1 (
 claim_key text PRIMARY KEY CHECK(claim_key ~ '^[a-f0-9]{64}$'),
 claim_kind text NOT NULL CHECK(claim_kind IN ('OWNER_NONCE','TL_NONCE','SUBJECT')),
 intent_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at > created_at)
);
CREATE TABLE public.vox_rc8_verified_intents_candidate_v1 (
 id uuid PRIMARY KEY,
 type text NOT NULL,
 subject_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 team_id uuid NOT NULL,
 city_id uuid NOT NULL,
 owner_id uuid NOT NULL,
 team_leader_id uuid NOT NULL,
 verified_signature_pair boolean NOT NULL CHECK(verified_signature_pair=true),
 state text NOT NULL DEFAULT 'AWAITING_EXTERNAL_REVIEW'
  CHECK(state='AWAITING_EXTERNAL_REVIEW'),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT vox_rc8_independent_actors CHECK(owner_id<>team_leader_id),
 CONSTRAINT vox_rc8_unique_target UNIQUE(type,subject_id)
);
CREATE OR REPLACE FUNCTION public.qf_vox_rc8_immutable_candidate_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'VOX_RC8_APPEND_ONLY'; END $$;
CREATE TRIGGER vox_rc8_nonce_immutable BEFORE UPDATE OR DELETE
 ON public.vox_rc8_approval_claims_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc8_immutable_candidate_v1();
CREATE TRIGGER vox_rc8_intent_immutable BEFORE UPDATE OR DELETE
 ON public.vox_rc8_verified_intents_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc8_immutable_candidate_v1();
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'vox_rc8_human_signer_registry_candidate_v1',
  'vox_rc8_signer_revocations_candidate_v1',
  'vox_rc8_approval_claims_candidate_v1',
  'vox_rc8_verified_intents_candidate_v1'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.qf_vox_rc8_immutable_candidate_v1()
 FROM PUBLIC,anon,authenticated,service_role;
-- Absolutely NO service_role table DML: current Node writer may only be used
-- with a future separately scoped trusted DB role after security review.
COMMIT;
