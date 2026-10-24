# Controlled scratch PostgreSQL17 RLS composition integration run, no managed DB.
$ErrorActionPreference='Stop'
$repo='D:\QuickFurno-Workspace\Worktrees\qf-vox-step3b13-20261024'
$data='D:\QuickFurno-Workspace\Artifacts\STEP3B13-PG17-COMPOSITION-20261024'
$bin='C:\Program Files\PostgreSQL\17\bin'
$port=55479
if(Test-Path $data){throw 'Cannot use existing scratch DB; refuse overwrite.'}
if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw 'Scratch loopback port busy.'}
& "$bin\initdb.exe" -D $data -U postgres -A trust --no-instructions | Out-Null
if($LASTEXITCODE){throw 'Scratch init failed'}
$started=$false
try {
 & "$bin\pg_ctl.exe" -D $data -l "$data\pg17.log" -o "-c listen_addresses=127.0.0.1 -p $port" -w start
 if($LASTEXITCODE){throw 'Scratch PG startup failed'}
 $started=$true
 Push-Location $repo
 try {
   & "$bin\psql.exe" -X -h 127.0.0.1 -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -f "scripts\scale\step3b11b-pg17-rls-isolated.sql"
   if($LASTEXITCODE){throw 'Baseline RLS fixture failed'}
   & "$bin\psql.exe" -X -h 127.0.0.1 -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -f "scripts\scale\step3b13-rls-composition.sql"
   if($LASTEXITCODE){throw 'Compositional RLS test failed'}
   Write-Output 'STEP3B13_REAL_PG17_COMPOSITION_AND_TENANT_WRITE_CHECKS_PASS'
 } finally {Pop-Location}
} finally {
 if($started){& "$bin\pg_ctl.exe" -D $data -m fast -w stop | Out-Null}
 Write-Output "SCRATCH_SERVER_STOPPED; data retained at $data for inspection"
}
