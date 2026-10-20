# AB7L OFFLINE ONLY. Archived Staging SCHEMA, not customer data.
param([Parameter(Mandatory=$true)][string]$ArchivePath)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$name='qf-vox-ab7l-archived-schema-pg17'
$db='ab7l_schema_only'
$image='public.ecr.aws/supabase/postgres@sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518'
$hash='D88176856CDBEDE5FD31216E6217A388D64A95D137C728A0CB0DE0A605BDE71E'
$archive=[IO.Path]::GetFullPath($ArchivePath)
if(!(Test-Path -LiteralPath $archive -PathType Leaf)){throw 'AB7L_ARCHIVE_MISSING'}
if((Get-FileHash $archive -Algorithm SHA256).Hash -cne $hash){throw 'AB7L_PINNED_ARCHIVE_DIGEST_INVALID'}
$files=@()
$files+=Get-ChildItem (Join-Path $root 'ops\vox\quarantined-migrations\legacy-20261014') -File -Filter '*.sql' | Sort-Object Name
$files+=Get-ChildItem (Join-Path $root 'ops\vox\sql-candidates') -File -Filter '*.sql' | Sort-Object Name
if($files.Count -ne 30){throw 'AB7L_EXACT_30_SOURCES_REQUIRED'}
if(docker ps -aq --filter "name=^/$name$"){throw 'AB7L_DISPOSABLE_CONFLICT'}
function Sql([string]$statement){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{
  $out=($statement | docker exec -i $name psql -U postgres -d $db -X -A -t -q -v ON_ERROR_STOP=1 2>&1 | Out-String)
  $code=$LASTEXITCODE
 }finally{$ErrorActionPreference=$old}
 return @{code=$code;text=$out.Trim()}
}
$started=$false
try{
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$cid=(docker run --rm --network none --name $name -d -e POSTGRES_PASSWORD=ab7l_disposable_only $image 2>&1|Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 if($code -ne 0){throw 'AB7L_OFFLINE_DOCKER_START_FAILED'}
 $started=$true;$ready=$false
 for($i=0;$i -lt 60;$i++){
  $health=(docker inspect $name --format '{{.State.Health.Status}}' 2>$null | Out-String).Trim()
  if($health -eq 'healthy'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 500
 }
 if(!$ready){throw 'AB7L_OFFLINE_PG_NOT_READY'}
 docker cp $archive "$($name):/tmp/staging.dump" *> $null
 if($LASTEXITCODE -ne 0){throw 'AB7L_LOCAL_ARCHIVE_COPY_FAILED'}
 docker exec $name createdb -U postgres -T template0 $db *> $null
 if($LASTEXITCODE -ne 0){throw 'AB7L_OFFLINE_DB_CREATE_FAILED'}
 $bootstrap=Sql 'DROP SCHEMA IF EXISTS public CASCADE;CREATE SCHEMA IF NOT EXISTS extensions;CREATE SCHEMA IF NOT EXISTS vault;CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;'
 if($bootstrap.code -ne 0){throw 'AB7L_OFFLINE_POSTGIS_BOOTSTRAP_FAILED'}
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$restore=(docker exec $name pg_restore -U postgres -d $db --schema-only --no-owner --no-acl --exit-on-error /tmp/staging.dump 2>&1|Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 if($code -ne 0){$err=($restore -split "`n" | Where-Object {$_ -match 'pg_restore: error|ERROR:|DETAIL:'}|Select-Object -First 2) -join ' / ';Write-Output "AB7L_RESTORE_ERROR $err";throw 'AB7L_SCHEMA_ONLY_RESTORE_FAILED'}
 $pre=Sql "select (select count(*) from auth.users)::text||'|'||(select count(*) from public.aarohi_prospects)::text||'|'||(select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'vox_%')::text;"
 if($pre.code -ne 0 -or $pre.text -ne '0|0|0'){throw 'AB7L_SCHEMA_ONLY_ZERO_ROW_PRECONDITION_FAILED'}
 $shape=Sql @'
select count(*)::text||'|'||
 md5(string_agg(table_schema||'.'||table_name||'.'||column_name||'|'||
 udt_schema||'.'||udt_name||'|'||is_nullable||'|'||
 coalesce(column_default,'<none>'), E'\n'
 order by table_schema,table_name,ordinal_position))
 from information_schema.columns
 where table_schema in ('public','auth','storage','supabase_migrations');
'@
 if($shape.code -ne 0 -or $shape.text -ne '2441|9353af8b65889b2a4ba5823e2d821a5d'){
  throw "AB7L_CURRENT_STAGING_COLUMN_STRUCTURE_DRIFT $($shape.text)"
 }
 Write-Output "PASS AB7L_CURRENT_STAGE_COLUMN_PARITY $($shape.text)"
 $funcShape=Sql @'
select count(*)::text||'|'||
 md5(string_agg(p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||
 md5(pg_get_functiondef(p.oid)), E'\n' order by n.nspname,p.proname,
 pg_get_function_identity_arguments(p.oid)))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','auth','storage','supabase_migrations')
 and p.prokind='f';
'@
 if($funcShape.code -ne 0 -or $funcShape.text -ne '212|55c5ab92e50a8d5426c45b1b873a22a8'){throw "AB7L_FUNCTION_DEFINITIONS_DRIFT $($funcShape.text)"}
 Write-Output "AB7L_CURRENT_STAGE_FUNCTION_DEFS $($funcShape.text)"
 $struct=Sql @'
select
 (select count(*)::text||'|'||md5(string_agg(n.nspname||'.'||c.relname||'.'||t.tgname||'|'||
 pg_get_triggerdef(t.oid),E'\n' order by n.nspname,c.relname,t.tgname))
 from pg_trigger t join pg_class c on c.oid=t.tgrelid
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','supabase_migrations') and not t.tgisinternal)
 ||';'||
 (select count(*)::text||'|'||md5(string_agg(schemaname||'.'||tablename||'.'||indexname||'|'||
 indexdef,E'\n' order by schemaname,tablename,indexname))
 from pg_indexes where schemaname in ('public','auth','storage','supabase_migrations'))
 ||';'||
 (select count(*)::text||'|'||md5(string_agg(n.nspname||'.'||c.relname||'.'||q.conname||'|'||
 pg_get_constraintdef(q.oid),E'\n' order by n.nspname,c.relname,q.conname))
 from pg_constraint q join pg_class c on c.oid=q.conrelid
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','supabase_migrations'));
'@
 if($struct.code -ne 0 -or $struct.text -ne '75|5f45a978554dd40104eb1cf16f1960a3;708|a948e7608a8aea7ec3dbdb80b7a17e6a;1103|2426ec853fd70573f6be691feb9c0f3a'){throw "AB7L_CATALOG_OBJECT_DRIFT $($struct.text)"}
 Write-Output "PASS AB7L_CURRENT_STAGE_CATALOG_OBJECT_PARITY $($struct.text)"
 $policy=Sql @'
select count(*)::text||'|'||
 md5(string_agg(schemaname||'.'||tablename||'.'||policyname||'|'||permissive||'|'||
 array_to_string(roles,',')||'|'||cmd||'|'||coalesce(qual,'<none>')||'|'||
 coalesce(with_check,'<none>'),E'\n'
 order by schemaname,tablename,policyname))
 from pg_policies
 where schemaname in ('public','auth','storage','supabase_migrations');
'@
 if($policy.code -ne 0 -or $policy.text -ne '74|1074f4271259203defff256380386a42'){
  throw "AB7L_STAGING_POLICY_DEFINITIONS_DRIFT $($policy.text)"
 }
 Write-Output "PASS AB7L_CURRENT_STAGE_RLS_POLICY_PARITY $($policy.text)"


 Write-Output 'PASS AB7L_VERIFIED_STAGING_ARCHIVE_SCHEMA_ONLY_NO_CUSTOMER_ROWS'
 $index=0
 foreach($file in $files){
  $index++
  $apply=Sql ([IO.File]::ReadAllText($file.FullName))
  if($apply.code -ne 0){
   Write-Output "AB7L_SOURCE_BLOCKER index=$index file=$($file.Name)"
   throw 'AB7L_REAL_STAGING_SCHEMA_CANDIDATE_DDL_FAILED'
  }
 }
 $post=Sql @'
select (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'vox_%')::text||
 '|'||(select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'vox_%' and c.relrowsecurity and c.relforcerowsecurity)::text||
 '|'||(select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'vox_%' and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE')))::text||
 '|'||(select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'vox_%' and (has_table_privilege('authenticated',c.oid,'INSERT') or has_table_privilege('authenticated',c.oid,'UPDATE') or has_table_privilege('authenticated',c.oid,'DELETE')))::text||
 '|'||(select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname like 'qf_vox_%' and has_function_privilege('anon',p.oid,'EXECUTE'))::text||
 '|'||(select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname like 'qf_vox_%' and has_function_privilege('authenticated',p.oid,'EXECUTE'))::text||
 '|'||(select count(*) from auth.users)::text;
'@
 if($post.code -ne 0 -or $post.text -ne '39|39|0|0|0|2|0'){
  throw "AB7L_OFFLINE_RLS_OR_PRIVILEGE_DRIFT $($post.text)"
 }
 Write-Output 'PASS AB7L_30_OF_30_VOX_SQL_REAL_STAGING_SCHEMA_39_FORCE_RLS_0_BROWSER_DML'
 Write-Output 'PASS AB7L_ANON_DEFINER_ZERO_AUTH_TWO_AAL2_REVIEWERS'
 Write-Output 'AB7L_OFFLINE_STAGE_SCHEMA_CERTIFIED_NO_MANAGED_WRITES'
}finally{
 if($started){docker rm -f $name *> $null}
}
