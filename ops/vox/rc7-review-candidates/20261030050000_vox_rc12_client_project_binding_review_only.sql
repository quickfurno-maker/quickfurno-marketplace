-- VOX RC12 client conversation -> independently reviewed project zone binding.
-- REVIEW ONLY, never managed migration or implicit identity reconciliation.
-- Cannot invent ownership of public.leads (no client_account_id there).
-- An authorized, signed human approval must establish this binding separately.
BEGIN;
CREATE TABLE public.vox_rc12_client_conversation_project_bindings_candidate_v1(
 conversation_id uuid PRIMARY KEY REFERENCES public.communication_conversations(id) ON DELETE RESTRICT,
 client_account_id uuid NOT NULL REFERENCES public.client_accounts(id) ON DELETE RESTRICT,
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
 service_zone_id uuid NOT NULL REFERENCES public.marketplace_service_zones(id) ON DELETE RESTRICT,
 approved_city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE RESTRICT,
 owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 reviewed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 team_id uuid NOT NULL REFERENCES public.vox_staff_teams_v1(id) ON DELETE RESTRICT,
 review_evidence_sha256 text NOT NULL CHECK (review_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 review_state text NOT NULL CHECK (review_state='APPROVED'),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (owner_user_id<>reviewed_by),
 CHECK (expires_at>created_at),
 UNIQUE(client_account_id,lead_id,conversation_id)
);
CREATE OR REPLACE FUNCTION public.qf_vox_rc12_client_binding_immutable_candidate_v1()
 RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'RC12_CLIENT_BINDING_IMMUTABLE'; END $$;
CREATE TRIGGER vox_rc12_client_binding_immutable BEFORE UPDATE OR DELETE
 ON public.vox_rc12_client_conversation_project_bindings_candidate_v1
 FOR EACH ROW EXECUTE FUNCTION public.qf_vox_rc12_client_binding_immutable_candidate_v1();
ALTER TABLE public.vox_rc12_client_conversation_project_bindings_candidate_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vox_rc12_client_conversation_project_bindings_candidate_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.vox_rc12_client_conversation_project_bindings_candidate_v1
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.qf_vox_rc12_client_binding_immutable_candidate_v1()
 FROM PUBLIC,anon,authenticated,service_role;
-- No service_role DML. Access requires a separate reviewed minimal-role transaction.
COMMIT;
