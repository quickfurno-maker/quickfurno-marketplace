# VOX-07 network-disabled synthetic PostgreSQL test. No real Supabase actions.
$ErrorActionPreference='Stop'
$name='qf-vox07-approved-finalizer-cert'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$fixture=Get-Content (Join-Path $root 'scripts\mvp\vox\vox07-finalizer-fixture.sql') -Raw
$pieces=$fixture -split '-- Synthetic profiles:',2
if($pieces.Count -ne 2){throw 'FIXTURE_BOUNDARY_MISSING'}
$migrations=@('20261014010000_vox_v1_scoped_staff_authority.sql','20261014020000_vox_v1_staff_review_workflow.sql','20261014030000_vox_v1_approved_grant_finalizer.sql','20261014040000_vox_v1_staff_emergency_revocation.sql')
if(docker ps -aq --filter "name=^/$name$"){throw 'REFUSING_OTHER_CONTAINER'}
$cid=$null
try {
 $cid=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=vox_synthetic_only postgres:16-alpine
 if($LASTEXITCODE -ne 0){throw 'START_FAILED'}
 $up=$false
 for($i=0;$i -lt 30;$i++){ docker exec $name pg_isready -U postgres *> $null; if($LASTEXITCODE -eq 0){$up=$true;break};Start-Sleep -Seconds 1 }
 if(-not $up){throw 'PG_NOT_READY'}
 $pieces[0] | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'BOOTSTRAP_FAILED'}
 foreach($namePart in $migrations){
   (Get-Content (Join-Path $root ('ops\vox\quarantined-migrations\legacy-20261014\'+$namePart)) -Raw) |
    docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
   if($LASTEXITCODE -ne 0){throw ('MIGRATION_FAILED='+$namePart)}
 }
 ('-- Synthetic profiles:'+$pieces[1]) | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'FINALIZER_FIXTURE_GATES_FAILED'}
 (Get-Content (Join-Path $root 'scripts\mvp\vox\vox07-revoke-fixture.sql') -Raw) | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'REVOKE_FIXTURE_GATES_FAILED'}
 $counts=docker exec $name psql -X -A -t -U postgres -d postgres -c "select (select count(*) from public.vox_staff_memberships_v1)||'|'||(select count(*) from public.vox_staff_object_scopes_v1)||'|'||(select count(*) from public.vox_staff_grant_audit_v1)||'|'||(select count(*) from public.vox_staff_access_activations_v1)"
 if($LASTEXITCODE -ne 0 -or ([string]$counts).Trim() -ne '1|1|3|2'){throw ('COUNTS_WRONG='+$counts)}
 $acl=docker exec $name psql -X -A -t -U postgres -d postgres -c "select (select relrowsecurity and relforcerowsecurity from pg_class where relname='vox_staff_access_activations_v1')::text ||'|'||has_function_privilege('authenticated','public.qf_vox_activate_reviewed_access_v1(uuid,uuid,integer,text)','EXECUTE')::text"
 if($LASTEXITCODE -ne 0 -or ([string]$acl).Trim() -ne 'true|false'){throw ('PRIVILEGE_FAIL='+$acl)}
 Write-Output 'VOX07_DISPOSABLE_FINALIZER_PASS member=1 prospect_scope=1 audit=3 activation=2 replay_denied=true wrong_city_denied=true unapproved_denied=true bad_actor_denied=true revoked=true revoke_replay_denied=true browser_grants_none=true'
}finally{
 if($cid){docker rm -f $name *> $null}
}
