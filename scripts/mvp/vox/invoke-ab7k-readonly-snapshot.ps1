# OPERATOR-RUN, READ-ONLY catalog/privilege snapshot of QuickFurno Staging for AB7K.
# Stores NO credentials. The operator supplies the connection through their own
# session environment (PGHOST, PGUSER, PGPASSWORD, optional PGPORT/PGDATABASE).
# Every statement runs inside BEGIN READ ONLY ... ROLLBACK. Nothing is installed.
# This script was authored without being executed by its author.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$ProjectRef,
 [Parameter(Mandatory)][string]$OutDir,
 [string]$BackupManifest
)
$ErrorActionPreference='Stop'
$cli=Join-Path $PSScriptRoot 'ab7k-readonly-evidence.mjs'
foreach($v in 'PGHOST','PGUSER','PGPASSWORD'){
 if(-not [Environment]::GetEnvironmentVariable($v)){throw "MISSING_ENV_$v (set in YOUR session; never commit)"}
}
if(@('require','verify-ca','verify-full') -notcontains $env:PGSSLMODE){throw 'PGSSLMODE_MUST_BE_require_verify-ca_OR_verify-full'}
if(-not (Get-Command psql -ErrorAction SilentlyContinue)){throw 'PSQL_NOT_FOUND'}
if(-not (Get-Command node -ErrorAction SilentlyContinue)){throw 'NODE_NOT_FOUND'}
if(Test-Path $OutDir){
 if(@(Get-ChildItem -LiteralPath $OutDir -Force).Count -ne 0){throw 'OUTDIR_MUST_BE_EMPTY_OR_NEW'}
}else{New-Item -ItemType Directory -Path $OutDir|Out-Null}
if(-not $env:PGCONNECT_TIMEOUT){$env:PGCONNECT_TIMEOUT='15'}

# 1. Strict endpoint/ref binding BEFORE any connection is opened.
node $cli identity --project-ref $ProjectRef --host $env:PGHOST --user $env:PGUSER
if($LASTEXITCODE -ne 0){throw 'PROJECT_IDENTITY_REJECTED_NO_CONNECTION_MADE'}
# 2. Manifest/hash/order gate (offline).
node $cli manifest *> $null
if($LASTEXITCODE -ne 0){throw 'MANIFEST_GATE_FAILED_SOURCE_DRIFT'}

function Save-Part([string]$part,[string]$file){
 $sqlFile=Join-Path $OutDir "$part.sql"
 node $cli sql --part $part | Set-Content -LiteralPath $sqlFile -Encoding ascii
 if($LASTEXITCODE -ne 0){throw "SQL_GENERATION_FAILED_$part"}
 $text=(& psql -X -q -A -t -v ON_ERROR_STOP=1 -f $sqlFile 2>&1|Out-String).Trim()
 if($LASTEXITCODE -ne 0){throw "PSQL_FAILED_$part`: $text"}
 [IO.File]::WriteAllText($file,$text,(New-Object Text.UTF8Encoding($false)))
}
$snap=Join-Path $OutDir 'snapshot.json'
$ledger=Join-Path $OutDir 'ledger.json'
Save-Part 'catalog' $snap
Save-Part 'ledger' $ledger

$args2=@('evaluate','--snapshot',$snap,'--ledger',$ledger,'--target','managed-staging','--expect','pre-install',
 '--project-ref',$ProjectRef,'--host',$env:PGHOST,'--user',$env:PGUSER,'--out',(Join-Path $OutDir 'report.json'))
if($BackupManifest){$args2+=@('--backup-manifest',$BackupManifest)}
node $cli @args2
$code=$LASTEXITCODE

$sums=Get-ChildItem -LiteralPath $OutDir -File|ForEach-Object{
 '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower(),$_.Name}
Set-Content -LiteralPath (Join-Path $OutDir 'SHA256SUMS.txt') -Value $sums -Encoding ascii
Write-Output "AB7K_READONLY_SNAPSHOT_DONE evaluator_exit=$code (0=HOLD,2=FAIL; GO is never emitted). Output: $OutDir"
exit $code
