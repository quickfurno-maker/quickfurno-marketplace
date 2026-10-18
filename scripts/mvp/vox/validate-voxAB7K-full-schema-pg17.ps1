$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$name='qf-vox-ab7k-fullschema-pg17'
$foundation=Join-Path $root 'ops\vox\quarantined-migrations\legacy-20261014'
$candidates=Join-Path $root 'ops\vox\sql-candidates'
$files=@()
$files+=Get-ChildItem $foundation -File -Filter '*.sql'|Sort-Object Name
$files+=Get-ChildItem $candidates -File -Filter '*.sql'|Sort-Object Name
if($files.Count -ne 30){throw "EXPECTED_30_REVIEW_FILES_FOUND_$($files.Count)"}
if(docker ps -aq --filter "name=^/$name$"){throw 'OFFLINE_CONTAINER_CONFLICT'}
function Sql([string]$script){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=($script | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String);$c=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 return @{code=$c;text=$out.Trim()}
}
try{
 docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_offline_only postgres:17-alpine *> $null
 if($LASTEXITCODE -ne 0){throw 'DOCKER_POSTGRES17_BOOT_FAILURE'}
 $ready=$false
 for($i=0;$i -lt 90;$i++){
  $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1|Out-String)}
  finally{$ErrorActionPreference=$old}
  if($log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 200
 }
 if(!$ready){throw 'POSTGRES17_NOT_READY'}
 $seed=@'
create schema auth;
create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create table public.profiles(id uuid primary key,role text,is_active boolean);
create table public.cities(id uuid primary key,is_active boolean not null default true);
create table public.aarohi_prospects(id uuid primary key,city_id uuid references public.cities(id));
create table public.aarohi_tasks(id uuid primary key,prospect_id uuid,task_type text,due_at timestamptz,priority text,reason text,assigned_to uuid,status text,created_by uuid,workflow_reference text,created_at timestamptz,updated_at timestamptz,completed_at timestamptz);
create table public.marketplace_service_zones(id uuid primary key,city_id uuid references public.cities(id),is_active boolean);
create table public.vendors(id uuid primary key,service_zone_id uuid);
create table public.vendor_support_threads(id uuid primary key,vendor_id uuid);
create table public.communication_conversations(
 id uuid primary key,tenant_id text,channel text,destination_hash text,
 subject_type text,subject_id uuid,state text,assigned_actor text,
 human_takeover boolean,jarvis_enabled boolean,revision bigint,updated_at timestamptz);
create table public.communication_conversation_events(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid references public.communication_conversations(id),
 event_type text,actor_type text,safe_summary text,event_data jsonb);
create table public.jarvis_os_operator_command_receipts(
 command_id uuid primary key,request_digest text,action text,state text);
create table public.communication_preferences(id uuid primary key);
create table public.communication_suppressions(id uuid primary key);
create table public.communication_consent_events(id uuid primary key);
grant usage on schema public to anon,authenticated,service_role;
'@
 $init=Sql $seed
 if($init.code -ne 0){throw "AB7K_OFFLINE_CORE_FIXTURE_INVALID $($init.text)"}
 $index=0
 foreach($f in $files){
  $index++
  $r=Sql ([IO.File]::ReadAllText($f.FullName))
  if($r.code -ne 0){
   Write-Output "AB7K_FULL_SCHEMA_BLOCKER index=$index file=$($f.Name)"
   throw "AB7K_SQL_BLOCKER $($f.Name): $($r.text)"
  }
  Write-Output "PASS AB7K schema_file_$index $($f.Name)"
 }
 $checks=Sql @'
select 'tables='||(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'vox_%')||
 '|rls='||(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'vox_%' and relrowsecurity and relforcerowsecurity)||
 '|tl_role='||(select count(*) from pg_constraint where conrelid='public.vox_staff_memberships_v1'::regclass
  and pg_get_constraintdef(oid) like '%team_leader%')||
 '|browser_suspension_rpc='||has_function_privilege('authenticated',
 'public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE')||
 '|browser_review_rpc='||has_function_privilege('authenticated',
 'public.qf_vox_ab7j_tl_approve_staff_suspend_v1(uuid,text)','EXECUTE')||
 '|anon_table_dml='||(select count(*) from pg_class c
 where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'vox_%'
 and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
      or has_table_privilege('anon',c.oid,'DELETE')))||
 '|browser_table_dml='||(select count(*) from pg_class c
 where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'vox_%'
 and (has_table_privilege('authenticated',c.oid,'INSERT') or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE')));
'@
 if($checks.code -ne 0){throw "AB7K_SQL_POSTCHECK_FAILED $($checks.text)"}
 Write-Output "AB7K_FULL_SCHEMA_POSTCHECK $($checks.text)"
 Write-Output 'AB7K_OFFLINE_FULL_SCHEMA_SOURCE_PASS (QUARANTINED NEVER DEPLOY)'
}finally{
 docker rm -f $name *> $null
}
