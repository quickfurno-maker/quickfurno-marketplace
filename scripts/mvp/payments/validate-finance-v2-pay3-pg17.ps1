# PAY-3 native PostgreSQL17 database rehearsal. Isolated Docker --network none ONLY.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$name='qf-finance-v2-pay3pg'
if(docker ps -aq --filter "name=^/$name$"){throw 'PAY3_CONTAINER_NAME_COLLISION'}
function Sql([string]$query){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$result=($query | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 return @{code=$code;text=$result.Trim()}
}
function Need([string]$label,[string]$query){
 $result=Sql $query
 if($result.code -ne 0){throw "$label FAILED $($result.text)"}
 Write-Host "PASS $label $($result.text)"
 return $result.text
}
function Refuse([string]$label,[string]$query){
 $r=Sql $query
 if($r.code -eq 0){throw "$label UNEXPECTEDLY_ALLOWED"}
 Write-Host "PASS $label REJECTED"
}
try {
 docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic-only postgres:17-alpine *> $null
 if($LASTEXITCODE -ne 0){throw 'PAY3_DOCKER_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 100;$i++){
  $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1 | Out-String)}finally{$ErrorActionPreference=$old}
  if($log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 250
 }
 if(!$ready){throw 'PAY3_DOCKER_NOT_READY'}
 Need 'PAY3_SYNTHETIC_CORE_SCHEMA' @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.payments(id uuid primary key);
create table public.vendor_package_orders(id uuid primary key);
grant usage on schema public to service_role,anon,authenticated;
insert into public.payments values ('10000000-0000-4000-8000-000000000001');
insert into public.vendor_package_orders values ('10000000-0000-4000-8000-000000000001');
'@ | Out-Null
 docker exec $name pg_dump -Fc -U postgres -d postgres -f /tmp/pay3_pre.dump *> $null
 if($LASTEXITCODE -ne 0){throw 'PAY3_BACKUP_FAILED'}
 foreach($file in @(
 'ops\finance\sql-candidates\20261022090200_finance_v2_pay2_history_candidate.sql',
 'ops\finance\sql-candidates\20261022120100_finance_v2_pay3_evidence_candidate.sql')){
  $r=Sql ([IO.File]::ReadAllText((Join-Path $root $file)))
  if($r.code -ne 0){throw "PAY3_SQL_FAILED $file $($r.text)"}
  Write-Host "PASS PAY3_OFFLINE_SQL_APPLIED $file"
 }
 $a=Need 'PAY3_EIGHT_IMMUTABLE_FORCE_RLS_TABLES' @'
select count(*)||'|'||
 count(*) filter(where relrowsecurity and relforcerowsecurity)||'|'||
 count(*) filter(where has_table_privilege('anon',oid,'SELECT')
 or has_table_privilege('authenticated',oid,'SELECT')
 or has_table_privilege('authenticated',oid,'INSERT')) from pg_class
 where relnamespace='public'::regnamespace and relkind='r'
 and relname like 'finance_%';
'@
 if($a -ne '8|8|0'){throw "PAY3_RLS_MISMATCH $a"}
 Need 'PAY3_SYNTHETIC_APPROVED_BANK_EVIDENCE' @'
insert into public.finance_manual_receipt_evidence
(payment_id,receiving_account_ref,normalized_utr,bank_statement_sha256,
 submitted_by,independently_verified_by,approval_reference) values
('10000000-0000-4000-8000-000000000001','bank-account-token','UTR1234',repeat('a',64),
 '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000013');
'@ | Out-Null
 Refuse 'PAY3_NO_SELF_VERIFICATION' @'
insert into public.finance_manual_receipt_evidence
(payment_id,receiving_account_ref,normalized_utr,bank_statement_sha256,
 submitted_by,independently_verified_by,approval_reference) values
('10000000-0000-4000-8000-000000000001','bank-account-token','DIFFUTR',repeat('a',64),
 '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000013');
'@
 Refuse 'PAY3_DUPLICATE_RECEIPT_PAYMENT_DENIED' @'
insert into public.finance_manual_receipt_evidence
(payment_id,receiving_account_ref,normalized_utr,bank_statement_sha256,
 submitted_by,independently_verified_by,approval_reference) values
('10000000-0000-4000-8000-000000000001','other-account','OTHERUTR',repeat('a',64),
 '00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000013');
'@
 Refuse 'PAY3_BANK_EVIDENCE_IMMUTABLE' @'
update public.finance_manual_receipt_evidence set normalized_utr='CHANGED';
'@
 Need 'PAY3_SETTLEMENT_RECORD' @'
insert into public.finance_settlements
(provider,provider_mode,merchant_account_id,provider_settlement_id,
 declared_net_subunits,provider_report_sha256)
values('razorpay','test','sandbox-merchant','setl_synthetic',10000,repeat('b',64));
'@ | Out-Null
 Refuse 'PAY3_DUPLICATE_PROVIDER_SETTLEMENT' @'
insert into public.finance_settlements
(provider,provider_mode,merchant_account_id,provider_settlement_id,
 declared_net_subunits,provider_report_sha256)
values('razorpay','test','sandbox-merchant','setl_synthetic',10000,repeat('b',64));
'@
 docker exec $name dropdb -U postgres --force postgres *> $null
 if($LASTEXITCODE -ne 0){throw 'PAY3_DROP_FAILED'}
 docker exec $name createdb -U postgres postgres *> $null
 if($LASTEXITCODE -ne 0){throw 'PAY3_CREATE_FAILED'}
 docker exec $name pg_restore -U postgres --no-owner -d postgres /tmp/pay3_pre.dump *> $null
 if($LASTEXITCODE -ne 0){throw 'PAY3_RESTORE_FAILED'}
 $restored=Need 'PAY3_RESTORE_BASELINE' @'
select count(*) from information_schema.tables where table_schema='public' and table_name like 'finance_%';
'@
 if($restored -ne '0'){throw "PAY3_RESTORE_LEAK $restored"}
 Write-Host 'PAY3_PG17_OFFLINE_ALL_CHECKS_PASS NO_SUPABASE_NO_PROVIDER'
}finally{docker rm -f $name *> $null}
