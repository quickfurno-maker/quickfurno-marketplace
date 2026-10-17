$ErrorActionPreference='Stop'
$name='qf-vox-ab3-eod-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$a=Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'
$b=Join-Path $root 'ops\vox\sql-candidates\20261017040000_vox_ab3_closed_day_source_snapshot_candidate.sql'
if(docker ps -aq --filter "name=^/$name$"){throw 'EOD_PG_NAME_CONFLICT'}
$container=$null
function Sql([string]$cmd){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=($cmd|docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String);$c=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 return @{code=$c;text=$out}
}
function Good([string]$label,[string]$cmd,[string]$wanted){
 $r=Sql $cmd
 if($r.code -ne 0 -or $r.text.Trim() -ne $wanted){throw "FAIL_GOOD $label $($r.text)"}
 Write-Output "PASS $label"
}
function Bad([string]$label,[string]$cmd,[string]$regex){
 $r=Sql $cmd;if($r.code -eq 0 -or $r.text -notmatch $regex){throw "FAIL_DENIAL $label $($r.text)"}
 Write-Output "PASS DENIED $label"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'EOD_PG_START_FAILED'}
 $ready=$false;for($i=0;$i -lt 40;$i++){
  docker exec $name pg_isready -U postgres -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Milliseconds 300
 }
 if(!$ready){throw 'EOD_PG_NOT_READY'}
 $fixture=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.cities(id uuid PRIMARY KEY);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY);
INSERT INTO public.profiles VALUES('00000000-0000-4000-8000-000000000001');
INSERT INTO public.cities VALUES('00000000-0000-4000-8000-000000000002');
INSERT INTO public.vox_staff_teams_v1 VALUES('00000000-0000-4000-8000-000000000003');
'@
 if((Sql $fixture).code -ne 0){throw 'FIXTURE_FAILED'}
 $r=Sql (Get-Content $a -Raw);if($r.code -ne 0){throw "F1_MIGRATE $($r.text)"}
 $r=Sql (Get-Content $b -Raw);if($r.code -ne 0){throw "AB3_MIGRATE $($r.text)"}
 $sourceRows=@(@('CORE_WORK_LEDGER','prospect',11),@('CRM_AAROHI','prospect',12),
  @('SUPPORT_DESK','support_thread',13),@('CORE_CONVERSATION','conversation',14))
 foreach($x in $sourceRows){
  $s=$x[0];$kind=$x[1];$n=[int]$x[2]
  $id='00000000-0000-4000-8000-'+$n.ToString().PadLeft(12,'0')
  $oid='00000000-0000-4000-8000-'+($n+100).ToString().PadLeft(12,'0')
  $in=@"
INSERT INTO public.vox_staff_source_events_candidate_v1
(id,source,source_event_id,actor_id,team_id,city_id,object_id,revision,event_kind,occurred_at,subject_kind,subject_id)
VALUES('$id','$s','$id','00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',
'$oid',1,'STAFF_ACTION','2026-10-16T08:00:00Z','$kind','$oid');
"@
  $r=Sql $in;if($r.code -ne 0){throw "SOURCE_INSERT $s $($r.text)"}
  $seal=@"
INSERT INTO public.vox_staff_source_watermarks_candidate_v1
(source,actor_id,team_id,city_id,business_date,cursor_start,cursor_end,
event_checksum,signed_at,signature)
SELECT '$s',e.actor_id,e.team_id,e.city_id,'2026-10-16'::date,
'2026-10-15T18:30:00Z'::timestamptz,
'2026-10-16T18:30:00Z'::timestamptz,
encode(digest(e.source_event_id::text||':'||e.revision::text,'sha256'),'hex'),
'2026-10-17T02:00:00Z'::timestamptz,repeat('b',64)
FROM public.vox_staff_source_events_candidate_v1 e WHERE e.source='$s';
"@
  $r=Sql $seal;if($r.code -ne 0){throw "SOURCE_SEAL $s $($r.text)"}
  $snapshot=@"
INSERT INTO public.vox_ab3_staff_source_snapshots_candidate_v1
(source,actor_id,team_id,city_id,business_date,event_count,event_checksum,watermark_signature)
SELECT source,actor_id,team_id,city_id,business_date,1,event_checksum,signature
FROM public.vox_staff_source_watermarks_candidate_v1 WHERE source='$s';
"@
  $r=Sql $snapshot;if($r.code -ne 0){throw "SOURCE_SNAPSHOT $s $($r.text)"}
  if($s -eq 'CORE_WORK_LEDGER'){$script:snap=$snapshot}
 }
 Good 'four canonical Staff-attributed closed-day snapshots' 'SELECT count(*) FROM public.vox_ab3_staff_source_snapshots_candidate_v1;' '4'
 Bad 'duplicate source snapshot denied' $script:snap 'duplicate key'
 Bad 'source forged count denied' @'
INSERT INTO public.vox_ab3_staff_source_snapshots_candidate_v1
(source,actor_id,team_id,city_id,business_date,event_count,event_checksum,watermark_signature)
SELECT source,actor_id,team_id,city_id,'2026-10-15'::date,2,event_checksum,signature
FROM public.vox_staff_source_watermarks_candidate_v1 WHERE source='CORE_WORK_LEDGER';
'@ 'VOX_AB3_CANONICAL_WATERMARK_MISSING'
 Bad 'anonymous SELECT denied' 'SET ROLE anon; SELECT * FROM public.vox_ab3_staff_source_snapshots_candidate_v1;' 'permission denied'
 Bad 'authenticated INSERT denied' 'SET ROLE authenticated; INSERT INTO public.vox_ab3_staff_source_snapshots_candidate_v1 DEFAULT VALUES;' 'permission denied'
 Bad 'immutable UPDATE denied' "UPDATE public.vox_ab3_staff_source_snapshots_candidate_v1 SET event_count=5;" 'VOX_F1_APPEND_ONLY'
 Bad 'immutable DELETE denied' "DELETE FROM public.vox_ab3_staff_source_snapshots_candidate_v1;" 'VOX_F1_APPEND_ONLY'
 Good 'forced RLS' @'
SELECT CASE WHEN relrowsecurity AND relforcerowsecurity THEN 'PASS' ELSE 'FAIL' END
FROM pg_class WHERE relname='vox_ab3_staff_source_snapshots_candidate_v1';
'@ 'PASS'
 Good 'no privileges beyond insert/select to service role' @'
SELECT CASE WHEN
 NOT has_table_privilege('anon','public.vox_ab3_staff_source_snapshots_candidate_v1','SELECT')
 AND NOT has_table_privilege('authenticated','public.vox_ab3_staff_source_snapshots_candidate_v1','INSERT')
 AND NOT has_table_privilege('service_role','public.vox_ab3_staff_source_snapshots_candidate_v1','UPDATE')
 THEN 'PASS' ELSE 'FAIL' END;
'@ 'PASS'
 $sha=(Get-FileHash $b -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "VOX_AB3_EOD_PG17_PASS four_sources=4 release_hold=true sha256=$sha"
}finally{
 if($container){docker rm -f $name *> $null}
}
