# RC42 credit-only candidate isolated PostgreSQL 17 smoke.
# NEVER connects to managed environments; minimal wallet stub is disposable.
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
 $v=& docker exec $name psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f ("/tmp/"+$dest) 2>&1
 if($LASTEXITCODE -ne 0){throw "POSTGRES_FILE_FAILED:$dest $v"}
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
 RunFile $candidate "rc42-candidate.sql"
 Assert ((Sql "select count(*) from pg_indexes where indexname='vox_rc42_bad_lead_once_per_original_assignment';") -eq '1') 'assignment-wide unique credit guard in disposable PG17'
 $call1="select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$report1','$actor');"
 $call2="select public.qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1('$report2','$actor');"
 $r1=(Sql $call1)|ConvertFrom-Json
 Assert ($r1.status -eq 'applied' -and $r1.lead_credits_restored -eq 1 -and $r1.cash_refunded_minor_units -eq 0) 'one approved complaint restores exactly one LEAD credit'
 $replay=(Sql $call1)|ConvertFrom-Json
 $another=(Sql $call2)|ConvertFrom-Json
 Assert ($replay.status -eq 'already_applied' -and $replay.lead_credits_restored -eq 0) 'same report replay cannot credit again'
 Assert ($another.status -eq 'already_applied' -and $another.lead_credits_restored -eq 0) 'second report for SAME original assignment cannot credit again'
 Assert ((Sql 'select lead_credits from public.credit_test_wallet;') -eq '11') 'wallet gained only one LEAD credit'
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
  Assert ((Sql 'select lead_credits from public.credit_test_wallet;') -eq '12') 'true PostgreSQL overlap yields one extra credit, never two'
  Assert ((Sql "select count(*) from public.credit_restoration_approvals where status='applied';") -eq '2') 'one canonical approval per original assignment after overlap'
 }finally { $jobs|Remove-Job -Force -ErrorAction SilentlyContinue }
 Write-Output 'VOX_RC42_CREDIT_ONLY_PG17_DISPOSABLE_PASS'
}finally{
 & docker rm -f $name 2>$null | Out-Null
}
