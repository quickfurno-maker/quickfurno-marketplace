$ErrorActionPreference='Stop'
$name='qf-vox-ab3-load-pg17'
if(docker ps -aq --filter "name=^/$name$"){throw 'AB3_BENCHMARK_NAME_OCCUPIED'}
$c=$null
function Psql([string]$sql){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$x=($sql|docker exec -i $name psql -X -A -t -q -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 if($code -ne 0){throw "AB3_PG_QUERY_FAILED $x"}
 return $x.Trim()
}
try{
 $c=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'AB3_BENCH_PG_START'}
 $ready=$false;for($i=0;$i -lt 35;$i++){
  docker exec $name pg_isready -U postgres -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Milliseconds 400
 }
 if(!$ready){throw 'AB3_BENCH_PG_NOT_READY'}
 # PostgreSQL Docker entrypoint stops its temporary bootstrap instance before
 # launching the real local socket; wait out that short initialization cycle.
 Start-Sleep -Seconds 3
 $sql=@'
CREATE TABLE public.vox_work_items_candidate_v1(
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null,city_id uuid not null,
 assignee_id uuid,source_kind text not null,
 source_id uuid not null,updated_at timestamptz not null,
 state text not null default 'ASSIGNED',revision int not null default 1);
INSERT INTO public.vox_work_items_candidate_v1
(team_id,city_id,assignee_id,source_kind,source_id,updated_at)
SELECT
 CASE WHEN i%5=0 THEN '00000000-0000-4000-8000-000000000005'::uuid
 ELSE '00000000-0000-4000-8000-000000000002'::uuid END,
 CASE WHEN i%7=0 THEN '00000000-0000-4000-8000-000000000007'::uuid
 ELSE '00000000-0000-4000-8000-000000000003'::uuid END,
 CASE WHEN i%9=0 THEN null WHEN i%3=0 THEN
 '00000000-0000-4000-8000-000000000006'::uuid
 ELSE '00000000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN i%3=0 THEN 'vendor' WHEN i%3=1 THEN 'prospect'
 ELSE 'support_thread' END,
 gen_random_uuid(),
 now() - (i||' seconds')::interval
FROM generate_series(1,100000) AS i;
CREATE INDEX vox_ab3_bench_scoped_v1 ON
 public.vox_work_items_candidate_v1(
 team_id,city_id,assignee_id,source_kind,updated_at desc,id desc);
ANALYZE public.vox_work_items_candidate_v1;
'@
 $null=Psql $sql
 $count=[int](Psql 'SELECT count(*) FROM public.vox_work_items_candidate_v1;')
 if($count -ne 100000){throw "BAD_SYNTHETIC_COUNT=$count"}
 $scope=@'
WHERE team_id='00000000-0000-4000-8000-000000000002'::uuid
 AND city_id='00000000-0000-4000-8000-000000000003'::uuid
 AND assignee_id='00000000-0000-4000-8000-000000000001'::uuid
 AND source_kind='prospect'
'@
 $base="SELECT id,updated_at FROM public.vox_work_items_candidate_v1 $scope ORDER BY updated_at DESC,id DESC LIMIT 25"
 $bounded=[int](Psql "SELECT count(*) FROM ($base) s;")
 if($bounded -ne 25){throw "INCORRECT_BOUNDED_RESULT=$bounded"}
 $elapsed=@();$planTypes=@()
 for($n=0;$n -lt 14;$n++){
  $doc=Psql "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) $base"
  $parsed=ConvertFrom-Json $doc
  $elapsed+=[double]$parsed[0].'Execution Time'
  $planTypes+=[string]$parsed[0].Plan.Plans[0].'Node Type'
 }
 $sorted=@($elapsed|Sort-Object)
 $p50=$sorted[[int][math]::Floor(($sorted.Count-1)*.5)]
 $p95=$sorted[[int][math]::Ceiling(($sorted.Count-1)*.95)]
 $details=@{schema='qf.vox.ab3.synthetic.pg17.benchmark.v1';
  syntheticRows=100000;boundedResults=$bounded;
  runs=$elapsed.Count;p50Ms=$p50;p95Ms=$p95;
  observedNodeTypes=@($planTypes|Select-Object -Unique);
  hasManagedDbData=$false;deploymentCertified=$false;
  scope='single_team_city_assignee_source'}
 $output='D:\QuickFurno-Workspace\VOX-AB3-SYNTHETIC-PG17-BENCHMARK-20261017.json'
 ($details|ConvertTo-Json -Depth 4)|Set-Content -Encoding UTF8 $output
 Write-Output "VOX_AB3_SYNTHETIC_PG17_BENCHMARK_PASS rows=$count bounded=$bounded p50_ms=$p50 p95_ms=$p95"
 Write-Output "BENCHMARK_PATH=$output"
}finally{if($c){docker rm -f $name *> $null}}
