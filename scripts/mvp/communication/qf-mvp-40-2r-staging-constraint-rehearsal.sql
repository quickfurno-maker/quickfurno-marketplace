-- ============================================================================
-- QF-MVP-40.2-R — STAGING ACK-INTENT CONSTRAINT REHEARSAL. ROLLBACK ONLY.
--
-- Executes the EXACT committed bytes of
--   supabase/migrations/20260721000100_communication_consent_ack_intent_provider_account_required.sql
--   (SHA-256 056696790cfdf2c55ab187dc58e211eab0aa232b47d131abd9009cebf5e831a0)
-- inside ONE explicit transaction against STAGING ONLY, verifies the resulting
-- constraint, and then ROLLS BACK. Nothing is retained.
--
-- WHY A REHEARSAL AND NOT AN APPLY. Staging never applied this migration, yet it
-- is marker 01/17 of the production cutover. Applying it permanently to staging
-- would create migration-history drift and consume a cutover step; rehearsing it
-- proves the exact DDL against the real staging schema and costs nothing.
--
-- CONTAINS: one BEGIN, zero COMMIT, one ROLLBACK, exactly one ALTER TABLE ADD
-- CONSTRAINT, no other DDL, no DML, no migration-history write, no function or
-- RPC call, no secret output.
--
-- FAIL CLOSED. Each assertion divides by a CASE that yields 0 when its condition
-- is false, raising division_by_zero and aborting the whole transaction.
--
-- The divisor MUST be the CASE, not a literal 1/0 inside an ELSE arm. PostgreSQL
-- constant-folds `1/0` while planning, so `case when <cond> then 1 else 1/0 end`
-- raises even when <cond> is TRUE — an earlier revision of this script aborted at
-- the very first assertion for exactly that reason, before any DDL ran. Making the
-- divisor depend on a catalogue subquery keeps evaluation at run time.
-- Reaching the final marker means every assertion held.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- PRECONDITIONS — measured again inside the transaction, never assumed.
-- ---------------------------------------------------------------------------
select 1 / (case when (to_regclass('public.communication_consent_ack_intents') is not null) then 1 else 0 end) as pre_01_table_exists;

select 1 / (case when (exists (select 1 from information_schema.columns
                           where table_schema='public'
                             and table_name='communication_consent_ack_intents'
                             and column_name='provider_account_id')) then 1 else 0 end) as pre_02_column_exists;

select 1 / (case when (not exists (select 1 from pg_constraint
                               where conname='communication_consent_ack_intents_provider_account_req_check')) then 1 else 0 end) as pre_03_constraint_absent;

select 1 / (case when ((select count(*) from public.communication_consent_ack_intents) = 0) then 1 else 0 end) as pre_04_zero_rows;

select 1 / (case when ((select count(*) from public.communication_consent_ack_intents
                    where provider_account_id is null) = 0) then 1 else 0 end) as pre_05_zero_null_rows;

select 1 / (case when (not exists (select 1 from supabase_migrations.schema_migrations
                               where version='20260721000100')) then 1 else 0 end) as pre_06_version_not_recorded;

-- ---------------------------------------------------------------------------
-- THE EXACT MIGRATION STATEMENT — byte-for-byte from the committed migration.
-- Validated immediately (no NOT VALID), no IF NOT EXISTS, no default, no DML.
-- ---------------------------------------------------------------------------
alter table public.communication_consent_ack_intents
  add constraint communication_consent_ack_intents_provider_account_req_check
  check (provider_account_id is not null);

-- ---------------------------------------------------------------------------
-- IN-TRANSACTION VERIFICATION
-- ---------------------------------------------------------------------------
select 1 / (case when (exists (select 1 from pg_constraint
                           where conname='communication_consent_ack_intents_provider_account_req_check')) then 1 else 0 end) as post_01_constraint_exists;

select 1 / (case when ((select pg_get_constraintdef(oid) from pg_constraint
                    where conname='communication_consent_ack_intents_provider_account_req_check')
                  = 'CHECK ((provider_account_id IS NOT NULL))') then 1 else 0 end) as post_02_predicate_exact;

select 1 / (case when ((select convalidated from pg_constraint
                    where conname='communication_consent_ack_intents_provider_account_req_check') = true) then 1 else 0 end) as post_03_validated;

select 1 / (case when ((select contype from pg_constraint
                    where conname='communication_consent_ack_intents_provider_account_req_check') = 'c') then 1 else 0 end) as post_04_is_check_constraint;

select 1 / (case when ((select count(*) from public.communication_consent_ack_intents) = 0) then 1 else 0 end) as post_05_rows_unchanged;

select 1 / (case when ((select count(*) from public.communication_consent_ack_intents
                    where provider_account_id is null) = 0) then 1 else 0 end) as post_06_null_rows_unchanged;

select 1 / (case when ((select count(*) from supabase_migrations.schema_migrations) = 17) then 1 else 0 end) as post_07_history_unchanged;

select 1 / (case when (not exists (select 1 from supabase_migrations.schema_migrations
                               where version='20260721000100')) then 1 else 0 end) as post_08_version_still_not_recorded;

-- Exactly one constraint of this name, on the intended table.
select 1 / (case when ((select count(*) from pg_constraint con
                    join pg_class c on c.oid=con.conrelid
                    join pg_namespace n on n.oid=c.relnamespace
                   where con.conname='communication_consent_ack_intents_provider_account_req_check'
                     and n.nspname='public'
                     and c.relname='communication_consent_ack_intents') = 1) then 1 else 0 end) as post_09_exactly_one_on_target_table;

-- ---------------------------------------------------------------------------
-- SUCCESS MARKER — reached only when every assertion above held.
-- ---------------------------------------------------------------------------
select 'QF_MVP_40_2R_STAGING_ACK_CONSTRAINT_REHEARSAL_REACHED' as marker,
       (select pg_get_constraintdef(oid) from pg_constraint
         where conname='communication_consent_ack_intents_provider_account_req_check') as constraint_def,
       (select convalidated::text from pg_constraint
         where conname='communication_consent_ack_intents_provider_account_req_check') as validated,
       (select count(*)::text from public.communication_consent_ack_intents) as ack_rows,
       (select count(*)::text from supabase_migrations.schema_migrations) as history_rows;

-- ---------------------------------------------------------------------------
-- MANDATORY ROLLBACK. Nothing above may be retained.
-- ---------------------------------------------------------------------------
ROLLBACK;
