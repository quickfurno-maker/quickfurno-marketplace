$ErrorActionPreference='Stop'
# Disposable, network-less PG17 proof of the RC32 atomic Core vendor-task writer.
# Candidate SQL only; nothing here touches a managed database.
$name='qf-vox-rc32-core-task-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$file=Join-Path $root 'ops\vox\rc32-review-candidates\20261031010000_vox_rc32_core_vendor_task_atomic_candidate.sql'
if(docker ps -aq --filter "name=^/$name$"){throw 'RC32_CONTAINER_CONFLICT'}
$container=$null
function Sql([string]$sql){
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$output=($sql | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 return @{code=$code;text=$output.Trim()}
}
function Pass([string]$label,[string]$query,[string]$expected){
 $res=Sql $query
 # psql emits platform-native CRLF on Windows; compare exact logical rows.
 $actual=($res.text -replace "\r\n?","`n").Trim()
 $wanted=($expected -replace "\r\n?","`n").Trim()
 if($res.code -ne 0 -or $actual -cne $wanted){throw "RC32_POSITIVE_FAILED $label $($res.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$query,[string]$regex){
 $res=Sql $query
 if($res.code -eq 0 -or $res.text -notmatch $regex){throw "RC32_NEGATIVE_FAILED $label $($res.text)"}
 Write-Output "PASS DENIED $label"
}
$U='00000000-0000-4000-8000-000000000001'
$TEAM='00000000-0000-4000-8000-000000000002'
$CITY='00000000-0000-4000-8000-000000000003'
$VENDOR='00000000-0000-4000-8000-000000000004'
$ZONE='00000000-0000-4000-8000-000000000005'
$OTHER='00000000-0000-4000-8000-000000000006'
function Call([string]$key,[string]$title='Follow up on documents',[string]$vendor=$VENDOR,[string]$actor=$U){
 return "SELECT task_id IS NOT NULL AS ok, created FROM public.qf_vox_core_vendor_task_atomic_candidate_v1('$actor','$TEAM','$CITY','vendor_success_agent','$vendor','general','$title','medium',now()+interval '1 day','vox-$($key*64)');"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'RC32_CONTAINER_START_FAILED'}
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
 if(!$stable){throw 'RC32_SERVER_NOT_READY'}
 $fixture=@"
CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.cities(id uuid PRIMARY KEY,is_active boolean);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_object_scopes_v1(auth_user_id uuid,scope_kind text,object_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.marketplace_service_zones(id uuid PRIMARY KEY,city_id uuid,is_active boolean);
CREATE TABLE public.vendors(id uuid PRIMARY KEY,service_zone_id uuid);
CREATE TABLE public.vendor_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendor_id uuid,task_type text,title text,description text,priority text,due_at timestamptz,idempotency_key text,source text,status text,created_by uuid,updated_by uuid);
CREATE UNIQUE INDEX vtk_idem ON public.vendor_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
INSERT INTO public.cities VALUES('$CITY',true);
INSERT INTO public.vox_staff_teams_v1 VALUES('$TEAM','$CITY',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES('$U','$TEAM','vendor_success_agent',true,null,now()+interval '1 day');
INSERT INTO public.vox_staff_object_scopes_v1 VALUES('$U','vendor','$VENDOR',null,now()+interval '1 day');
INSERT INTO public.marketplace_service_zones VALUES('$ZONE','$CITY',true);
INSERT INTO public.vendors VALUES('$VENDOR','$ZONE'),('$OTHER',null);
"@
 $res=Sql $fixture;if($res.code -ne 0){throw "RC32_FIXTURE_FAILED $($res.text)"}
 $res=Sql (Get-Content $file -Raw);if($res.code -ne 0){throw "RC32_SQL_FAILED $($res.text)"}

 Pass 'first authorized call creates' (Call 'a') 't|t'
 # Replay is exact only with a pinned due_at, so anchor it inside one session.
 $anchored=@"
BEGIN;
CREATE TEMP TABLE d AS SELECT date_trunc('hour',now())+interval '2 days' AS due;
SELECT created FROM public.qf_vox_core_vendor_task_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$VENDOR','general','Pinned replay title','medium',(SELECT due FROM d),'vox-$('b'*64)');
SELECT created FROM public.qf_vox_core_vendor_task_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$VENDOR','general','Pinned replay title','medium',(SELECT due FROM d),'vox-$('b'*64)');
COMMIT;
"@
 Pass 'exact replay returns created=false, one row' $anchored "t`nf"
 Pass 'two rows total' 'SELECT count(*) FROM public.vendor_tasks;' '2'
 Denied 'same key different title is conflict' @"
SELECT * FROM public.qf_vox_core_vendor_task_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$VENDOR','general','A completely different title','medium',now()+interval '2 days','vox-$('b'*64)');
"@ 'VOX_VENDOR_TASK_IDEMPOTENCY_CONFLICT'
 Denied 'vendor outside actor grant' (Call 'c' -vendor $OTHER) 'VENDOR_GRANT_NOT_CURRENT'
 Denied 'bad key shape' "SELECT * FROM public.qf_vox_core_vendor_task_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$VENDOR','general','Follow up on documents','medium',now()+interval '1 day','vox-short');" 'VOX_CORE_TASK_INPUT_DENIED'
 Denied 'unauthenticated role cannot invoke writer' ("SET ROLE anon; "+(Call 'd')) 'permission denied'

 # Ordering race: a writer holds its transaction open; a concurrent revocation
 # UPDATE must block until the writer commits (never interleave mid-write).
 $writer=@"
BEGIN;
SELECT created FROM public.qf_vox_core_vendor_task_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$VENDOR','general','Race writer title','medium',now()+interval '1 day','vox-$('e'*64)');
SELECT pg_sleep(4);
COMMIT;
"@
 $job=Start-Job -ScriptBlock{param($n,$s) $s | docker exec -i $n psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String} -ArgumentList $name,$writer
 Start-Sleep -Seconds 1
 $sw=[Diagnostics.Stopwatch]::StartNew()
 $res=Sql "UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=now() WHERE auth_user_id='$U' AND object_id='$VENDOR';"
 $sw.Stop()
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($res.code -ne 0 -or $sw.Elapsed.TotalSeconds -lt 2){throw "RC32_REVOCATION_NOT_SERIALIZED $($sw.Elapsed.TotalSeconds)"}
 Write-Output "PASS revocation blocked behind in-flight write ($([int]$sw.Elapsed.TotalSeconds)s)"
 Pass 'writer committed before revocation' "SELECT count(*) FROM public.vendor_tasks WHERE title='Race writer title';" '1'
 Denied 'after revocation new write denied' (Call 'f') 'VENDOR_GRANT_NOT_CURRENT'
 Denied 'after revocation exact replay cannot read back' @"
SELECT * FROM public.qf_vox_core_vendor_task_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$VENDOR','general','Race writer title','medium',now()+interval '1 day','vox-$('e'*64)');
"@ 'VENDOR_GRANT_NOT_CURRENT'
 $null=Sql "UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=null;UPDATE public.vox_staff_memberships_v1 SET is_active=false;"
 Denied 'membership disabled denies' (Call '1') 'STAFF_NOT_CURRENT'
 $null=Sql "UPDATE public.vox_staff_memberships_v1 SET is_active=true;UPDATE public.cities SET is_active=false;"
 Denied 'city disabled denies' (Call '2') 'TEAM_OR_CITY_NOT_CURRENT'
 $null=Sql "UPDATE public.cities SET is_active=true;UPDATE public.marketplace_service_zones SET city_id='$OTHER';"
 Denied 'vendor zone moved to another city denies' (Call '3') 'VENDOR_CITY_DENIED'
 Pass 'no orphan rows from denied calls' 'SELECT count(*) FROM public.vendor_tasks;' '3'
 $sha=(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "VOX_RC32_CORE_VENDOR_TASK_ATOMIC_PG17_PASS tasks=3 sha256=$sha"
}finally{if($container){docker rm -f $name *> $null}}
