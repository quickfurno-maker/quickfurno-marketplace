# Synthetic, network-isolated PostgreSQL 17 VOX seven-migration disaster recovery.
# This is NOT a managed Supabase staging backup or permission to deploy.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$source='qf-vox20-source-pg17'
$restored='qf-vox20-restored-pg17'
$dump=Join-Path ([System.IO.Path]::GetTempPath()) ('vox20-synthetic-'+[guid]::NewGuid().ToString('N')+'.dump')
$containers=@()
foreach($name in @($source,$restored)){
 if((docker ps -aq --filter "name=^/$name$" | Out-String).Trim()){
  throw "EXISTING_CONTAINER_CONFLICT_$name"
 }
}
try{
 foreach($name in @($source,$restored)){
  docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine|Out-Null
  if($LASTEXITCODE -ne 0){throw "PG_CONTAINER_START_DENIED_$name"}
  $containers+= $name
 }
 foreach($name in $containers){
  $ok=$false
  for($i=0;$i -lt 60;$i++){
   docker exec $name pg_isready -q -U postgres -d postgres 2>$null
   if($LASTEXITCODE -eq 0){$ok=$true;break}
   Start-Sleep -Milliseconds 350
  }
  if(-not $ok){throw "PG17_NOT_READY_$name"}
 }
 $fixture=Get-Content (Join-Path $root 'scripts\mvp\vox\vox07-finalizer-fixture.sql') -Raw
 $parts=$fixture -split '-- Synthetic profiles:',2
 if($parts.Count -ne 2){throw 'VOX_SYNTHETIC_FIXTURE_CORRUPT'}
 $parts[0] | docker exec -i $source psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'PRE_MIGRATION_FIXTURE_FAILED'}
 $native=@'
CREATE TABLE public.aarohi_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 prospect_id uuid NOT NULL,task_type text NOT NULL,due_at timestamptz,
 priority text NOT NULL,reason text,assigned_to uuid,created_by uuid,
 workflow_reference text,created_at timestamptz DEFAULT now());
CREATE TABLE public.aarohi_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 prospect_id uuid,event_type text NOT NULL,actor_type text NOT NULL,
 actor_reference text,safe_summary text,reference_type text,reference_id text,
 idempotency_key text,tenant_id text NOT NULL DEFAULT 'quickfurno',
 occurred_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX aarohi_events_idempotency_idx ON public.aarohi_events
 (tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
'@
 $native | docker exec -i $source psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'NATIVE_AAROHI_FIXTURE_FAILED'}
 # Preserve original migration semantics for OFFLINE recovery while refusing
 # to re-introduce the unapproved legacy SQL to managed deploy discovery.
 $managed=@(Get-ChildItem (Join-Path $root 'supabase\migrations') -Filter '*vox*.sql' -File)
 if($managed.Count -ne 0){throw 'UNAPPROVED_MANAGED_VOX_SQL_PRESENT'}
 $sqls=@(Get-ChildItem (Join-Path $root 'ops\vox\quarantined-migrations\legacy-20261014') -Filter '20261014*vox*.sql' -File|Sort-Object Name)
 if($sqls.Count -ne 7){throw 'EXACT_SEVEN_QUARANTINED_VOX_SQL_FILES_REQUIRED'}
 foreach($sql in $sqls){
  (Get-Content $sql.FullName -Raw)|docker exec -i $source psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
  if($LASTEXITCODE -ne 0){throw ('MIGRATION_FAILED_'+$sql.Name)}
 }
 @'
INSERT INTO public.profiles(id,role,is_active)
 VALUES('10000000-0000-4000-8000-000000000001','admin',true),
       ('10000000-0000-4000-8000-000000000002','admin',true);
INSERT INTO public.cities(id,is_active)
 VALUES('20000000-0000-4000-8000-000000000001',true),
       ('20000000-0000-4000-8000-000000000002',true);
'@|docker exec -i $source psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'SYNTHETIC_ROWS_FAILED'}
 # Write binary custom-format dump inside container; do not use PowerShell binary pipe.
 docker exec $source pg_dump -U postgres -d postgres --format custom --file /tmp/vox20.dump
 if($LASTEXITCODE -ne 0){throw 'CUSTOM_ARCHIVE_FAILED'}
 docker cp "${source}:/tmp/vox20.dump" $dump|Out-Null
 if($LASTEXITCODE -ne 0){throw 'ARCHIVE_TRANSFER_FAILED'}
 $checksum=(Get-FileHash -Algorithm SHA256 -LiteralPath $dump).Hash
 if($checksum -notmatch '^[A-F0-9]{64}$'){throw 'INVALID_SHA256_CHECKSUM'}
 # pg_dump deliberately excludes cluster roles; create only synthetic auth roles.
 "CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;" |
   docker exec -i $restored psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_ROLE_SETUP_FAILED'}
 docker cp $dump "${restored}:/tmp/vox20.dump"|Out-Null
 if($LASTEXITCODE -ne 0){throw 'ARCHIVE_RESTORE_TRANSFER_FAILED'}
 docker exec $restored pg_restore --no-owner --exit-on-error -U postgres -d postgres /tmp/vox20.dump
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_PG_RESTORE_FAILED'}
 $after=(Get-FileHash -Algorithm SHA256 -LiteralPath $dump).Hash
 if($after -ne $checksum){throw 'SHA256_ARCHIVE_CHANGED'}
 $proof=@'
select json_build_object(
 'vox_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relname like 'vox_%'),
 'vox_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relname like 'vox_%'
   and c.relrowsecurity and c.relforcerowsecurity),
 'vox_policies',(select count(*) from pg_policies
   where schemaname='public' and tablename like 'vox_%'),
 'vox_functions',(select count(*) from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'qf_vox_%'),
 'profiles',(select count(*) from public.profiles),
 'cities',(select count(*) from public.cities),
 'anon_denied',not has_table_privilege('anon','public.vox_staff_memberships_v1','SELECT'),
 'authenticated_denied',not has_table_privilege('authenticated','public.vox_operational_intents_v1','SELECT'),
 'rpc_denied',not has_function_privilege('authenticated',
   'public.qf_vox_execute_approved_aarohi_followup_v1(uuid,uuid,integer)','EXECUTE')
)::text;
'@
 $left=($proof|docker exec -i $source psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1|Out-String).Trim()
 if($LASTEXITCODE -ne 0){throw 'SOURCE_PARITY_QUERY_FAILED'}
 $right=($proof|docker exec -i $restored psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1|Out-String).Trim()
 if($LASTEXITCODE -ne 0){throw 'RESTORED_PARITY_QUERY_FAILED'}
 $a=$left|ConvertFrom-Json
 $b=$right|ConvertFrom-Json
 Write-Output ('VOX_RESTORE_PROOF_COUNTS tables='+$a.vox_tables+' rls='+$a.vox_rls+
  ' policies='+$a.vox_policies+' functions='+$a.vox_functions)
 # Quarantined tables deliberately have zero policies: FORCE RLS defaults deny.
 # A newly introduced policy requires a fresh independent security review.
 if($a.vox_tables -lt 8 -or $a.vox_rls -ne $a.vox_tables -or
  $a.vox_policies -ne 0 -or $a.vox_functions -lt 1 -or
  $a.profiles -ne 2 -or $a.cities -ne 2 -or
  $a.anon_denied -ne $true -or $a.authenticated_denied -ne $true -or $a.rpc_denied -ne $true){
  throw 'SOURCE_VOX_SCHEMA_SECURITY_BASELINE_FAILED'
 }
 if($left -ne $right){throw 'SYNTHETIC_RESTORE_PARITY_FAILED'}
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{
  $probe=("SET ROLE anon; SELECT * FROM public.vox_staff_memberships_v1 LIMIT 1;"|
    docker exec -i $restored psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String)
  $exit=$LASTEXITCODE
 }finally{$ErrorActionPreference=$old}
 if($exit -eq 0 -or $probe -notmatch '(?i)permission denied'){
  throw 'RESTORED_ANON_ROLE_NOT_DENIED'
 }
 Write-Output ('VOX20_ISOLATED_PG17_SEVEN_MIGRATION_RESTORE_PASS migrations=7 vox_tables='+$a.vox_tables+
 ' rls_tables='+$a.vox_rls+' policies='+$a.vox_policies+
 ' functions='+$a.vox_functions+' profiles=2 cities=2 sha256_verified=true privileges_preserved=true '+
 'restored_anon_denied=true live_staging_backup=false live_staging_modified=false')
}finally{
 foreach($name in $containers){docker rm -f $name *> $null}
 Remove-Item -LiteralPath $dump -Force -ErrorAction SilentlyContinue
}
