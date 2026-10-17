$ErrorActionPreference='Stop'
$name='qf-vox-ab4-activity-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$paths=@(
 (Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261017020000_vox_phaseb_nonce_ledger_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261018010000_vox_ab4_native_work_source_writer_candidate.sql')
)
if(docker ps -aq --filter "name=^/$name$"){throw 'PG17_CONTAINER_COLLISION'}
$container=$null
function Sql([string]$code){
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=($code|docker exec -i $name psql -X -q -t -A -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$exit=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 return [pscustomobject]@{exit=$exit;text=$out.Trim()}
}
function Allowed([string]$label,[string]$cmd,[string]$want){
 $r=Sql $cmd
 if($r.exit -ne 0 -or $r.text -ne $want){throw "POSITIVE_FAIL $label $($r.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$cmd,[string]$pattern){
 $r=Sql $cmd
 if($r.exit -eq 0 -or $r.text -notmatch $pattern){throw "DENIAL_FAIL $label $($r.text)"}
 Write-Output "PASS DENIED $label"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'PG17_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 40;$i++){
  docker exec $name pg_isready -U postgres -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Milliseconds 330
 }
 if(!$ready){throw 'PG17_NOT_READY'}
 $fixture=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean);
CREATE TABLE public.cities(id uuid PRIMARY KEY);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_object_scopes_v1(auth_user_id uuid,scope_kind text,object_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_work_items_candidate_v1(id uuid PRIMARY KEY,team_id uuid,city_id uuid,source_kind text,source_id uuid,related_vendor_id uuid,state text,revision integer,assignee_id uuid);
CREATE TABLE public.vox_work_events_candidate_v1(id uuid PRIMARY KEY,work_item_id uuid,actor_id uuid,event_nonce uuid NOT NULL UNIQUE,event_type text,from_state text,to_state text,from_revision integer,to_revision integer,reason text,created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(work_item_id,to_revision));
INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-000000000001',null,true),('00000000-0000-4000-8000-000000000099',null,true);
INSERT INTO public.cities VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.vox_staff_teams_v1 VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','acquisition_agent',true,null,now()+interval '1 day'),
 ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000003','team_leader',true,null,now()+interval '1 day');
INSERT INTO public.vox_staff_object_scopes_v1 VALUES
 ('00000000-0000-4000-8000-000000000001','prospect','00000000-0000-4000-8000-000000000011',null,now()+interval '1 day'),
 ('00000000-0000-4000-8000-000000000001','prospect','00000000-0000-4000-8000-000000000012',null,now()+interval '1 day');
INSERT INTO public.vox_work_items_candidate_v1 VALUES
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','prospect','00000000-0000-4000-8000-000000000011',null,'ASSIGNED',1,'00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','prospect','00000000-0000-4000-8000-000000000012',null,'ASSIGNED',1,'00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','prospect','00000000-0000-4000-8000-000000000013',null,'ASSIGNED',1,'00000000-0000-4000-8000-000000000001');
'@
 $r=Sql $fixture;if($r.exit -ne 0){throw "PG_FIXTURE_FAILED $($r.text)"}
 foreach($file in $paths){
  $r=Sql (Get-Content $file -Raw)
  if($r.exit -ne 0){throw "SOURCE_SQL_APPLY_FAILED $file $($r.text)"}
 }
 $one=@'
INSERT INTO public.vox_work_events_candidate_v1
(id,work_item_id,actor_id,event_nonce,event_type,from_state,to_state,from_revision,to_revision,reason)
VALUES('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021',
'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000041',
'CLAIM','NEW','ASSIGNED',0,1,'');
'@
 $r=Sql $one;if($r.exit -ne 0){throw "ACTUAL_NATIVE_FIRST_INSERT_FAILED $($r.text)"}
 Allowed 'native event one original and one canonical source' @'
SELECT (SELECT count(*) FROM public.vox_work_events_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_events_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_nonce_candidate_v1)::text;
'@ '1:1:1'
 Allowed 'exact actor/source/revision provenance' @'
SELECT CASE WHEN e.actor_id=n.actor_id and s.actor_id=e.actor_id and
 s.source_event_id=e.id and s.revision=e.to_revision and
 s.subject_kind='prospect' and s.subject_id=w.source_id and
 n.nonce=e.event_nonce THEN 'PASS' ELSE 'FAIL' END
FROM public.vox_work_events_candidate_v1 e
JOIN public.vox_staff_source_events_candidate_v1 s ON s.id=e.id
JOIN public.vox_staff_source_nonce_candidate_v1 n ON n.source_event_id=e.id
JOIN public.vox_work_items_candidate_v1 w ON w.id=e.work_item_id;
'@ 'PASS'
 Denied 'same original event nonce replay' $one 'duplicate key'
 $collision=@'
INSERT INTO public.vox_work_events_candidate_v1
(id,work_item_id,actor_id,event_nonce,event_type,from_state,to_state,from_revision,to_revision,reason)
VALUES('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000022',
'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000041',
'CLAIM','NEW','ASSIGNED',0,1,'');
'@
 Denied 'second work cannot reuse signed nonce' $collision 'duplicate key'
 Denied 'forged Team Leader actor' ($collision.Replace('000000000041','000000000042').Replace('000000000001','000000000099')) 'VOX_AB4_SOURCE_STATE_OR_ACTOR_MISMATCH'
 Denied 'ung ranted source object' ($collision.Replace('000000000041','000000000043').Replace('000000000022','000000000023')) 'VOX_AB4_OBJECT_GRANT_REVOKED'
 Allowed 'failed commits rollback all three tables' @'
SELECT (SELECT count(*) FROM public.vox_work_events_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_events_candidate_v1)::text||':'||
 (SELECT count(*) FROM public.vox_staff_source_nonce_candidate_v1)::text;
'@ '1:1:1'
 Denied 'anonymous table select' 'SET ROLE anon;SELECT * FROM public.vox_staff_source_events_candidate_v1;' 'permission denied'
 Denied 'immutable F1 event' "DELETE FROM public.vox_staff_source_events_candidate_v1 WHERE id='00000000-0000-4000-8000-000000000031';" 'VOX_F1_APPEND_ONLY'
 $sha=(Get-FileHash $paths[-1] -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "VOX_AB4_NATIVE_WORK_PG17_PASS same_transaction=true no_external_sends=true sha256=$sha"
}finally{
 if($container){docker rm -f $name *> $null}
}
