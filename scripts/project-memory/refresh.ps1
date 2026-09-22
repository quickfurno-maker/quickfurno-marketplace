$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$graphify = Join-Path $env:USERPROFILE ".local\bin\graphify.exe"
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source

if (-not (Test-Path $graphify)) {
  throw "Graphify is not installed at $graphify"
}
if ([string]::IsNullOrWhiteSpace($uv)) {
  throw "uv is not available on PATH"
}

Set-Location $repoRoot
& (Join-Path $repoRoot "infra\project-brain\start-local.ps1")
if ($LASTEXITCODE -ne 0) { throw "Project Brain runtime startup failed" }

# start-local.ps1 enters its infrastructure directory; restore repository root.
Set-Location $repoRoot
& $graphify update .
if ($LASTEXITCODE -ne 0) { throw "Graphify refresh failed" }

node scripts/project-memory/export-graphify-summary.mjs
if ($LASTEXITCODE -ne 0) { throw "Graphify summary export failed" }

& $uv run --with "mcp>=1.27.2,<2" python scripts/project-memory/graphiti_bridge.py validate
if ($LASTEXITCODE -ne 0) { throw "Graphiti validation failed" }

& $uv run --with "mcp>=1.27.2,<2" python scripts/project-memory/graphiti_bridge.py export
if ($LASTEXITCODE -ne 0) { throw "Graphiti snapshot export failed" }

node scripts/project-memory/compact-graphiti-snapshots.mjs
if ($LASTEXITCODE -ne 0) { throw "Graphiti snapshot compaction failed" }

node scripts/project-memory/verify.mjs
if ($LASTEXITCODE -ne 0) { throw "Project Brain verification failed" }

git diff --check
if ($LASTEXITCODE -ne 0) { throw "git diff --check failed" }

Write-Output "QF_PROJECT_BRAIN_REFRESH=PASS"
Write-Output "Updated Graphify intelligence and compact Graphiti ChatGPT snapshots."
