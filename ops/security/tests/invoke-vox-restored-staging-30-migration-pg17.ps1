param(
 [Parameter(Mandatory=$true)][string]$BackupPath,
 [Parameter(Mandatory=$true)][string]$SqlSourceRoot,
 [switch]$SchemaOnly
)
$ErrorActionPreference='Continue' # Docker/psql may emit harmless NOTICE on stderr; explicit native exit codes remain mandatory.
$root=(Resolve-Path $SqlSourceRoot).Path
$name='qf-vox-restored-staging-30-pg17'
$foundation=Join-Path $root 'ops\vox\quarantined-migrations\legacy-20261014'
$candidates=Join-Path $root 'ops\vox\sql-candidates'
if(!(Test-Path $foundation) -or !(Test-Path $candidates)){throw 'SQL_SOURCE_ROOT_NOT_FOUND'}
$files=@()
$files+=Get-ChildItem $foundation -File -Filter '*.sql' | Sort-Object Name
$files+=Get-ChildItem $candidates -File -Filter '*.sql' | Sort-Object Name
if($files.Count -ne 30){throw "EXPECTED_30_SQL_FOUND_$($files.Count)"}
$manifestTest=Join-Path $root 'scripts\mvp\vox\validate-voxAB7K-manifest.test.mjs'
if(!(Test-Path $manifestTest)){throw 'PINNED_30_SQL_MANIFEST_TEST_MISSING'}
node $manifestTest *> $null
if($LASTEXITCODE -ne 0){throw 'PINNED_SQL_MANIFEST_HASH_VERIFICATION_FAILED'}
Write-Output 'PASS PINNED_30_SQL_MANIFEST'
if(!(Test-Path $BackupPath)){throw 'BACKUP_MISSING'}
$sha=(Get-FileHash -Path $BackupPath -Algorithm SHA256).Hash.ToUpperInvariant()
if($sha -ne '57F3B8D446BBB0B47332B24CBF0BA8385D72269ED923ABC393EC8B73DAE129A1'){throw 'EXPECTED_27_OCT_STAGING_BACKUP_SHA_MISMATCH'}
if(docker ps -aq --filter "name=^/$name$"){throw 'ISOLATED_CONTAINER_NAME_CONFLICT'}
$img='public.ecr.aws/supabase/postgres:17.11.0.002'
try{
 docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_isolated_only $img *> $null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_CONTAINER_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 100;$i++){
  $logs=(cmd.exe /d /s /c "docker logs $name 2>&1" | Out-String)
  if($logs -match 'PostgreSQL init process complete'){
   docker exec $name psql -X -q -U supabase_admin -d postgres -t -A -c 'select 1;' *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 300
 }
 if(!$ready){throw 'POSTGRES_17_NOT_READY'}
 docker cp $BackupPath "${name}:/tmp/staging.pgcustom" *> $null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_BACKUP_COPY_FAILED'}
 docker exec $name createdb -U supabase_admin -T template0 qf_restore *> $null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_DB_CREATE_FAILED'}
 $seed=@'
set client_min_messages=error;
drop schema if exists auth,storage,supabase_migrations,vault,public cascade;
create schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
'@
 $seed | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d qf_restore *> $null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_EXTENSION_SETUP_FAILED'}
 $schemaLog=Join-Path $env:TEMP 'qf-vox-restored-staging-pg17-schema.log'
 docker exec $name pg_restore -U supabase_admin -d qf_restore --schema-only --no-owner --no-acl --exit-on-error /tmp/staging.pgcustom *> $schemaLog
 if($LASTEXITCODE -ne 0){$errorLine=Get-Content $schemaLog | Where-Object {$_ -match 'ERROR:'} | Select-Object -First 1; Write-Output ('SCHEMA_RESTORE_ERROR='+($errorLine -replace 'DETAIL:.*','').Substring(0,[Math]::Min(180,($errorLine -replace 'DETAIL:.*','').Length))); throw 'REAL_STAGING_SCHEMA_RESTORE_FAILED'}
 Write-Output 'PASS REAL_STAGING_SCHEMA_RESTORE'
 # The archive owns the vault schema; extension-owned tables are omitted by pg_dump.
 # Recreate Supabase Vault after archive schema restoration, before data restore.
 'create extension if not exists supabase_vault with schema vault;' | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d qf_restore *> $null
 if($LASTEXITCODE -ne 0){throw 'SUPABASE_VAULT_EXTENSION_RESTORE_FAILED'}
 Write-Output 'PASS SUPABASE_VAULT_EXTENSION_RECREATED'
 if(!$SchemaOnly){
 $defer=@'
create schema restore_review;
create table restore_review.original_constraints as
select conrelid::regclass::text as table_name,conname as name,pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace='public'::regnamespace and contype='c' and not convalidated;
do $body$
declare r record;
begin
 if (select count(*) from restore_review.original_constraints)<>6
 then raise exception 'EXPECTED_6_NOT_VALID_CHECK_CONSTRAINTS';
 end if;
 for r in select table_name,name from restore_review.original_constraints
 loop
 execute format('alter table %s drop constraint %I',r.table_name,r.name);
 end loop;
end $body$;
'@
 $defer | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d qf_restore *> $null
 if($LASTEXITCODE -ne 0){throw 'NONVALIDATED_CHECK_DEFER_FAILED'}
 Write-Output 'PASS SIX_NONVALIDATED_CHECKS_TEMPORARILY_DEFERRED_OFFLINE'
 $restoreLog=Join-Path $env:TEMP 'qf-vox-restored-staging-pg17-data.log'
 docker exec $name pg_restore -U supabase_admin -d qf_restore --data-only --disable-triggers --no-owner --no-acl --exit-on-error /tmp/staging.pgcustom *> $restoreLog
 if($LASTEXITCODE -ne 0){
  $raw=Get-Content $restoreLog -Raw
  $m=[regex]::Match($raw,'COPY failed for table "([^"]+)": ERROR:\s*([^\r\n]+)')
  if($m.Success){
   $table=$m.Groups[1].Value -replace '[^a-zA-Z0-9_]',''
   $category=($m.Groups[2].Value -replace 'DETAIL:.*','').Trim()
   Write-Output ('DATA_RESTORE_FIRST_ERROR_TABLE='+$table)
   Write-Output ('DATA_RESTORE_FIRST_ERROR_CATEGORY='+$category.Substring(0,[Math]::Min(110,$category.Length)))
  }else{
   $first=($raw -split "[\r\n]+" | Where-Object {$_ -match 'pg_restore: error:|ERROR:|COPY failed|permission denied'} | Select-Object -First 1)
   if($first){
    $category= if($raw -match 'duplicate key'){'DUPLICATE_KEY'} elseif($raw -match 'permission denied'){'PERMISSION_DENIED'} elseif($raw -match 'COPY failed'){'COPY_FAILED'} elseif($raw -match 'constraint'){'CONSTRAINT'} elseif($raw -match 'could not execute'){'EXECUTION_ERROR'} elseif($raw -match 'unrecognized'){'UNKNOWN_SETTING'} else {'OTHER_PG_RESTORE_ERROR'}
    Write-Output ("DATA_RESTORE_ERROR_CATEGORY="+$category)
    $detail=([regex]::Matches($raw,'(?i)ERROR:\s*([^\r\n]+)') | Select-Object -First 1)
    if($detail){
      $safe=$detail.Groups[1].Value -replace "'[^']*'","'[redacted]'" -replace '([0-9a-f]{8}-[0-9a-f-]{27,})','[redacted]'
      Write-Output ('DATA_RESTORE_ERROR_SUMMARY='+$safe.Substring(0,[Math]::Min(165,$safe.Length)))
    }
    # Only report bounded SQLSTATE and error type; never raw row data.
    $state=[regex]::Match($raw,'SQL state: ([0-9A-Z]{5})')
    if($state.Success){Write-Output ("DATA_RESTORE_ERROR_SQLSTATE="+$state.Groups[1].Value)}
    $table=[regex]::Match($raw,'(?:COPY failed for table|relation) "([a-zA-Z0-9_]+)"')
    if($table.Success){Write-Output ("DATA_RESTORE_ERROR_RELATION="+$table.Groups[1].Value)}
   }else{Write-Output 'DATA_RESTORE_ERROR_CATEGORY_UNCLASSIFIED'}
  }
  throw 'DATA_RESTORE_FAILED_NO_DATA_PRINTED'
 }
 Write-Output 'PASS REAL_STAGING_ARCHIVE_DATA_RESTORE'
 $restore=@'
do $body$
declare r record;
begin
 for r in select table_name,name,definition from restore_review.original_constraints
 loop
 execute format('alter table %s add constraint %I %s',r.table_name,r.name,r.definition);
 end loop;
end $body$;
'@
 $restore | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d qf_restore *> $null
 if($LASTEXITCODE -ne 0){throw 'ORIGINAL_NOT_VALID_CONSTRAINT_REINSTALL_FAILED'}
 $count=docker exec $name psql -X -U supabase_admin -d qf_restore -t -A -c "select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='c' and not convalidated;"
 if($LASTEXITCODE -ne 0 -or $count.Trim() -ne '6'){throw 'NOT_VALID_CONSTRAINT_PARITY_FAILED'}
 Write-Output 'PASS SIX_ORIGINAL_NOT_VALID_CONSTRAINTS_RESTORED'
 }else{Write-Output 'SKIP DATA_RESTORE -- ACTUAL ARCHIVE SCHEMA-ONLY MIGRATION COMPATIBILITY'}
 $index=0
 foreach($f in $files){
  $index++
  [IO.File]::ReadAllText($f.FullName) | docker exec -i $name psql -X -q -U supabase_admin -d qf_restore -v ON_ERROR_STOP=1 *> $null
  if($LASTEXITCODE -ne 0){throw "VOX_SQL_FILE_FAILED_INDEX_$index"}
 }
 Write-Output 'PASS 30_VOX_SQL_SOURCE_FILES_REAL_RESTORED_SCHEMA'
 $check=docker exec $name psql -X -U supabase_admin -d qf_restore -t -A -c "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'vox_%') || '|' || (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'vox_%' and c.relrowsecurity and c.relforcerowsecurity) || '|' || (select count(*) from public.profiles) || '|' || (select count(*) from public.automation_action_requests)"
 if($LASTEXITCODE -ne 0){throw 'FINAL_COUNT_QUERY_FAILED'}
 Write-Output ("RESTORED_SCHEMA_POSTCHECK "+$check.Trim())
}
finally{
 docker rm -f $name *> $null
 Remove-Item (Join-Path $env:TEMP 'qf-vox-restored-staging-pg17-data.log') -ErrorAction SilentlyContinue
 Remove-Item (Join-Path $env:TEMP 'qf-vox-restored-staging-pg17-schema.log') -ErrorAction SilentlyContinue
 Write-Output 'DISPOSABLE_RESTORE_CONTAINER_AND_DATA_LOG_REMOVED'
}
