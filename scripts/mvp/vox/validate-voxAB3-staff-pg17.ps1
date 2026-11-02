$ErrorActionPreference='Stop'
$name='qf-vox-ab3-staff-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sqlPath=Join-Path $root 'ops\vox\sql-candidates\20261017030000_vox_ab3_staff_invitation_review_candidate.sql'
if(docker ps -aq --filter "name=^/$name$"){throw 'PG_NAME_COLLISION'}
$container=$null
function Sql([string]$cmd){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=($cmd|docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 return @{code=$code;text=$out}
}
function Require([string]$title,[string]$query,[string]$want){
 $r=Sql $query
 if($r.code -ne 0 -or $r.text.Trim() -ne $want){throw "FAILED $title $($r.text)"}
 Write-Output "PASS $title"
}
function Denied([string]$title,[string]$query,[string]$match){
 $r=Sql $query
 if($r.code -eq 0 -or $r.text -notmatch $match){throw "EXPECTED_DENIAL $title $($r.text)"}
 Write-Output "PASS DENIED $title"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'PG_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 40;$i++){
  docker exec $name pg_isready -U postgres -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Milliseconds 300
 }
 if(!$ready){throw 'PG_NOT_READY'}

 # Fresh postgres:17-alpine initially runs a disposable bootstrap server.
 # pg_isready can succeed during bootstrap, then its socket disappears during
 # final startup. Wait for the entrypoint's completed-init marker AND a
 # live final server before any schema fixture writes.
 $stable=$false
 for($attempt=0;$attempt -lt 80;$attempt++){
  $oldLogErrorPreference=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try{
   $initLog=(docker logs $name 2>&1 | Out-String)
   $logExit=$LASTEXITCODE
  }finally{$ErrorActionPreference=$oldLogErrorPreference}
  if($logExit -eq 0 -and $initLog -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$stable=$true;break}
  }
  Start-Sleep -Milliseconds 300
 }
 if(!$stable){throw 'PG_FINAL_SERVER_NOT_STABLE'}

 $fixture=@'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid primary key,role text NOT NULL,is_active boolean NOT NULL);
CREATE TABLE public.cities(id uuid primary key);
CREATE TABLE public.vox_staff_teams_v1(id uuid primary key,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid primary key,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
INSERT INTO public.profiles VALUES
('00000000-0000-4000-8000-000000000001','admin',true),
('00000000-0000-4000-8000-000000000002','staff',true),
('00000000-0000-4000-8000-000000000003','staff',true);
INSERT INTO public.cities VALUES ('00000000-0000-4000-8000-000000000004');
INSERT INTO public.vox_staff_teams_v1 VALUES
('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005','team_leader',true,null,now()+interval '7 days'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','support_agent',true,null,now()+interval '7 days');
'@
 $v=Sql $fixture;if($v.code -ne 0){throw "FIXTURE $($v.text)"}
 $v=Sql (Get-Content $sqlPath -Raw);if($v.code -ne 0){throw "MIGRATION $($v.text)"}
 $request=@'
INSERT INTO public.vox_ab3_staff_invitation_requests_candidate_v1
(id,owner_id,reviewer_id,team_id,city_id,email_sha256,department_packs,nonce,expected_roster_revision,expires_at)
VALUES
('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005',
'00000000-0000-4000-8000-000000000004',
repeat('a',64),ARRAY['acquisition','service_support'],
'00000000-0000-4000-8000-000000000011',3,now()+interval '1 hour');
'@
 $v=Sql $request;if($v.code -ne 0){throw "VALID_PENDING_REVIEW_DENIED $($v.text)"}
 Require 'one immutable pending staff review' "SELECT state FROM public.vox_ab3_staff_invitation_requests_candidate_v1" 'PENDING_INDEPENDENT_REVIEW'
 Denied 'nonce replay' $request 'duplicate key'
 Denied 'self reviewer' ($request.Replace('000000000010','000000000012').Replace('000000000011','000000000013').Replace('000000000002','000000000001')) '(?i)check constraint|VOX_AB3_CURRENT_OWNER_OR_TL_DENIED'
 Denied 'reviewer not TL' ($request.Replace('000000000010','000000000014').Replace('000000000011','000000000015').Replace('000000000002','000000000003')) 'VOX_AB3_CURRENT_OWNER_OR_TL_DENIED'
 Denied 'bad unsorted packs' ($request.Replace('000000000010','000000000016').Replace('000000000011','000000000017').Replace("ARRAY['acquisition','service_support']","ARRAY['service_support','acquisition']")) 'VOX_AB3_PACKS_NOT_SORTED'
 Denied 'anonymous SELECT' 'SET ROLE anon; SELECT * FROM public.vox_ab3_staff_invitation_requests_candidate_v1;' 'permission denied'
 Denied 'authenticated INSERT' 'SET ROLE authenticated; INSERT INTO public.vox_ab3_staff_invitation_requests_candidate_v1 DEFAULT VALUES;' 'permission denied'
 $decision=@'
INSERT INTO public.vox_ab3_staff_invitation_decisions_candidate_v1
(request_id,reviewer_id,decision,decision_reference,review_signature_sha256)
VALUES('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002',
'APPROVED','00000000-0000-4000-8000-000000000021',repeat('b',64));
'@
 $v=Sql $decision;if($v.code -ne 0){throw "VALID_DECISION_DENIED $($v.text)"}
 Denied 'duplicate independent decision' $decision 'duplicate key'
 Denied 'immutable request' "DELETE FROM public.vox_ab3_staff_invitation_requests_candidate_v1 WHERE id='00000000-0000-4000-8000-000000000010';" 'VOX_AB3_APPEND_ONLY'
 Denied 'immutable decision' "UPDATE public.vox_ab3_staff_invitation_decisions_candidate_v1 SET decision='REJECTED';" 'VOX_AB3_APPEND_ONLY'
 Require 'both tables FORCE row security' @'
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname LIKE 'vox_ab3_staff_invitation_%_candidate_v1'
 AND c.relrowsecurity AND c.relforcerowsecurity;
'@ '2'
 Require 'no anon/Auth privileges' @'
SELECT CASE WHEN NOT has_table_privilege('authenticated','public.vox_ab3_staff_invitation_requests_candidate_v1','INSERT')
 AND NOT has_table_privilege('anon','public.vox_ab3_staff_invitation_decisions_candidate_v1','SELECT')
 AND has_table_privilege('service_role','public.vox_ab3_staff_invitation_requests_candidate_v1','INSERT')
 AND NOT has_table_privilege('service_role','public.vox_ab3_staff_invitation_requests_candidate_v1','UPDATE')
 THEN 'PASS' ELSE 'FAIL' END;
'@ 'PASS'
 $hash=(Get-FileHash $sqlPath -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "VOX_AB3_STAFF_PG17_PASS isolation=network-none no_auth_invites=true sha256=$hash"
}finally{
 if($container){docker rm -f $name *> $null}
}
