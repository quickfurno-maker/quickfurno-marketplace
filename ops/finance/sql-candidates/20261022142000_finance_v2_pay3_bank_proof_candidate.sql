-- PAY-3 Final C: bank evidence separate from provider accounting, NOT installed.
-- Bank proof must be uploaded/reviewed out-of-band; no import automation in this file.
begin;
create table public.finance_bank_settlement_proofs (
 id uuid primary key default gen_random_uuid(),
 settlement_id uuid not null unique references public.finance_settlements(id) on delete restrict,
 receiving_account_ref text not null check(length(btrim(receiving_account_ref)) between 4 and 128),
 bank_reference text not null check(length(btrim(bank_reference)) between 4 and 128),
 statement_sha256 text not null check(statement_sha256 ~ '^[0-9a-f]{64}$'),
 deposited_subunits bigint not null check(deposited_subunits>=0),
 recorded_by uuid not null,verified_by uuid not null,
 approval_reference uuid not null unique,
 verified_at timestamptz not null default now(),
 check(recorded_by<>verified_by),
 unique(receiving_account_ref,bank_reference)
);
alter table public.finance_bank_settlement_proofs enable row level security;
alter table public.finance_bank_settlement_proofs force row level security;
revoke all on public.finance_bank_settlement_proofs from public,anon,authenticated;
grant select on public.finance_bank_settlement_proofs to service_role;
create trigger trg_finance_v2_no_history_change before update or delete
 on public.finance_bank_settlement_proofs
 for each row execute function public.qf_finance_v2_reject_history_mutation();

create or replace view public.qf_finance_v2_bank_reconciliation_v
with (security_invoker=true) as
select p.settlement_id,p.provider_mode,p.merchant_account_id,
 p.provider_settlement_id,p.declared_net_subunits,p.calculated_net_subunits,
 p.discrepancy_subunits,b.deposited_subunits,
 case when p.reconciliation_state='MISSING_LINES' then 'MISSING_PROVIDER_LINES'
 when b.id is null then 'BANK_EVIDENCE_NOT_VERIFIED'
 when p.discrepancy_subunits<>0 or b.deposited_subunits::numeric<>p.calculated_net_subunits
 then 'THREE_WAY_DISCREPANCY'
 else 'THREE_WAY_AMOUNT_MATCH' end as review_state
from public.qf_finance_v2_settlement_projection_v p
left join public.finance_bank_settlement_proofs b on b.settlement_id=p.settlement_id;
revoke all on public.qf_finance_v2_bank_reconciliation_v from public,anon,authenticated;
grant select on public.qf_finance_v2_bank_reconciliation_v to service_role;
comment on view public.qf_finance_v2_bank_reconciliation_v is
'PAY-3 bank statement hash and independent verification evidence. A three-way amount match is not accounting or GST certification.';
commit;
