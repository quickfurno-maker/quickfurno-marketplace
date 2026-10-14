$ErrorActionPreference='Stop'
$name='qf-vox09c-atomic-intents-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$original=Get-Content (Join-Path $root 'scripts\mvp\vox\vox07-finalizer-fixture.sql') -Raw
$parts=$original -split '-- Synthetic profiles:',2
if($parts.Count -ne 2){throw 'BASE_FIXTURE_MISSING'}
if(docker ps -aq --filter "name=^/$name$"){throw 'ALREADY_RUNNING'}
$cid=$null
try{
 $cid=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=vox09c_synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'DB_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 30;$i++){docker exec $name pg_isready -U postgres *> $null;if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
 if(-not $ready){throw 'PG_NOT_READY'}
 $parts[0] | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'FIXTURE_BOOTSTRAP_FAILED'}
 foreach($f in @('20261014010000_vox_v1_scoped_staff_authority.sql','20261014060000_vox_operational_intent_review.sql')){
 (Get-Content (Join-Path $root ('supabase\migrations\'+$f)) -Raw) |
  docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw ('MIGRATION_FAILED '+$f)}
 }
 (Get-Content (Join-Path $root 'scripts\mvp\vox\vox09c-intent-fixture.sql') -Raw) |
  docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'REVIEW_FIXTURE_FAILED'}
 $perms=docker exec $name psql -X -A -t -U postgres -d postgres -c "SELECT (SELECT count(*) FROM pg_class WHERE relname LIKE 'vox_operational_%_v1' AND relrowsecurity AND relforcerowsecurity)::text || '|' ||has_function_privilege('authenticated','public.qf_vox_decide_operational_intent_v1(uuid,uuid,integer,text)','EXECUTE')::text;"
 if($LASTEXITCODE -ne 0 -or ([string]$perms).Trim() -ne '2|false'){throw ('UNEXPECTED_BROWSER_PRIVILEGES '+$perms)}
 Write-Output 'VOX09C_REAL_PG17_INTENT_REVIEW_PASS audit=2 no_browser_rpc=true source_only=true'
}finally{if($cid){docker rm -f $name *> $null}}
