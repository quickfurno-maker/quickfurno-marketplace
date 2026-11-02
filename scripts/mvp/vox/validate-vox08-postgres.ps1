$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$original=Get-Content (Join-Path $root 'scripts\mvp\vox\validate-vox-07-finalizer-postgres.ps1') -Raw
$needle=" Write-Output 'VOX07_DISPOSABLE_FINALIZER_PASS"
if(-not $original.Contains($needle)){throw 'VALIDATOR_BASE_CHANGED'}
$inject=@'
 $policy=Join-Path $root 'ops\vox\quarantined-migrations\legacy-20261014\20261014050000_vox_v1_team_leader_review_policy.sql'
 (Get-Content $policy -Raw) | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'TEAM_LEADER_SQL_FAILED'}
 $f=Join-Path $root 'scripts\mvp\vox\vox08-team-leader-fixture.sql'
 (Get-Content $f -Raw) | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'TEAM_LEADER_NEGATIVE_OR_POSITIVE_FAILED'}
 Write-Output 'VOX08_TEAM_LEADER_PG17_PASS owner_request=1 team_leader_review=1 owner_activation=1 escalation_denied=true owner_bypass_denied=true revoked_reviewer_denied=true'
'@
$generated=$original.Replace($needle,$inject+"`n"+$needle)
$name='qf-vox08-reviewed-grant-pg17'
$generated=$generated.Replace("qf-vox07-approved-finalizer-cert",$name)
$dest=Join-Path $root 'scripts\mvp\vox\generated-vox08-executor.ps1'
[IO.File]::WriteAllText($dest,$generated,[Text.UTF8Encoding]::new($false))
$env:VOX_TEST_PG_IMAGE='postgres:17-alpine'
& powershell -NoProfile -ExecutionPolicy Bypass -File $dest
if($LASTEXITCODE -ne 0){throw 'VOX08_PG17_SUITE_FAILED'}
