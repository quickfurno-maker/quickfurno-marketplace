$ErrorActionPreference='Stop'
$name='qf-vox-ab7f-atomic-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
if(docker ps -aq --filter "name=^/$name$"){throw 'AB7F_CONTAINER_CONFLICT'}
function Sql([string]$q){
 $old=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$out=($q | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$old}
 return @{code=$code;text=$out.Trim()}
}
function Must([string]$label,[string]$q,[string]$expected){
 $r=Sql $q
 if($r.code -ne 0 -or $r.text -ne $expected){throw "AB7F_FAIL $label : $($r.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$q){
 $r=Sql $q
 if($r.code -eq 0){throw "AB7F_UNEXPECTED_SUCCESS $label"}
 Write-Output "PASS DENIED $label"
}
$owner='00000000-0000-4000-8000-000000000001'
$tl='00000000-0000-4000-8000-000000000002'
$staff='00000000-0000-4000-8000-000000000003'
$team='00000000-0000-4000-8000-000000000004'
$city='00000000-0000-4000-8000-000000000005'
$conv='00000000-0000-4000-8000-000000000006'
$conv2='00000000-0000-4000-8000-000000000007'
$n1='00000000-0000-4000-8000-000000000008'
$n2='00000000-0000-4000-8000-000000000009'
$n3='00000000-0000-4000-8000-000000000010'
try{
 docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine *> $null
 if($LASTEXITCODE -ne 0){throw 'PG17_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 90;$i++){
  $previous=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1 | Out-String)}
  finally{$ErrorActionPreference=$previous}
  if($log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 250
 }
 if(!$ready){throw 'PG17_NOT_READY'}
 $fixture=@'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.profiles(id uuid primary key,role text,is_active boolean);
CREATE TABLE public.cities(id uuid primary key);
CREATE TABLE public.vox_staff_teams_v1(id uuid primary key,city_id uuid,is_active boolean);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid primary key,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_department_capabilities_v1(auth_user_id uuid,team_id uuid,city_id uuid,revoked_at timestamptz,revision integer);
CREATE TABLE public.vox_staff_object_scopes_v1(auth_user_id uuid,revoked_at timestamptz);
CREATE TABLE public.communication_conversations(id uuid primary key,tenant_id text,state text,assigned_actor text,human_takeover boolean,jarvis_enabled boolean,revision bigint,updated_at timestamptz);
CREATE TABLE public.communication_conversation_events(id uuid primary key default gen_random_uuid(),conversation_id uuid references public.communication_conversations(id),event_type text,actor_type text,safe_summary text,event_data jsonb);
CREATE TABLE public.jarvis_os_operator_command_receipts(command_id uuid primary key,request_digest text,action text,state text);
CREATE TABLE public.vox_ab3_staff_source_snapshots_candidate_v1(source text,actor_id uuid,team_id uuid,city_id uuid,business_date date,event_checksum text,watermark_signature text);
INSERT INTO public.profiles VALUES
('00000000-0000-4000-8000-000000000001','admin',true),
('00000000-0000-4000-8000-000000000002',null,true),
('00000000-0000-4000-8000-000000000003',null,true);
INSERT INTO public.cities VALUES('00000000-0000-4000-8000-000000000005');
INSERT INTO public.vox_staff_teams_v1 VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005',true);
INSERT INTO public.vox_staff_memberships_v1 VALUES
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','team_leader',true,null,now()+interval '2 days'),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','support_agent',true,null,now()+interval '2 days');
INSERT INTO public.vox_staff_department_capabilities_v1 VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005',null,2);
INSERT INTO public.vox_staff_object_scopes_v1 VALUES('00000000-0000-4000-8000-000000000003',null);
INSERT INTO public.communication_conversations VALUES
('00000000-0000-4000-8000-000000000006','quickfurno','OPEN','RIYA',false,true,1,now()),
('00000000-0000-4000-8000-000000000007','quickfurno','OPEN','RIYA',false,true,1,now());
INSERT INTO public.vox_ab3_staff_source_snapshots_candidate_v1
 SELECT source,'00000000-0000-4000-8000-000000000003'::uuid,
 '00000000-0000-4000-8000-000000000004'::uuid,
 '00000000-0000-4000-8000-000000000005'::uuid,'2026-10-17'::date,
 repeat('a',64),repeat('b',64)
 FROM unnest(ARRAY['CORE_WORK_LEDGER','CRM_AAROHI','SUPPORT_DESK','CORE_CONVERSATION']) source;
'@
 $r=Sql $fixture;if($r.code -ne 0){throw "FIXTURE_FAILED $($r.text)"}
 foreach($f in @(
 '20261018070000_vox_ab7f_conversation_atomic_operator_candidate.sql',
 '20261018080000_vox_ab7f_staff_atomic_suspend_candidate.sql',
 '20261018090000_vox_ab7f_four_source_eod_persist_candidate.sql',
 '20261018100000_vox_ab7g_eod_official_release_candidate.sql',
 '20261018110000_vox_ab7h_signed_operator_atomic_candidate.sql')){
  $q=Get-Content (Join-Path $root "ops\vox\sql-candidates\$f") -Raw
  $r=Sql $q;if($r.code -ne 0){throw "DDL_FAILED $f $($r.text)"}
  Write-Output "PASS DDL $f"
 }
 $digest=Sql "select encode(public.digest(string_agg(source||':'||event_checksum||':'||watermark_signature,'|' order by source),'sha256'),'hex') from public.vox_ab3_staff_source_snapshots_candidate_v1;"
 if($digest.code -ne 0 -or $digest.text.Length -ne 64){throw "INVALID_SOURCE_DIGEST $($digest.text)"}
 Must 'EOD four source reviewed DB receipt' "select source_count||'|'||published from public.qf_vox_ab7f_four_source_eod_atomic_candidate_v1('$staff','$tl','$team','$city','2026-10-17','$n3','$($digest.text)');" '4|false'
 Denied 'EOD same nonce replay' "select * from public.qf_vox_ab7f_four_source_eod_atomic_candidate_v1('$staff','$tl','$team','$city','2026-10-17','$n3','$($digest.text)');"
 Denied 'EOD forged four source digest' "select * from public.qf_vox_ab7f_four_source_eod_atomic_candidate_v1('$staff','$tl','$team','$city','2026-10-16','00000000-0000-4000-8000-000000000040','$(('c'*64))');"
 $report=Sql "select id::text from public.vox_ab7f_four_source_eod_candidate_v1 where nonce='$n3';"
 if($report.code -ne 0 -or $report.text -notmatch '^[0-9a-f-]{36}$'){throw 'AB7G_REPORT_ID_REQUIRED'}
 Denied 'Official EOD release without independently reviewed attestation' "select * from public.qf_vox_ab7g_official_eod_publish_candidate_v1('$($report.text)','$owner','$tl','00000000-0000-4000-8000-000000000046','$($digest.text)');"
 Denied 'No service role may manufacture Owner attestation' "set role service_role;insert into public.vox_ab7g_eod_owner_approvals_candidate_v1(report_id,owner_id,team_leader_id,digest,verified_signature_digest,expires_at) values('$($report.text)','$owner','$tl','$($digest.text)',repeat('f',64),clock_timestamp()+interval '5 minutes');"
 $approval=Sql "insert into public.vox_ab7g_eod_owner_approvals_candidate_v1(report_id,owner_id,team_leader_id,digest,verified_signature_digest,expires_at) values('$($report.text)','$owner','$tl','$($digest.text)',repeat('f',64),clock_timestamp()+interval '5 minutes');"
 if($approval.code -ne 0){throw "AB7G_OFFLINE_OWNER_PROOF_SETUP_FAILED $($approval.text)"}
 Must 'Official EOD release requires exact Owner TL evidence' "select publication_state from public.qf_vox_ab7g_official_eod_publish_candidate_v1('$($report.text)','$owner','$tl','00000000-0000-4000-8000-000000000046','$($digest.text)');" 'OFFICIALLY_RELEASED_BY_OWNER'
 Must 'EOD exactly one independent publication ledger row' "select count(*) from public.vox_ab7g_eod_official_publications_candidate_v1 where report_id='$($report.text)';" '1'
 Denied 'Official EOD duplicate publication replay' "select * from public.qf_vox_ab7g_official_eod_publish_candidate_v1('$($report.text)','$owner','$tl','00000000-0000-4000-8000-000000000047','$($digest.text)');"
 Must 'Conversation real PAUSE revision' "select new_state||'|'||revision from public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1('$conv',1,'$owner','$n1','PAUSE_AI');" 'PAUSED|2'
 Must 'Conversation native event and nonce exactly one' "select (select count(*) from public.communication_conversation_events where conversation_id='$conv')||'|'||(select count(*) from public.vox_ab7f_conversation_operator_receipts_candidate_v1 where nonce='$n1');" '1|1'
 Denied 'Conversation stale revision rejected' "select * from public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1('$conv',1,'$owner','00000000-0000-4000-8000-000000000041','TAKEOVER');"
 Denied 'Conversation wrong operator role rejected' "select * from public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1('$conv2',1,'$staff','00000000-0000-4000-8000-000000000042','PAUSE_AI');"
 $check=Sql "alter table public.communication_conversation_events add constraint ab7f_synthetic_event_rejection check (conversation_id <> '$conv2'::uuid);"
 if($check.code -ne 0){throw 'AB7F_EVENT_REJECTION_SETUP_FAILED'}
 Denied 'Native conversation event failure aborts entire transaction' "select * from public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1('$conv2',1,'$owner','00000000-0000-4000-8000-000000000045','PAUSE_AI');"
 Must 'Conversation state unchanged after event failure' "select state||'|'||revision from public.communication_conversations where id='$conv2';" 'OPEN|1'
 Must 'No orphan nonce receipt after event failure' "select count(*) from public.vox_ab7f_conversation_operator_receipts_candidate_v1 where conversation_id='$conv2';" '0'
 $signed='00000000-0000-4000-8000-000000000050'
 $signed2='00000000-0000-4000-8000-000000000051'
 $conv3='00000000-0000-4000-8000-000000000048'
 $setup=Sql "insert into public.communication_conversations values('$conv3','quickfurno','OPEN','ANISHA',false,true,1,now());insert into public.jarvis_os_operator_command_receipts values('$signed',repeat('a',64),'CONVERSATION_PAUSE_AI','CLAIMED');"
 if($setup.code -ne 0){throw "AB7H_SIGNED_FIXTURE_FAILED $($setup.text)"}
 Denied 'Jarvis signed receipt alone cannot bypass independent human approval' "select * from public.qf_vox_ab7h_signed_operator_atomic_candidate_v1('$signed',repeat('a',64),'$conv3',1,'CONVERSATION_PAUSE_AI','jarvis-os:operator1');"
 Denied 'Service role cannot create human signed approval' "set role service_role;insert into public.vox_ab7h_operator_review_candidate_v1(command_id,conversation_id,owner_id,reviewer_id,action,request_digest,verified_operator_label,verified_signature_sha256,expires_at) values('$signed','$conv3','$owner','$tl','CONVERSATION_PAUSE_AI',repeat('a',64),'jarvis-os:operator1',repeat('f',64),clock_timestamp()+interval '5 minutes');"
 $trusted=Sql "insert into public.vox_ab7h_operator_review_candidate_v1(command_id,conversation_id,owner_id,reviewer_id,action,request_digest,verified_operator_label,verified_signature_sha256,expires_at) values('$signed','$conv3','$owner','$tl','CONVERSATION_PAUSE_AI',repeat('a',64),'jarvis-os:operator1',repeat('f',64),clock_timestamp()+interval '5 minutes');"
 if($trusted.code -ne 0){throw "AB7H_REVIEW_SETUP_FAILED $($trusted.text)"}
 Denied 'Signed operator NULL digest rejected' "select * from public.qf_vox_ab7h_signed_operator_atomic_candidate_v1('$signed',null,'$conv3',1,'CONVERSATION_PAUSE_AI','jarvis-os:operator1');"
 Denied 'Signed operator NULL action rejected' "select * from public.qf_vox_ab7h_signed_operator_atomic_candidate_v1('$signed',repeat('a',64),'$conv3',1,null,'jarvis-os:operator1');"
 Denied 'Signed operator NULL actor label rejected' "select * from public.qf_vox_ab7h_signed_operator_atomic_candidate_v1('$signed',repeat('a',64),'$conv3',1,'CONVERSATION_PAUSE_AI',null);"
 Denied 'Jarvis digest mismatch cannot execute' "select * from public.qf_vox_ab7h_signed_operator_atomic_candidate_v1('$signed',repeat('b',64),'$conv3',1,'CONVERSATION_PAUSE_AI','jarvis-os:operator1');"
 Must 'Signed Jarvis+human review executes one native Core transaction' "select new_state||'|'||new_revision from public.qf_vox_ab7h_signed_operator_atomic_candidate_v1('$signed',repeat('a',64),'$conv3',1,'CONVERSATION_PAUSE_AI','jarvis-os:operator1');" 'PAUSED|2'
 Must 'Signed operator exactly one event and receipt' "select (select count(*) from public.communication_conversation_events where conversation_id='$conv3')||'|'||(select count(*) from public.vox_ab7h_operator_atomic_receipts_candidate_v1 where command_id='$signed');" '1|1'
 Denied 'Signed Jarvis duplicate receipt replay forbidden' "select * from public.qf_vox_ab7h_signed_operator_atomic_candidate_v1('$signed',repeat('a',64),'$conv3',1,'CONVERSATION_PAUSE_AI','jarvis-os:operator1');"
 Must 'Staff native membership grant scope revoked together' "select department_grants_revoked||'|'||object_scopes_revoked from public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1('$staff','$owner','$tl','$team','$city','$n2');" '1|1'
 Must 'Staff membership and department and scopes fenced' "select (select is_active from public.vox_staff_memberships_v1 where auth_user_id='$staff')||'|'||(select revision from public.vox_staff_department_capabilities_v1 where auth_user_id='$staff')||'|'||(select (revoked_at is not null) from public.vox_staff_object_scopes_v1 where auth_user_id='$staff');" 'false|3|true'
 Denied 'Staff replay prevents second grant revoke' "select * from public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1('$staff','$owner','$tl','$team','$city','$n2');"
 Denied 'Anon Core RPC not callable' "set role anon;select * from public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1('$conv2',1,'$owner','00000000-0000-4000-8000-000000000043','PAUSE_AI');"
 Must 'No synthetic provider outbound rows created' "select count(*) from public.communication_conversation_events where event_type not in ('ai.paused_by_operator','human.takeover_started');" '0'
 Write-Output 'AB7F_REAL_SQL_PG17_PASS'
}finally{
 docker rm -f $name *> $null
}
