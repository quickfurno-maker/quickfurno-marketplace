<#
 SOURCE-ONLY: prove two *independent* PostgreSQL transactions do not double
 claim a Core Staff work-notification job while one holds FOR UPDATE lock.
 Run ONLY against the disposable, network-none PostgreSQL17 clone.
#>
param(
 [Parameter(Mandatory=$true)][string]$Container,
 [Parameter(Mandatory=$true)][string]$DatabaseName,
 [Parameter(Mandatory=$true)][string]$Repo
)
$ErrorActionPreference='Stop'
if($Container -notmatch '^qf-vox08n-replay-[a-f0-9]{12}$' -or
 $DatabaseName -ne 'vox08n_disposable'){throw 'REFUSE_NONDISPOSABLE_TARGET'}
$net=(& docker inspect -f '{{.HostConfig.NetworkMode}}' $Container)
$ports=(& docker inspect -f '{{len .HostConfig.PortBindings}}' $Container)
if($net -ne 'none' -or $ports -ne '0'){throw 'REFUSE_NETWORKED_DB'}
$source=Join-Path $Repo 'ops\vox\tests\vox08n_two_session_claim_fixture.sql'
if(!(Test-Path -LiteralPath $source)){throw 'FIXTURE_NOT_IN_REVIEW_SOURCE'}
& docker cp $source ($Container+':/tmp/vox08n-two-session.sql')|Out-Null
if($LASTEXITCODE -ne 0){throw 'FIXTURE_COPY_FAILED'}
& docker exec -u postgres $Container psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $DatabaseName -f /tmp/vox08n-two-session.sql|Out-Null
if($LASTEXITCODE -ne 0){throw 'ISOLATED_WORK_EVENT_FIXTURE_FAILED'}
$worker1='11111111-1111-4111-8111-111111111111'
$worker2='22222222-2222-4222-8222-222222222222'
$sql1="BEGIN; SELECT 'CLAIMED:'||job_id::text FROM public.qf_vox_staff_notification_outbox_claim_v1('$worker1'::uuid,1,60); SELECT pg_sleep(7); COMMIT;"
$job=Start-Job -ScriptBlock {
 param($c,$d,$q)
 $ErrorActionPreference='Stop'
 & docker exec -u postgres $c psql -X -At -v ON_ERROR_STOP=1 -U postgres -d $d -c $q
 if($LASTEXITCODE -ne 0){throw 'WORKER1_QUERY_ERROR'}
} -ArgumentList $Container,$DatabaseName,$sql1
try{
 $inLock=$false
 for($i=0;$i -lt 40;$i++){
  $poll="SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query LIKE 'BEGIN;%' AND query LIKE '%pg_sleep(7)%'"
  $seen=(& docker exec -u postgres $Container psql -X -At -U postgres -d $DatabaseName -c $poll)
  if($LASTEXITCODE -ne 0){throw 'CANNOT_QUERY_ISOLATED_LOCK'}
  if($seen -eq '1'){$inLock=$true;break}
  Start-Sleep -Milliseconds 250
 }
 if(!$inLock){throw 'WORKER1_LOCK_NOT_OBSERVED'}
 $two=(& docker exec -u postgres $Container psql -X -At -v ON_ERROR_STOP=1 -U postgres -d $DatabaseName -c "SELECT job_id FROM public.qf_vox_staff_notification_outbox_claim_v1('$worker2'::uuid,1,60)")
 if($LASTEXITCODE -ne 0){throw 'WORKER2_QUERY_FAILED'}
 if(($two -join '').Trim() -ne ''){throw 'TWO_DATABASE_SESSIONS_CLAIMED_SAME_JOB'}
 Wait-Job -Job $job -Timeout 22|Out-Null
 if($job.State -ne 'Completed'){throw 'WORKER1_DID_NOT_FINISH'}
 $one=@(Receive-Job -Job $job -ErrorAction Stop)
 $claimed=@($one|Where-Object {$_ -match '^CLAIMED:[0-9a-f-]{36}$'})
 if($claimed.Count -ne 1){throw 'WORKER1_DID_NOT_CLAIM_EXACTLY_ONE_JOB'}
 $state=(& docker exec -u postgres $Container psql -X -At -U postgres -d $DatabaseName -c "SELECT state||'|'||attempts||'|'||lease_owner FROM public.vox_staff_notification_outbox_candidate_v1")
 if($state -ne "LEASED|1|$worker1"){throw 'ATOMIC_CLAIM_WAS_NOT_DURABLE'}
 Write-Output 'TWO_INDEPENDENT_PG_SESSIONS_SKIP_LOCKED_PASS=1_OF_2_CLAIMS'
 Write-Output 'WORKER1_LEASE_COMMITTED_WORKER2_SKIPPED_LOCKED_ROW'
}finally{
 if($job.State -eq 'Running'){Stop-Job -Job $job -ErrorAction SilentlyContinue}
 Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
}
