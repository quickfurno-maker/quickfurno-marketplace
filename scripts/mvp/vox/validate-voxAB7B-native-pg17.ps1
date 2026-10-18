$ErrorActionPreference='Stop'
$name='qf-vox-ab7b-native-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$files=@(
 (Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261017020000_vox_phaseb_nonce_ledger_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261018020000_vox_ab7b_nonwork_native_source_candidate.sql')
)
if(docker ps -aq --filter "name=^/$name$"){throw 'AB7B_TEST_NAME_COLLISION'}
$container=$null
function Sql([string]$query){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=($query | docker exec -i $name psql -X -A -t -q -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$rc=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 return @{exit=$rc;text=$out.Trim()}
}
function Ok([string]$label,[string]$sql,[string]$wanted){
 $r=Sql $sql;if($r.exit -ne 0 -or $r.text -ne $wanted){throw "AB7B_FAIL $label $($r.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$sql,[string]$match){
 $r=Sql $sql;if($r.exit -eq 0 -or $r.text -notmatch $match){throw "AB7B_DENIAL_FAILED $label $($r.text)"}
 Write-Output "PASS DENIED $label"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'AB7B_POSTGRES_START_FAILED'}
 $stable=$false
 for($i=0;$i -lt 80;$i++){
  $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1 | Out-String);$rc=$LASTEXITCODE}
  finally{$ErrorActionPreference=$old}
  if($rc -eq 0 -and $log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$stable=$true;break}
  }
  Start-Sleep -Milliseconds 330
 }
 if(!$stable){throw 'AB7B_STABLE_PG17_NOT_READY'}
 $fixture=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid primary key,role text,is_active boolean);
CREATE TABLE public.cities(id uuid primary key);
CREATE TABLE public.vox_staff_teams_v1(id uuid primary key,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid primary key,team_id uuid,
 staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_object_scopes_v1(auth_user_id uuid,scope_kind text,
 object_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_department_capabilities_v1(auth_user_id uuid,team_id uuid,
 city_id uuid,department text,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_ab7b_current_consent_candidate_v1(conversation_id uuid,
 status text,current_revision integer,revoked_at timestamptz);
INSERT INTO public.profiles VALUES
('00000000-0000-4000-8000-000000000001',null,true),
('00000000-0000-4000-8000-000000000002',null,true),
('00000000-0000-4000-8000-000000000003',null,true),
('00000000-0000-4000-8000-000000000099','admin',true);
INSERT INTO public.cities VALUES('00000000-0000-4000-8000-000000000004');
INSERT INTO public.vox_staff_teams_v1 VALUES
('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','acquisition_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','support_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','client_success_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000005','team_leader',true,null,now()+interval '1 day');
INSERT INTO public.vox_staff_object_scopes_v1 VALUES
('00000000-0000-4000-8000-000000000001','prospect','00000000-0000-4000-8000-000000000011',null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000002','support_thread','00000000-0000-4000-8000-000000000012',null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000003','conversation','00000000-0000-4000-8000-000000000013',null,now()+interval '1 day');
INSERT INTO public.vox_staff_department_capabilities_v1 VALUES
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','acquisition',null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','service_support',null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','client_success',null,now()+interval '1 day');
INSERT INTO public.vox_ab7b_current_consent_candidate_v1 VALUES
('00000000-0000-4000-8000-000000000013','ALLOWED',3,null);
'@
 $r=Sql $fixture;if($r.exit -ne 0){throw "AB7B_FIXTURE_FAILED $($r.text)"}
 foreach($p in $files){$r=Sql (Get-Content $p -Raw);if($r.exit -ne 0){throw "AB7B_SQL_MIGRATION_FAILED $p $($r.text)"}}
 $sources=@(
 @('CRM_AAROHI','prospect','000000000001','000000000011','000000000021','000000000031'),
 @('SUPPORT_DESK','support_thread','000000000002','000000000012','000000000022','000000000032'),
 @('CORE_CONVERSATION','conversation','000000000003','000000000013','000000000023','000000000033')
 )
 $commands=@()
 foreach($s in $sources){
  $row=@"
INSERT INTO public.vox_ab7b_native_source_actions_candidate_v1
(id,source,subject_kind,subject_id,actor_id,team_id,city_id,revision,event_kind,nonce)
VALUES('00000000-0000-4000-8000-$($s[4])','$($s[0])','$($s[1])',
'00000000-0000-4000-8000-$($s[3])','00000000-0000-4000-8000-$($s[2])',
'00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',
1,'STAFF_ACTION','00000000-0000-4000-8000-$($s[5])');
"@
  $commands+=$row
  $r=Sql $row;if($r.exit -ne 0){throw "AB7B_SOURCE_INSERT_FAILED $($s[0]) $($r.text)"}
 }
 Ok 'original event + F1 + nonce all exact 3' @'
SELECT (SELECT count(*) FROM public.vox_ab7b_native_source_actions_candidate_v1)::text||':'||
(SELECT count(*) FROM public.vox_staff_source_events_candidate_v1)::text||':'||
(SELECT count(*) FROM public.vox_staff_source_nonce_candidate_v1)::text;
'@ '3:3:3'
 Ok 'exact three source categories' @'
SELECT string_agg(source,',' ORDER BY source) FROM public.vox_staff_source_events_candidate_v1;
'@ 'CORE_CONVERSATION,CRM_AAROHI,SUPPORT_DESK'
 Denied 'original nonce replay' $commands[0] 'duplicate key'
 $revoke=@'
UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=now()
WHERE scope_kind='prospect';
'@
 $r=Sql $revoke;if($r.exit -ne 0){throw 'REVOKE_FIXTURE_FAILED'}
 Denied 'revoked original prospect grant' ($commands[0].Replace('000000000021','000000000041').Replace('000000000031','000000000051').Replace('revision,event_kind,nonce)', 'revision,event_kind,nonce)').Replace("1,'STAFF_ACTION'","2,'STAFF_ACTION'")) 'AB7B_SOURCE_OBJECT_GRANT_REVOKED'
 Denied 'forged owner actor in support' ($commands[1].Replace('000000000022','000000000042').Replace('000000000032','000000000052').Replace('000000000002','000000000099').Replace("1,'STAFF_ACTION'","2,'STAFF_ACTION'")) 'AB7B_CURRENT_STAFF_REVOKED'
 $r=Sql "UPDATE public.vox_ab7b_current_consent_candidate_v1 SET revoked_at=now() WHERE conversation_id='00000000-0000-4000-8000-000000000013';"
 if($r.exit -ne 0){throw 'CONSENT_FIXTURE_REVOKE_FAILED'}
 Denied 'revoked conversation consent' ($commands[2].Replace('000000000023','000000000043').Replace('000000000033','000000000053').Replace("1,'STAFF_ACTION'","2,'STAFF_ACTION'")) 'AB7B_CONVERSATION_CONSENT_REQUIRED'
 Ok 'rollback leaves exact first 3 triples' @'
SELECT (SELECT count(*) FROM public.vox_ab7b_native_source_actions_candidate_v1)::text||':'||
(SELECT count(*) FROM public.vox_staff_source_events_candidate_v1)::text||':'||
(SELECT count(*) FROM public.vox_staff_source_nonce_candidate_v1)::text;
'@ '3:3:3'
 Denied 'anon direct insert forbidden' "SET ROLE anon; INSERT INTO public.vox_ab7b_native_source_actions_candidate_v1 DEFAULT VALUES;" 'permission denied'
 Denied 'original immutable UPDATE' "UPDATE public.vox_ab7b_native_source_actions_candidate_v1 SET revision=9;" 'VOX_F1_APPEND_ONLY'
 Ok 'forced row level security' @'
SELECT CASE WHEN relrowsecurity and relforcerowsecurity THEN 'PASS' ELSE 'FAIL' END
FROM pg_class WHERE relname='vox_ab7b_native_source_actions_candidate_v1';
'@ 'PASS'
 Write-Output ("VOX_AB7B_NATIVE_PG17_PASS sha256="+(Get-FileHash $files[-1] -Algorithm SHA256).Hash.ToLowerInvariant())
}finally{if($container){docker rm -f $name *> $null}}
