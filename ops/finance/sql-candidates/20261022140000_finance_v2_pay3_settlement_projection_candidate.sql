-- PAY-3D read-only source reconciliation: provider declaration versus signed ledger lines.
-- NOT bank confirmed, NOT recognized revenue, NOT installed. Requires PAY-3 evidence.
begin;
create or replace view public.qf_finance_v2_settlement_projection_v
with (security_invoker=true) as
select s.id as settlement_id,
 s.provider_mode,s.merchant_account_id,s.provider_settlement_id,
 s.declared_net_subunits,
 count(l.id)::bigint as line_count,
 coalesce(sum(l.amount_signed_subunits::numeric),0) as calculated_net_subunits,
 s.declared_net_subunits::numeric -
  coalesce(sum(l.amount_signed_subunits::numeric),0) as discrepancy_subunits,
 case
  when count(l.id)=0 then 'MISSING_LINES'
  when s.declared_net_subunits::numeric=coalesce(sum(l.amount_signed_subunits::numeric),0)
    then 'AMOUNT_MATCH_ONLY'
  else 'DISCREPANCY'
 end as reconciliation_state
from public.finance_settlements s
left join public.finance_settlement_lines l on l.settlement_id=s.id
group by s.id,s.provider_mode,s.merchant_account_id,s.provider_settlement_id,
 s.declared_net_subunits;
revoke all on public.qf_finance_v2_settlement_projection_v from public,anon,authenticated;
grant select on public.qf_finance_v2_settlement_projection_v to service_role;
comment on view public.qf_finance_v2_settlement_projection_v is
'PAY-3D source-only comparison against provider declarations, never bank statement confirmation or taxable revenue.';
commit;
