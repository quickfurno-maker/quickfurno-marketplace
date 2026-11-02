$ErrorActionPreference='Stop'
$name='qf-vox-ab7a-staff-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$files=@(
 (Join-Path $root 'ops\vox\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'),
 (Join-Path $root 'ops\vox\sql-candidates\20261018030000_vox_ab7a_staff_lifecycle_pending_candidate.sql'))
if(docker ps -aq --filter "name=^/$name$"){throw 'AB7A_NAME_COLLISION'}
$container=$null
function Sql([string]$q){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$output=($q|docker exec -i $name psql -X -t -A -q -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String);$rc=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 return @{rc=$rc;text=$output.Trim()}
}
function Expect([string]$label,[string]$q,[string]$expected){
 $x=Sql $q;if($x.rc -ne 0 -or $x.text -ne $expected){throw "AB7A_NOT_EXPECTED $label $($x.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$q,[string]$match){
 $x=Sql $q;if($x.rc -eq 0 -or $x.text -notmatch $match){throw "AB7A_WRONG_ALLOW $label $($x.text)"}
 Write-Output "PASS DENIED $label"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'PG_START_FAILED'}
 $stable=$false
 for($i=0;$i -lt 80;$i++){
  $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1|Out-String);$rc=$LASTEXITCODE}
  finally{$ErrorActionPreference=$prior}
  if($rc -eq 0 -and $log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$stable=$true;break}
  }
  Start-Sleep -Milliseconds 330
 }
 if(!$stable){throw 'PG_FINAL_NOT_READY'}
 $fixture=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean);
CREATE TABLE public.cities(id uuid PRIMARY KEY);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,
 is_active boolean,revoked_at timestamptz,expires_at timestamptz);
INSERT INTO public.profiles VALUES
('00000000-0000-4000-8000-000000000001','admin',true),
('00000000-0000-4000-8000-000000000002',null,true),
('00000000-0000-4000-8000-000000000003',null,true),
('00000000-0000-4000-8000-000000000099',null,true);
INSERT INTO public.cities VALUES ('00000000-0000-4000-8000-000000000004');
INSERT INTO public.vox_staff_teams_v1 VALUES
('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','team_leader',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','support_agent',true,null,now()+interval '1 day'),
('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000005','support_agent',false,now(),now()+interval '1 day');
'@
 $x=Sql $fixture;if($x.rc -ne 0){throw "AB7A_FIXTURE $($x.text)"}
 foreach($file in $files){$x=Sql (Get-Content $file -Raw);if($x.rc -ne 0){throw "AB7A_CANDIDATE_SQL $file $($x.text)"}}
 $insert=@'
INSERT INTO public.vox_ab7a_staff_lifecycle_pending_candidate_v1
(id,action,owner_id,reviewer_id,target_staff_id,team_id,city_id,nonce,expected_roster_revision,expires_at)
VALUES('00000000-0000-4000-8000-000000000021','SUSPEND',
'00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000002',
'00000000-0000-4000-8000-000000000003',
'00000000-0000-4000-8000-000000000005',
'00000000-0000-4000-8000-000000000004',
'00000000-0000-4000-8000-000000000022',0,now()+interval '1 hour');
'@
 $x=Sql $insert;if($x.rc -ne 0){throw "AB7A_PENDING_INSERT $($x.text)"}
 Expect 'pending only, no grant/identity effects' "SELECT state FROM public.vox_ab7a_staff_lifecycle_pending_candidate_v1;" 'PENDING_INDEPENDENT_REVIEW'
 Denied 'nonce/revision replay' $insert 'duplicate key'
 Denied 'owner self-review' ($insert.Replace('000000000021','000000000023').Replace('000000000022','000000000024').Replace("000000000002","000000000001")) 'check constraint|VOX_AB7A_CURRENT_INDEPENDENT_MEMBERSHIP_REQUIRED'
 Denied 'disabled target' ($insert.Replace('000000000021','000000000025').Replace('000000000022','000000000026').Replace("000000000003","000000000099")) 'VOX_AB7A_CURRENT_INDEPENDENT_MEMBERSHIP_REQUIRED'
 $x=Sql "UPDATE public.vox_staff_memberships_v1 SET revoked_at=now() WHERE auth_user_id='00000000-0000-4000-8000-000000000002';"
 if($x.rc -ne 0){throw 'REVOKE_TL_FIXTURE_FAILED'}
 Denied 'TL revoked before proposal' ($insert.Replace('000000000021','000000000027').Replace('000000000022','000000000028')) 'VOX_AB7A_CURRENT_INDEPENDENT_MEMBERSHIP_REQUIRED'
 Denied 'anon cannot INSERT' 'SET ROLE anon; INSERT INTO public.vox_ab7a_staff_lifecycle_pending_candidate_v1 DEFAULT VALUES;' 'permission denied'
 Denied 'append-only UPDATE' "UPDATE public.vox_ab7a_staff_lifecycle_pending_candidate_v1 SET action='TRANSFER_TEAM';" 'VOX_F1_APPEND_ONLY'
 Expect 'FORCE RLS' @'
SELECT CASE WHEN relrowsecurity AND relforcerowsecurity THEN 'PASS' ELSE 'FAIL' END
FROM pg_class WHERE relname='vox_ab7a_staff_lifecycle_pending_candidate_v1';
'@ 'PASS'
 Write-Output ("VOX_AB7A_STAFF_PG17_PASS sha256="+(Get-FileHash $files[-1] -Algorithm SHA256).Hash.ToLowerInvariant())
}finally{if($container){docker rm -f $name *> $null}}
