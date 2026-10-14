# VOX-03 isolated SQL migration certification. No host ports, network disabled.
# Requires the already-cached postgres:16-alpine container image.
$ErrorActionPreference = 'Stop'
$name = 'qf-vox03-isolated-schema-cert'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
$sql = Join-Path $repo 'supabase\migrations\20261014010000_vox_v1_scoped_staff_authority.sql'
if(-not (Test-Path $sql)){throw 'SQL_MIGRATION_NOT_FOUND'}
$existing = docker ps -aq --filter "name=^/$name$"
if($existing){throw 'EXISTING_CONTAINER_REFUSING_TO_TOUCH'}
try {
  $cid = docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=vox_local_disposable_only postgres:16-alpine
  if($LASTEXITCODE -ne 0){throw 'POSTGRES_START_FAILED'}
  $ready=$false
  for($i=0;$i -lt 30;$i++){
    docker exec $name pg_isready -U postgres -d postgres *> $null
    if($LASTEXITCODE -eq 0){$ready=$true;break}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'POSTGRES_NOT_READY'}
  @'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.profiles(id uuid primary key);
CREATE TABLE public.cities(id uuid primary key);
'@ | docker exec -i $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
  if($LASTEXITCODE -ne 0){throw 'BOOTSTRAP_FAILED'}
  Get-Content $sql -Raw | docker exec -i $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres
  if($LASTEXITCODE -ne 0){throw 'MIGRATION_SQL_FAILED'}
  $rls=docker exec $name psql -X -A -t -U postgres -d postgres -c "select count(*) from pg_class where relname like 'vox_staff_%_v1' and relrowsecurity and relforcerowsecurity"
  if($LASTEXITCODE -ne 0 -or ([string]$rls).Trim() -ne '4'){throw "RLS_FORCE_ASSERT_FAILED:$rls"}
  $grants=docker exec $name psql -X -A -t -U postgres -d postgres -c "select count(*) from pg_class where relname like 'vox_staff_%_v1' and (has_table_privilege('anon',oid,'SELECT') or has_table_privilege('authenticated',oid,'SELECT') or has_table_privilege('authenticated',oid,'INSERT'))"
  if($LASTEXITCODE -ne 0 -or ([string]$grants).Trim() -ne '0'){throw "DIRECT_BROWSER_GRANTS_NOT_CLOSED:$grants"}
  $service=docker exec $name psql -X -A -t -U postgres -d postgres -c "select count(*) from pg_class where relname like 'vox_staff_%_v1' and has_table_privilege('service_role',oid,'SELECT')"
  if($LASTEXITCODE -ne 0 -or ([string]$service).Trim() -ne '4'){throw "SERVICE_READ_GRANTS_MISSING:$service"}
  $originalPreference=$ErrorActionPreference
  $ErrorActionPreference="Continue"
  docker exec $name psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET ROLE authenticated; SELECT count(*) FROM public.vox_staff_memberships_v1;" *> $null
  $deniedExit=$LASTEXITCODE
  $ErrorActionPreference=$originalPreference
  if($deniedExit -eq 0){throw 'BROWSER_ROLE_SELECT_UNEXPECTEDLY_SUCCEEDED'}
  Write-Output 'VOX_03_DISPOSABLE_POSTGRES_MIGRATION_PASS RLS_FORCE=4 BROWSER_GRANTS=0 SERVICE_READ=4 DENIED_AUTHENTICATED_SELECT=true'
} finally {
  if($cid){docker rm -f $name *> $null}
}
