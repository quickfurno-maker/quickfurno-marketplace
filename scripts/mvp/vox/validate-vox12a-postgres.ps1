$ErrorActionPreference='Stop'
$name='qf-vox12a-atomic-followup-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$original=Get-Content (Join-Path $root 'scripts\mvp\vox\vox07-finalizer-fixture.sql') -Raw
$parts=$original -split '-- Synthetic profiles:',2
if($parts.Count -ne 2){throw 'BOOTSTRAP_FIXTURE_MISSING'}
if(docker ps -aq --filter "name=^/$name$"){throw 'CONTAINER_NAME_CONFLICT'}
$cid=$null
try{
 $cid=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only_vox12 postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'POSTGRES_START_FAIL'}
 $ready=$false
 for($i=0;$i -lt 30;$i++){docker exec $name pg_isready -U postgres *> $null;if($LASTEXITCODE -eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
 if(-not $ready){throw 'POSTGRES_NOT_READY'}
 $parts[0] | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'BOOTSTRAP_FAIL'}
 # Native Aarohi tables used in production are defined by an existing acquisition CRM migration.
 # Synthetic minimal matching shape keeps this disposable test isolated from other tenant dependencies.
 $native=@'
CREATE TABLE public.aarohi_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 prospect_id uuid NOT NULL,task_type text NOT NULL,due_at timestamptz,priority text NOT NULL,
 reason text,assigned_to uuid,created_by uuid,workflow_reference text,created_at timestamptz DEFAULT now());
CREATE TABLE public.aarohi_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 prospect_id uuid,event_type text NOT NULL,actor_type text NOT NULL,actor_reference text,
 safe_summary text,reference_type text,reference_id text,idempotency_key text,
 tenant_id text NOT NULL DEFAULT 'quickfurno',occurred_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX aarohi_events_idempotency_idx
 ON public.aarohi_events(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
'@
 $native | docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'NATIVE_CRM_FIXTURE_FAIL'}
 foreach($file in @('20261014010000_vox_v1_scoped_staff_authority.sql',
 '20261014060000_vox_operational_intent_review.sql',
 '20261014070000_vox_approved_followup_executor.sql')){
 (Get-Content (Join-Path $root ('supabase\migrations\'+$file)) -Raw) |
 docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw ('MIGRATION_FAILED '+$file)}
 }
 foreach($fixture in @('vox09c-intent-fixture.sql','vox12a-followup-fixture.sql')){
 (Get-Content (Join-Path $root ('scripts\mvp\vox\'+$fixture)) -Raw) |
 docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw ('FIXTURE_FAILED '+$fixture)}
 }
 $r=docker exec $name psql -X -A -t -U postgres -d postgres -c "SELECT (SELECT count(*) FROM public.vox_approved_followup_executions_v1)::text || '|' || (SELECT count(*) FROM public.aarohi_tasks)::text || '|' || (SELECT count(*) FROM public.aarohi_events WHERE event_type='task.created')::text || '|' || has_function_privilege('authenticated','public.qf_vox_execute_approved_aarohi_followup_v1(uuid,uuid,integer)','EXECUTE')::text;"
 if($LASTEXITCODE -ne 0 -or ([string]$r).Trim() -ne '1|1|1|false'){throw ('FOLLOWUP_MISMATCH '+$r)}
 Write-Output 'VOX12A_REAL_PG17_APPROVED_AAROHI_FOLLOWUP_PASS task=1 event=1 receipt=1 duplicate=false revoked_scope_denied=true browser_exec=false'
}finally{if($cid){docker rm -f $name *> $null}}
