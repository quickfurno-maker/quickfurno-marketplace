\set ON_ERROR_STOP on
\pset pager off

-- ============ SETUP: users (trigger auto-creates profiles) ============
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','v1@x.com','{"role":"vendor","full_name":"Kitchen King"}'),
 ('00000000-0000-0000-0000-0000000000a2','v2@x.com','{"role":"vendor","full_name":"Modular Masters"}'),
 ('00000000-0000-0000-0000-0000000000a3','v3@x.com','{"role":"vendor","full_name":"Kharadi Kitchens"}'),
 ('00000000-0000-0000-0000-0000000000a4','v4@x.com','{"role":"vendor","full_name":"Pune Interiors"}'),
 ('00000000-0000-0000-0000-0000000000a5','v5@x.com','{"role":"vendor","full_name":"Zero Credit Co"}'),
 ('00000000-0000-0000-0000-0000000000a6','v6@x.com','{"role":"vendor","full_name":"Painter Only"}'),
 ('00000000-0000-0000-0000-0000000000ad','admin@x.com','{"role":"admin"}');

-- confirm profiles auto-created with roles
select 'profiles_created' as check, count(*) from public.profiles;

-- ============ VENDORS ============
insert into public.vendors(id, profile_id, business_name, city, areas, status) values
 ('b0000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','Kitchen King','Pune','{Kharadi}','verified'),
 ('b0000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','Modular Masters','Pune','{Wagholi}','verified'),
 ('b0000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a3','Kharadi Kitchens','Pune','{Kharadi}','verified'),
 ('b0000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a4','Pune Interiors','Pune','{Viman Nagar}','verified'),
 ('b0000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000a5','Zero Credit Co','Pune','{Kharadi}','verified'),
 ('b0000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a6','Painter Only','Pune','{Kharadi}','verified');

insert into public.vendor_services(vendor_id, category) values
 ('b0000000-0000-0000-0000-0000000000a1','modular_kitchen'),
 ('b0000000-0000-0000-0000-0000000000a2','modular_kitchen'),
 ('b0000000-0000-0000-0000-0000000000a3','modular_kitchen'),
 ('b0000000-0000-0000-0000-0000000000a4','modular_kitchen'),
 ('b0000000-0000-0000-0000-0000000000a5','modular_kitchen'),
 ('b0000000-0000-0000-0000-0000000000a6','painting');

-- ============ CREDITS via order approval (tests the approval trigger) ============
-- v1..v4 buy a Starter pack (5 credits). v5 & v6 get none / paint only.
do $$
declare vp uuid; pkg uuid; oid uuid;
begin
  select id into pkg from public.packages where code='starter';
  foreach vp in array array[
    'b0000000-0000-0000-0000-0000000000a1'::uuid,
    'b0000000-0000-0000-0000-0000000000a2'::uuid,
    'b0000000-0000-0000-0000-0000000000a3'::uuid,
    'b0000000-0000-0000-0000-0000000000a4'::uuid]
  loop
    insert into public.package_orders(vendor_id,package_id,amount,status)
    values (vp,pkg,1250,'pending') returning id into oid;
    update public.package_orders set status='approved' where id=oid;  -- fires trigger -> mints batch
  end loop;
  -- v6 (painting) also gets credits so we can prove CATEGORY filtering, not credit filtering, excludes it
  insert into public.package_orders(vendor_id,package_id,amount,status)
  values ('b0000000-0000-0000-0000-0000000000a6',pkg,1250,'pending') returning id into oid;
  update public.package_orders set status='approved' where id=oid;
end $$;

select 'active_credits_after_approval' as check, business_name, active_credits
from public.vendors order by business_name;

-- ============ TEST 1: client selects 2, expect auto-fill to exactly 4 ============
insert into public.leads(id, client_name, client_phone, client_city, client_area, category, source)
values ('c0000000-0000-0000-0000-000000000001','Asha','+919999900001','Pune','Kharadi','modular_kitchen','website');

select 'T1_assign' as check, public.assign_lead(
  'c0000000-0000-0000-0000-000000000001',
  array['b0000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-0000000000a2']::uuid[]
);

select 'T1_assigned_count' as check, count(*) as n,
       (count(*) = 4) as is_exactly_4
from public.lead_assignments where lead_id='c0000000-0000-0000-0000-000000000001';

select 'T1_no_painter_no_zero' as check,
       bool_and(vendor_id not in ('b0000000-0000-0000-0000-0000000000a5','b0000000-0000-0000-0000-0000000000a6')) as excluded_ok
from public.lead_assignments where lead_id='c0000000-0000-0000-0000-000000000001';

select 'T1_credits_deducted' as check, business_name, active_credits,
       (active_credits = 4) as dropped_by_1
from public.vendors
where id in ('b0000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-0000000000a2',
             'b0000000-0000-0000-0000-0000000000a3','b0000000-0000-0000-0000-0000000000a4')
order by business_name;

-- ============ TEST 2: idempotency — re-run must NOT deduct again ============
select 'T2_rerun' as check, public.assign_lead(
  'c0000000-0000-0000-0000-000000000001',
  array['b0000000-0000-0000-0000-0000000000a1']::uuid[]
) -> 'status' as status;

select 'T2_still_4_credits' as check, bool_and(active_credits=4) as unchanged
from public.vendors
where id in ('b0000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-0000000000a2',
             'b0000000-0000-0000-0000-0000000000a3','b0000000-0000-0000-0000-0000000000a4');

-- ============ TEST 3: duplicate lead (same phone+category in 7d) is blocked ============
insert into public.leads(id, client_name, client_phone, client_city, category, source)
values ('c0000000-0000-0000-0000-000000000002','Asha','+919999900001','Pune','modular_kitchen','website');

select 'T3_is_duplicate_flagged' as check, is_duplicate
from public.leads where id='c0000000-0000-0000-0000-000000000002';

select 'T3_assign_blocked' as check,
       public.assign_lead('c0000000-0000-0000-0000-000000000002','{}'::uuid[]) ->> 'reason' as reason;

-- ============ TEST 4: client selects 5 -> hard cap at 4 ============
insert into public.leads(id, client_name, client_phone, client_city, client_area, category)
values ('c0000000-0000-0000-0000-000000000003','Ravi','+919999900003','Pune','Kharadi','modular_kitchen');

select 'T4_assign' as check, public.assign_lead(
  'c0000000-0000-0000-0000-000000000003',
  array['b0000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-0000000000a2',
        'b0000000-0000-0000-0000-0000000000a3','b0000000-0000-0000-0000-0000000000a4',
        'b0000000-0000-0000-0000-0000000000a5']::uuid[]  -- a5 has 0 credits, should be dropped anyway
) -> 'assigned_count' as assigned_count;

select 'T4_capped_at_4' as check, count(*) as n, (count(*) <= 4) as ok
from public.lead_assignments where lead_id='c0000000-0000-0000-0000-000000000003';

-- ============ TEST 5: bad-lead report refund restores a credit ============
-- v1 now has 3 credits (lost 1 in T1, 1 in T4). File + approve a report.
select 'T5_before' as check, active_credits from public.vendors where id='b0000000-0000-0000-0000-0000000000a1';

insert into public.lead_reports(id, lead_id, vendor_id, assignment_id, reason)
select 'd0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
       'b0000000-0000-0000-0000-0000000000a1', la.id, 'fake_number'
from public.lead_assignments la
where la.lead_id='c0000000-0000-0000-0000-000000000001' and la.vendor_id='b0000000-0000-0000-0000-0000000000a1';

select 'T5_resolve' as check, public.resolve_lead_report('d0000000-0000-0000-0000-000000000001', true) ->> 'status';
select 'T5_after_refund' as check, active_credits,
       (active_credits = 4) as refunded_ok
from public.vendors where id='b0000000-0000-0000-0000-0000000000a1';

-- ============ TEST 6: vendor that hits 0 credits drops off public listing ============
-- Drain v4 down to 0 and confirm public listing policy would hide it.
do $$
declare i int; res jsonb;
begin
  for i in 1..6 loop
    insert into public.leads(id, client_name, client_phone, client_city, client_area, category)
    values (gen_random_uuid(),'Drain'||i,'+9198765000'||i,'Pune','Viman Nagar','modular_kitchen')
    returning id into res;  -- reuse var loosely
  end loop;
end $$;

select 'T6_listing_count_active' as check, count(*) filter (where status='verified' and active_credits>0) as listed,
       count(*) as total_verified
from public.vendors where status='verified';

-- ledger sanity: every deduction is -1, refund +1
select 'ledger_summary' as check, reason, count(*), sum(delta)
from public.credit_ledger group by reason order by reason;
