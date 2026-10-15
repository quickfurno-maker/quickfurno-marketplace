# VOX-05 disposable SQL review-governance test; never touches real Supabase.
$ErrorActionPreference="Stop"
$name="qf-vox05-grant-review-cert"
$root=(Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$m1=Join-Path $root "ops\vox\quarantined-migrations\legacy-20261014\20261014010000_vox_v1_scoped_staff_authority.sql"
$m2=Join-Path $root "ops\vox\quarantined-migrations\legacy-20261014\20261014020000_vox_v1_staff_review_workflow.sql"
if(docker ps -aq --filter "name=^/$name$"){throw "REFUSING_EXISTING_CONTAINER"}
$cid=$null
try{
 $cid=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=vox_disposable_not_production postgres:16-alpine
 if($LASTEXITCODE -ne 0){throw "POSTGRES_LAUNCH_FAILED"}
 $ready=$false
 for($i=0;$i -lt 30;$i++){docker exec $name pg_isready -U postgres *> $null;if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
 if(-not $ready){throw "POSTGRES_NOT_READY"}
 @'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb not null default '{}'::jsonb);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean);
CREATE TABLE public.cities(id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
'@ | docker exec -i $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres *> $null
 if($LASTEXITCODE -ne 0){throw "BOOTSTRAP_FAILED"}
 Get-Content $m1 -Raw | docker exec -i $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres *> $null
 if($LASTEXITCODE -ne 0){throw "BASE_MIGRATION_FAILED"}
 Get-Content $m2 -Raw | docker exec -i $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres *> $null
 if($LASTEXITCODE -ne 0){throw "REVIEW_MIGRATION_FAILED"}
 @'
INSERT INTO public.profiles(id,role,is_active) VALUES
('aaaa0000-0000-4000-8000-000000000001','admin',true),
('aaaa0000-0000-4000-8000-000000000002','admin',true),
('aaaa0000-0000-4000-8000-000000000003','admin',true);
INSERT INTO auth.users(id,raw_app_meta_data) VALUES
('aaaa0000-0000-4000-8000-000000000002','{"admin_role":"Superadmin"}'),
('aaaa0000-0000-4000-8000-000000000003','{"admin_role":"Support Admin"}');
INSERT INTO public.cities(id) VALUES('aaaa0000-0000-4000-8000-000000000004');
INSERT INTO public.vox_staff_teams_v1(id,team_name,city_id,is_active,created_by) VALUES
('aaaa0000-0000-4000-8000-000000000005','Pune vendor ops','aaaa0000-0000-4000-8000-000000000004',true,'aaaa0000-0000-4000-8000-000000000001');
INSERT INTO public.vox_staff_access_requests_v1(id,request_nonce,requested_by,target_profile_id,team_id,request_kind,requested_role,desired_expires_at,reason)
VALUES
('bbbb0000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000011','aaaa0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000003','aaaa0000-0000-4000-8000-000000000005','STAFF_MEMBERSHIP','vendor_success_agent',now()+interval '2 days','Two-person staff access request'),
('bbbb0000-0000-4000-8000-000000000002','bbbb0000-0000-4000-8000-000000000012','aaaa0000-0000-4000-8000-000000000002','aaaa0000-0000-4000-8000-000000000003','aaaa0000-0000-4000-8000-000000000005','STAFF_MEMBERSHIP','vendor_success_agent',now()+interval '2 days','Self reviewed request not allowed'),
('bbbb0000-0000-4000-8000-000000000003','bbbb0000-0000-4000-8000-000000000013','aaaa0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000002','aaaa0000-0000-4000-8000-000000000005','STAFF_MEMBERSHIP','operations_manager',now()+interval '2 days','Bad reviewer request must fail');
'@ | docker exec -i $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres *> $null
 if($LASTEXITCODE -ne 0){throw "SEED_FAILED"}
 $passed=docker exec $name psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET ROLE service_role; SELECT decision,new_revision FROM public.qf_vox_review_staff_access_v1('bbbb0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000002',0,'APPROVE','APPROVAL-REVIEW-001');"
 if($LASTEXITCODE -ne 0 -or (($passed -join "`n") -notmatch 'APPROVED\|1')){throw "POSITIVE_TWO_PERSON_REVIEW_FAILED"}
 # Expected SQL exception outcomes. Temporarily allow native stderr without
 # PowerShell treating the failed psql command as an unexpected script crash.
 $ErrorActionPreference="Continue"
 docker exec $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET ROLE service_role; SELECT * FROM public.qf_vox_review_staff_access_v1('bbbb0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000002',0,'APPROVE','APPROVAL-REVIEW-001');" *> $null
 $replay=$LASTEXITCODE
 docker exec $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET ROLE service_role; SELECT * FROM public.qf_vox_review_staff_access_v1('bbbb0000-0000-4000-8000-000000000002','aaaa0000-0000-4000-8000-000000000002',0,'APPROVE','APPROVAL-REVIEW-002');" *> $null
 $self=$LASTEXITCODE
 docker exec $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET ROLE service_role; SELECT * FROM public.qf_vox_review_staff_access_v1('bbbb0000-0000-4000-8000-000000000003','aaaa0000-0000-4000-8000-000000000003',0,'APPROVE','APPROVAL-REVIEW-003');" *> $null
 $wrongRole=$LASTEXITCODE
 docker exec $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET ROLE authenticated; SELECT * FROM public.qf_vox_review_staff_access_v1('bbbb0000-0000-4000-8000-000000000003','aaaa0000-0000-4000-8000-000000000002',0,'APPROVE','APPROVAL-REVIEW-003');" *> $null
 $browser=$LASTEXITCODE
 $ErrorActionPreference="Stop"
 if($replay -eq 0 -or $self -eq 0 -or $wrongRole -eq 0 -or $browser -eq 0){throw "FAIL_CLOSED_NEGATIVE_GATE_FAILED"}
 $st=docker exec $name psql -X -A -t -U postgres -d postgres -c "select concat((select count(*) from public.vox_staff_access_decisions_v1),'|',(select count(*) from public.vox_staff_memberships_v1),'|',(select count(*) from pg_class where relname in ('vox_staff_access_requests_v1','vox_staff_access_decisions_v1') and relrowsecurity and relforcerowsecurity));"
 if($LASTEXITCODE -ne 0 -or ($st -join "`n").Trim() -ne '1|0|2'){throw "ATOMIC_AUDIT_OR_NO_GRANT_FAILED:$st"}
 Write-Output "VOX_05_APPROVAL_DISPOSABLE_POSTGRES_PASS review=APPROVED audit=1 applied_grants=0 forced_RLS=2 replay_denied=true self_denied=true wrong_role_denied=true browser_denied=true"
}finally{
 if($cid){docker rm -f $name *> $null}
}
