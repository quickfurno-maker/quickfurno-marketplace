$ErrorActionPreference='Stop'
$name='qf-vox-ab7b-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$files=@(
 (Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261017020000_vox_phaseb_nonce_ledger_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261018020000_vox_ab7b_nonwork_native_source_candidate.sql')
)
if(docker ps -aq --filter "name=^/$name$"){throw 'AB7B_CONTAINER_CONFLICT'}
$container=$null
function Sql([string]$sql){
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$output=($sql | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 return @{code=$code;text=$output.Trim()}
}
function Pass([string]$label,[string]$query,[string]$expected){
 $res=Sql $query
 if($res.code -ne 0 -or $res.text -ne $expected){throw "AB7B_POSITIVE_FAILED $label $($res.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$query,[string]$regex){
 $res=Sql $query
 if($res.code -eq 0 -or $res.text -notmatch $regex){throw "AB7B_NEGATIVE_FAILED $label $($res.text)"}
 Write-Output "PASS DENIED $label"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'AB7B_CONTAINER_START_FAILED'}
 $stable=$false
 for($i=0;$i -lt 80;$i++){
  $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1|Out-String)}finally{$ErrorActionPreference=$prior}
  if($log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$stable=$true;break}
  }
  Start-Sleep -Milliseconds 350
 }
 if(!$stable){throw 'AB7B_SERVER_NOT_READY'}
 $fixture=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean);
CREATE TABLE public.cities(id uuid PRIMARY KEY);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_object_scopes_v1(auth_user_id uuid,scope_kind text,object_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_department_capabilities_v1(auth_user_id uuid,team_id uuid,city_id uuid,department text,expires_at timestamptz,revoked_at timestamptz);
INSERT INTO public.profiles VALUES
('00000000-0000-4000-8000-000000000001',null,true),
('00000000-0000-4000-8000-000000000002',null,true),
('00000000-0000-4000-8000-000000000003',null,true);
INSERT INTO public.cities VALUES('00000000-0000-4000-8000-000000000004');
INSERT INTO public.vox_staff_teams_v1 VALUES('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','acquisition_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','support_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','operations_manager',true,null,now()+interval '1 day');
INSERT INTO public.vox_staff_object_scopes_v1 VALUES
('00000000-0000-4000-8000-000000000001','prospect','00000000-0000-4000-8000-000000000011',null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000002','support_thread','00000000-0000-4000-8000-000000000012',null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000003','conversation','00000000-0000-4000-8000-000000000013',null,now()+interval '1 day');
INSERT INTO public.vox_staff_department_capabilities_v1 VALUES
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','acquisition',now()+interval '1 day',null),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','service_support',now()+interval '1 day',null),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','client_success',now()+interval '1 day',null);
'@
 $res=Sql $fixture
 if($res.code -ne 0){throw "AB7B_FIXTURE_FAILED $($res.text)"}
 foreach($f in $files){$res=Sql (Get-Content $f -Raw);if($res.code -ne 0){throw "AB7B_SQL_FAILED $f $($res.text)"}}
 function EventSql([int]$n,[int]$staff,[int]$object,[string]$source,[string]$kind,[int]$nonce){
  $event='00000000-0000-4000-8000-'+$n.ToString().PadLeft(12,'0')
  $who='00000000-0000-4000-8000-'+$staff.ToString().PadLeft(12,'0')
  $sub='00000000-0000-4000-8000-'+$object.ToString().PadLeft(12,'0')
  $token='00000000-0000-4000-8000-'+$nonce.ToString().PadLeft(12,'0')
  return "INSERT INTO public.vox_ab7b_native_source_actions_candidate_v1 (id,source,subject_kind,subject_id,actor_id,team_id,city_id,revision,event_kind,nonce) VALUES ('$event','$source','$kind','$sub','$who','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',1,'STAFF_ACTION','$token');"
 }
 $events=@(
 (EventSql 21 1 11 'CRM_AAROHI' 'prospect' 41),
 (EventSql 22 2 12 'SUPPORT_DESK' 'support_thread' 42)
 )
 foreach($e in $events){$res=Sql $e;if($res.code -ne 0){throw "AB7B_NATIVE_INSERT_FAILED $($res.text)"}}
 Pass 'two genuine-lane original synthetic events and F1/nonce in one tx' @'
SELECT (SELECT count(*) FROM public.vox_ab7b_native_source_actions_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_events_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_nonce_candidate_v1)::text;
'@ '2:2:2'
 Pass 'source actor, subject, nonce and revision are identical' @'
SELECT CASE WHEN count(*)=2 THEN 'PASS' ELSE 'FAIL' END
FROM public.vox_ab7b_native_source_actions_candidate_v1 n
JOIN public.vox_staff_source_events_candidate_v1 e ON e.source_event_id=n.id AND e.source=n.source
JOIN public.vox_staff_source_nonce_candidate_v1 t ON t.source_event_id=n.id AND t.nonce=n.nonce
WHERE n.actor_id=e.actor_id AND n.subject_id=e.subject_id AND n.revision=e.revision;
'@ 'PASS'
 Denied 'same original CRM event replay' $events[0] 'duplicate key'
 Denied 'cross-source actor role spoof' (EventSql 24 2 11 'CRM_AAROHI' 'prospect' 44) 'AB7B_CURRENT_STAFF_REVOKED'
 Denied 'wrong source kind and Staff role' (EventSql 25 1 11 'SUPPORT_DESK' 'prospect' 45) 'AB7B_CURRENT_STAFF_REVOKED|check constraint'
 Denied 'ungranted object' (EventSql 26 1 77 'CRM_AAROHI' 'prospect' 46) 'AB7B_SOURCE_OBJECT_GRANT_REVOKED'
 Denied 'CORE_CONVERSATION blocked at writer (no canonical consent source or role)' (EventSql 27 3 13 'CORE_CONVERSATION' 'conversation' 47) 'AB7B_CORE_CONVERSATION_BLOCKED'
 Pass 'all denied writes rolled back together' @'
SELECT (SELECT count(*) FROM public.vox_ab7b_native_source_actions_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_events_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_nonce_candidate_v1)::text;
'@ '2:2:2'
 Denied 'anon read denied' 'SET ROLE anon; SELECT * FROM public.vox_ab7b_native_source_actions_candidate_v1;' 'permission denied'
 Denied 'immutable native row' "DELETE FROM public.vox_ab7b_native_source_actions_candidate_v1 WHERE id='00000000-0000-4000-8000-000000000021';" 'VOX_F1_APPEND_ONLY'
 Pass 'forced row security' "SELECT CASE WHEN relrowsecurity AND relforcerowsecurity THEN 'PASS' ELSE 'FAIL' END FROM pg_class WHERE relname='vox_ab7b_native_source_actions_candidate_v1';" 'PASS'
 $sha=(Get-FileHash $files[-1] -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "VOX_AB7B_NATIVE_2SOURCE_PG17_PASS core_conversation=BLOCKED synthetic_originals=2 sha256=$sha"
}finally{if($container){docker rm -f $name *> $null}}
