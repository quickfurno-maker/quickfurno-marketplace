$ErrorActionPreference='Stop'
$name='qf-vox-ab7b-aarohi-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$files=@(
 (Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261017020000_vox_phaseb_nonce_ledger_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261018020000_vox_ab7b_nonwork_native_source_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261018050000_vox_ab7b_aarohi_task_atomic_candidate.sql')
)
if(docker ps -aq --filter "name=^/$name$"){throw 'AB7B_AAROHI_CONTAINER_CONFLICT'}
$container=$null
function Sql([string]$sql){
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$output=($sql | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 return @{code=$code;text=$output.Trim()}
}
function Pass([string]$label,[string]$query,[string]$expected){
 $res=Sql $query
 if($res.code -ne 0 -or $res.text -ne $expected){throw "AB7B_AAROHI_POSITIVE_FAILED $label $($res.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$query,[string]$regex){
 $res=Sql $query
 if($res.code -eq 0 -or $res.text -notmatch $regex){throw "AB7B_AAROHI_NEGATIVE_FAILED $label $($res.text)"}
 Write-Output "PASS DENIED $label"
}
$actor='00000000-0000-4000-8000-000000000001'
$other='00000000-0000-4000-8000-000000000002'
$team='00000000-0000-4000-8000-000000000005'
$city='00000000-0000-4000-8000-000000000004'
$prospect='00000000-0000-4000-8000-000000000011'
function Call([string]$who,[string]$c,[string]$nonce,[string]$priority='NORMAL',[string]$due="now()+interval '2 days'"){
 return "select * from public.qf_vox_ab7b_aarohi_task_atomic_candidate_v1('$who','$team','$c','$prospect','$nonce','$priority',$due);"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'AB7B_AAROHI_CONTAINER_START_FAILED'}
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
 if(!$stable){throw 'AB7B_AAROHI_SERVER_NOT_READY'}
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
CREATE TABLE public.vox_ab7b_current_consent_candidate_v1(conversation_id uuid PRIMARY KEY,status text,current_revision integer,revoked_at timestamptz);
INSERT INTO public.profiles VALUES
('00000000-0000-4000-8000-000000000001',null,true),
('00000000-0000-4000-8000-000000000002',null,true),
('00000000-0000-4000-8000-000000000003',null,true);
INSERT INTO public.cities VALUES('00000000-0000-4000-8000-000000000004');
INSERT INTO public.vox_staff_teams_v1 VALUES('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','acquisition_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','support_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','client_success_agent',true,null,now()+interval '1 day');
INSERT INTO public.vox_staff_object_scopes_v1 VALUES
('00000000-0000-4000-8000-000000000001','prospect','00000000-0000-4000-8000-000000000011',null,now()+interval '1 day');
INSERT INTO public.vox_staff_department_capabilities_v1 VALUES
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','acquisition',now()+interval '1 day',null);
CREATE TABLE public.aarohi_prospects(
 id uuid PRIMARY KEY,tenant_id text NOT NULL,city_id uuid NOT NULL,
 prospect_stage text NOT NULL,do_not_contact boolean NOT NULL,
 merged_into_prospect_id uuid
);
INSERT INTO public.aarohi_prospects VALUES
('00000000-0000-4000-8000-000000000011','quickfurno','00000000-0000-4000-8000-000000000004','CONTACTED',false,null);
CREATE TABLE public.aarohi_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),prospect_id uuid REFERENCES public.aarohi_prospects(id),
 task_type text NOT NULL,due_at timestamptz,priority text NOT NULL,reason text,
 assigned_to uuid,created_by uuid,status text,workflow_reference text
);
CREATE TABLE public.aarohi_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id text NOT NULL DEFAULT 'quickfurno',
 prospect_id uuid,event_type text,actor_type text,actor_reference text,
 safe_summary text,reference_type text,reference_id text,idempotency_key text UNIQUE
);
'@
 $res=Sql $fixture
 if($res.code -ne 0){throw "AB7B_AAROHI_FIXTURE_FAILED $($res.text)"}
 foreach($f in $files){
  $res=Sql (Get-Content $f -Raw)
  if($res.code -ne 0){throw "AB7B_AAROHI_SQL_FAILED $f $($res.text)"}
 }
 $first=Call $actor $city '00000000-0000-4000-8000-000000000050'
 Pass 'canonical original Aarohi task and CRM/F1/nonce receipt' "select case when task_id=source_event_id and crm_event_id is not null and nonce_consumed and native_event_appended and provider_messages_sent=0 then 'PASS' else 'FAIL' end from ($($first.TrimEnd(';'))) r;" 'PASS'
 Pass 'task/crm/source/F1/nonce EXACTLY 1:1:1:1:1' @'
select (select count(*) from public.aarohi_tasks)::text||':'||
(select count(*) from public.aarohi_events)::text||':'||
(select count(*) from public.vox_ab7b_native_source_actions_candidate_v1)::text||':'||
(select count(*) from public.vox_staff_source_events_candidate_v1)::text||':'||
(select count(*) from public.vox_staff_source_nonce_candidate_v1)::text;
'@ '1:1:1:1:1'
 Pass 'original tasks and CRM events point at immutable source' @'
select case when count(*)=1 then 'PASS' else 'FAIL' end
from public.aarohi_tasks t join public.aarohi_events e
on e.reference_id=t.id::text and e.prospect_id=t.prospect_id
join public.vox_ab7b_native_source_actions_candidate_v1 n
on n.id=t.id and n.source='CRM_AAROHI'
join public.vox_staff_source_events_candidate_v1 f on f.source_event_id=n.id
join public.vox_staff_source_nonce_candidate_v1 k on k.source_event_id=n.id
where e.actor_type='HUMAN' and e.actor_reference=n.actor_id::text;
'@ 'PASS'
 Denied 'duplicate nonce rolls back BOTH original writes' $first 'duplicate key'
 Pass 'replay did not leave orphan CRM task/event' @'
select (select count(*) from public.aarohi_tasks)::text||':'||
(select count(*) from public.aarohi_events)::text;
'@ '1:1'
 Denied 'wrong city denied at canonical prospect lock' (Call $actor '00000000-0000-4000-8000-000000000006' '00000000-0000-4000-8000-000000000051') 'VOX_AB7B_AAROHI_PROSPECT_DENIED'
 Denied 'unsupported Staff role never becomes acquisition' (Call $other $city '00000000-0000-4000-8000-000000000052') 'VOX_AB7B_AAROHI_STAFF_NOT_CURRENT'
 Denied 'due too soon is denied' (Call $actor $city '00000000-0000-4000-8000-000000000053' 'NORMAL' "now()+interval '1 minute'") 'VOX_AB7B_AAROHI_INPUT_DENIED'
 $res=Sql "update public.vox_staff_object_scopes_v1 set revoked_at=now() where auth_user_id='$actor'"
 if($res.code -ne 0){throw $res.text}
 Denied 'revoked prospect object grant rolls back both CRM writes' (Call $actor $city '00000000-0000-4000-8000-000000000054') 'AB7B_SOURCE_OBJECT_GRANT_REVOKED'
 $res=Sql "update public.vox_staff_object_scopes_v1 set revoked_at=null where auth_user_id='$actor'"
 if($res.code -ne 0){throw $res.text}
 $res=Sql "update public.vox_staff_department_capabilities_v1 set revoked_at=now() where auth_user_id='$actor'"
 if($res.code -ne 0){throw $res.text}
 Denied 'revoked acquisition capability rolls back CRM writes' (Call $actor $city '00000000-0000-4000-8000-000000000055') 'AB7B_DEPARTMENT_CAPABILITY_REVOKED'
 $res=Sql "update public.vox_staff_department_capabilities_v1 set revoked_at=null where auth_user_id='$actor'"
 if($res.code -ne 0){throw $res.text}
 $res=Sql "update public.aarohi_prospects set do_not_contact=true where id='$prospect'"
 if($res.code -ne 0){throw $res.text}
 Denied 'do-not-contact blocked before new internal followup' (Call $actor $city '00000000-0000-4000-8000-000000000056') 'VOX_AB7B_AAROHI_PROSPECT_DENIED'
 Pass 'all denied writes left exactly one task and CRM event' @'
select (select count(*) from public.aarohi_tasks)::text||':'||
(select count(*) from public.aarohi_events)::text||':'||
(select count(*) from public.vox_staff_source_nonce_candidate_v1)::text;
'@ '1:1:1'
 Denied 'anon RPC execution denied' "set role anon; $first" 'permission denied'
 Denied 'native source append-only UPDATE rejected' @'
update public.vox_ab7b_native_source_actions_candidate_v1 set revision=revision+1;
'@ 'IMMUTABLE'
 Write-Output 'AB7B_AAROHI_OFFLINE_POSTGRES17_CERTIFICATION_PASS'
}finally{
 if($container){docker stop $name *> $null}
}
