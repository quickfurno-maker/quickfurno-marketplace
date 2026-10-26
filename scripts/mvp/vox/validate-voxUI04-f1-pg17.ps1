$ErrorActionPreference='Stop'
$name='qf-vox-ui04-f1-pg17-disposable'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$candidate=Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'
if(!(Test-Path $candidate)){throw 'F1_CANDIDATE_SQL_MISSING'}
if(docker ps -aq --filter "name=^/$name$"){throw 'ISOLATED_PG_NAME_CONFLICT'}
$container=$null
try{
  $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=ui04_synthetic_only postgres:17-alpine
  if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_PG_START_FAILED'}
  $ready=$false
  # Postgres Docker runs a TEMP bootstrap server that can briefly answer
  # pg_isready before it shuts down. Only probe final SQL after init completes.
  for($i=0;$i -lt 55;$i++){
   $oldPreference=$ErrorActionPreference
   $ErrorActionPreference='Continue'
   try{$logs=(docker logs $name 2>&1 | Out-String)}finally{$ErrorActionPreference=$oldPreference}
   if($logs -match 'PostgreSQL init process complete; ready for start up.'){
    docker exec $name pg_isready -U postgres -d postgres *> $null
    if($LASTEXITCODE -eq 0){
     $probe=((docker exec $name psql -X -A -t -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'SELECT 1;' 2>$null)|Out-String).Trim()
     if($LASTEXITCODE -eq 0 -and $probe -eq '1'){$ready=$true;break}
    }
   }
   Start-Sleep -Milliseconds 350
  }
  if(!$ready){throw 'PG17_NOT_READY'}
  $fixture=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.cities(id uuid PRIMARY KEY);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY);
INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.cities VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.vox_staff_teams_v1 VALUES ('00000000-0000-4000-8000-000000000003');
'@
  $fixture|docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
  if($LASTEXITCODE -ne 0){throw 'F1_DEPENDENCY_FIXTURE_FAILED'}
  (Get-Content $candidate -Raw)|docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
  if($LASTEXITCODE -ne 0){throw 'F1_SQL_CANDIDATE_APPLICATION_FAILED'}
  $security=@'
SELECT CASE WHEN
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname IN
      ('vox_staff_source_events_candidate_v1','vox_staff_source_watermarks_candidate_v1')
      AND c.relrowsecurity AND c.relforcerowsecurity)=2
 AND NOT has_table_privilege('anon','public.vox_staff_source_events_candidate_v1','SELECT')
 AND NOT has_table_privilege('authenticated','public.vox_staff_source_events_candidate_v1','INSERT')
 AND NOT has_table_privilege('authenticated','public.vox_staff_source_watermarks_candidate_v1','SELECT')
 AND has_table_privilege('service_role','public.vox_staff_source_events_candidate_v1','INSERT')
 AND NOT has_table_privilege('service_role','public.vox_staff_source_events_candidate_v1','UPDATE')
 AND NOT has_table_privilege('service_role','public.vox_staff_source_watermarks_candidate_v1','DELETE')
 AND NOT has_function_privilege('anon','public.qf_vox_f1_immutable_audit_candidate_v1()','EXECUTE')
 THEN 'PASS' ELSE 'FAIL' END;
'@
  $proof=($security | docker exec -i $name psql -X -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 | Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $proof -ne 'PASS'){throw ('F1_SQL_RLS_GRANT_FAILURE '+$proof)}
  Write-Output 'PASS F1 SQL RLS_FORCE_AND_UNPRIVILEGED_DENIAL'
  $insert=@'
INSERT INTO public.vox_staff_source_events_candidate_v1
(id,source,source_event_id,actor_id,team_id,city_id,object_id,revision,event_kind,occurred_at,subject_kind,subject_id)
VALUES (
'00000000-0000-4000-8000-000000000010','CRM_AAROHI',
'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',
'00000000-0000-4000-8000-000000000012',4,'FOLLOW_UP','2026-10-16T06:00:00Z',
'prospect','00000000-0000-4000-8000-000000000013');
'@
  $insert|docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
  if($LASTEXITCODE -ne 0){throw 'APPEND_POSITIVE_FAILED'}
  Write-Output 'PASS F1 append true attributable synthetic event'
  function TestDenied([string]$testName,[string]$sql,[string]$reason){
    $old=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try{$output=($sql|docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String);$code=$LASTEXITCODE}
    finally{$ErrorActionPreference=$old}
    if($code -eq 0 -or $output -notmatch $reason){throw ('UNEXPECTED_DATABASE_ALLOW '+$testName+' '+$output.Substring(0,[Math]::Min(500,$output.Length)))}
    Write-Output ('PASS F1 DENIED '+$testName)
  }
  TestDenied 'anon_select' 'SET ROLE anon; SELECT * FROM public.vox_staff_source_events_candidate_v1;' '(?i)permission denied'
  TestDenied 'auth_insert' @'
SET ROLE authenticated;
INSERT INTO public.vox_staff_source_events_candidate_v1
(id,source,source_event_id,actor_id,team_id,city_id,object_id,revision,event_kind,occurred_at,subject_kind,subject_id)
VALUES('00000000-0000-4000-8000-000000000050','CRM_AAROHI','00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000052',0,'FOLLOW_UP',now(),'prospect','00000000-0000-4000-8000-000000000053');
'@ '(?i)permission denied'
  TestDenied 'event_update_immutable' "UPDATE public.vox_staff_source_events_candidate_v1 SET event_kind='EDITED' WHERE id='00000000-0000-4000-8000-000000000010';" 'VOX_F1_APPEND_ONLY'
  TestDenied 'event_delete_immutable' "DELETE FROM public.vox_staff_source_events_candidate_v1 WHERE id='00000000-0000-4000-8000-000000000010';" 'VOX_F1_APPEND_ONLY'
  TestDenied 'duplicate_source_event' $insert '(?i)duplicate key'
  $bad=$insert.Replace("'CRM_AAROHI'","'SUPPORT_DESK'")
  TestDenied 'source_subject_constraint' $bad '(?i)check constraint'
  $digest=(Get-FileHash $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Output ('VOX_UI04_F1_PG17_PASS disposable_network_none=true anon_denied=true authenticated_denied=true immutable=true unique=true source_kind=true sha256='+$digest)
}
finally{
 if($container){docker rm -f $name *> $null}
}
