<#
.SYNOPSIS
    Runs ops/security/tests/vox_p0_4_admin_rls_session_transitions_pg17.sql inside a disposable,
    network-isolated postgres:17-alpine container.

.DESCRIPTION
    Starts a unique container with --network none and no published ports, mounts the repository
    root read-only at /qa, waits for Postgres readiness, executes the SQL test file via psql with
    ON_ERROR_STOP=1, fails the script on any nonzero exit code, and always stops/removes the container.
    Mirrors ops/security/tests/invoke-vox-p0-2-admin-rls-pg17.ps1; kept as a separate script because
    the P0-2 fixture is already signed off at 9/9 and this file must not change its meaning.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$SqlRelativePath = 'ops/security/tests/vox_p0_4_admin_rls_session_transitions_pg17.sql'
$SqlAbsolutePath = Join-Path $RepoRoot ($SqlRelativePath -replace '/', '\')

if (-not (Test-Path -LiteralPath $SqlAbsolutePath)) {
    throw "SQL test file not found: $SqlAbsolutePath"
}

$ContainerName = "vox-p0-4-admin-rls-pg17-$([guid]::NewGuid().ToString('N').Substring(0,12))"

$existing = & docker ps -a --filter "name=^/$ContainerName`$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) {
    throw "docker ps failed while checking for existing container '$ContainerName'."
}
if ($existing) {
    throw "A container named '$ContainerName' already exists. Aborting to avoid collision."
}

$containerStarted = $false

try {
    Write-Host "Starting disposable container '$ContainerName' (network: none, repo mounted read-only at /qa)..."

    & docker run -d `
        --name $ContainerName `
        --network none `
        -e POSTGRES_HOST_AUTH_METHOD=trust `
        -v "${RepoRoot}:/qa:ro" `
        postgres:17-alpine | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "docker run failed to start container '$ContainerName'."
    }
    $containerStarted = $true

    Write-Host 'Waiting for Postgres to become ready...'
    $maxAttempts = 60
    $ready = $false
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        & docker exec $ContainerName pg_isready -U postgres | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 1
    }

    if (-not $ready) {
        throw "Postgres did not become ready in container '$ContainerName' after $maxAttempts seconds."
    }

    Write-Host "Running $SqlRelativePath ..."
    & docker exec $ContainerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/qa/$SqlRelativePath"
    $sqlExitCode = $LASTEXITCODE

    if ($sqlExitCode -ne 0) {
        throw "SQL test file '$SqlRelativePath' failed with exit code $sqlExitCode."
    }

    Write-Host 'SQL test completed successfully.'
}
finally {
    if ($containerStarted) {
        Write-Host "Cleaning up container '$ContainerName'..."
        & docker stop $ContainerName | Out-Null
        & docker rm $ContainerName | Out-Null
    }
}
