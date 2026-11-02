$ErrorActionPreference='Stop'
# Disposable, network-less PG17 proof of the RC37 atomic Core vendor-task
# transition. Candidate SQL only; nothing here touches a managed database.
$name='qf-vox-rc37-core-transition-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$file=Join-Path $root 'ops\vox\rc37-review-candidates\20261031020000_vox_rc37_core_vendor_task_transition_atomic_candidate.sql'
if(docker ps -aq --filter "name=^/$name$"){throw 'RC37_CONTAINER_CONFLICT'}
$container=$null
function Sql([string]$sql){
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$output=($sql | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 return @{code=$code;text=$output.Trim()}
}
function Norm([string]$t){return ($t -replace "\r\n?","`n").Trim()}
function Pass([string]$label,[string]$query,[string]$expected){
 $res=Sql $query
 if($res.code -ne 0 -or (Norm $res.text) -cne (Norm $expected)){throw "RC37_POSITIVE_FAILED $label $($res.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$query,[string]$regex){
 $res=Sql $query
 if($res.code -eq 0 -or $res.text -notmatch $regex){throw "RC37_NEGATIVE_FAILED $label $($res.text)"}
 Write-Output "PASS DENIED $label"
}
function Id([int]$n){return '00000000-0000-4000-8000-'+$n.ToString('000000000000')}
$U=Id 1;$TEAM=Id 2;$CITY=Id 3;$VENDOR=Id 4;$ZONE=Id 5;$OTHER=Id 6;$U2=Id 7
$OTHERCITY=Id 50
$RESULT='Documents received and verified'
# All calls run as service_role (the only role granted EXECUTE).
function Tx([string]$task,[string]$action='complete',[string]$result=$RESULT,[string]$actor=$U){
 $r=if($action -eq 'cancel'){'NULL'}else{"'$result'"}
 return "SET ROLE service_role; SELECT task_id, task_status, replayed, receipt FROM public.qf_vox_core_vendor_task_transition_atomic_candidate_v1('$actor','$TEAM','$CITY','vendor_success_agent','$task','$action',$r);"
}
function Job([string]$sql){
 return Start-Job -ScriptBlock{param($n,$s) $s | docker exec -i $n psql -X -q -A -t -U postgres -d postgres 2>&1 | Out-String} -ArgumentList $name,$sql
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'RC37_CONTAINER_START_FAILED'}
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
 if(!$stable){throw 'RC37_SERVER_NOT_READY'}
 # Grants mirror the quarantined staff authority migration (select/insert/update
 # to service_role) and the Vendor CRM foundation (select/insert/update tasks).
 $tasks=(10..21|%{"('$(Id $_)','$VENDOR','general','Follow up task $_','open')"}) -join ','
 $fixture=@"
CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.cities(id uuid PRIMARY KEY,is_active boolean);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_object_scopes_v1(auth_user_id uuid,scope_kind text,object_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.marketplace_service_zones(id uuid PRIMARY KEY,city_id uuid,is_active boolean);
CREATE TABLE public.vendors(id uuid PRIMARY KEY,service_zone_id uuid);
CREATE TABLE public.vendor_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendor_id uuid NOT NULL,task_type text NOT NULL,title text NOT NULL,description text,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','done','cancelled')),completion_result text,
 updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,updated_by uuid,
 CONSTRAINT vtk_completed_consistency CHECK ((status='done')=(completed_at IS NOT NULL)));
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.vox_staff_teams_v1,public.vox_staff_memberships_v1,public.vox_staff_object_scopes_v1,public.vendor_tasks TO service_role;
GRANT SELECT,UPDATE ON public.cities,public.vendors,public.marketplace_service_zones TO service_role;
INSERT INTO public.cities VALUES('$CITY',true);
INSERT INTO public.vox_staff_teams_v1 VALUES('$TEAM','$CITY',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES('$U','$TEAM','vendor_success_agent',true,null,now()+interval '1 day'),('$U2','$TEAM','vendor_success_agent',true,null,now()+interval '1 day');
INSERT INTO public.vox_staff_object_scopes_v1 VALUES('$U','vendor','$VENDOR',null,now()+interval '1 day'),('$U2','vendor','$VENDOR',null,now()+interval '1 day');
INSERT INTO public.marketplace_service_zones VALUES('$ZONE','$CITY',true);
INSERT INTO public.vendors VALUES('$VENDOR','$ZONE'),('$OTHER',null);
INSERT INTO public.vendor_tasks(id,vendor_id,task_type,title,status) VALUES $tasks,('$(Id 30)','$OTHER','general','Out of grant task','open');
"@
 $res=Sql $fixture;if($res.code -ne 0){throw "RC37_FIXTURE_FAILED $($res.text)"}
 $res=Sql (Get-Content $file -Raw);if($res.code -ne 0){throw "RC37_SQL_FAILED $($res.text)"}

 # --- functional ---
 $first=Sql (Tx (Id 10));if($first.code -ne 0 -or $first.text -notmatch "(^|\n)$(Id 10)\|done\|f\|[0-9a-f]{64}$"){throw "RC37_COMPLETE_FAILED $($first.text)"}
 $rcpt=($first.text -split '\|')[-1].Trim()
 Write-Output 'PASS complete returns done, replayed=false, sha256 receipt'
 $again=Sql (Tx (Id 10));if($again.code -ne 0 -or $again.text -notmatch "\|done\|t\|$rcpt$"){throw "RC37_REPLAY_FAILED $($again.text)"}
 Write-Output 'PASS exact replay returns replayed=true with the identical receipt'
 Pass 'row is done with completed_at, text and updated_by actor' "SELECT status,completion_result,completed_at IS NOT NULL,updated_by FROM public.vendor_tasks WHERE id='$(Id 10)';" "done|$RESULT|t|$U"
 Denied 'replay with different text is conflict' (Tx (Id 10) -result 'A completely different result') 'VOX_VENDOR_TASK_STATE_CONFLICT'
 Denied 'replay by another actor is conflict' (Tx (Id 10) -actor $U2) 'VOX_VENDOR_TASK_STATE_CONFLICT'
 Denied 'cancel after done is conflict' (Tx (Id 10) -action cancel) 'VOX_VENDOR_TASK_STATE_CONFLICT'
 $c=Sql (Tx (Id 11) -action cancel);if($c.code -ne 0 -or $c.text -notmatch '\|cancelled\|f\|[0-9a-f]{64}$'){throw "RC37_CANCEL_FAILED $($c.text)"}
 Write-Output 'PASS cancel returns cancelled'
 Pass 'cancelled row keeps completed_at null and updated_by actor' "SELECT status,completion_result IS NULL,completed_at IS NULL,updated_by FROM public.vendor_tasks WHERE id='$(Id 11)';" "cancelled|t|t|$U"
 $c2=Sql (Tx (Id 11) -action cancel);if($c2.code -ne 0 -or $c2.text -notmatch '\|cancelled\|t\|'){throw "RC37_CANCEL_REPLAY_FAILED $($c2.text)"}
 Write-Output 'PASS cancel exact replay'
 Denied 'complete after cancel is conflict' (Tx (Id 11)) 'VOX_VENDOR_TASK_STATE_CONFLICT'
 Denied 'cancel with a result is input-denied' "SET ROLE service_role; SELECT * FROM public.qf_vox_core_vendor_task_transition_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$(Id 12)','cancel','Not allowed here');" 'INPUT_DENIED'
 Denied 'short result' (Tx (Id 12) -result 'short') 'INPUT_DENIED'
 Denied 'untrimmed result' (Tx (Id 12) -result ' padded result text ') 'INPUT_DENIED'
 Denied 'double-space result' (Tx (Id 12) -result 'double  space result') 'INPUT_DENIED'
 Denied 'bad action' "SET ROLE service_role; SELECT * FROM public.qf_vox_core_vendor_task_transition_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$(Id 12)','reopen',null);" 'INPUT_DENIED'
 Denied 'non-eligible role' "SET ROLE service_role; SELECT * FROM public.qf_vox_core_vendor_task_transition_atomic_candidate_v1('$U','$TEAM','$CITY','auditor','$(Id 12)','cancel',null);" 'INPUT_DENIED'
 $oog=Sql (Tx (Id 30)); $unk=Sql (Tx (Id 99))
 if($oog.code -eq 0 -or $unk.code -eq 0 -or (Norm ($oog.text -replace 'CONTEXT:[\s\S]*','')) -cne (Norm ($unk.text -replace 'CONTEXT:[\s\S]*',''))){throw "RC37_EXISTENCE_ORACLE $($oog.text) // $($unk.text)"}
 Write-Output 'PASS DENIED out-of-grant and unknown task are indistinguishable'
 Denied 'anon cannot invoke' ((Tx (Id 12)) -replace 'service_role','anon') 'permission denied'
 Denied 'authenticated cannot invoke' ((Tx (Id 12)) -replace 'service_role','authenticated') 'permission denied'

 # --- concurrency ---
 # 1. Revocation UPDATE blocks behind an in-flight transition (never mid-write).
 $writer="SET ROLE service_role; BEGIN; SELECT task_status FROM public.qf_vox_core_vendor_task_transition_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$(Id 12)','complete','$RESULT'); SELECT pg_sleep(4); COMMIT;"
 $job=Job $writer;Start-Sleep -Seconds 1
 $sw=[Diagnostics.Stopwatch]::StartNew()
 $res=Sql "UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=now() WHERE auth_user_id='$U' AND object_id='$VENDOR';"
 $sw.Stop();$null=Receive-Job $job -Wait;Remove-Job $job
 if($res.code -ne 0 -or $sw.Elapsed.TotalSeconds -lt 2){throw "RC37_REVOCATION_NOT_SERIALIZED $($sw.Elapsed.TotalSeconds)"}
 Write-Output "PASS revocation blocked behind in-flight transition ($([int]$sw.Elapsed.TotalSeconds)s)"
 Pass 'in-flight transition committed before the revocation' "SELECT status FROM public.vendor_tasks WHERE id='$(Id 12)';" 'done'
 Denied 'after revocation a new transition is denied' (Tx (Id 13)) 'VENDOR_GRANT_NOT_CURRENT'
 Denied 'after revocation exact replay is denied too' (Tx (Id 12)) 'VENDOR_GRANT_NOT_CURRENT'
 $null=Sql "UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=null WHERE auth_user_id='$U';"

 # 2. A transition waiting behind an uncommitted revocation is denied once it commits.
 $revoker="BEGIN; UPDATE public.vox_staff_memberships_v1 SET is_active=false WHERE auth_user_id='$U'; SELECT pg_sleep(4); COMMIT;"
 $job=Job $revoker;Start-Sleep -Seconds 1
 $sw=[Diagnostics.Stopwatch]::StartNew()
 $res=Sql (Tx (Id 14))
 $sw.Stop();$null=Receive-Job $job -Wait;Remove-Job $job
 if($res.code -eq 0 -or $res.text -notmatch 'STAFF_NOT_CURRENT' -or $sw.Elapsed.TotalSeconds -lt 2){throw "RC37_WRITE_AFTER_REVOCATION $($sw.Elapsed.TotalSeconds) $($res.text)"}
 Write-Output "PASS DENIED transition queued behind revocation is denied after it commits ($([int]$sw.Elapsed.TotalSeconds)s)"
 Pass 'queued transition wrote nothing' "SELECT status FROM public.vendor_tasks WHERE id='$(Id 14)';" 'open'
 $null=Sql "UPDATE public.vox_staff_memberships_v1 SET is_active=true WHERE auth_user_id='$U';"

 # 3. Two identical concurrent completes: exactly one write, one exact replay, same receipt.
 $holdA="SET ROLE service_role; BEGIN; SELECT task_status,replayed,receipt FROM public.qf_vox_core_vendor_task_transition_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$(Id 15)','complete','$RESULT'); SELECT pg_sleep(3); COMMIT;"
 $job=Job $holdA;Start-Sleep -Seconds 1
 $b=Sql (Tx (Id 15));$a=(Receive-Job $job -Wait);Remove-Job $job
 $ra=([regex]::Match($a,'done\|f\|([0-9a-f]{64})')).Groups[1].Value
 $rb=([regex]::Match($b.text,'done\|t\|([0-9a-f]{64})')).Groups[1].Value
 if(!$ra -or $ra -ne $rb){throw "RC37_CONCURRENT_COMPLETE $a // $($b.text)"}
 Write-Output 'PASS concurrent identical completes: one write, one replay, identical receipt'

 # 4. Complete vs cancel race: loser sees a conflict and the winner stays intact.
 $holdC="SET ROLE service_role; BEGIN; SELECT task_status FROM public.qf_vox_core_vendor_task_transition_atomic_candidate_v1('$U','$TEAM','$CITY','vendor_success_agent','$(Id 16)','cancel',null); SELECT pg_sleep(3); COMMIT;"
 $job=Job $holdC;Start-Sleep -Seconds 1
 $loser=Sql (Tx (Id 16));$null=Receive-Job $job -Wait;Remove-Job $job
 if($loser.code -eq 0 -or $loser.text -notmatch 'VOX_VENDOR_TASK_STATE_CONFLICT'){throw "RC37_RACE_LOSER $($loser.text)"}
 Pass 'cancel winner intact after losing complete' "SELECT status,completion_result IS NULL,completed_at IS NULL FROM public.vendor_tasks WHERE id='$(Id 16)';" 'cancelled|t|t'
 Write-Output 'PASS DENIED complete-vs-cancel race loser is a conflict'

 # 5. Remaining authority dimensions.
 $null=Sql "UPDATE public.cities SET is_active=false;"
 Denied 'city disabled denies' (Tx (Id 17)) 'TEAM_OR_CITY_NOT_CURRENT'
 $null=Sql "UPDATE public.cities SET is_active=true;UPDATE public.marketplace_service_zones SET city_id='$OTHERCITY';"
 Denied 'vendor zone moved to another city denies' (Tx (Id 17)) 'VENDOR_CITY_DENIED'
 $null=Sql "UPDATE public.marketplace_service_zones SET city_id='$CITY';UPDATE public.vox_staff_memberships_v1 SET expires_at=now()-interval '1 minute' WHERE auth_user_id='$U';"
 Denied 'expired membership denies' (Tx (Id 17)) 'STAFF_NOT_CURRENT'
 $null=Sql "UPDATE public.vox_staff_memberships_v1 SET expires_at=now()+interval '1 day';"
 Pass 'no orphan or partial rows from denied calls' "SELECT count(*) FILTER (WHERE status='done'),count(*) FILTER (WHERE status='cancelled'),count(*) FILTER (WHERE status='open') FROM public.vendor_tasks;" '3|2|8'
 Pass 'no foreign updated_by' "SELECT count(*) FROM public.vendor_tasks WHERE updated_by IS NOT NULL AND updated_by<>'$U';" '0'
 $sha=(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "VOX_RC37_CORE_VENDOR_TASK_TRANSITION_ATOMIC_PG17_PASS sha256=$sha"
}finally{if($container){docker rm -f $name *> $null}}
