$ErrorActionPreference='Stop'
$name='qf-vox-phaseb-nonce-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$a=Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'
$b=Join-Path $root 'ops\vox\sql-candidates\20261017020000_vox_phaseb_nonce_ledger_candidate.sql'
if(!(Test-Path $a) -or !(Test-Path $b)){throw 'CANDIDATE_SQL_NOT_PRESENT'}
if(docker ps -aq --filter "name=^/$name$"){throw 'PG_NAME_COLLISION'}
$container=$null
function ExecSql([string]$sql){
 $ErrorActionPreference='Continue'
 try{
  $output=($sql | docker exec -i $name psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String)
  return [pscustomobject]@{code=$LASTEXITCODE;output=$output}
 }finally{$ErrorActionPreference='Stop'}
}
function AssertDenied([string]$label,[string]$sql,[string]$pattern){
 $r=ExecSql $sql
 if($r.code -eq 0 -or $r.output -notmatch $pattern){
  throw ("MISSING_DENIAL_"+$label+"_"+$r.output.Substring(0,[Math]::Min(300,$r.output.Length)))
 }
 Write-Output ('PASS '+$label)
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'DISPOSABLE_PG_NOT_STARTED'}
 $ready=$false
 # pg_isready may succeed against initdb's TEMPORARY PostgreSQL server,
 # which is subsequently stopped and restarted. Never mistake that transient
 # listener for final readiness; require the init-complete marker AND a query.
 for($i=0;$i -lt 80;$i++){
  $oldPreference=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try{$logs=(docker logs $name 2>&1 | Out-String)}finally{$ErrorActionPreference=$oldPreference}
  if($logs.Contains('PostgreSQL init process complete; ready for start up.')){
   $probe=ExecSql 'SELECT 1;'
   # ExecSql uses normal psql table formatting (headers and a row-count).
   # Require an actual SQL 1 row instead of incorrectly expecting raw output '1'.
   if($probe.code -eq 0 -and $probe.output -match '(?m)^\s*1\s*$'){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 250
 }
 if(!$ready){throw 'DISPOSABLE_PG_FINAL_SERVER_NOT_READY'}
 $init=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.cities(id uuid PRIMARY KEY);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY);
INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000099');
INSERT INTO public.cities VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.vox_staff_teams_v1 VALUES ('00000000-0000-4000-8000-000000000003');
'@
 $boot=ExecSql $init;if($boot.code -ne 0){throw ('BASE_SCHEMA_INVALID '+$boot.output)}
 if((ExecSql (Get-Content $a -Raw)).code -ne 0){throw 'F1_SOURCE_SQL_FAILED'}
 $apply=ExecSql (Get-Content $b -Raw)
 if($apply.code -ne 0){throw ('NONCE_SQL_FAILED '+$apply.output)}
 $event=@'
INSERT INTO public.vox_staff_source_events_candidate_v1
(id,source,source_event_id,actor_id,team_id,city_id,object_id,revision,event_kind,occurred_at,subject_kind,subject_id)
VALUES('00000000-0000-4000-8000-000000000010','CRM_AAROHI',
'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',
'00000000-0000-4000-8000-000000000012',1,'STAFF_FOLLOWUP','2026-10-17T09:00:00Z',
'prospect','00000000-0000-4000-8000-000000000013');
'@
 if((ExecSql $event).code -ne 0){throw 'F1_EVENT_APPEND_FAILED'}
 $nonce=@'
INSERT INTO public.vox_staff_source_nonce_candidate_v1
(nonce,source,source_event_id,actor_id,team_id,city_id)
VALUES('00000000-0000-4000-8000-000000000020','CRM_AAROHI',
'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
'@
 if((ExecSql $nonce).code -ne 0){throw 'NONCE_APPEND_FAILED'}
 Write-Output 'PASS real single nonce/attributed source event append'
 AssertDenied 'duplicate_nonce_replay' $nonce '(?i)duplicate key'
 $newNonce=$nonce.Replace('000000000020','000000000021')
 AssertDenied 'duplicate_source_event' $newNonce '(?i)duplicate key'
 $foreign=$nonce.Replace('000000000020','000000000022').Replace('000000000011','000000000077')
 AssertDenied 'missing_original_source_event' $foreign 'VOX_PHASEB_NONCE_ACTOR_MISMATCH|foreign key'
 $forged=$nonce.Replace('000000000020','000000000023').Replace('000000000001','000000000099')
 AssertDenied 'foreign_staff_actor_denied' $forged 'VOX_PHASEB_NONCE_ACTOR_MISMATCH'
 AssertDenied 'anonymous_select_denied' 'SET ROLE anon; SELECT * FROM public.vox_staff_source_nonce_candidate_v1;' '(?i)permission denied'
 AssertDenied 'authenticated_insert_denied' 'SET ROLE authenticated; INSERT INTO public.vox_staff_source_nonce_candidate_v1 DEFAULT VALUES;' '(?i)permission denied'
 AssertDenied 'mutation_append_only' "UPDATE public.vox_staff_source_nonce_candidate_v1 SET actor_id='00000000-0000-4000-8000-000000000099' WHERE nonce='00000000-0000-4000-8000-000000000020';" 'VOX_F1_APPEND_ONLY'
 AssertDenied 'delete_append_only' "DELETE FROM public.vox_staff_source_nonce_candidate_v1 WHERE nonce='00000000-0000-4000-8000-000000000020';" 'VOX_F1_APPEND_ONLY'
 $check=@'
SELECT CASE WHEN c.relrowsecurity AND c.relforcerowsecurity
 AND NOT has_table_privilege('anon','public.vox_staff_source_nonce_candidate_v1','SELECT')
 AND NOT has_table_privilege('authenticated','public.vox_staff_source_nonce_candidate_v1','INSERT')
 AND has_table_privilege('service_role','public.vox_staff_source_nonce_candidate_v1','INSERT')
 AND NOT has_table_privilege('service_role','public.vox_staff_source_nonce_candidate_v1','UPDATE')
 THEN 'PASS' ELSE 'FAIL' END
 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
 WHERE n.nspname='public' AND c.relname='vox_staff_source_nonce_candidate_v1';
'@
 $checkR=ExecSql $check
 if($checkR.code -ne 0 -or $checkR.output.Trim() -notmatch 'PASS'){throw ('RLS_GRANTS_UNVERIFIED '+$checkR.output)}
 Write-Output 'PASS forced RLS and narrow service grants'
 $hash=(Get-FileHash $b -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output ('VOX_PHASEB_NONCE_PG17_PASS network=none cleanup=true sha256='+$hash)
}finally{
 if($container){docker rm -f $name *> $null}
}
