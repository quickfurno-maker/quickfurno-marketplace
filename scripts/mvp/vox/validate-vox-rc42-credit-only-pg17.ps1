# RC44 disposable PostgreSQL 17: optionally execute ACTUAL canonical functions.
# Never connects to managed databases; no real vendor credit is mutated.
param([switch]$UseCanonicalCreditAuthority)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$fixture=Join-Path $root 'scripts\mvp\vox\fixtures\rc42-bad-lead-credit-minimal.pg17.sql'
$candidate=Join-Path $root 'ops\vox\rc42-review-candidates\20261101020000_vox_rc42_bad_lead_credit_only_atomic_REVIEW_ONLY.sql'
$name="vox-rc42-credit-pg17-$PID"
$report1="11111111-1111-4111-8111-111111111111"
$report2="33333333-3333-4333-8333-333333333333"
$actor="66666666-6666-4666-8666-666666666666"
function Sql([string]$q) {
 $v=& docker exec $name psql -X -U postgres -d postgres -A -t -v ON_ERROR_STOP=1 -c $q 2>&1
 if($LASTEXITCODE -ne 0){throw "POSTGRES_QUERY_FAILED:$v"}
 return (($v|Out-String).Trim())
}
function RunFile([string]$file,[string]$dest){
 & docker cp $file ($name + ':/tmp/' + $dest) | Out-Null
 if($LASTEXITCODE -ne 0){throw "DOCKER_COPY_FAILED:$dest"}
 # PostgreSQL first boot may briefly accept pg_isready and then restart
 # before initdb has fully completed. Retry ONLY transient connection loss.
 # -1 wraps each fixture file in one transaction so interrupted imports never
 # leave a partial schema. SQL/permission errors fail immediately.
 for($try=1;$try -le 8;$try++){
  # Candidate includes its own explicit BEGIN/COMMIT; do not nest -1 there.
  # Native stderr NOTICE output is not a failure. On Windows PowerShell
  # ErrorActionPreference=Stop otherwise stops BEFORE $LASTEXITCODE is read.
  # PostgreSQL's ON_ERROR_STOP and nonzero exit code remain mandatory.
  $priorErrorAction=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try {
   if($dest -eq "rc42-candidate.sql"){
    $v=& docker exec $name psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f ("/tmp/"+$dest) 2>&1
   }else{
    $v=& docker exec $name psql -X --single-transaction -U postgres -d postgres -v ON_ERROR_STOP=1 -f ("/tmp/"+$dest) 2>&1
   }
   $runExit=$LASTEXITCODE
  }finally{$ErrorActionPreference=$priorErrorAction}
  if($runExit -eq 0){return}
  $detail=($v|Out-String)
  if($detail -notmatch '(?i)(connection to server|could not connect|server closed the connection|database system is starting up|server is starting up)'){
   throw "POSTGRES_FILE_FAILED_NONTRANSIENT:$dest $detail"
  }
  if($try -eq 8){throw "POSTGRES_FILE_CONNECT_RETRY_EXHAUSTED:$dest $detail"}
  Start-Sleep -Milliseconds (350*$try)
 }
}
function Assert([bool]$ok,[string]$label){if(-not $ok){throw "RC42_PG17_FAIL:$label"}; Write-Output "PASS $label"}
try{
 & docker pull postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'POSTGRES17_PULL_FAILED'}
 & docker run --rm -d --name $name -e POSTGRES_PASSWORD=disposable_rc42_only postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'POSTGRES17_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 35;$i++){& docker exec $name pg_isready -U postgres -d postgres 2>$null | Out-Null
  if($LASTEXITCODE -eq 0){$ready=$true;break}; Start-Sleep -Milliseconds 650}
 if(-not $ready){throw 'POSTGRES17_NOT_READY'}
 RunFile $fixture "rc42-fixture.sql"
 if($UseCanonicalCreditAuthority){
  # Fixture's deliberately simple stub uses different parameter names.
  # Replace it with the actual checked-in canonical function, never wrap it.
  [void](Sql 'DROP FUNCTION public.qf_approve_credit_restoration_v2(uuid,uuid,text);')
  $canonicalSource=Get-Content (Join-Path $root 'supabase\migrations\20260723000300_qf_mvp_canonical_assignment_authority.sql') -Raw
  $fn=@()
  foreach($namePart in @('qf_apply_credit_mutation_v2','qf_approve_credit_restoration_v2')){
   $regex='(?is)create or replace function public\.'+$namePart+'\(.*?\n\$\$;'
   $match=[regex]::Match($canonicalSource,$regex)
   if(-not $match.Success){throw "ACTUAL_CANONICAL_FUNCTION_MISSING:$namePart"}
   $fn+=$match.Value
  }
  $schema=@'
ALTER TABLE public.credit_restoration_approvals ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE public.vendors(id uuid PRIMARY KEY,remaining_credits integer NOT NULL,last_assigned_at timestamptz);
INSERT INTO public.vendors VALUES('22222222-2222-4222-8222-222222222222',10,NULL);
CREATE TABLE public.vendor_credit_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 vendor_id uuid NOT NULL,change_type text NOT NULL,
 credits_before integer NOT NULL,credits_delta integer NOT NULL,
 credits_after integer NOT NULL,reason text,updated_by text,
 reference_type text,reference_id text,approval_reference uuid,
 idempotency_key text UNIQUE,actor_kind text,actor_id uuid,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX rc44_credit_ref_unique ON public.vendor_credit_logs(reference_type,reference_id);
'@
  $tempSql=Join-Path ([System.IO.Path]::GetTempPath()) ("rc44-canonical-credit-"+$PID+".sql")
  Set-Content -Path $tempSql -Value ($schema+[Environment]::NewLine+($fn -join [Environment]::NewLine)) -Encoding utf8
  RunFile $tempSql 'rc44-real-canonical.sql'
 }
 RunFile $candidate "rc42-candidate.sql"
 Assert ((Sql "select count(*) from pg_indexes where indexname='vox_rc42_bad_lead_once_per_original_assignment';") -eq '1') 'bad-lead scoped unique credit guard in disposable PG17'
 Assert ((Sql "select count(*) from pg_indexes where indexname='vox_rc56_all_evidence_once_per_original_assignment';") -eq '1') 'cross-evidence assignment-wide unique index exists in disposable PG17'
 $call1="select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$report1','$actor');"
 $call2="select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$report2','$actor');"
 $r1=(Sql $call1)|ConvertFrom-Json
 Assert ($r1.status -eq 'applied' -and $r1.lead_credits_restored -eq 1 -and $r1.cash_refunded_minor_units -eq 0) 'one approved complaint restores exactly one LEAD credit'
 $replay=(Sql $call1)|ConvertFrom-Json
 $another=(Sql $call2)|ConvertFrom-Json
 Assert ($replay.status -eq 'already_applied' -and $replay.lead_credits_restored -eq 0) 'same report replay cannot credit again'
 Assert ($another.status -eq 'already_applied' -and $another.lead_credits_restored -eq 0) 'second report for SAME original assignment cannot credit again'
 $wallet=if($UseCanonicalCreditAuthority){'select remaining_credits from public.vendors;'}else{'select lead_credits from public.credit_test_wallet;'}
 Assert ((Sql $wallet) -eq '11') 'wallet gained only one LEAD credit'
 if($UseCanonicalCreditAuthority){Assert ((Sql "select count(*) from public.vendor_credit_logs where change_type='approved_bad_lead_restoration' and credits_delta=1;") -eq '1') 'real canonical ledger: exactly one approved restoration'}
 $wrong=(Sql "select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$report1','77777777-7777-4777-8777-777777777777');")|ConvertFrom-Json
 Assert ($wrong.reason_code -eq 'verified_owner_required') 'forged administrator denied'
 Assert ((Sql "select count(*) from public.credit_restoration_approvals where status='applied';") -eq '1') 'only one canonical approval'
 # Prove ACTUAL overlapping PostgreSQL transactions on the same original assignment.
 # Force first approved restoration to pause inside the inserting transaction;
 # second report locks the same assignment and must wait/replay, not double credit.
 $assignment2='88888888-8888-4888-8888-888888888888'
 $a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 $b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 $vendor='22222222-2222-4222-8222-222222222222'
 $lead='55555555-5555-4555-8555-555555555555'
 $ins="insert into public.lead_assignments values ('$assignment2','$vendor','$lead',true,'delivered'); insert into public.bad_lead_reports (id,vendor_id,lead_assignment_id,status,reason_code,recovery_status) values ('$a','$vendor','$assignment2','Approved','bad_lead_validated','recommended'),('$b','$vendor','$assignment2','Approved','bad_lead_validated','recommended');"
 [void](Sql $ins)
 $slow="CREATE OR REPLACE FUNCTION public.rc42_disposable_delay_insert() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN PERFORM pg_sleep(0.6); RETURN NEW; END'; CREATE TRIGGER rc42_disposable_credit_overlap BEFORE INSERT ON public.credit_restoration_approvals FOR EACH ROW EXECUTE FUNCTION public.rc42_disposable_delay_insert();"
 [void](Sql $slow)
 $jobs=@()
 foreach($id in @($a,$b)){
  $query="select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$id','$actor');"
  $jobs+=Start-Job -ArgumentList $name,$query -ScriptBlock {
   param($container,$sql)
   $raw=& docker exec $container psql -X -U postgres -d postgres -A -t -v ON_ERROR_STOP=1 -c $sql 2>&1
   if($LASTEXITCODE -ne 0){throw "PARALLEL_PG17_FAILED:$raw"}
   return (($raw|Out-String).Trim())
  }
 }
 try {
  $jobs|Wait-Job -Timeout 25|Out-Null
  Assert ((@($jobs|Where-Object State -eq 'Completed')).Count -eq 2) 'two overlapping credit restorations complete'
  $results=@($jobs|Receive-Job | ForEach-Object {$_|ConvertFrom-Json})
  Assert ((@($results|Where-Object status -eq 'applied')).Count -eq 1) 'exactly one transaction applied a second original assignment'
  Assert ((@($results|Where-Object status -eq 'already_applied')).Count -eq 1) 'contending second report replayed with zero additional credit'
  Assert ((Sql $wallet) -eq '12') 'true PostgreSQL overlap yields one extra credit, never two'
  if($UseCanonicalCreditAuthority){
   Assert ((Sql "select count(*) from public.vendor_credit_logs where change_type='approved_bad_lead_restoration' and credits_delta=1;") -eq '2') 'real canonical ledger: one row per original assignment'
   Assert ((Sql 'select count(*) from public.vendor_credit_logs where credits_after<>credits_before+credits_delta;') -eq '0') 'real ledger before/delta/after balances reconcile'
  }
  Assert ((Sql "select count(*) from public.credit_restoration_approvals where status='applied';") -eq '2') 'one canonical approval per original assignment after overlap'
 }finally { $jobs|Remove-Job -Force -ErrorAction SilentlyContinue }
 # A restoration previously applied via admin_request must also consume
 # the original assignment's single eligible lead-credit remedy. Testing an
 # unrelated evidence_type prevents silently granting a second credit.
 $assignment3='99999999-9999-4999-8999-999999999999'
 $report3='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 $prior3='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 $ledger3='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
 [void](Sql "insert into public.lead_assignments values ('$assignment3','$vendor','$lead',true,'delivered'); insert into public.bad_lead_reports (id,vendor_id,lead_assignment_id,status,reason_code,recovery_status) values ('$report3','$vendor','$assignment3','Approved','bad_lead_validated','recommended'); insert into public.credit_restoration_approvals(id,original_assignment_id,vendor_id,lead_id,evidence_type,evidence_reference,reason_code,requested_by,status,approved_by,idempotency_key,restoration_ledger_id) values ('$prior3','$assignment3','$vendor','$lead','admin_request','historical-owner-review','historical_credit','$actor','applied','$actor','historical-compensation:$assignment3','$ledger3');")
 $third=(Sql "select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$report3','$actor');")|ConvertFrom-Json
 Assert ($third.status -eq 'rejected' -and $third.reason_code -eq 'existing_other_restoration_requires_review') 'historical OTHER evidence-type restoration blocks second LEAD credit'
 Assert ((Sql $wallet) -eq '12') 'cross-evidence double-credit attempt leaves real wallet unchanged'
 Assert ((Sql "select count(*) from public.credit_restoration_approvals where original_assignment_id='$assignment3';") -eq '1') 'cross-evidence attempt cannot create a second approval'
 # Verify the NEW RC56 index really forbids another active approval from any
 # evidence type, even when inserted outside the guarded bad-lead RPC.
 $duplicateId='ffffffff-ffff-4fff-8fff-ffffffffffff'
 $duplicateError=$null
 try{
  [void](Sql "insert into public.credit_restoration_approvals(id,original_assignment_id,vendor_id,lead_id,evidence_type,evidence_reference,reason_code,requested_by,status,approved_by,idempotency_key) values ('$duplicateId','$assignment3','$vendor','$lead','manual_reconciliation','additional','other','$actor','requested','$actor','duplicate-compensation:$assignment3');")
 }catch{$duplicateError=$_.Exception.Message}
 Assert ($duplicateError -match 'vox_rc56_all_evidence_once_per_original_assignment') 'cross-evidence unique index blocks direct competing approval in actual PG17'
 Assert ((Sql "select count(*) from public.credit_restoration_approvals where original_assignment_id='$assignment3';") -eq '1') 'cross-evidence violating insert rolls back without touching prior restoration'
 # A canonical function can replay a previously applied credit even when
 # a new approval row was inserted. The wrapper must reject the replay,
 # roll the approval insertion back and leave the wallet untouched.
 $assignment4='12121212-1212-4212-8212-121212121212'
 $report4='13131313-1313-4313-8313-131313131313'
 [void](Sql "insert into public.lead_assignments values ('$assignment4','$vendor','$lead',true,'delivered'); insert into public.bad_lead_reports(id,vendor_id,lead_assignment_id,status,reason_code,recovery_status) values ('$report4','$vendor','$assignment4','Approved','bad_lead_validated','recommended');")
 # PostgreSQL forbids renaming input parameters in CREATE OR REPLACE.
 # The disposable fixture and actual canonical function use different names.
 $fakeArgs=if($UseCanonicalCreditAuthority){'p_approval_id uuid,p_actor_id uuid,p_reason_code text'}else{'p_approval uuid,p_actor uuid,p_reason text'}
 $fakeReturn="CREATE OR REPLACE FUNCTION public.qf_approve_credit_restoration_v2($fakeArgs) RETURNS jsonb LANGUAGE sql AS 'SELECT jsonb_build_object(''status'',''already_applied'',''ledger_id'',gen_random_uuid())';"
 [void](Sql $fakeReturn)
 $replayRejected=$false
 try{[void](Sql "select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$report4','$actor');")}
 catch{$replayRejected=$_.Exception.Message -match 'RC60_CANONICAL_CREDIT_NOT_NEWLY_APPLIED'}
 Assert $replayRejected 'new credit cannot be reported from a canonical already_applied response'
 Assert ((Sql "select count(*) from public.credit_restoration_approvals where original_assignment_id='$assignment4';") -eq '0') 'canonical replay aborts new approval in same PostgreSQL transaction'
 Assert ((Sql $wallet) -eq '12') 'canonical replay cannot increment wallet again'
 # A pre-existing counterfeit index with the expected name must never make
 # CREATE INDEX IF NOT EXISTS silently certify the wrong uniqueness rule.
 [void](Sql 'drop index public.vox_rc56_all_evidence_once_per_original_assignment;')
 [void](Sql 'create index vox_rc56_all_evidence_once_per_original_assignment on public.credit_restoration_approvals(vendor_id);')
 $spoofRejected=$false
 try{RunFile $candidate 'rc42-candidate.sql'}
 catch{
  $spoofMessage=$_.Exception.Message
  $spoofRejected=$spoofMessage -match 'RC57_CROSS_EVIDENCE_INDEX_DEFINITION_UNTRUSTED'
  # Deliberately do not print raw database error contents in CI logs.
 }
 Assert $spoofRejected 'spoofed same-name non-unique index fails reviewed SQL candidate before installing a release'
 if($UseCanonicalCreditAuthority){Write-Output 'VOX_RC44_CANONICAL_CREDIT_PG17_DISPOSABLE_PASS'}
 else {Write-Output 'VOX_RC42_CREDIT_ONLY_PG17_DISPOSABLE_PASS'}
}finally{
 & docker rm -f $name 2>$null | Out-Null
 if($tempSql -and (Test-Path $tempSql)){Remove-Item $tempSql -Force}
}
