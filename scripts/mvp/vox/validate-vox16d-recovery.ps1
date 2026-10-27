# VOX-16D strictly synthetic backup -> checksum -> isolated restore test.
# Not a managed Supabase backup; no credentials, vendor data or production sources.
$ErrorActionPreference='Stop'
$a='qf-vox16d-synthetic-source'
$b='qf-vox16d-synthetic-restore'
$archive=Join-Path ([System.IO.Path]::GetTempPath()) ('vox16d-synthetic-'+[guid]::NewGuid().ToString('N')+'.dump')
foreach($n in @($a,$b)){
 $existing=(docker ps -aq --filter "name=^/$n$" | Out-String).Trim()
 if($existing){throw "PREFLIGHT_CONTAINER_CONFLICT"}
}
try{
 foreach($n in @($a,$b)){
  docker run -d --rm --network none --name $n -e POSTGRES_PASSWORD=synthetic_recovery_test postgres:17-alpine | Out-Null
  if($LASTEXITCODE -ne 0){throw "CANNOT_CREATE_DISPOSABLE_CONTAINER"}
 }
 foreach($n in @($a,$b)){
  # postgres:17-alpine starts a TEMPORARY init server that can answer pg_isready,
  # then stops it before PID 1 execs the final postgres process. Do not seed
  # during that transient ready window (socket disappears at the restart).
  $ready=$false
  for($i=0;$i -lt 80;$i++){
   $pidOne=([string](docker exec $n sh -c 'cat /proc/1/comm' 2>$null | Out-String)).Trim()
   if($LASTEXITCODE -eq 0 -and $pidOne -eq 'postgres'){
    $probe=([string](docker exec $n psql -X -q -tA -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'select 1;' 2>$null | Out-String)).Trim()
    if($LASTEXITCODE -eq 0 -and $probe -eq '1'){$ready=$true;break}
   }
   Start-Sleep -Milliseconds 250
  }
  if(-not $ready){throw "SYNTHETIC_FINAL_POSTMASTER_UNAVAILABLE"}
 }
 @'
create table public.vox16d_synthetic_restore_case(id int primary key,city_id int not null);
insert into public.vox16d_synthetic_restore_case values(1,1),(2,1),(3,2),(4,2),(5,3);
'@ | docker exec -i $a psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw "SYNTHETIC_SEED_FAILED"}
 docker exec $a pg_dump -U postgres -d postgres -F c -f /tmp/vox16d.dump
 if($LASTEXITCODE -ne 0){throw "SYNTHETIC_BACKUP_FAILED"}
 docker cp "${a}:/tmp/vox16d.dump" $archive | Out-Null
 if($LASTEXITCODE -ne 0){throw "ARCHIVE_COPY_FAILED"}
 $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
 if($hash -notmatch '^[A-F0-9]{64}$'){throw 'INVALID_ARCHIVE_HASH'}
 docker cp $archive "${b}:/tmp/vox16d.dump" | Out-Null
 if($LASTEXITCODE -ne 0){throw "RESTORE_COPY_FAILED"}
 docker exec $b pg_restore -U postgres -d postgres --exit-on-error /tmp/vox16d.dump
 if($LASTEXITCODE -ne 0){throw "RESTORE_FAILED"}
 $rows=(docker exec $b psql -X -A -t -U postgres -d postgres -c 'select count(*) from public.vox16d_synthetic_restore_case;')
 if($LASTEXITCODE -ne 0 -or ([string]$rows).Trim() -ne '5'){throw "ROW_COUNT_MISMATCH"}
 $distinct=(docker exec $b psql -X -A -t -U postgres -d postgres -c 'select count(distinct city_id) from public.vox16d_synthetic_restore_case;')
 if($LASTEXITCODE -ne 0 -or ([string]$distinct).Trim() -ne '3'){throw "CITY_COUNT_MISMATCH"}
 $again=(Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
 if($hash -ne $again){throw "ARCHIVE_HASH_CHANGED"}
 Write-Output "VOX16D_DISPOSABLE_PG17_BACKUP_RESTORE_PASS rows=5 cities=3 sha256_verified=true live_staging_backup=false production_modified=false"
}finally{
 foreach($n in @($a,$b)){docker rm -f $n *> $null}
 Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}
