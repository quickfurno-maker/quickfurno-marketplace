$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$name="qf-vox-rc75-atomic-bad-lead-$PID"
$fixture=Join-Path $root 'scripts\mvp\vox\fixtures\rc75-bad-lead-status-minimal.pg17.sql'
$candidate=Join-Path $root 'ops\vox\sql-candidates\20261102040000_vox_rc75_bad_lead_review_atomic_REVIEW_ONLY.sql'
if(docker ps -aq --filter "name=^/$name$"){throw 'RC75_DOCKER_CONTAINER_COLLISION'}
function Query([string]$sql,[bool]$failExpected=$false){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{
  $out=& docker exec $name psql -X -U postgres -d postgres -A -t -v ON_ERROR_STOP=1 -c $sql 2>&1
  $code=$LASTEXITCODE
 }finally{$ErrorActionPreference=$old}
 if(($code -ne 0) -ne $failExpected){throw "RC75_SQL_EXPECTED_FAILURE_MISMATCH"}
 if($failExpected){return ""}
 return ($out|Out-String).Trim()
}
function RunSqlFile([string]$path,[string]$remote){
 & docker cp $path "$($name):/tmp/$remote" | Out-Null
 if($LASTEXITCODE -ne 0){throw 'RC75_DOCKER_COPY_FAILED'}
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=& docker exec $name psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/tmp/$remote" 2>&1;$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 if($code -ne 0){throw 'RC75_PG_SQL_INSTALL_DISPOSABLE_FAILED'}
}
function Check([bool]$condition,[string]$what){
 if(-not $condition){throw "RC75_PG17_ASSERT_FAILED:$what"}
 Write-Output "PASS $what"
}
try{
 & docker pull postgres:17-alpine|Out-Null
 if($LASTEXITCODE -ne 0){throw 'RC75_POSTGRES_IMAGE_FAILED'}
 & docker run --rm -d --name $name -e POSTGRES_PASSWORD=rc75_disposable_only postgres:17-alpine|Out-Null
 if($LASTEXITCODE -ne 0){throw 'RC75_POSTGRES_BOOT_FAILED'}
 $ready=$false
 for($i=0;$i -lt 35;$i++){& docker exec $name pg_isready -U postgres -d postgres 2>$null|Out-Null;if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Milliseconds 650}
 if(-not $ready){throw 'RC75_POSTGRES_NOT_READY'}
 RunSqlFile $fixture 'rc75-fixture.sql'
 RunSqlFile $candidate 'rc75-candidate.sql'
 $fn='public.qf_vox_rc75_bad_lead_status_atomic_candidate_v1'
 $actor='66666666-6666-4666-8666-666666666666'
 $valid="select $fn('11111111-1111-4111-8111-111111111111','Valid','reviewed','$actor');"
 $result=(Query $valid)|ConvertFrom-Json
 Check ($result.ok -eq $true -and $result.assignmentFlagged -eq $true -and $result.leadCreditsIssued -eq 0 -and $result.providerMessagesSent -eq 0) 'atomic review receipt has zero credits and zero provider sends'
 Check ((Query "select is_bad_lead_reported from public.lead_assignments where id='22222222-2222-4222-8222-222222222222';") -eq 't') 'linked original assignment flagged'
 Check ((Query "select status from public.bad_lead_reports where id='11111111-1111-4111-8111-111111111111';") -eq 'Valid') 'report status committed with linked original assignment'
 [void](Query "select $fn('33333333-3333-4333-8333-333333333333','Valid','bad','$actor');" $true)
 Check ((Query "select status from public.bad_lead_reports where id='33333333-3333-4333-8333-333333333333';") -eq 'Under Review') 'missing assignment cannot partially commit report'
 [void](Query "select $fn('55555555-5555-4555-8555-555555555555','Valid','bad','$actor');" $true)
 Check ((Query "select status from public.bad_lead_reports where id='55555555-5555-4555-8555-555555555555';") -eq 'Under Review') 'missing original assignment is refused'
 [void](Query "select $fn('11111111-1111-4111-8111-111111111111','Cash Refund','forged','$actor');" $true)
 Check ((Query "select status from public.bad_lead_reports where id='11111111-1111-4111-8111-111111111111';") -eq 'Valid') 'invalid money refund status denied'
 [void](Query 'create function public.rc75_suppress_assignment_update() returns trigger language plpgsql as $$ begin return null; end $$;')
 [void](Query "create trigger rc75_suppress_assignment before update on public.lead_assignments for each row execute function public.rc75_suppress_assignment_update();")
 [void](Query "select $fn('11111111-1111-4111-8111-111111111111','Valid','SUPPRESSED','$actor');" $true)
 Check ((Query "select admin_notes from public.bad_lead_reports where id='11111111-1111-4111-8111-111111111111';") -eq 'reviewed') 'suppressed linked assignment update atomically rolls back report metadata'
 [void](Query "drop trigger rc75_suppress_assignment on public.lead_assignments;")
 [void](Query "drop function public.rc75_suppress_assignment_update();")
 Check ((Query "select has_function_privilege('public','public.qf_vox_rc75_bad_lead_status_atomic_candidate_v1(uuid,text,text,uuid)','EXECUTE');") -eq 'f') 'PUBLIC cannot execute review candidate'
 Check ((Query "select prosecdef from pg_proc where proname='qf_vox_rc75_bad_lead_status_atomic_candidate_v1';") -eq 'f') 'review candidate is SECURITY INVOKER'
 Check ((Query "select count(*) from information_schema.tables where table_name like '%wallet%' or table_name like '%credit%';") -eq '0') 'no wallet or credit table created'
 Write-Output 'VOX_RC75_BAD_LEAD_ATOMIC_CANDIDATE_PG17_DISPOSABLE_PASS managed_install=false releaseGo=false'
}finally{
 & docker rm -f $name 2>$null|Out-Null
}
