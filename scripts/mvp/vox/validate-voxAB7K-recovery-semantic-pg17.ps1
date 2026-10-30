# AB7K RC3 semantic recovery adjudication harness. LOCAL DISPOSABLE postgres:17-alpine ONLY (--network none).
# NOT a managed Staging/Production backup or restore, and NOT a certification of one.
# Authored without being executed by its author (Read/Edit-only session).
#
# What it does, in two throwaway containers:
#  1. install the 30 files on a synthetic Core fixture (+ optional identity overlay, disposable only)
#  2. full-fidelity pg_dump + roles -> restore -> STRICT RAW catalog diff (preserved as RAW_DIVERGENCE if it differs)
#  3. independent SEMANTIC catalog snapshot (effective ACL via acldefault, parse-tree constraints, policies,
#     triggers, indexes, default ACL, owners, RLS) on both databases
#  4. BEHAVIOR probes on both databases as non-superuser roles (SET LOCAL ROLE anon/authenticated/service_role)
#     for grants and constraints, always ROLLED BACK
#  5. adjudication, then a NEGATIVE CONTROL: a mutated restore (privilege widening, constraint weakening, ...)
#     that the comparator MUST reject; otherwise the comparator itself is distrusted (exit 5)
#
# Safety rails (also asserted by ab7k-semantic-evidence.test.mjs):
#  - all output confined to a FRESH directory under the OS temp dir; UNC, '..', pre-existing dirs, reparse parents refused
#  - Docker daemon must be local (npipe/unix); image must already exist locally; --pull never; --network none verified
#  - only containers created by THIS run (unique names + label) are ever removed
#  - no bind mounts, no published ports, no privileged mode, no host network, no HTTP clients, no git/npm
# Exit: 0 exact raw parity | 4 candidate-semantic-parity-provisional (RAW_DIVERGENCE kept; DBA must interpret)
#       3 semantic divergence/unexplained/incomplete | 5 negative control NOT detected | 7 safety refusal | 1 other failure
[CmdletBinding()]
param(
 [switch]$NoSupabaseDefaultPrivileges,
 [switch]$ApplyIdentityOverlay,
 [string]$ExpectedImageId,
 [string]$OutDir=(Join-Path ([IO.Path]::GetTempPath()) ('ab7k-rc3-evidence-'+[guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$rawCli=Join-Path $PSScriptRoot 'ab7k-readonly-evidence.mjs'
$semCli=Join-Path $PSScriptRoot 'ab7k-semantic-evidence.mjs'
$runId=[guid]::NewGuid().ToString('N').Substring(0,10)
$src="qf-ab7k-rc3-src-$runId";$rst="qf-ab7k-rc3-rst-$runId"
$image='postgres:17-alpine'
$created=New-Object System.Collections.Generic.List[string]
$utf8=New-Object Text.UTF8Encoding($false)

function Native([scriptblock]$b){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=(& $b 2>&1|Out-String);$code=$LASTEXITCODE}finally{$ErrorActionPreference=$old}
 return @{code=$code;text=$out.Trim()}
}
function Refuse([string]$why){Write-Output "AB7K_RC3_SAFETY_REFUSAL $why";exit 7}

function Resolve-FreshTempOutDir([string]$p){
 if($p -match '^(\\\\|//)'){Refuse 'OUTDIR_UNC'}
 if(($p -split '[\\/]') -contains '..'){Refuse 'OUTDIR_TRAVERSAL'}
 $full=[IO.Path]::GetFullPath($p)
 $tmp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 if(-not $full.StartsWith($tmp,[StringComparison]::OrdinalIgnoreCase)){Refuse 'OUTDIR_OUTSIDE_TEMP'}
 if(Test-Path -LiteralPath $full){Refuse 'OUTDIR_ALREADY_EXISTS'}
 $parent=Split-Path -Parent $full
 if(-not (Test-Path -LiteralPath $parent -PathType Container)){Refuse 'OUTDIR_PARENT_MISSING'}
 if((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){Refuse 'OUTDIR_PARENT_REPARSE_POINT'}
 return $full
}
function Assert-LocalDockerOnly{
 if($env:DOCKER_HOST -and $env:DOCKER_HOST -notmatch '^(npipe|unix)://'){Refuse "DOCKER_HOST_NOT_LOCAL"}
 $c=Native {docker context inspect --format '{{.Endpoints.docker.Host}}'}
 if($c.code -ne 0){Refuse 'DOCKER_CONTEXT_UNREADABLE'}
 if(-not $env:DOCKER_HOST -and $c.text -notmatch '^(npipe|unix)://'){Refuse "DOCKER_CONTEXT_NOT_LOCAL"}
}
function Assert-ImagePresent{
 $i=Native {docker image inspect $image --format '{{.Id}}'}
 if($i.code -ne 0){Refuse "IMAGE_NOT_PRESENT_LOCALLY: pre-pull $image deliberately; this harness never pulls (no uncontrolled network)"}
 if($ExpectedImageId -and $i.text -ne $ExpectedImageId){Refuse 'IMAGE_ID_MISMATCH'}
 return $i.text
}

function Psql([string]$c,[string]$db,[string]$sql){
 $r=Native {$sql|docker exec -i $c psql -X -q -A -t -U postgres -d $db -v ON_ERROR_STOP=1}
 if($r.code -ne 0){throw "PSQL_FAILED_$c`: $($r.text)"}
 return $r.text
}
function Boot([string]$c){
 if((docker ps -aq --filter "name=^/$c$"|Out-String).Trim()){throw "CONTAINER_CONFLICT_$c"}
 $created.Add($c)
 docker run --pull never --rm --network none --memory 1g --pids-limit 512 --label "qf.ab7k.run=$runId" -d --name $c -e POSTGRES_PASSWORD=synthetic_offline_only $image *> $null
 if($LASTEXITCODE -ne 0){throw "PG17_BOOT_FAILED_$c"}
 $net=Native {docker inspect -f '{{.HostConfig.NetworkMode}}' $c}
 if($net.text -ne 'none'){throw "NETWORK_NOT_NONE_$c`: $($net.text)"}
 $ports=Native {docker inspect -f '{{len .NetworkSettings.Ports}}' $c}
 if($ports.text -ne '0'){throw "PORTS_PUBLISHED_$c"}
 $mt=Native {docker inspect -f '{{range .Mounts}}{{.Type}} {{end}}' $c}
 if($mt.text -match 'bind'){throw "BIND_MOUNT_PRESENT_$c"}
 for($i=0;$i -lt 150;$i++){
  $log=(Native {docker logs $c}).text
  if($log -match 'PostgreSQL init process complete'){
   $r=Native {docker exec $c pg_isready -U postgres -d postgres}
   if($r.code -eq 0){return}
  }
  Start-Sleep -Milliseconds 200
 }
 throw "PG17_NOT_READY_$c"
}
function Save([string]$name,[string]$text){[IO.File]::WriteAllText((Join-Path $OutDir $name),$text,$utf8)}
function RawSnapshot([string]$c,[string]$db,[string]$name){
 $sql=(Native {node $rawCli sql --part catalog}).text
 Save $name (Psql $c $db $sql)
}
function SemSnapshot([string]$c,[string]$db,[string]$name){
 $r=Native {node $semCli sql}
 if($r.code -ne 0){throw "SEMANTIC_SQL_BUILD_FAILED $($r.text)"}
 Save $name (Psql $c $db $r.text)
}
function Probes([string]$c,[string]$db,[string]$tag){
 $r=Native {node $semCli probe-sql}
 if($r.code -ne 0){throw "PROBE_SQL_BUILD_FAILED $($r.text)"}
 Save "probes-$tag.raw.txt" (Psql $c $db $r.text)
 $p=Native {node $semCli parse-probes --in (Join-Path $OutDir "probes-$tag.raw.txt") --out (Join-Path $OutDir "probes-$tag.json")}
 if($p.code -ne 0){throw "PROBE_PARSE_FAILED_$tag`: $($p.text)"}
}
function LoadRoles([string]$c){
 $lines=Get-Content -LiteralPath (Join-Path $OutDir 'roles.sql')|
  Where-Object {$_ -notmatch '^(CREATE|ALTER) ROLE postgres(\s|;)'}
 Save 'roles.filtered.sql' (($lines -join "`n")+"`n")
 $null=Psql $c 'postgres' ([IO.File]::ReadAllText((Join-Path $OutDir 'roles.filtered.sql')))
}
function RestoreInto([string]$c,[string]$db,[string[]]$flags){
 $r=Native {docker exec $c createdb -U postgres -T template0 $db}
 if($r.code -ne 0){throw "CREATEDB_FAILED_$db`: $($r.text)"}
 return (Native {docker exec $c pg_restore -U postgres -d $db --exit-on-error @flags /tmp/r.dump})
}
function Adjudicate([string]$semB,[string]$rawB,[string]$probesB,[string]$out){
 return (Native {node $semCli adjudicate --raw-a (Join-Path $OutDir 'source.snapshot.json') --raw-b (Join-Path $OutDir $rawB) --sem-a (Join-Path $OutDir 'source.semantic.json') --sem-b (Join-Path $OutDir $semB) --probes-a (Join-Path $OutDir 'probes-source.json') --probes-b (Join-Path $OutDir $probesB) --out (Join-Path $OutDir $out)})
}

# ---- preflight (nothing started yet) ----
$OutDir=Resolve-FreshTempOutDir $OutDir
Assert-LocalDockerOnly
$imageId=Assert-ImagePresent
New-Item -ItemType Directory -Path $OutDir|Out-Null
$m=Native {node $rawCli manifest}
if($m.code -ne 0){throw "MANIFEST_GATE_FAILED $($m.text)"}
Save 'manifest.json' $m.text
Save 'environment.txt' ("image_id=$imageId`nrun_id=$runId`napply_identity_overlay=$($ApplyIdentityOverlay.IsPresent)`nsupabase_default_privileges=$(-not $NoSupabaseDefaultPrivileges.IsPresent)`n")

$seedText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'validate-voxAB7K-full-schema-pg17.ps1'))
$sm=[regex]::Match($seedText,'(?s)\$seed=@''\r?\n(.*?)\r?\n''@')
if(-not $sm.Success){throw 'SYNTHETIC_CORE_SEED_NOT_FOUND'}
$seed=$sm.Groups[1].Value
$defaults=@'
alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on functions to anon,authenticated,service_role;
'@
$files=@()
$files+=Get-ChildItem (Join-Path $root 'ops\vox\quarantined-migrations\legacy-20261014') -File -Filter '*.sql'|Sort-Object Name
$files+=Get-ChildItem (Join-Path $root 'ops\vox\sql-candidates') -File -Filter '*.sql'|Sort-Object Name
if($files.Count -ne 30){throw "EXPECTED_30_FILES_FOUND_$($files.Count)"}

$mutations=@'
grant select on public.vox_ab7j_staff_suspend_intents_candidate_v1 to anon;
grant insert on public.vox_staff_team_messages_candidate_v1 to authenticated;
alter table public.vox_ab7j_staff_suspend_intents_candidate_v1 no force row level security;
create policy qf_mutant_anon_read on public.vox_staff_team_messages_candidate_v1 for select to anon using (true);
alter table public.vox_ab7j_staff_suspend_intents_candidate_v1 drop constraint ab7j_distinct_staff_approvers;
do $m$
declare c text;
begin
 select conname into strict c from pg_constraint
  where conrelid='public.vox_staff_team_messages_candidate_v1'::regclass and contype='c' and pg_get_constraintdef(oid) like '%cntrl%';
 execute format('alter table public.vox_staff_team_messages_candidate_v1 drop constraint %I',c);
 execute format('alter table public.vox_staff_team_messages_candidate_v1 add constraint %I check(length(body)<=5000)',c);
end
$m$;
do $m$
declare f record;
begin
 select p.oid::regprocedure::text as sig into strict f from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname like '%vox%' and p.prokind='f' and p.prorettype<>'trigger'::regtype
   and not has_function_privilege('anon',p.oid,'EXECUTE') order by p.proname,p.oid limit 1;
 execute format('grant execute on function %s to anon',f.sig);
end
$m$;
alter table public.vox_staff_team_messages_candidate_v1 owner to service_role;
'@

$exit=1
try{
 Boot $src
 $null=Psql $src 'postgres' $seed
 if(-not $NoSupabaseDefaultPrivileges){$null=Psql $src 'postgres' $defaults}
 $i=0
 foreach($f in $files){
  $i++
  $null=Psql $src 'postgres' ([IO.File]::ReadAllText($f.FullName))
  Write-Output "PASS install_$i $($f.Name)"
 }
 if($ApplyIdentityOverlay){
  $overlay=Join-Path $root 'ops\vox\identity-attestation-overlay\20261030010000_vox_ab7k_identity_attestation_fail_closed_overlay.sql'
  $verify=Join-Path $root 'ops\vox\identity-attestation-overlay\verify_ab7k_identity_overlay_disposable_only.sql'
  $authFixture=@'
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid;
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
$$;
'@
  $null=Psql $src 'postgres' $authFixture
  $null=Psql $src 'postgres' ([IO.File]::ReadAllText($overlay))
  $null=Psql $src 'postgres' ([IO.File]::ReadAllText($verify))
  Write-Output 'AB7K_DISPOSABLE_IDENTITY_OVERLAY_SQL_VERIFIED'
 }
 RawSnapshot $src 'postgres' 'source.snapshot.json'
 SemSnapshot $src 'postgres' 'source.semantic.json'
 Probes $src 'postgres' 'source'

 foreach($cmd in @(
  'pg_dump -U postgres -d postgres -Fc --file /tmp/postinstall-full.dump',
  'pg_dump -U postgres -d postgres -Fp --schema-only --file /tmp/schema.sql',
  'pg_dumpall -U postgres --roles-only --file /tmp/roles.sql')){
  $parts=$cmd -split ' '
  $r=Native {docker exec $src @parts}
  if($r.code -ne 0){throw "DUMP_FAILED $cmd`: $($r.text)"}
 }
 foreach($n in 'postinstall-full.dump','schema.sql','roles.sql'){
  docker cp "${src}:/tmp/$n" (Join-Path $OutDir $n)|Out-Null
  if($LASTEXITCODE -ne 0){throw "ARTIFACT_COPY_FAILED_$n"}
 }

 Boot $rst
 LoadRoles $rst
 docker cp (Join-Path $OutDir 'postinstall-full.dump') "${rst}:/tmp/r.dump"|Out-Null
 if($LASTEXITCODE -ne 0){throw 'DUMP_COPY_FAILED'}
 $rr=RestoreInto $rst 'ab7k_restore' @()
 if($rr.code -ne 0){throw "FULL_FIDELITY_RESTORE_FAILED $($rr.text)"}
 RawSnapshot $rst 'ab7k_restore' 'restored-full.snapshot.json'
 SemSnapshot $rst 'ab7k_restore' 'restored-full.semantic.json'
 Probes $rst 'ab7k_restore' 'restored'

 # Strict raw comparison is kept verbatim (RAW_DIVERGENCE must stay visible).
 $cmp=Native {node $rawCli compare --a (Join-Path $OutDir 'source.snapshot.json') --b (Join-Path $OutDir 'restored-full.snapshot.json')}
 Save 'compare-full-fidelity.json' $cmp.text
 $rawStatus=if($cmp.code -eq 0){'RAW_PARITY'}else{'RAW_DIVERGENCE'}

 $adj=Adjudicate 'restored-full.semantic.json' 'restored-full.snapshot.json' 'probes-restored.json' 'adjudication.json'
 $primary=$adj.code
 if($primary -notin 0,3,4){throw "ADJUDICATE_ERROR $($adj.text)"}

 # Negative control: the comparator must reject real widening / weakening.
 $null=RestoreInto $rst 'ab7k_mutant' @()
 $null=Psql $rst 'ab7k_mutant' $mutations
 RawSnapshot $rst 'ab7k_mutant' 'mutant.snapshot.json'
 SemSnapshot $rst 'ab7k_mutant' 'mutant.semantic.json'
 Probes $rst 'ab7k_mutant' 'mutant'
 $neg=Adjudicate 'mutant.semantic.json' 'mutant.snapshot.json' 'probes-mutant.json' 'adjudication-negative-control.json'
 $controlOk=$false
 if($neg.code -eq 3){
  $rep=Get-Content -Raw -LiteralPath (Join-Path $OutDir 'adjudication-negative-control.json')|ConvertFrom-Json
  $codes=@($rep.semanticFindings|ForEach-Object{$_.code})
  $want='ACL_WIDENED','PRIV_WIDENED','RLS_WEAKENED','POLICY_ADDED','CONSTRAINT_REMOVED','CONSTRAINT_EXPR_CHANGED','FUNCTION_EXECUTE_WIDENED','OWNER_CHANGED','PROBE_WIDENED','PROBE_WEAKENED'
  $missing=@($want|Where-Object{$codes -notcontains $_})
  $controlOk=($rep.verdict -eq 'SEMANTIC_DIVERGENCE' -and $rep.securityRegression -eq $true -and $missing.Count -eq 0)
  if(-not $controlOk){Write-Output "AB7K_RC3_NEGATIVE_CONTROL_MISSING_CODES=$($missing -join ',')"}
 }

 # Informational only: lossy restore (27 Oct method class). Never asserted, never upgraded.
 $lossy=RestoreInto $rst 'ab7k_lossy' @('--no-owner','--no-acl')
 $lossyNote='LOSSY_RESTORE_FAILED'
 if($lossy.code -eq 0){
  RawSnapshot $rst 'ab7k_lossy' 'lossy.snapshot.json'
  SemSnapshot $rst 'ab7k_lossy' 'lossy.semantic.json'
  Probes $rst 'ab7k_lossy' 'lossy'
  $la=Adjudicate 'lossy.semantic.json' 'lossy.snapshot.json' 'probes-lossy.json' 'adjudication-lossy-informational.json'
  $lossyNote="LOSSY_ADJUDICATION_EXIT=$($la.code)(informational; 0 exact,4 provisional,3 divergent)"
 }

 $sums=Get-ChildItem -LiteralPath $OutDir -File|ForEach-Object{
  '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower(),$_.Name}
 Set-Content -LiteralPath (Join-Path $OutDir 'SHA256SUMS.txt') -Value $sums -Encoding ascii

 $rep0=Get-Content -Raw -LiteralPath (Join-Path $OutDir 'adjudication.json')|ConvertFrom-Json
 Write-Output "AB7K_RC3_RAW_STATUS=$rawStatus"
 Write-Output "AB7K_RC3_VERDICT=$($rep0.verdict)"
 Write-Output "AB7K_RC3_LABEL=$($rep0.label)"
 Write-Output "AB7K_RC3_REQUIRES_DBA_INTERPRETATION=$($rep0.requiresDbaInterpretation)"
 Write-Output "AB7K_RC3_NEGATIVE_CONTROL=$(if($controlOk){'DETECTED'}else{'NOT_DETECTED'})"
 Write-Output "AB7K_RC3_$lossyNote"
 Write-Output 'AB7K_MANAGED_RESTORATION=BLOCKED (local disposable only; no managed backup, AAL2, PITR, Ed25519 or human DBA/AppSec signoff exists)'
 Write-Output "Artifacts: $OutDir"
 $exit=if(-not $controlOk){5}else{$primary}
}finally{
 foreach($c in $created){docker rm -f -v $c *> $null}
}
exit $exit
