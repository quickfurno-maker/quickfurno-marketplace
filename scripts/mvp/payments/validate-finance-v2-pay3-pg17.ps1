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
create table public.vendors(id uuid primary key);
create table public.payments(id uuid primary key);
create table public.vendor_package_orders(id uuid primary key,payment_provider text,
 provider_mode text,provider_order_id text unique,provider_amount_subunits bigint);
grant usage on schema public to service_role,anon,authenticated;
insert into public.vendors values ('10000000-0000-4000-8000-000000000007');
insert into public.payments values ('10000000-0000-4000-8000-000000000001');
insert into public.vendor_package_orders values ('10000000-0000-4000-8000-000000000001',
 'razorpay','test','order_12345',9999);
'@ | Out-Null
 docker exec $name pg_dump -Fc -U postgres -d postgres -f /tmp/pay3_pre.dump *> $null
 if($LASTEXITCODE -ne 0){throw 'PAY3_BACKUP_FAILED'}
 foreach($file in @(
 'ops\finance\sql-candidates\20261022090200_finance_v2_pay2_history_candidate.sql',
 'ops\finance\sql-candidates\20261022120100_finance_v2_pay3_evidence_candidate.sql',
 'ops\finance\sql-candidates\20261022133000_finance_v2_pay3_inbox_candidate.sql',
 'ops\finance\sql-candidates\20261022134000_finance_v2_pay3_refund_reservation_candidate.sql',
 'ops\finance\sql-candidates\20261022135000_finance_v2_pay3_staff_read_candidate.sql',
 'ops\finance\sql-candidates\20261022140000_finance_v2_pay3_settlement_projection_candidate.sql',
 'ops\finance\sql-candidates\20261022141000_finance_v2_pay3_webhook_receipt_candidate.sql',
 'ops\finance\sql-candidates\20261022142000_finance_v2_pay3_bank_proof_candidate.sql',
 'ops\finance\sql-candidates\20261022143000_finance_v2_pay4a_refund_release_candidate.sql',
 'ops\finance\sql-candidates\20261022144000_finance_v2_pay4a_vox_cases_candidate.sql',
 'ops\finance\sql-candidates\20261022145000_finance_v2_pay4b_inbox_recovery_candidate.sql')){
  $r=Sql ([IO.File]::ReadAllText((Join-Path $root $file)))
  if($r.code -ne 0){throw "PAY3_SQL_FAILED $file $($r.text)"}
  Write-Host "PASS PAY3_OFFLINE_SQL_APPLIED $file"
 }
 $a=Need 'PAY4A_EIGHTEEN_FORCE_RLS_FINANCE_CASE_TABLES' @'
select count(*)||'|'||
 count(*) filter(where relrowsecurity and relforcerowsecurity)||'|'||
 count(*) filter(where has_table_privilege('anon',oid,'SELECT')
 or has_table_privilege('authenticated',oid,'SELECT')
 or has_table_privilege('authenticated',oid,'INSERT')) from pg_class
 where relnamespace='public'::regnamespace and relkind='r'
 and relname like 'finance_%';
'@
 if($a -ne '18|18|0'){throw "PAY3_RLS_MISMATCH $a"}
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
 Need 'PAY3_SETTLEMENT_LINES_SOURCE_ONLY' @'
insert into public.finance_settlement_lines
(settlement_id,line_kind,amount_signed_subunits,source_reference,source_sha256)
select id,'capture',12000,'capture_test',repeat('a',64)
from public.finance_settlements where provider_settlement_id='setl_synthetic';
insert into public.finance_settlement_lines
(settlement_id,line_kind,amount_signed_subunits,source_reference,source_sha256)
select id,'fee',-2000,'fee_test',repeat('b',64)
from public.finance_settlements where provider_settlement_id='setl_synthetic';
'@ | Out-Null
 $projection=Need 'PAY3_SETTLEMENT_PROVIDER_LEDGER_PROJECTION' @'
select declared_net_subunits||'|'||calculated_net_subunits||'|'||
 discrepancy_subunits||'|'||reconciliation_state
 from public.qf_finance_v2_settlement_projection_v
 where provider_settlement_id='setl_synthetic';
'@
 if($projection -ne '10000|10000|0|AMOUNT_MATCH_ONLY'){
  throw "PAY3_PROJECTION_MISMATCH $projection"
 }
 $viewAccess=Need 'PAY3_SETTLEMENT_VIEW_NO_BROWSER_PRIVILEGE' @'
select has_table_privilege('authenticated',
 'public.qf_finance_v2_settlement_projection_v','SELECT')::int;
'@
 if($viewAccess -ne '0'){throw 'PAY3_SETTLEMENT_VIEW_UNSAFE'}

 $notYet=Need 'PAY3_BANK_NOT_CERTIFIED_WITHOUT_EVIDENCE' @'
select review_state from public.qf_finance_v2_bank_reconciliation_v
where provider_settlement_id='setl_synthetic';
'@
 if($notYet -ne 'BANK_EVIDENCE_NOT_VERIFIED'){throw "PAY3_BANK_PREMATURE_CLAIM $notYet"}
 Need 'PAY3_BANK_STATEMENT_REVIEW_FIXTURE' @'
insert into public.finance_bank_settlement_proofs
(settlement_id,receiving_account_ref,bank_reference,statement_sha256,
 deposited_subunits,recorded_by,verified_by,approval_reference)
select id,'bank-account-synthetic','utr-settlement-synthetic',repeat('c',64),
 10000,'00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000099'
from public.finance_settlements where provider_settlement_id='setl_synthetic';
'@ | Out-Null
 $three=Need 'PAY3_THREE_WAY_AMOUNT_PROOF' @'
select review_state from public.qf_finance_v2_bank_reconciliation_v
where provider_settlement_id='setl_synthetic';
'@
 if($three -ne 'THREE_WAY_AMOUNT_MATCH'){throw "PAY3_THREE_WAY_REVIEW_MISMATCH $three"}
 Refuse 'PAY3_BANK_EVIDENCE_IMMUTABLE' @'
update public.finance_bank_settlement_proofs set deposited_subunits=1;
'@
 $bankAccess=Need 'PAY3_BANK_PROJECTION_SERVICE_ONLY' @'
select has_table_privilege('authenticated',
'public.qf_finance_v2_bank_reconciliation_v','SELECT')::int;
'@
 if($bankAccess -ne '0'){throw "PAY3_BANK_LEAK $bankAccess"}
 $evt=Need 'PAY3_ATOMIC_SIGNED_JOURNAL' @'
select public.qf_finance_v2_record_webhook_v1(
 'evt_integrated_12345','test','merchant_synthetic','payment.captured',
 repeat('d',64),'order_12345','pay_12345',9999);
'@
 $evtRetry=Need 'PAY3_SIGNED_JOURNAL_DUPLICATE_SAME_ROW' @'
select public.qf_finance_v2_record_webhook_v1(
 'evt_integrated_12345','test','merchant_synthetic','payment.captured',
 repeat('d',64),'order_12345','pay_12345',9999);
'@
 if($evt -ne $evtRetry){throw "PAY3_WEBHOOK_REPLAY_NEW_ROW"}
 Refuse 'PAY3_SIGNED_JOURNAL_PAYLOAD_HASH_CONFLICT_DENIED' @'
select public.qf_finance_v2_record_webhook_v1(
 'evt_integrated_12345','test','merchant_synthetic','payment.captured',
 repeat('e',64),'order_12345','pay_12345',9999);
'@
 Refuse 'PAY3_SIGNED_JOURNAL_WRONG_AMOUNT_DENIED' @'
select public.qf_finance_v2_record_webhook_v1(
 'evt_integrated_12346','test','merchant_synthetic','payment.captured',
 repeat('d',64),'order_12345','pay_12345',10000);
'@
 Refuse 'PAY3_SIGNED_JOURNAL_WRONG_MODE_DENIED' @'
select public.qf_finance_v2_record_webhook_v1(
 'evt_integrated_12347','live','merchant_synthetic','payment.captured',
 repeat('d',64),'order_12345','pay_12345',9999);
'@
 $j=Need 'PAY3_SIGNED_JOURNAL_ENQUEUED_EXACTLY_ONCE' @'
select count(*) from public.finance_event_inbox_jobs j
join public.finance_provider_events e on e.id=j.provider_event_row_id
where e.provider_event_id='evt_integrated_12345';
'@
 if($j -ne '1'){throw "PAY3_JOURNAL_JOB_NOT_UNIQUE $j"}
 $journalPrivilege=Need 'PAY3_JOURNAL_RPC_NOT_BROWSER_ACCESSIBLE' @'
select has_function_privilege('authenticated',
'public.qf_finance_v2_record_webhook_v1(text,text,text,text,text,text,text,bigint)',
'EXECUTE')::int;
'@
 if($journalPrivilege -ne '0'){throw 'PAY3_UNSAFE_JOURNAL_RPC'}

 Need 'PAY3_SIGNED_PROVIDER_EVENT_FIXTURE' @'
insert into public.finance_provider_events
(id,provider,provider_mode,merchant_account_id,provider_event_id,event_type,payload_sha256,signature_verified)
values ('30000000-0000-4000-8000-000000000005','razorpay','test','synthetic-merchant',
 'evt_test_source','payment.captured',repeat('a',64),true);
'@ | Out-Null
 $first=Need 'PAY3_IDEMPOTENT_DURABLE_INBOX_RECEIPT' @'
select public.qf_finance_v2_enqueue_verified_event('30000000-0000-4000-8000-000000000005');
'@
 $again=Need 'PAY3_REPLAY_RETURNS_SAME_INBOX' @'
select public.qf_finance_v2_enqueue_verified_event('30000000-0000-4000-8000-000000000005');
'@
 if($first -ne $again){throw 'PAY3_INBOX_REPLAY_DUPLICATED'}
 $c=Need 'PAY3_CLAIM_LEASE' @'
select job_id||'|'||event_id||'|'||token||'|'||attempt_num
from public.qf_finance_v2_claim_inbox(1);
'@
 $fields=$c.Split('|')
 if($fields.Length -ne 4 -or $fields[3] -ne '1'){throw "PAY3_BAD_LEASE $c"}
 $noSecond=Need 'PAY3_CONCURRENT_CLAIMER_CANNOT_LEASE_SAME_EVENT' (
  "select count(*) from public.qf_finance_v2_claim_inbox(1) where event_id='"+$fields[1]+"';")
 if($noSecond -ne '0'){throw "PAY3_DOUBLE_CLAIM_SAME_EVENT $noSecond"}
 $wrong=Need 'PAY3_STALE_TOKEN_CANNOT_ACK' ("select public.qf_finance_v2_finish_inbox('"+$fields[0]+"','00000000-0000-4000-8000-000000000099','VERIFIED','PROVIDER_CHECKED');")
 if($wrong -ne 'f'){throw 'PAY3_WRONG_TOKEN_ACCEPTED'}
 $done=Need 'PAY3_EXACT_LEASE_ACK' ("select public.qf_finance_v2_finish_inbox('"+$fields[0]+"','"+$fields[2]+"','VERIFIED','PROVIDER_CHECKED');")
 if($done -ne 't'){throw 'PAY3_EXACT_LEASE_ACK_FAILED'}
 $replayed=Need 'PAY3_REPLAYED_ACK_REJECTED' ("select public.qf_finance_v2_finish_inbox('"+$fields[0]+"','"+$fields[2]+"','VERIFIED','PROVIDER_CHECKED');")
 if($replayed -ne 'f'){throw 'PAY3_DUPLICATE_ACK_ACCEPTED'}
 $state=Need 'PAY3_APPEND_ONLY_COMPLETION_EVIDENCE' @'
select j.state||'|'||count(e.id) from public.finance_event_inbox_jobs j
join public.finance_event_processing_evidence e on e.provider_event_row_id=j.provider_event_row_id
group by j.state;
'@
 if($state -ne 'VERIFIED|1'){throw "PAY3_COMPLETION_EVIDENCE_INVALID $state"}
 $permissions=Need 'PAY3_NO_BROWSER_INBOX_OR_RPC_PRIVILEGES' @'
select has_table_privilege('authenticated','public.finance_event_inbox_jobs','SELECT')::int||'|'||
 has_function_privilege('authenticated','public.qf_finance_v2_claim_inbox(integer)','EXECUTE')::int;
'@
 if($permissions -ne '0|0'){throw "PAY3_UNSAFE_PRIVILEGES $permissions"}

 Need 'PAY3_SYNTHETIC_CAPTURE_CONFIRMATION' @'
insert into public.finance_payment_attempts
(id,order_id,provider,provider_mode,merchant_account_id,provider_payment_id,
 expected_amount_subunits,initiated_source)
values('20000000-0000-4000-8000-000000000005',
'10000000-0000-4000-8000-000000000001','razorpay','test',
'synthetic-merchant','pay_synthetic_source',10000,'checkout');
insert into public.finance_capture_confirmations
(attempt_id,confirmed_subunits,provider_payment_id,provider_mode,
merchant_account_id,provider_fetch_sha256)
values('20000000-0000-4000-8000-000000000005',10000,
'pay_synthetic_source','test','synthetic-merchant',repeat('c',64));
'@ | Out-Null
 $res1=Need 'PAY3_ATOMIC_RESERVATION_1' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',6000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000031');
'@
 $res1Again=Need 'PAY3_REFUND_RESERVATION_IDEMPOTENT' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',6000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000031');
'@
 if($res1 -ne $res1Again){throw 'PAY3_RESERVATION_REPLAY_CREATED_NEW_ID'}
 Refuse 'PAY3_NO_SELF_APPROVED_REFUND_RESERVATION' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',1000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000032');
'@
 Refuse 'PAY3_REFUND_TOTAL_EXCEEDS_CAPTURE_REJECTED' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',5000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000033');
'@
 Refuse 'PAY3_APPROVAL_IDEMPOTENCY_CONFLICT' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',3000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000031');
'@
 $res2=Need 'PAY3_SECOND_PARTIAL_REFUND_AT_CAP' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',4000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000034');
'@
 $total=Need 'PAY3_REFUND_TOTAL_LIMIT_EXACTLY_CAPTURED' @'
select sum(requested_subunits) from public.finance_refund_reservations;
'@
 if($total -ne '10000'){throw "PAY3_REFUND_CAP_SUM_BAD $total"}
 Refuse 'PAY3_REFUND_HISTORY_IMMUTABLE' @'
update public.finance_refund_reservations set requested_subunits=100;
'@
 $fperm=Need 'PAY3_NO_BROWSER_REFUND_RPC' @'
select has_function_privilege('authenticated',
'public.qf_finance_v2_reserve_refund(uuid,bigint,uuid,uuid,uuid)','EXECUTE')::int;
'@
 if($fperm -ne '0'){throw 'PAY3_UNSAFE_REFUND_RPC_GRANTS'}

 $releaseSql="select public.qf_finance_v2_release_unsubmitted_refund('"+$res1+
 "','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012',"+
 "'00000000-0000-4000-8000-000000000041',repeat('e',64),'CANCELLED_BEFORE_GATEWAY');"
 $rel=Need 'PAY4A_REFUND_RELEASE_APPEND_ONLY' $releaseSql
 $relRetry=Need 'PAY4A_REFUND_RELEASE_REPLAY_IDEMPOTENT' $releaseSql
 if($rel -ne $relRetry){throw 'PAY4A_RELEASE_REPLAY_CHANGED_ID'}
 Refuse 'PAY4A_RELEASE_SELF_APPROVAL_DENIED' (
 "select public.qf_finance_v2_release_unsubmitted_refund('"+$res2+
 "','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011',"+
 "'00000000-0000-4000-8000-000000000043',repeat('e',64),'CANCELLED_BEFORE_GATEWAY');")
 Refuse 'PAY4A_RELEASED_APPROVAL_REUSE_DENIED' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',6000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000031');
'@
 $reallocated=Need 'PAY4A_RELEASED_FUNDS_REUSABLE_WITH_NEW_APPROVAL' @'
select public.qf_finance_v2_reserve_refund(
 '20000000-0000-4000-8000-000000000005',6000,
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000012',
 '00000000-0000-4000-8000-000000000044');
'@
 $active=Need 'PAY4A_ACTIVE_REFUND_CAP_NEVER_EXCEEDED' @'
select sum(r.requested_subunits)
from public.finance_refund_reservations r
where not exists(select 1 from public.finance_refund_reservation_releases
 where reservation_id=r.id);
'@
 if($active -ne '10000'){throw "PAY4A_ACTIVE_REFUND_OVER_CAP $active"}
 Refuse 'PAY4A_RELEASE_EVENT_IMMUTABLE' @'
update public.finance_refund_reservation_releases set reason_code='PROVIDER_NOT_SUBMITTED';
'@
 $releaseAccess=Need 'PAY4A_NO_BROWSER_REFUND_RELEASE_RPC' @'
select has_function_privilege('authenticated',
'public.qf_finance_v2_release_unsubmitted_refund(uuid,uuid,uuid,uuid,text,text)',
'EXECUTE')::int;
'@
 if($releaseAccess -ne '0'){throw 'PAY4A_REFUND_RELEASE_RPC_LEAK'}

 Need 'PAY4A_SYNTHETIC_GATEWAY_REFUND_JOURNAL' @'
insert into public.finance_refunds
(attempt_id,provider,provider_mode,merchant_account_id,
requested_amount_subunits,request_reason_code)
values('20000000-0000-4000-8000-000000000005','razorpay','test',
'synthetic-merchant',1000,'PROVIDER_SUBMISSION_UNCERTAIN');
'@ | Out-Null
 Refuse 'PAY4A_REFUND_SUBMITTED_ATTEMPT_RELEASE_BLOCKED' (
 "select public.qf_finance_v2_release_unsubmitted_refund('"+$res2+
 "','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012',"+
 "'00000000-0000-4000-8000-000000000045',repeat('f',64),'PROVIDER_NOT_SUBMITTED');")

 Need 'PAY3_VENDOR_SCOPED_FINANCE_STAFF_GRANT_FIXTURE' @'
insert into public.finance_staff_read_grants
(id,staff_user_id,team_id,city_id,vendor_id,requested_by,approved_by,approval_reference,expires_at)
values('30000000-0000-4000-8000-000000000050',
'00000000-0000-4000-8000-000000000013',
'00000000-0000-4000-8000-000000000014',
'00000000-0000-4000-8000-000000000015',
'10000000-0000-4000-8000-000000000007',
'00000000-0000-4000-8000-000000000011',
'00000000-0000-4000-8000-000000000012',
'00000000-0000-4000-8000-000000000016',now()+interval '1 day');
'@ | Out-Null
 Refuse 'PAY3_NO_STAFF_SELF_APPROVAL' @'
insert into public.finance_staff_read_grants
(staff_user_id,team_id,city_id,vendor_id,requested_by,approved_by,approval_reference,expires_at)
values('00000000-0000-4000-8000-000000000013',
'00000000-0000-4000-8000-000000000014',
'00000000-0000-4000-8000-000000000015',
'10000000-0000-4000-8000-000000000007',
'00000000-0000-4000-8000-000000000013',
'00000000-0000-4000-8000-000000000012',
'00000000-0000-4000-8000-000000000018',now()+interval '1 day');
'@
 Need 'PAY3_STAFF_REVOCATION_EVENT' @'
insert into public.finance_staff_read_revocations(grant_id,revoked_by,reason_code)
values('30000000-0000-4000-8000-000000000050',
'00000000-0000-4000-8000-000000000011','REVIEW_REVOKED');
'@ | Out-Null
 Refuse 'PAY3_STAFF_GRANT_HISTORY_IMMUTABLE' @'
delete from public.finance_staff_read_grants
where id='30000000-0000-4000-8000-000000000050';
'@

 Need 'PAY4A_FINANCE_STAFF_CASE_REQUEST' @'
insert into public.finance_staff_case_requests
(id,client_request_id,order_id,vendor_id,requested_by,case_kind,
requested_amount_subunits,evidence_sha256)
values('30000000-0000-4000-8000-000000000091',
'30000000-0000-4000-8000-000000000092',
'10000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000007',
'00000000-0000-4000-8000-000000000013',
'MANUAL_RECEIPT_REVIEW',1000,repeat('b',64));
'@ | Out-Null
 Refuse 'PAY4A_FINANCE_STAFF_CASE_DUPLICATE_REQUEST' @'
insert into public.finance_staff_case_requests
(client_request_id,order_id,vendor_id,requested_by,case_kind,
requested_amount_subunits,evidence_sha256)
values('30000000-0000-4000-8000-000000000092',
'10000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000007',
'00000000-0000-4000-8000-000000000013',
'MANUAL_RECEIPT_REVIEW',1000,repeat('b',64));
'@
 Refuse 'PAY4A_REVIEW_REQUESTER_PROVENANCE_MISMATCH' @'
insert into public.finance_staff_case_reviews
(case_id,reviewer_id,case_requester_id,decision,review_reference,reason_code)
values('30000000-0000-4000-8000-000000000091',
'00000000-0000-4000-8000-000000000012',
'00000000-0000-4000-8000-000000000055',
'APPROVED_FOR_FURTHER_CHECKS',
'30000000-0000-4000-8000-000000000093','FURTHER_CHECKS_REQUIRED');
'@
 Refuse 'PAY4A_SELF_REVIEW_REJECTED' @'
insert into public.finance_staff_case_reviews
(case_id,reviewer_id,case_requester_id,decision,review_reference,reason_code)
values('30000000-0000-4000-8000-000000000091',
'00000000-0000-4000-8000-000000000013',
'00000000-0000-4000-8000-000000000013',
'APPROVED_FOR_FURTHER_CHECKS',
'30000000-0000-4000-8000-000000000094','FURTHER_CHECKS_REQUIRED');
'@
 Need 'PAY4A_INDEPENDENT_REVIEW_EVIDENCE_ONLY' @'
insert into public.finance_staff_case_reviews
(case_id,reviewer_id,case_requester_id,decision,review_reference,reason_code)
values('30000000-0000-4000-8000-000000000091',
'00000000-0000-4000-8000-000000000012',
'00000000-0000-4000-8000-000000000013',
'APPROVED_FOR_FURTHER_CHECKS',
'30000000-0000-4000-8000-000000000095','FURTHER_CHECKS_REQUIRED');
'@ | Out-Null
 Refuse 'PAY4A_REVIEW_IMMUTABLE' @'
update public.finance_staff_case_reviews set decision='REJECTED';
'@
 $casePriv=Need 'PAY4A_FINANCE_CASE_NO_AUTHENTICATED_DML' @'
select has_table_privilege('authenticated','public.finance_staff_case_requests','INSERT')::int
||'|'||has_table_privilege('authenticated','public.finance_staff_case_reviews','SELECT')::int;
'@
 if($casePriv -ne '0|0'){throw "PAY4A_CASE_PRIVILEGES_LEAK $casePriv"}

 Need 'PAY4B2_SYNTHETIC_EXHAUSTED_LEASE' @'
update public.finance_event_inbox_jobs set
 state='LEASED',attempts=5,lease_token='30000000-0000-4000-8000-000000000077',
 lease_until=now()-interval '2 minutes'
 where provider_event_row_id='30000000-0000-4000-8000-000000000005';
'@ | Out-Null
 $closed=Need 'PAY4B2_EXPIRED_MAX_ATTEMPTS_TO_DEAD_LETTER' @'
select public.qf_finance_v2_expire_exhausted_inbox(10);
'@
 if($closed -ne '1'){throw "PAY4B2_EXPIRATION_MISSED $closed"}
 $closedAgain=Need 'PAY4B2_DEAD_LETTER_REPLAY_SAFE' @'
select public.qf_finance_v2_expire_exhausted_inbox(10);
'@
 if($closedAgain -ne '0'){throw "PAY4B2_DEAD_LETTER_DUPLICATE $closedAgain"}
 $health=Need 'PAY4B2_AGGREGATE_AUDIT_HEALTH' @'
select dead_letter||'|'||expired from public.qf_finance_v2_inbox_health_v;
'@
 if($health -ne '1|0'){throw "PAY4B2_INVALID_HEALTH $health"}
 $workerPerm=Need 'PAY4B2_NO_BROWSER_RECOVERY_RPC_ACCESS' @'
select has_function_privilege('authenticated',
'public.qf_finance_v2_expire_exhausted_inbox(integer)','EXECUTE')::int;
'@
 if($workerPerm -ne '0'){throw "PAY4B2_RPC_LEAK"}

 Need 'PAY4C1_REFUND_RACE_SYNTHETIC_FIXTURE' @'
insert into public.finance_payment_attempts
(id,order_id,provider,provider_mode,merchant_account_id,
 provider_payment_id,expected_amount_subunits,initiated_source)
values('20000000-0000-4000-8000-000000000070',
'10000000-0000-4000-8000-000000000001',
'razorpay','test','synthetic-merchant','pay_parallel_ref',10000,'checkout');
insert into public.finance_capture_confirmations
(attempt_id,confirmed_subunits,provider_payment_id,provider_mode,
 merchant_account_id,provider_fetch_sha256)
values('20000000-0000-4000-8000-000000000070',
10000,'pay_parallel_ref','test','synthetic-merchant',repeat('f',64));
'@ | Out-Null
 $raceScript=[IO.File]::ReadAllText((Join-Path $root 'scripts/mvp/payments/finance-pay4c1-two-clients.sh'))
 $raceResult=($raceScript | docker exec -i $name sh 2>&1 | Out-String)
 $raceExit=$LASTEXITCODE
 if($raceExit -ne 0 -or $raceResult -notmatch 'PAY4C1_TWO_PG_CLIENTS_EXACTLY_ONE_PASS'){
  throw "PAY4C1_PARALLEL_PG_RACE_FAILED $raceResult"
 }
 Write-Host 'PASS PAY4C1_TWO_INDEPENDENT_POSTGRES_CLIENTS_EXACTLY_ONE_APPROVED'
 $reserved=Need 'PAY4C1_REFUND_CAP_AFTER_REAL_CONCURRENCY' @'
select count(*)::text||'|'||coalesce(sum(requested_subunits),0)::text
from public.finance_refund_reservations
where attempt_id='20000000-0000-4000-8000-000000000070';
'@
 if($reserved -ne '1|7000'){throw "PAY4C1_REFUND_CAP_RACE_FAILURE $reserved"}

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
