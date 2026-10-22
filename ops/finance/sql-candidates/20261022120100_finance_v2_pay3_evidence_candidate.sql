-- Finance V2 PAY-3 candidate. UNINSTALLED; source-only, DBA/AppSec/Owner HOLD.
-- Requires PAY-2 history candidate. Does not call Razorpay or alter credits.
begin;
create table public.finance_settlements (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='razorpay'),
 provider_mode text not null check(provider_mode in ('test','live')),
 merchant_account_id text not null check(length(btrim(merchant_account_id))>0),
 provider_settlement_id text not null check(length(btrim(provider_settlement_id))>0),
 currency text not null default 'INR' check(currency='INR'),
 declared_net_subunits bigint not null check(declared_net_subunits>=0),
 provider_report_sha256 text not null check(provider_report_sha256 ~ '^[0-9a-f]{64}$'),
 observed_at timestamptz not null default now(),
 unique(provider,provider_mode,merchant_account_id,provider_settlement_id)
);
create table public.finance_settlement_lines (
 id uuid primary key default gen_random_uuid(),
 settlement_id uuid not null references public.finance_settlements(id) on delete restrict,
 provider_event_id uuid references public.finance_provider_events(id) on delete restrict,
 line_kind text not null check(line_kind in ('capture','refund','fee','tax_on_fee','adjustment')),
 amount_signed_subunits bigint not null check(amount_signed_subunits<>0),
 currency text not null default 'INR' check(currency='INR'),
 source_reference text not null check(length(btrim(source_reference))>0),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 observed_at timestamptz not null default now(),
 unique(settlement_id,line_kind,source_reference)
);
create index ix_finance_v2_settlement_lines_settlement on public.finance_settlement_lines(settlement_id,observed_at,id);
-- Verification evidence is separate from 'Paid' and never auto-activates credits.
create table public.finance_manual_receipt_evidence (
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references public.payments(id) on delete restrict,
 receiving_account_ref text not null check(length(btrim(receiving_account_ref))>0),
 normalized_utr text not null check(normalized_utr=upper(btrim(normalized_utr)) and length(normalized_utr)>1),
 bank_statement_sha256 text not null check(bank_statement_sha256 ~ '^[0-9a-f]{64}$'),
 submitted_by uuid not null,
 independently_verified_by uuid not null,
 approval_reference uuid not null,
 observed_at timestamptz not null default now(),
 check(submitted_by<>independently_verified_by),
 unique(receiving_account_ref,normalized_utr),
 unique(payment_id)
);
-- Append-only observability; this is NOT an executable queue or distributed lock.
create table public.finance_event_processing_evidence (
 id uuid primary key default gen_random_uuid(),
 provider_event_row_id uuid not null references public.finance_provider_events(id) on delete restrict,
 attempt_sequence integer not null check(attempt_sequence>0),
 state text not null check(state in ('RECEIVED','VERIFICATION_FAILED','NEEDS_RETRY','PROVIDER_CONFIRMED','DEAD_LETTER')),
 observed_at timestamptz not null default now(),
 evidence_sha256 text check(evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
 unique(provider_event_row_id,attempt_sequence)
);
create index ix_finance_v2_processing_event on public.finance_event_processing_evidence(provider_event_row_id,attempt_sequence desc);
do $$
declare t text;
begin
 foreach t in array array[
  'finance_settlements','finance_settlement_lines',
  'finance_manual_receipt_evidence','finance_event_processing_evidence'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
  execute format('grant select,insert on table public.%I to service_role',t);
  execute format('create trigger trg_finance_v2_no_history_change before update or delete on public.%I for each row execute function public.qf_finance_v2_reject_history_mutation()',t);
 end loop;
end $$;
commit;
