# Offline only: transient local PostgreSQL17 cluster, no managed credentials or endpoints.
$ErrorActionPreference='Stop'
$repo='D:\QuickFurno-Workspace\Worktrees\qf-vox-step3b11-20261024'
$data='D:\QuickFurno-Workspace\Artifacts\STEP3B11-PG17-SCRATCH-R3-20261024'
$bin='C:\Program Files\PostgreSQL\17\bin'
$port=55477
if(Test-Path $data){throw 'Scratch path already exists; do not overwrite'}
if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw 'Scratch port busy'}
& "$bin\initdb.exe" -D $data -U postgres -A trust --no-instructions
if($LASTEXITCODE){throw 'initdb failed'}
$started=$false
try {
 & "$bin\pg_ctl.exe" -D $data -l "$data\pg17.log" -o "-c listen_addresses=127.0.0.1 -p $port" -w start
 if($LASTEXITCODE){throw 'server did not start'}
 $started=$true
 Push-Location $repo
 try {
 & "$bin\psql.exe" -X -h 127.0.0.1 -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -f "scripts\scale\step3b11b-pg17-rls-isolated.sql"
 if($LASTEXITCODE){throw 'offline RLS test failed'}
 Write-Output 'STEP3B11B_OFFLINE_REAL_POSTGRES17_RLS_PASS'
 } finally {Pop-Location}
} finally {
 if($started){& "$bin\pg_ctl.exe" -D $data -m fast -w stop}
 Write-Output ('Scratch PostgreSQL data for later inspection at '+$data)
}
