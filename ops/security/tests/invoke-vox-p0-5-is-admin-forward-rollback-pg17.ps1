<# Source-only P0-5 forward/rollback proof. Disposable PG17 only. #>
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$SqlRelativePath='ops/security/tests/vox_p0_5_is_admin_forward_rollback_pg17.sql'
$SqlAbsolutePath=Join-Path $RepoRoot ($SqlRelativePath -replace '/','\')
if(-not (Test-Path -LiteralPath $SqlAbsolutePath)){ throw "SQL test file not found: $SqlAbsolutePath" }
$ContainerName="vox-p0-5-is-admin-rollback-$([guid]::NewGuid().ToString('N').Substring(0,12))"
$started=$false
try {
  & docker run -d --name $ContainerName --network none -e POSTGRES_HOST_AUTH_METHOD=trust -v "${RepoRoot}:/qa:ro" postgres:17-alpine | Out-Null
  if($LASTEXITCODE -ne 0){ throw "docker run failed" }
  $started=$true
  $ready=$false
  for($i=1;$i -le 60;$i++){
    & docker exec $ContainerName pg_isready -U postgres | Out-Null
    if($LASTEXITCODE -eq 0){ $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if(-not $ready){ throw "Postgres readiness failed" }
  & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/qa/$SqlRelativePath"
  if($LASTEXITCODE -ne 0){ throw "P0-5 forward/rollback SQL failed" }
  Write-Host 'P0-5 forward/rollback SQL completed successfully.'
}
finally {
  if($started){ & docker stop $ContainerName | Out-Null; & docker rm $ContainerName | Out-Null }
}
