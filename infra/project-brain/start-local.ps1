$ErrorActionPreference = "Stop"

$brainDir = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $brainDir "..\..")).Path
$graphitiSource = Join-Path $env:USERPROFILE ".quickfurno-project-brain\graphiti"
$passwordFile = Join-Path $brainDir ".neo4j-password"

if (-not (Test-Path $graphitiSource)) {
  throw "Graphiti source missing at $graphitiSource"
}

$gemini = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "User")
if ([string]::IsNullOrWhiteSpace($gemini)) {
  $gemini = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "Process")
}
if ([string]::IsNullOrWhiteSpace($gemini)) {
  throw "GEMINI_API_KEY is not configured for this Windows user."
}

if (-not (Test-Path $passwordFile)) {
  $password = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  [IO.File]::WriteAllText($passwordFile, $password, [Text.UTF8Encoding]::new($false))
}

$env:GOOGLE_API_KEY = $gemini
$env:NEO4J_USER = "neo4j"
$env:NEO4J_PASSWORD = (Get-Content $passwordFile -Raw).Trim()
$env:GRAPHITI_SOURCE_DIR = $graphitiSource.Replace("\", "/")
$env:MODEL_NAME = "gemini-3.5-flash-lite"
$env:EMBEDDER_MODEL = "gemini-embedding-001"
$env:QF_GRAPHITI_PORT = "18000"
$env:QF_PROJECT_BRAIN_DOCKERFILE = (Join-Path $brainDir "Dockerfile.graphiti-quickfurno").Replace("\", "/")
$env:QF_NEO4J_HTTP_PORT = "17474"
$env:QF_NEO4J_BOLT_PORT = "17687"
if ([string]::IsNullOrWhiteSpace($env:ProgramData)) { $env:ProgramData = "C:\ProgramData" }

Set-Location $brainDir
if (-not (docker info --format "{{.ServerVersion}}" 2>$null)) {
  throw "Docker engine is not running. Start Docker Desktop first."
}

docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw "docker compose config failed" }

$imagePresent = docker image ls --format "{{.Repository}}:{{.Tag}}" | Where-Object { $_ -eq "quickfurno/graphiti-mcp:0.30.2-gemini-c035afb-r1" }
if (-not $imagePresent) {
  docker compose build graphiti-mcp
  if ($LASTEXITCODE -ne 0) { throw "Graphiti image build failed" }
}

docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "Project Brain startup failed" }

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18000/health" -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
}
if (-not $healthy) {
  docker compose ps
  docker compose logs --tail 80 graphiti-mcp
  throw "Graphiti health check failed"
}

Write-Output "QF_PROJECT_BRAIN=READY"
Write-Output "GRAPHITI_MCP=http://127.0.0.1:18000/mcp/"
Write-Output "NEO4J_BROWSER=http://127.0.0.1:17474"
