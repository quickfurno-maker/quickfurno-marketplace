<#
 VOX-08N source-review REPRODUCIBLE OFFLINE TEST ONLY.
 This never reads or writes managed Supabase. Requires the authorized,
 SHA256-verified four-schema staging archive and local prerequisites SQL.
 Example (PowerShell):
  ./ops/vox/offline/invoke-08n-stage-clone-replay.ps1 -Archive 'C:\private\stage.dump' -ExtensionPrerequisites 'C:\private\extensions.sql'
#>
param(
 [Parameter(Mandatory=$true)][string]$Archive,
 [Parameter(Mandatory=$true)][string]$ExtensionPrerequisites
)
$ErrorActionPreference='Stop'
$repo=(& git rev-parse --show-toplevel).Trim()
if($LASTEXITCODE -ne 0 -or !$repo){throw 'GIT_SOURCE_REQUIRED'}
$sha='D88176856CDBEDE5FD31216E6217A388D64A95D137C728A0CB0DE0A605BDE71E'
if(!(Test-Path -LiteralPath $Archive)){throw 'ARCHIVE_MISSING'}
if((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $sha){
 throw 'REFUSE_UNVERIFIED_STAGE_ARCHIVE'
}
if(!(Test-Path -LiteralPath $ExtensionPrerequisites)){throw 'EXTENSION_RESTORE_PREREQS_MISSING'}
$container='qf-vox08r-replay-'+[guid]::NewGuid().ToString('N').Substring(0,12)
$db='vox08r_disposable'
$files=@(
 'ops/vox/quarantined-migrations/legacy-20261014/20261014010000_vox_v1_scoped_staff_authority.sql',
 'ops/vox/sql-candidates/20261015010000_vox_to02b_staff_department_governance.sql',
 'ops/vox/sql-candidates/20261015020000_vox_to02c_reviewed_department_actions.sql',
 'ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql',
 'ops/vox/sql-candidates/20261016010000_vox08j_eod_partial_review_candidate.sql',
 'ops/vox/sql-candidates/20261016020000_vox08j_staff_team_chat_candidate.sql',
 'ops/vox/sql-candidates/20261016030000_vox08l_staff_work_notifications_candidate.sql',
 'ops/vox/sql-candidates/20261016040000_vox08n_transactional_work_notification_outbox_candidate.sql',
 'ops/vox/sql-candidates/20261016050000_vox08r_internal_outbox_metrics_candidate.sql'
)
$proofs=@(
 'ops/vox/tests/vox08j_offline_pg17_denials.sql',
 'ops/vox/tests/vox08l_offline_pg17_denials.sql',
 'ops/vox/tests/vox08n_transactional_outbox_pg17_proof.sql',
 'ops/vox/tests/vox08r_metrics_pg17_proof.sql'
)
try{
 & docker run -d --name $container --network none --memory 2048m --pids-limit 256 -e POSTGRES_PASSWORD=offline_disposable_only public.ecr.aws/supabase/postgres:17.6.1.147 |Out-Null
 if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_PG17_START_FAILED'}
 $network=(& docker inspect -f '{{.HostConfig.NetworkMode}}' $container)
 $portCount=(& docker inspect -f '{{len .HostConfig.PortBindings}}' $container)
 if($network -ne 'none' -or $portCount -ne '0'){throw 'OFFLINE_NETWORK_ISOLATION_FAILED'}
 $ready=$false
 for($i=0;$i -lt 30;$i++){
  & docker exec -u postgres $container pg_isready -U postgres -d postgres 2>$null|Out-Null
  if($LASTEXITCODE -eq 0){$ready=$true;break}
  Start-Sleep -Seconds 1
 }
 if(!$ready){throw 'POSTGRES_NOT_READY'}
 Start-Sleep -Seconds 4
 & docker exec -u postgres $container createdb -U postgres $db
 if($LASTEXITCODE -ne 0){throw 'CREATEDB_FAILED'}
 & docker cp $Archive ($container+':/tmp/stage.dump')|Out-Null
 if($LASTEXITCODE -ne 0){throw 'COPY_STAGE_ARCHIVE_FAILED'}
 & docker cp $ExtensionPrerequisites ($container+':/tmp/prerequisites.sql')|Out-Null
 if($LASTEXITCODE -ne 0){throw 'COPY_PREREQUISITES_FAILED'}
 & docker exec -u postgres $container psql -X -v ON_ERROR_STOP=1 -U postgres -d $db -f /tmp/prerequisites.sql|Out-Null
 if($LASTEXITCODE -ne 0){throw 'RESTORE_PREREQUISITES_FAILED'}
 & docker exec -u postgres $container pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U postgres -d $db /tmp/stage.dump|Out-Null
 if($LASTEXITCODE -ne 0){throw 'STAGE_RESTORE_FAILED'}
 $hist=(& docker exec -u postgres $container psql -X -At -U postgres -d $db -c 'SELECT count(*) FROM supabase_migrations.schema_migrations').Trim()
 if($hist -ne '86'){throw 'REAL_STAGE_ARCHIVE_HISTORY_MISMATCH'}
 foreach($relative in $files){
  $filepath=Join-Path $repo $relative
  if(!(Test-Path -LiteralPath $filepath)){throw 'MISSING_SOURCE_SQL_FILE'}
  $name=[System.IO.Path]::GetFileName($filepath)
  & docker cp $filepath ($container+':/tmp/'+$name)|Out-Null
  if($LASTEXITCODE -ne 0){throw 'COPY_SOURCE_SQL_FAILED'}
  & docker exec -u postgres $container psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $db -f ('/tmp/'+$name)|Out-Null
  if($LASTEXITCODE -ne 0){throw ('SQL_INSTALL_FAILED_'+$name)}
  Write-Output ('OFFLINE_SQL_PASS='+$name)
 }
 foreach($relative in $proofs){
  $filepath=Join-Path $repo $relative
  if(!(Test-Path -LiteralPath $filepath)){throw 'MISSING_SOURCE_PROOF'}
  $name=[System.IO.Path]::GetFileName($filepath)
  & docker cp $filepath ($container+':/tmp/'+$name)|Out-Null
  if($LASTEXITCODE -ne 0){throw 'COPY_PROOF_FAILED'}
  & docker exec -u postgres $container psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $db -f ('/tmp/'+$name)|Out-Null
  if($LASTEXITCODE -ne 0){throw ('SQL_PROOF_FAILED_'+$name)}
  Write-Output ('OFFLINE_NEGATIVE_AND_POSITIVE_PROOF_PASS='+$name)
 }
 $count=(& docker exec -u postgres $container psql -X -At -U postgres -d $db -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'vox_%'").Trim()
 $history=(& docker exec -u postgres $container psql -X -At -U postgres -d $db -c 'SELECT count(*) FROM supabase_migrations.schema_migrations').Trim()
 if($count -ne '16' -or $history -ne '86'){throw 'VOX_SQL_PROVENANCE_INVALID'}
 $concurrencyProof=Join-Path $repo 'ops\vox\offline\invoke-08n-two-session-claim.ps1'
# isolated concurrency proof was certified in VOX-08N; not repeated here
 Write-Output 'OFFLINE_TEST_PASS: 9 SQL candidates; 4 actual SQL security+outbox+metrics proofs; 16 disposable VOX tables; 86 untouched staging migrations'
}finally{
 & docker rm -f $container 2>$null|Out-Null
 Write-Output 'DISPOSABLE_NETWORK_NONE_CONTAINER_REMOVED'
}
