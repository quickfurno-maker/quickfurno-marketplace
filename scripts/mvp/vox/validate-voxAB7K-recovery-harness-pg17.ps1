# AB7K isolated recovery harness. LOCAL DISPOSABLE postgres:17-alpine ONLY (--network none).
# NOT a managed Staging/Production backup or restore, and NOT a certification of one.
# Proves (on a synthetic Core fixture) whether a FULL-FIDELITY logical backup (owners, ACLs,
# default privileges, role dump) restores to a byte-identical security catalog, and shows what
# a --no-owner --no-acl restore (the 27 Oct method class) does to that same catalog.
# Authored without being executed by its author.
[CmdletBinding()]
param(
 [switch]$NoSupabaseDefaultPrivileges,
 [string]$OutDir=(Join-Path ([IO.Path]::GetTempPath()) ('ab7k-evidence-'+[guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$cli=Join-Path $PSScriptRoot 'ab7k-readonly-evidence.mjs'
$src='qf-ab7k-evid-src-pg17';$rst='qf-ab7k-evid-rst-pg17';$lossy='qf-ab7k-evid-lossy-pg17'
$all=@($src,$rst,$lossy)
$utf8=New-Object Text.UTF8Encoding($false)

function Native([scriptblock]$b){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=(& $b 2>&1|Out-String);$code=$LASTEXITCODE}finally{$ErrorActionPreference=$old}
 return @{code=$code;text=$out.Trim()}
}
function Psql([string]$c,[string]$db,[string]$sql){
 $r=Native {$sql|docker exec -i $c psql -X -q -A -t -U postgres -d $db -v ON_ERROR_STOP=1}
 if($r.code -ne 0){throw "PSQL_FAILED_$c`: $($r.text)"}
 return $r.text
}
function Boot([string]$c){
 if((docker ps -aq --filter "name=^/$c$"|Out-String).Trim()){throw "CONTAINER_CONFLICT_$c"}
 docker run --rm --network none -d --name $c -e POSTGRES_PASSWORD=synthetic_offline_only postgres:17-alpine *> $null
 if($LASTEXITCODE -ne 0){throw "PG17_BOOT_FAILED_$c"}
 for($i=0;$i -lt 150;$i++){
  $log=(Native {docker logs $c}).text
  if($log -match 'PostgreSQL init process complete'){
   $r=Native {docker exec $c pg_isready -U postgres -d postgres}
   if($r.code -eq 0){return}
  }
  Start-Sleep -Milliseconds 200
 }
 throw "PG17_NOT_READY_$c"
}
function Snapshot([string]$c,[string]$db,[string]$file){
 $sql=(Native {node $cli sql --part catalog}).text
 $json=Psql $c $db $sql
 [IO.File]::WriteAllText($file,$json,$utf8)
}
function LoadRoles([string]$c){
 $lines=Get-Content -LiteralPath (Join-Path $OutDir 'roles.sql')|
  Where-Object {$_ -notmatch '^(CREATE|ALTER) ROLE postgres(\s|;)'}
 [IO.File]::WriteAllText((Join-Path $OutDir 'roles.filtered.sql'),(($lines -join "`n")+"`n"),$utf8)
 $null=Psql $c 'postgres' ([IO.File]::ReadAllText((Join-Path $OutDir 'roles.filtered.sql')))
}
function Restore([string]$c,[string[]]$flags){
 LoadRoles $c
 docker cp (Join-Path $OutDir 'postinstall-full.dump') "${c}:/tmp/r.dump"|Out-Null
 if($LASTEXITCODE -ne 0){throw "DUMP_COPY_FAILED_$c"}
 $r=Native {docker exec $c createdb -U postgres -T template0 ab7k_restore}
 if($r.code -ne 0){throw "CREATEDB_FAILED_$c`: $($r.text)"}
 return (Native {docker exec $c pg_restore -U postgres -d ab7k_restore --exit-on-error @flags /tmp/r.dump})
}

New-Item -ItemType Directory -Path $OutDir -Force|Out-Null
$m=Native {node $cli manifest}
if($m.code -ne 0){throw "MANIFEST_GATE_FAILED $($m.text)"}

# Reuse the committed synthetic Core seed WITHOUT editing the existing validator.
$seedText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'validate-voxAB7K-full-schema-pg17.ps1'))
$sm=[regex]::Match($seedText,'(?s)\$seed=@''\r?\n(.*?)\r?\n''@')
if(-not $sm.Success){throw 'SYNTHETIC_CORE_SEED_NOT_FOUND'}
$seed=$sm.Groups[1].Value
$defaults=@'
alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;
'@
$files=@()
$files+=Get-ChildItem (Join-Path $root 'ops\vox\quarantined-migrations\legacy-20261014') -File -Filter '*.sql'|Sort-Object Name
$files+=Get-ChildItem (Join-Path $root 'ops\vox\sql-candidates') -File -Filter '*.sql'|Sort-Object Name
if($files.Count -ne 30){throw "EXPECTED_30_FILES_FOUND_$($files.Count)"}

$exit=0
try{
 Boot $src
 $null=Psql $src 'postgres' $seed
 if(-not $NoSupabaseDefaultPrivileges){$null=Psql $src 'postgres' $defaults}
 $i=0
 foreach($f in $files){
  $i++
  $null=Psql $src 'postgres' ([IO.File]::ReadAllText($f.FullName))
  Write-Output "PASS install_$i $($f.Name)"
 }
 Snapshot $src 'postgres' (Join-Path $OutDir 'source.snapshot.json')

 # Full-fidelity artifacts (owners + ACLs + default privileges kept; roles dumped separately).
 foreach($cmd in @(
  'pg_dump -U postgres -d postgres -Fc --file /tmp/postinstall-full.dump',
  'pg_dump -U postgres -d postgres -Fp --schema-only --file /tmp/schema.sql',
  'pg_dumpall -U postgres --roles-only --file /tmp/roles.sql')){
  $parts=$cmd -split ' '
  $r=Native {docker exec $src @parts}
  if($r.code -ne 0){throw "DUMP_FAILED $cmd`: $($r.text)"}
 }
 # The dump is taken AFTER the 30-file install so it captures the installed security state.
 foreach($n in 'postinstall-full.dump','schema.sql','roles.sql'){
  docker cp "${src}:/tmp/$n" (Join-Path $OutDir $n)|Out-Null
  if($LASTEXITCODE -ne 0){throw "ARTIFACT_COPY_FAILED_$n"}
 }

 Boot $rst
 $rr=Restore $rst @()
 if($rr.code -ne 0){throw "FULL_FIDELITY_RESTORE_FAILED $($rr.text)"}
 Snapshot $rst 'ab7k_restore' (Join-Path $OutDir 'restored-full.snapshot.json')
 $cmp=Native {node $cli compare --a (Join-Path $OutDir 'source.snapshot.json') --b (Join-Path $OutDir 'restored-full.snapshot.json')}
 [IO.File]::WriteAllText((Join-Path $OutDir 'compare-full-fidelity.json'),$cmp.text,$utf8)
 $fullOk=($cmp.code -eq 0)

 Boot $lossy
 $lr=Restore $lossy @('--no-owner','--no-acl')
 $lossyNote='LOSSY_RESTORE_FAILED'
 if($lr.code -eq 0){
  Snapshot $lossy 'ab7k_restore' (Join-Path $OutDir 'restored-lossy.snapshot.json')
  $lc=Native {node $cli compare --a (Join-Path $OutDir 'source.snapshot.json') --b (Join-Path $OutDir 'restored-lossy.snapshot.json')}
  [IO.File]::WriteAllText((Join-Path $OutDir 'compare-lossy.json'),$lc.text,$utf8)
  $lossyNote=if($lc.code -eq 0){'LOSSY_RESTORE_IDENTICAL_IN_THIS_FIXTURE(do not generalize; Supabase default privileges/owners differ)'}else{'LOSSY_RESTORE_DIFFERS(security catalog not preserved by --no-owner --no-acl)'}
 }

 $ev=Native {node $cli evaluate --snapshot (Join-Path $OutDir 'source.snapshot.json') --target local-disposable --expect post-install --out (Join-Path $OutDir 'report.json')}
 $evCode=$ev.code

 $sums=Get-ChildItem -LiteralPath $OutDir -File|ForEach-Object{
  '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower(),$_.Name}
 Set-Content -LiteralPath (Join-Path $OutDir 'SHA256SUMS.txt') -Value $sums -Encoding ascii

 Write-Output "AB7K_LOCAL_FULL_FIDELITY_RESTORE_CATALOG_PARITY=$fullOk"
 Write-Output "AB7K_LOCAL_$lossyNote"
 Write-Output "AB7K_LOCAL_SECURITY_INVARIANT_EVALUATOR_EXIT=$evCode (0=HOLD,2=FAIL; see report.json; consent relation is expected BLOCKED)"
 Write-Output 'AB7K_MANAGED_RESTORATION=BLOCKED (local disposable only; no managed backup, AAL2, PITR or Ed25519 evidence exists)'
 Write-Output "Artifacts: $OutDir"
 if(-not $fullOk){$exit=3}elseif($evCode -ne 0){$exit=2}
}finally{
 foreach($c in $all){docker rm -f $c *> $null}
}
exit $exit
