-- ============================================================================
-- QuickFurno — Phase 8B-1B-A: durable provider-account binding (EXPAND-ONLY)
--
-- Adds a NULLABLE `provider_account_id uuid` foreign key to the five communication
-- tables so that, in later subphases (B outbound / C inbound), a message or a verified
-- callback can be durably attributed to the exact approved `communication_provider_accounts`
-- row that owns it — instead of only a coarse provider KEY string.
--
-- THIS MIGRATION IS STRICTLY EXPAND-ONLY. It:
--   • adds nullable columns (no DEFAULT, no NOT NULL, no lifecycle CHECK, no trigger);
--   • adds foreign keys ON DELETE RESTRICT (bound history must outlive its account);
--   • re-partitions each PROVIDER-ORIGINATED uniqueness authority into paired
--     LEGACY (provider_account_id IS NULL) and BOUND (provider_account_id IS NOT NULL)
--     partial-unique namespaces, so two newly bound accounts can never collapse on a
--     legacy provider-key index, while every existing unbound row stays valid;
--   • never backfills, never infers ownership from environment/WABA/phone-number id,
--     never reassigns an existing row, never expands communication_provider_accounts,
--     never weakens RLS.
--
-- BUSINESS idempotency is left UNCHANGED and NOT account-scoped:
--   • communication_messages.idempotency_key (global app-generated enqueue dedup);
--   • communication_consent_ack_intents.uq_consent_ack_intent_idempotency (the
--     account-aware acknowledgement-response rule is deferred to Phase 8B-1B-C).
--
-- INVALID-signature receipts: this migration adds NO account-bound uniqueness namespace for
-- them, and their legacy uniqueness (uq_comm_webhook_receipt_payload_rejected_unbound) applies
-- ONLY where provider_account_id IS NULL. NOTE PRECISELY: because provider_account_id is a plain
-- nullable column with no CHECK/trigger, this A-stage SCHEMA does not itself prevent application
-- code from attempting to write a non-null provider_account_id onto an invalid-signature receipt —
-- it only declines to give such a row a bound uniqueness namespace. Guaranteeing that an invalid
-- signature can never bind an account is RUNTIME enforcement, deferred to Phase 8B-1B-C. The same
-- precision applies to WABA-only callbacks (template/account updates with no phone_number_id): this
-- A stage defines no binding path for them, and their runtime binding remains deferred to C.
--
-- Runs in the standard single implicit migration transaction: every replacement index is
-- CREATED before its predecessor is DROPPED, so there is never a window in which neither
-- the legacy nor the account-scoped uniqueness protection exists.
--
-- FAIL CLOSED ON SCHEMA DRIFT — deliberately NO `IF NOT EXISTS` / `IF EXISTS`. This migration has
-- not been applied anywhere and is written against an exact, frozen schema authority, so every
-- object it creates must not already exist and every predecessor index it drops must exist. Those
-- guards would not make the migration safer, they would SILENTLY MASK drift: `ADD COLUMN IF NOT
-- EXISTS` would accept a pre-existing provider_account_id that lacks the expected FK; `CREATE INDEX
-- IF NOT EXISTS` would accept an incorrectly-defined index of the same name (Postgres does not
-- compare definitions); `DROP INDEX IF EXISTS` would accept a missing predecessor authority. Bare
-- DDL makes the whole transaction ABORT and roll back instead — the correct outcome for an unapplied
-- expand-only stage whose review depends on the schema being exactly what the authority says.
-- ============================================================================

-- 1) EXPAND — nullable provider_account_id + FK ON DELETE RESTRICT (no default, no backfill).
alter table public.communication_messages
  add column provider_account_id uuid
    references public.communication_provider_accounts(id) on delete restrict;

alter table public.communication_delivery_events
  add column provider_account_id uuid
    references public.communication_provider_accounts(id) on delete restrict;

alter table public.communication_webhook_receipts
  add column provider_account_id uuid
    references public.communication_provider_accounts(id) on delete restrict;

alter table public.communication_inbound_messages
  add column provider_account_id uuid
    references public.communication_provider_accounts(id) on delete restrict;

alter table public.communication_consent_ack_intents
  add column provider_account_id uuid
    references public.communication_provider_accounts(id) on delete restrict;

-- 2) SUPPORTING FK/LOOKUP INDEXES.
--   A table needs a PLAIN account index exactly when its account-scoped UNIQUE partial (section 3)
--   does NOT cover every bound row — i.e. when that unique carries an extra predicate on a NULLABLE
--   column, leaving some bound rows outside every account-leading index. Evidence, per table:
--
--   • messages — REQUIRED: uq_comm_message_account_provider_message additionally requires
--     provider_message_id IS NOT NULL, and communication_messages.provider_message_id is NULLABLE
--     (a queued, not-yet-sent row has none), so bound queued rows fall outside it.
create index idx_communication_messages_provider_account
  on public.communication_messages(provider_account_id)
  where provider_account_id is not null;
--   • delivery_events — REQUIRED: uq_comm_delivery_event_account_event additionally requires
--     provider_event_id IS NOT NULL, and communication_delivery_events.provider_event_id is NULLABLE
--     (20260708000170: `provider_event_id text`), so a bound row whose provider_event_id is NULL falls
--     outside every account-leading index and would leave the FK and account lookups uncovered.
create index idx_comm_delivery_event_provider_account
  on public.communication_delivery_events(provider_account_id)
  where provider_account_id is not null;
--   • ack_intents — REQUIRED: it gains no account-scoped unique in A at all.
create index idx_comm_ack_intent_provider_account
  on public.communication_consent_ack_intents(provider_account_id)
  where provider_account_id is not null;
--
--   • inbound_messages — NOT added (would be redundant): uq_comm_inbound_account_message is keyed
--     (provider_account_id, provider_message_id) under the predicate `provider_account_id is not null`
--     ONLY. It is account-leading with no extra nullable predicate, so it already covers EVERY bound row.
--   • webhook_receipts — NOT added (would be redundant): uq_comm_webhook_receipt_payload_verified_account
--     is keyed (provider_account_id, payload_hash) — payload_hash is NOT NULL (20260708000170) — under
--     `signature_valid and provider_account_id is not null`, so it covers every bound VALID-signature row.
--     The only row it misses is a bound INVALID-signature receipt: a state Stage A deliberately gives no
--     bound namespace and that Phase 8B-1B-C must prevent at runtime. Indexing it here would add an index
--     serving only a state the design forbids.

-- 3) ACCOUNT-SCOPED PROVIDER-ORIGINATED NAMESPACES (paired legacy / bound partial uniques).

-- 3a) communication_messages — KEEP idempotency_key (global business) + the existing non-unique
--     idx_communication_messages_provider_message unchanged; ADD only the account-scoped unique.
create unique index uq_comm_message_account_provider_message
  on public.communication_messages(provider_account_id, provider_message_id)
  where provider_account_id is not null and provider_message_id is not null;

-- 3b) communication_delivery_events — pair the provider-scoped unique, then drop the original.
create unique index uq_comm_delivery_event_provider_event_legacy
  on public.communication_delivery_events(provider, provider_event_id, provider_message_id, normalized_event_type)
  where provider_event_id is not null and provider_account_id is null;
create unique index uq_comm_delivery_event_account_event
  on public.communication_delivery_events(provider_account_id, provider_event_id, provider_message_id, normalized_event_type)
  where provider_event_id is not null and provider_account_id is not null;
drop index public.uq_comm_delivery_event_provider_event;

-- 3c) communication_webhook_receipts — pair the VALID-signature uniques. The INVALID-signature
--     namespace is given NO account-bound uniqueness index; its legacy uniqueness applies only where
--     provider_account_id IS NULL. Keeping an invalid signature actually unbound is RUNTIME work for
--     Phase 8B-1B-C — the schema here declines a bound namespace, it does not enforce nullability.
create unique index uq_comm_webhook_receipt_provider_event_legacy
  on public.communication_webhook_receipts(provider, provider_event_id)
  where signature_valid and provider_event_id is not null and provider_account_id is null;
create unique index uq_comm_webhook_receipt_account_event
  on public.communication_webhook_receipts(provider_account_id, provider_event_id)
  where signature_valid and provider_event_id is not null and provider_account_id is not null;
drop index public.uq_comm_webhook_receipt_provider_event;

create unique index uq_comm_webhook_receipt_payload_verified_legacy
  on public.communication_webhook_receipts(provider, payload_hash)
  where signature_valid and provider_account_id is null;
create unique index uq_comm_webhook_receipt_payload_verified_account
  on public.communication_webhook_receipts(provider_account_id, payload_hash)
  where signature_valid and provider_account_id is not null;
drop index public.uq_comm_webhook_receipt_payload_verified;

-- invalid-signature receipts: provider-scoped, no account-bound counterpart index (unbound rows only;
-- runtime must keep provider_account_id NULL here — see the 3c note above and Phase 8B-1B-C).
create unique index uq_comm_webhook_receipt_payload_rejected_unbound
  on public.communication_webhook_receipts(provider, payload_hash)
  where not signature_valid and provider_account_id is null;
drop index public.uq_comm_webhook_receipt_payload_rejected;

-- 3d) communication_inbound_messages — pair the provider-scoped unique, then drop the original.
create unique index uq_comm_inbound_provider_message_legacy
  on public.communication_inbound_messages(provider, provider_message_id)
  where provider_account_id is null;
create unique index uq_comm_inbound_account_message
  on public.communication_inbound_messages(provider_account_id, provider_message_id)
  where provider_account_id is not null;
drop index public.uq_comm_inbound_provider_message;

-- 3e) communication_consent_ack_intents — nullable FK + account lookup index ONLY (added above).
--     Its business/response idempotency authority (uq_consent_ack_intent_idempotency) is UNCHANGED;
--     whether the acknowledgement is scoped per receiving account is a Phase 8B-1B-C decision.
