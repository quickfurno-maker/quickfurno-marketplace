$ErrorActionPreference = 'Stop'
$container = 'vox-f1-pg17-' + ([guid]::NewGuid().ToString('N').Substring(0,12))
$path = Join-Path $PSScriptRoot '..\sql-candidates\20261017010000_vox_f1_four_source_attribution_candidate.sql'
try {
  docker run --rm -d --network none --name $container -e POSTGRES_PASSWORD=isolated_vox_f1_only postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_DOCKER_START_FAILED' }
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    docker exec $container pg_isready -U postgres 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready=$true;break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'ISOLATED_POSTGRES_NOT_READY' }
  $bootstrap = @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.profiles(id uuid primary key);
create table public.vox_staff_teams_v1(id uuid primary key);
create table public.cities(id uuid primary key);
'@
  $bootstrap | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'BOOTSTRAP_FAILED' }
  Get-Content -Raw $path | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_SQL_FAILED' }
  $proof = @'
begin;
insert into public.profiles(id) values('00000000-0000-4000-8000-000000000001');
insert into public.vox_staff_teams_v1(id) values('00000000-0000-4000-8000-000000000002');
insert into public.cities(id) values('00000000-0000-4000-8000-000000000003');
insert into public.vox_staff_source_events_candidate_v1(
 source,source_event_id,actor_id,team_id,city_id,object_id,revision,
 event_kind,occurred_at,subject_kind,subject_id)
 values('CORE_WORK_LEDGER','00000000-0000-4000-8000-000000000004',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000005',1,'START',
 '2026-10-16T08:00:00Z','vendor','00000000-0000-4000-8000-000000000006');
insert into public.vox_staff_source_watermarks_candidate_v1(
 source,actor_id,team_id,city_id,business_date,cursor_start,cursor_end,
 event_checksum,signed_at,signature)
 values('CORE_WORK_LEDGER',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003','2026-10-16',
 '2026-10-15T18:30:00Z','2026-10-16T18:30:00Z',
 repeat('a',64),'2026-10-16T18:31:00Z',repeat('b',64));
do $$
begin
 begin
  update public.vox_staff_source_events_candidate_v1 set revision=2;
  raise exception 'EVENT_MUTATION_DID_NOT_DENY';
 exception when raise_exception then
  if SQLERRM <> 'VOX_F1_APPEND_ONLY' then raise; end if;
 end;
 begin
  delete from public.vox_staff_source_watermarks_candidate_v1;
  raise exception 'WATERMARK_MUTATION_DID_NOT_DENY';
 exception when raise_exception then
  if SQLERRM <> 'VOX_F1_APPEND_ONLY' then raise; end if;
 end;
 if (select count(*) from public.vox_staff_source_events_candidate_v1) <> 1 then
  raise exception 'EVENT_INSERT_MISSING';end if;
 if has_table_privilege('authenticated','public.vox_staff_source_events_candidate_v1','SELECT')
 then raise exception 'AUTHENTICATED_READ_LEAK';end if;
end $$;
rollback;
select 'VOX_F1_PG17_APPEND_ONLY_RLS_PASS' as proof;
'@
  $out = $proof | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1 -t -A 2>&1
  if ($LASTEXITCODE -ne 0 -or (($out -join [Environment]::NewLine) -notmatch 'VOX_F1_PG17_APPEND_ONLY_RLS_PASS')) {
    $out | Select-Object -Last 20
    throw 'ISOLATED_PG17_SECURITY_PROOF_FAILED'
  }
  Write-Output ('VOX_F1_PG17_SOURCE_CANDIDATE_PASS sha256=' + (Get-FileHash $path -Algorithm SHA256).Hash)
} finally {
  docker rm -f $container 2>$null | Out-Null
}
