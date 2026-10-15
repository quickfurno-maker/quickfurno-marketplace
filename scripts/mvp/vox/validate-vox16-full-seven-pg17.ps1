$ErrorActionPreference='Stop'
$name='qf-vox16-full-seven-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$original=Get-Content (Join-Path $root 'scripts\mvp\vox\vox07-finalizer-fixture.sql') -Raw
$parts=$original -split '-- Synthetic profiles:',2
if($parts.Count -ne 2){throw 'MISSING_FIXTURE_BOUNDARY'}
if(docker ps -aq --filter "name=^/$name$"){throw 'DISPOSABLE_PG_NAME_CONFLICT'}
$cid=$null
try{
 $cid=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=vox16_synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'POSTGRES_RUN_FAILED'}
 $ready=$false
 for($i=0;$i -lt 60;$i++){
  $old=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try{$logs=(docker logs $name 2>&1|Out-String)}finally{$ErrorActionPreference=$old}
  if($logs.Contains('PostgreSQL init process complete; ready for start up.')){
   $probe=docker exec $name psql -X -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'select 1;'
   if($LASTEXITCODE -eq 0 -and ([string]$probe).Trim() -eq '1'){$ready=$true;break}
  }
  Start-Sleep -Seconds 1
 }
 if(-not $ready){throw 'POSTGRES_FINAL_SERVER_NOT_READY'}
 $parts[0] | docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'SYNTHETIC_SCHEMA_BOOTSTRAP_FAILED'}
 # Dependencies belong to the existing Aarohi CRM. The fixture never creates
 # a competing VOX task authority and contains no real user records.
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
 $native | docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'AAROHI_NATIVE_DEPENDENCY_MISSING'}
 $sqls=Get-ChildItem (Join-Path $root 'supabase\migrations') -Filter '20261014*vox*.sql'|Sort-Object Name
 if($sqls.Count -ne 7){throw 'MIGRATION_COUNT_MISMATCH'}
 foreach($sql in $sqls){
  (Get-Content $sql.FullName -Raw) | docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
  if($LASTEXITCODE -ne 0){throw ('VOX16_MIGRATION_FAILED '+$sql.Name)}
  Write-Output ('PASS SQL '+$sql.Name)
 }
 $checks=@'
SELECT CASE WHEN
(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'vox_%'
 AND c.relrowsecurity AND c.relforcerowsecurity)>=8
AND NOT has_table_privilege('anon','public.vox_staff_memberships_v1','SELECT')
AND NOT has_table_privilege('authenticated','public.vox_staff_memberships_v1','SELECT')
AND NOT has_table_privilege('anon','public.vox_operational_intents_v1','SELECT')
AND NOT has_table_privilege('authenticated','public.vox_operational_intents_v1','INSERT')
AND NOT has_function_privilege('anon','public.qf_vox_decide_operational_intent_v1(uuid,uuid,integer,text)','EXECUTE')
AND NOT has_function_privilege('authenticated','public.qf_vox_execute_approved_aarohi_followup_v1(uuid,uuid,integer)','EXECUTE')
AND has_function_privilege('service_role','public.qf_vox_execute_approved_aarohi_followup_v1(uuid,uuid,integer)','EXECUTE')
THEN 'PASS' ELSE 'FAIL' END;
'@
 $proof=($checks|docker exec -i $name psql -X -A -t -U postgres -d postgres -v ON_ERROR_STOP=1)
 if($LASTEXITCODE -ne 0 -or ([string]$proof).Trim() -ne 'PASS'){throw ('VOX16_RLS_RPC_GRANTS_FAILED '+$proof)}
 # Execute actual denied actions as both unprivileged database roles, not
 # only metadata checks. No privileged RPC executes: revoke must fail first.
 $denials=@(
  @{role='anon';sql='SELECT * FROM public.vox_staff_memberships_v1 LIMIT 1;'},
  @{role='authenticated';sql='SELECT * FROM public.vox_operational_intents_v1 LIMIT 1;'},
  @{role='anon';sql="SELECT public.qf_vox_decide_operational_intent_v1(null::uuid,null::uuid,0,'approve');"},
  @{role='authenticated';sql='SELECT public.qf_vox_execute_approved_aarohi_followup_v1(null::uuid,null::uuid,0);'}
 )
 foreach($case in $denials){
  $previous=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$attempt=(("SET ROLE "+$case.role+"; "+$case.sql) | docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String)}finally{$ErrorActionPreference=$previous}
  if($LASTEXITCODE -eq 0 -or $attempt -notmatch '(?i)permission denied'){
   throw ('VOX16E_RLS_ROLE_PROBE_UNEXPECTED_'+$case.role+' exit='+$LASTEXITCODE+' details='+([string]$attempt).Substring(0,[Math]::Min(([string]$attempt).Length,300)))
  }
 }
 Write-Output 'VOX16E_PG17_ROLE_NEGATIVE_PASS attempted=4 role_anon=true role_authenticated=true no_business_effects=true'

 Write-Output 'VOX16_FULL_SEVEN_SQL_PG17_PASS migrations=7 rls=true anon_denied=true authenticated_denied=true definer_rpc_locked=true live_database_modified=false'
}finally{if($cid){docker rm -f $name *> $null}}
