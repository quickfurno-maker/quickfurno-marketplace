-- PAY-4A VOX Finance evidence-only request/review candidates. UNINSTALLED.
-- No wallet, bank, paid-status, refund or provider execution is authorized.
begin;
create table public.finance_staff_case_requests (
 id uuid primary key default gen_random_uuid(),
 client_request_id uuid not null,
 order_id uuid not null references public.vendor_package_orders(id) on delete restrict,
 vendor_id uuid not null references public.vendors(id) on delete restrict,
 requested_by uuid not null,
 case_kind text not null check(case_kind in ('MANUAL_RECEIPT_REVIEW','REFUND_POLICY_REVIEW')),
 requested_amount_subunits bigint not null check(requested_amount_subunits>0),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 unique(requested_by,client_request_id)
);
create index ix_finance_case_order_time on public.finance_staff_case_requests(order_id,created_at,id);
create table public.finance_staff_case_reviews(
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null unique references public.finance_staff_case_requests(id) on delete restrict,
 reviewer_id uuid not null,
 case_requester_id uuid not null,
 decision text not null check(decision in ('APPROVED_FOR_FURTHER_CHECKS','REJECTED')),
 review_reference uuid not null unique,
 reason_code text not null check(reason_code ~ '^[A-Z_]{3,64}$'),
 reviewed_at timestamptz not null default now(),
 check(reviewer_id<>case_requester_id)
);
do $$declare t text;begin
 foreach t in array array['finance_staff_case_requests','finance_staff_case_reviews'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated',t);
 execute format('grant select,insert on table public.%I to service_role',t);
 execute format('create trigger trg_finance_v2_no_history_change before update or delete
  on public.%I for each row execute function public.qf_finance_v2_reject_history_mutation()',t);
 end loop;
end $$;
-- SQL must enforce reviewer trace to original requester even for service-role inserts.
create or replace function public.qf_finance_v2_enforce_case_review()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_requester uuid;begin
 select requested_by into v_requester from public.finance_staff_case_requests where id=NEW.case_id;
 if v_requester is null or v_requester<>NEW.case_requester_id or
 NEW.reviewer_id=v_requester then
 raise exception 'FINANCE_REVIEWER_PROVENANCE_INVALID' using errcode='P0001';end if;
 return NEW;
end $$;
revoke all on function public.qf_finance_v2_enforce_case_review() from public,anon,authenticated;
grant execute on function public.qf_finance_v2_enforce_case_review() to service_role;
create trigger trg_finance_v2_case_reviewer_provenance before insert
 on public.finance_staff_case_reviews for each row
 execute function public.qf_finance_v2_enforce_case_review();
commit;
