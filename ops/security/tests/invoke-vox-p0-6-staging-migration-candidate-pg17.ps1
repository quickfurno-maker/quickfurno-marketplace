<#
.SYNOPSIS
  Runs the exact P0-6 Staging migration-candidate + rollback proof in disposable PostgreSQL 17.
.DESCRIPTION
  Network-none Docker, no published ports, repository mounted read-only, no managed credentials.
#>
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$SqlRelativePath='ops/security/tests/vox_p0_6_staging_migration_candidate_pg17.sql'
$SqlAbsolutePath=Join-Path $RepoRoot ($SqlRelativePath -replace '/','\')
if(-not (Test-Path -LiteralPath $SqlAbsolutePath)){ throw "SQL test file not found: $SqlAbsolutePath" }
$ContainerName="vox-p0-6-staging-candidate-$([guid]::NewGuid().ToString('N').Substring(0,12))"
$started=$false
try {
  & docker run -d --name $ContainerName --network none -e POSTGRES_HOST_AUTH_METHOD=trust -v "${RepoRoot}:/qa:ro" postgres:17-alpine | Out-Null
  if($LASTEXITCODE -ne 0){ throw 'docker run failed' }
  $started=$true
  $ready=$false
  for($i=1;$i -le 60;$i++){
    $initComplete = ((& cmd.exe /d /s /c "docker logs $ContainerName 2>&1") | Select-String -SimpleMatch 'PostgreSQL init process complete; ready for start up.')
    if($initComplete){
      $probe = (& docker exec $ContainerName psql -U postgres -d postgres -Atqc 'select 1' 2>$null | Out-String).Trim()
      if($LASTEXITCODE -eq 0 -and $probe -eq '1'){ $ready=$true; break }
    }
    Start-Sleep -Seconds 1
  }
  if(-not $ready){ & cmd.exe /d /s /c "docker logs $ContainerName 2>&1"; throw 'Final initialized Postgres readiness failed' }
  & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/qa/$SqlRelativePath"
  if($LASTEXITCODE -ne 0){ throw 'P0-6 migration-candidate SQL failed' }
  Write-Host 'P0-6 migration-candidate SQL completed successfully.'
} finally {
  if($started){ & docker stop $ContainerName | Out-Null; & docker rm $ContainerName | Out-Null }
}
