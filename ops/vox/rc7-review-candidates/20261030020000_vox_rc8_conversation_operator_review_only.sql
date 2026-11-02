-- RC8 Core conversation consent-bound operator review-only candidate.
-- NOT a managed migration and NOT an AB7B original source row.
-- Actual Core conversation/event tables are owned by QuickFurno; this receipt
-- records one provider-free human PAUSE/TAKEOVER. No messages/credits/opt-in.
BEGIN;
CREATE TABLE public.vox_rc8_conversation_operator_receipts_candidate_v1(
 nonce uuid PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES public.communication_conversations(id)
  ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('PAUSE_AI','TAKEOVER')),
 previous_revision bigint NOT NULL CHECK(previous_revision>=0),
 new_revision bigint NOT NULL CHECK(new_revision=previous_revision+1),
 event_id uuid NOT NULL UNIQUE REFERENCES public.communication_conversation_events(id)
  ON DELETE RESTRICT,
 consent_scope text NOT NULL CHECK(consent_scope='transactional'),
 canonical_source_ready boolean NOT NULL DEFAULT false CHECK(canonical_source_ready=false),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.vox_rc8_conversation_operator_receipts_candidate_v1
 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vox_rc8_conversation_operator_receipts_candidate_v1
 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.vox_rc8_conversation_operator_receipts_candidate_v1
 FROM PUBLIC,anon,authenticated,service_role;
-- No API or service_role DML permissions. Trusted isolated DB operator only;
-- use reviewed minimal role and original AB7B source binding before installation.
COMMIT;
