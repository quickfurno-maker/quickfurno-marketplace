# FINAL-2 / Track C: real PG17 atomic nonce+intent persistence smoke.
# DISPOSABLE ONLY. No real keys, public API route, managed DB or approval activation.
$ErrorActionPreference='Stop'
$name='qf-vox-final2-approval-pg17'
$created=$false
$existing=(docker ps -aq --filter "name=^/$name$" | Out-String).Trim()
if($existing){throw 'REFUSE_EXISTING_CONTAINER'}
if($env:DOCKER_HOST -and $env:DOCKER_HOST -notmatch '^(npipe|unix)://'){throw 'REFUSE_REMOTE_DOCKER'}
docker image inspect postgres:17-alpine *> $null
if($LASTEXITCODE -ne 0){throw 'LOCAL_IMAGE_MISSING_NO_PULL'}
function Query([string]$sql){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=($sql|docker exec -i $name psql -X -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String).Trim()
     $exit=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 if($exit -ne 0){throw "SQL_FAILED $($out.Substring(0,[Math]::Min(420,$out.Length)))"}
 return $out
}
try{
 docker run --pull never -d --rm --network none --name $name -e POSTGRES_PASSWORD=synthetic_local_only postgres:17-alpine *> $null
 if($LASTEXITCODE -ne 0){throw 'LOCAL_CONTAINER_START_FAILED'}
 $created=$true
 $ready=$false
 for($i=0;$i -lt 120;$i++){
  $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1|Out-String);
      $probe=(docker exec $name psql -X -A -t -U postgres -d postgres -c 'SELECT 1;' 2>&1|Out-String).Trim()
      $ok=$LASTEXITCODE}
  finally{$ErrorActionPreference=$old}
  if($log.Contains('PostgreSQL init process complete; ready for start up.') -and $ok -eq 0 -and $probe -eq '1'){$ready=$true;break}
  Start-Sleep -Milliseconds 250
 }
 if(!$ready){throw 'PG17_FINAL_SERVER_NOT_READY'}
 $setup=@'
CREATE TABLE public.qf_final2_synthetic_nonce(
 nonce text primary key,
 claim text not null check(claim in ('OWNER','TEAM_LEADER','SUBJECT'))
);
CREATE TABLE public.qf_final2_synthetic_intent(
 subject text primary key,
 owner_id text not null,
 tl_id text not null,
 digest text not null,
 check(owner_id<>tl_id)
);
-- Three claims + one verified intent commit as a single atomic transaction.
BEGIN;
INSERT INTO public.qf_final2_synthetic_nonce VALUES
 ('owner-rolled-back','OWNER'),('tl-rolled-back','TEAM_LEADER'),('subject-rolled-back','SUBJECT');
INSERT INTO public.qf_final2_synthetic_intent
 VALUES('subject-rolled-back','owner-1','tl-1',repeat('a',64));
ROLLBACK;
-- Simulate a previously VERIFIED cryptographic decision (not cryptographic SQL authority).
BEGIN;
INSERT INTO public.qf_final2_synthetic_nonce VALUES
 ('owner-a','OWNER'),('tl-a','TEAM_LEADER'),('subject-a','SUBJECT');
INSERT INTO public.qf_final2_synthetic_intent
 VALUES('subject-a','owner-1','tl-1',repeat('a',64));
COMMIT;
-- Replay of either nonce must NOT create an additional official intent.
DO $f$BEGIN
 BEGIN
  INSERT INTO public.qf_final2_synthetic_nonce VALUES ('owner-a','OWNER');
  RAISE EXCEPTION 'REPLAY_UNEXPECTEDLY_ACCEPTED';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END$f$;
-- Simulate one signed half accepted in a transaction, second insert fails.
-- The transaction is explicitly rolled back; neither half survives.
BEGIN;
INSERT INTO public.qf_final2_synthetic_nonce VALUES ('owner-aborted','OWNER');
INSERT INTO public.qf_final2_synthetic_nonce VALUES ('tl-aborted','TEAM_LEADER');
ROLLBACK;
'@
 $null=Query $setup
 $result=Query @'
SELECT CASE WHEN
 (SELECT COUNT(*) FROM public.qf_final2_synthetic_nonce)=3 AND
 (SELECT COUNT(*) FROM public.qf_final2_synthetic_intent)=1 AND
 (SELECT COUNT(*) FROM public.qf_final2_synthetic_nonce WHERE nonce LIKE '%rolled-back%')=0 AND
 (SELECT COUNT(*) FROM public.qf_final2_synthetic_nonce WHERE nonce LIKE '%aborted%')=0 AND
 (SELECT owner_id<>tl_id FROM public.qf_final2_synthetic_intent WHERE subject='subject-a')
THEN 'PASS' ELSE 'FAIL' END;
'@
 if($result -ne 'PASS'){throw "SYNTHETIC_ATOMICITY_ASSERTION_FAILED $result"}
 Write-Output 'VOX_FINAL2_DISPOSABLE_PG17_APPROVAL_ATOMICITY_PASS claims=3 intents=1 rollback=clean replay=denied human_keys=none managed_mutation=false'
}finally{if($created){docker rm -f -v $name *> $null}}
