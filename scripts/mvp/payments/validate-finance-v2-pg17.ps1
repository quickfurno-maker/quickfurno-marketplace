# Finance V2 PAY-1 + PAY-2 native PostgreSQL 17 isolated migration/ACL/rollback.
# Strictly local Docker with --network none. NEVER connect to Supabase.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$name='qf-finance-v2-pay17'
if(docker ps -aq --filter "name=^/$name$"){throw 'DISPOSABLE_DOCKER_NAME_COLLISION'}
function Sql([string]$sql){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{
  $output=($sql | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String)
  $c=$LASTEXITCODE
 }finally{$ErrorActionPreference=$old}
 return @{code=$c;text=$output.Trim()}
}
function Need([string]$label,[string]$sql){
 $r=Sql $sql
 if($r.code -ne 0){throw "$label ERROR $($r.text)"}
 Write-Host "PASS $label $($r.text)"
 return $r.text
}
function Refuse([string]$label,[string]$sql){
 $r=Sql $sql
 if($r.code -eq 0){throw "$label MISSED_EXPECTED_REJECTION"}
 Write-Output "PASS $label REJECTED"
}
try{
 docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic-only postgres:17-alpine *> $null
 if($LASTEXITCODE -ne 0){throw 'OFFLINE_DOCKER_BOOT_FAILURE'}
 $ready=$false
 for($i=0;$i -lt 100;$i++){
  $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1 | Out-String)}
  finally{$ErrorActionPreference=$old}
  if($log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 200
 }
 if(!$ready){throw 'POSTGRES17_START_TIMEOUT'}
 Need 'FINANCE_PG17_CORE_FIXTURE' @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.vendors (id uuid primary key);
create table public.packages (id uuid primary key);
create table public.vendor_package_orders (
 id uuid primary key, vendor_id uuid references public.vendors(id),
 payment_provider text, provider_mode text, provider_status text,
 activation_status text, paid_at timestamptz
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
 vendor_id uuid references public.vendors(id),
 package_id uuid references public.packages(id),amount numeric,
 payment_method text,payment_status text,transaction_id text
);
grant usage on schema public to service_role,anon,authenticated;
grant select on table public.payments,public.vendor_package_orders to service_role;
insert into public.vendors values ('00000000-0000-4000-8000-000000000001');
insert into public.packages values ('00000000-0000-4000-8000-000000000002');
insert into public.vendor_package_orders values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','razorpay','live','captured','activated',now()),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','razorpay','test','captured','activated',now());
insert into public.payments (id,vendor_id,package_id,amount,payment_method,payment_status,transaction_id) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',100,'razorpay','Paid','pay_live'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',900,'razorpay','Paid','pay_test');
'@ | Out-Null
 docker exec $name pg_dump -Fc -U postgres -d postgres -f /tmp/finance_v2_pre.dump *> $null
 if($LASTEXITCODE -ne 0){throw 'PAY1_PAY2_DISPOSABLE_BACKUP_FAILED'}
 foreach($f in @(
  'ops\finance\sql-candidates\20261022090100_finance_v2_pay1_integrity_candidate.sql',
  'ops\finance\sql-candidates\20261022090200_finance_v2_pay2_history_candidate.sql'
 )){
  $r=Sql ([IO.File]::ReadAllText((Join-Path $root $f)))
  if($r.code -ne 0){throw "FINANCE_V2_SQL_INVALID $f $($r.text)"}
  Write-Output "PASS FINANCE_V2_NATIVE_DDL $f"
 }
 $projection=Need 'PAY1_TEST_NEVER_LIVE_COLLECTION' @'
select razorpay_live_captured_inr||'|'||razorpay_test_excluded_inr||'|'||
 razorpay_live_captured_this_month_inr||'|'||manual_recorded_unreconciled_inr
 from public.qf_finance_v2_collection_summary_v;
'@
 if($projection -ne '100|900|100|0'){throw "FINANCE_COLLECTION_PROJECTION_MISMATCH $projection"}
 Need 'PAY1_FIRST_MANUAL_UTR' @'
insert into public.payments(id,vendor_id,package_id,amount,payment_method,payment_status,transaction_id)
 values('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',25,'UPI','Pending','Abc123');
'@ | Out-Null
 Refuse 'PAY1_DUPLICATE_UTR_UPPER_TRIM_DENIED' @'
insert into public.payments(id,vendor_id,package_id,amount,payment_method,payment_status,transaction_id)
 values('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',25,'upi','Pending','  ABC123  ');
'@
 $access=Need 'FINANCE_V2_NO_BROWSER_ACCESS_AND_FORCE_RLS' @'
select count(*)||'|'||
 count(*) filter(where c.relrowsecurity and c.relforcerowsecurity)||'|'||
 count(*) filter(where has_table_privilege('anon',c.oid,'SELECT') or
 has_table_privilege('authenticated',c.oid,'SELECT') or
 has_table_privilege('authenticated',c.oid,'INSERT') or
 has_table_privilege('authenticated',c.oid,'UPDATE'))::text
 from pg_class c where c.relnamespace='public'::regnamespace
 and c.relkind='r' and c.relname in
 ('finance_payment_attempts','finance_provider_events','finance_refunds','finance_audit_events');
'@
 if($access -ne '4|4|0'){throw "FINANCE_V2_ACCESS_MISMATCH $access"}
 Need 'PAY2_REAL_ATTEMPT_RECEIPT' @'
insert into public.finance_payment_attempts
 (id,order_id,provider,provider_mode,merchant_account_id,provider_payment_id,expected_amount_subunits,initiated_source)
 values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 'razorpay','live','merchant-synthetic','pay_unique_1',10000,'checkout');
insert into public.finance_provider_events
 (id,provider,provider_mode,merchant_account_id,provider_event_id,event_type,order_id,attempt_id,payload_sha256,signature_verified)
 values('30000000-0000-4000-8000-000000000001','razorpay','live','merchant-synthetic','evt_unique_1','payment.captured',
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',repeat('a',64),true);
'@ | Out-Null
 Refuse 'PAY2_DUPLICATE_PROVIDER_PAYMENT_ID_DENIED' @'
insert into public.finance_payment_attempts(order_id,provider,provider_mode,merchant_account_id,provider_payment_id,expected_amount_subunits,initiated_source)
 values('10000000-0000-4000-8000-000000000001','razorpay','live','merchant-synthetic','pay_unique_1',10000,'checkout');
'@
 Refuse 'PAY2_DUPLICATE_WEBHOOK_EVENT_ID_DENIED' @'
insert into public.finance_provider_events(provider,provider_mode,merchant_account_id,provider_event_id,event_type,payload_sha256,signature_verified)
 values('razorpay','live','merchant-synthetic','evt_unique_1','payment.captured',repeat('b',64),true);
'@
 Refuse 'PAY2_UNSIGNED_EVENT_DENIED' @'
insert into public.finance_provider_events(provider,provider_mode,merchant_account_id,provider_event_id,event_type,payload_sha256,signature_verified)
 values('razorpay','live','merchant-synthetic','evt_unsigned','payment.captured',repeat('b',64),false);
'@
 Refuse 'PAY2_FINANCE_HISTORY_IMMUTABLE_UPDATE_DENIED' @'
update public.finance_provider_events set event_type='payment.failed'
 where provider_event_id='evt_unique_1';
'@
 Refuse 'PAY2_FINANCE_HISTORY_IMMUTABLE_DELETE_DENIED' @'
delete from public.finance_payment_attempts where provider_payment_id='pay_unique_1';
'@
 docker exec $name dropdb -U postgres --force postgres *> $null
 if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_DROP_FAILED'}
 docker exec $name createdb -U postgres postgres *> $null
 if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_RECREATE_FAILED'}
 docker exec $name pg_restore -U postgres --no-owner -d postgres /tmp/finance_v2_pre.dump *> $null
 if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_RESTORE_FAILED'}
 $check=Need 'PAY1_PAY2_DISPOSABLE_PRE_RESTORE' @'
select
 (select count(*) from information_schema.tables
 where table_schema='public' and table_name like 'finance_%')||'|'||
 (select count(*) from pg_views where schemaname='public' and viewname='qf_finance_v2_collection_summary_v');
'@
 if($check -ne '0|0'){throw "FINANCE_RESTORE_MISMATCH $check"}
 Write-Output 'FINANCE_V2_NATIVE_PG17_ALL_CHECKS_PASS; NO_MANAGED_DB_OR_PROVIDER_WRITE'
} finally {
 docker rm -f $name *> $null
}
