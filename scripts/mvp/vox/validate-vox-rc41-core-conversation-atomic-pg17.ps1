$ErrorActionPreference='Stop'
# Disposable, network-less PG17 proof of the RC41 atomic Core conversation
# PAUSE_AI / TAKEOVER RPC. Candidate SQL only; nothing here touches a managed DB.
# Fixture tables are minimal stand-ins carrying only the columns the RPC reads.
$name='qf-vox-rc41-core-conversation-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$file=Join-Path $root 'ops\vox\rc41-review-candidates\20261101010000_vox_rc41_core_conversation_operator_atomic_candidate.sql'
$FN='public.qf_vox_rc41_core_conversation_operator_atomic_candidate_v1'
if(docker ps -aq --filter "name=^/$name$"){throw 'RC41_CONTAINER_CONFLICT'}
$container=$null
function Sql([string]$sql){
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$output=($sql | docker exec -i $name psql -X -q -A -t -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 return @{code=$code;text=$output.Trim()}
}
function Norm([string]$t){return ($t -replace "\r\n?","`n").Trim()}
function Pass([string]$label,[string]$query,[string]$expected){
 $res=Sql $query
 if($res.code -ne 0 -or (Norm $res.text) -cne (Norm $expected)){throw "RC41_POSITIVE_FAILED $label :: $($res.text)"}
 Write-Output "PASS $label"
}
function Snapshot{
 return (Sql "SELECT (SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1)||'|'||(SELECT count(*) FROM public.communication_conversation_events)||'|'||(SELECT sum(revision) FROM public.communication_conversations)||'|'||(SELECT count(*) FROM public.communication_conversation_outbox)||'|'||(SELECT count(*) FROM public.communication_messages)||'|'||(SELECT count(*) FROM public.communication_preferences)||'|'||(SELECT count(*) FROM public.communication_suppressions);").text
}
# A denial must raise the expected code AND leave every table byte-for-byte unchanged.
function Denied([string]$label,[string]$query,[string]$regex){
 $before=Snapshot
 $res=Sql $query
 if($res.code -eq 0 -or $res.text -notmatch $regex){throw "RC41_NEGATIVE_FAILED $label :: $($res.text)"}
 if((Snapshot) -cne $before){throw "RC41_DENIAL_WROTE_STATE $label"}
 Write-Output "PASS DENIED $label"
}
function Id([int]$n){return '00000000-0000-4000-8000-'+$n.ToString('000000000000')}
function Conv([int]$n){return Id (100+$n)}
function Nonce([int]$n){return Id (5000+$n)}
function Hash([int]$n){return $n.ToString('x').PadLeft(64,'0')}
$U=Id 1;$TLU=Id 2;$REQ=Id 3;$TEAM=Id 4;$CITY=Id 5;$VENDOR=Id 6;$ZONE=Id 7;$OTHERCITY=Id 8;$OTHERTEAM=Id 9
$FUT="now()+interval '10 minutes'"
function Call([int]$conv,[int]$nonce,[int]$rev,[string]$action='TAKEOVER',[string]$actor=$U,[string]$aal='aal2',[string]$exp=$FUT){
 return "SELECT nonce,action,previous_revision,new_revision,state,consent_scope,consent_policy_version,consent_reason,replayed,receipt_sha256,provider_messages_sent FROM $FN('$actor','$aal',$exp,'$(Conv $conv)','$(Nonce $nonce)',$rev,'$action');"
}
function Tx([int]$conv,[int]$nonce,[int]$rev,[string]$action='TAKEOVER',[string]$actor=$U,[string]$aal='aal2',[string]$exp=$FUT){
 return "SET ROLE service_role; "+(Call $conv $nonce $rev $action $actor $aal $exp)
}
function Job([string]$sql){
 return Start-Job -ScriptBlock{param($n,$s) $s | docker exec -i $n psql -X -q -A -t -U postgres -d postgres 2>&1 | Out-String} -ArgumentList $name,$sql
}
function Elapsed([scriptblock]$block){$sw=[Diagnostics.Stopwatch]::StartNew();$r=& $block;$sw.Stop();return @{result=$r;seconds=$sw.Elapsed.TotalSeconds}}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'RC41_CONTAINER_START_FAILED'}
 $stable=$false
 for($i=0;$i -lt 80;$i++){
  $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1|Out-String)}finally{$ErrorActionPreference=$prior}
  if($log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$stable=$true;break}
  }
  Start-Sleep -Milliseconds 350
 }
 if(!$stable){throw 'RC41_SERVER_NOT_READY'}
 $fixture=@"
CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE vox_rc41_owner NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb NOT NULL);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean NOT NULL);
CREATE TABLE public.cities(id uuid PRIMARY KEY,name text NOT NULL,is_active boolean NOT NULL);
CREATE TABLE public.marketplace_service_zones(id uuid PRIMARY KEY,canonical_city text NOT NULL,is_active boolean NOT NULL,matching_enabled boolean NOT NULL);
CREATE TABLE public.vendors(id uuid PRIMARY KEY,service_zone_id uuid);
CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean NOT NULL);
CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_object_scopes_v1(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid,scope_kind text,object_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE public.vox_staff_department_requests_v1(id uuid PRIMARY KEY,state text,revision integer,expires_at timestamptz,target_staff_id uuid,team_id uuid,city_id uuid,department text,decided_by uuid,requested_by uuid,decision_reference text);
CREATE TABLE public.vox_staff_department_capabilities_v1(id uuid PRIMARY KEY,auth_user_id uuid,team_id uuid,city_id uuid,department text,revoked_at timestamptz,revision integer,expires_at timestamptz,request_id uuid,granted_by uuid);
CREATE TABLE public.vox_staff_department_decisions_v1(request_id uuid,reviewer_id uuid,decision text,decision_reference text);
CREATE TABLE public.vox_staff_department_activations_v1(request_id uuid,capability_id uuid,activated_by uuid);
CREATE TABLE public.communication_conversations(id uuid PRIMARY KEY,tenant_id text NOT NULL DEFAULT 'quickfurno',channel text NOT NULL DEFAULT 'whatsapp' CHECK(channel='whatsapp'),
 destination_hash text NOT NULL CHECK(destination_hash ~ '^[0-9a-f]{64}$'),subject_type text NOT NULL DEFAULT 'unknown' CHECK(subject_type IN('unknown','prospect','client','vendor')),subject_id uuid,
 assigned_actor text NOT NULL DEFAULT 'AAROHI' CHECK(assigned_actor IN('AAROHI','ANISHA','RIYA','HUMAN','SYSTEM')),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','PAUSED','HUMAN','CLOSED')),jarvis_enabled boolean NOT NULL DEFAULT false,human_takeover boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT human_state_chk CHECK(human_takeover=false OR state='HUMAN'),CONSTRAINT jarvis_human_chk CHECK(NOT(jarvis_enabled AND human_takeover)));
CREATE TABLE public.communication_conversation_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES public.communication_conversations(id) ON DELETE RESTRICT,
 event_type text NOT NULL,actor_type text NOT NULL CHECK(actor_type IN('AAROHI','ANISHA','RIYA','JARVIS','HUMAN','SYSTEM','META')),safe_summary text,event_data jsonb NOT NULL DEFAULT '{}',occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.communication_conversation_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid);
CREATE TABLE public.communication_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid);
-- Deliberately NO unique index/constraint here: tests corrupt the canonical tables
-- with duplicates to prove the D2-C integrity fence inside the transaction.
CREATE TABLE public.communication_preferences(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),principal_type text NOT NULL,principal_id uuid,channel text NOT NULL,scope text NOT NULL,
 state text NOT NULL,policy_version text NOT NULL,consented_at timestamptz,withdrawn_at timestamptz);
CREATE TABLE public.communication_suppressions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),destination_hash text NOT NULL,channel text NOT NULL,scope text NOT NULL,reason text NOT NULL DEFAULT 'unspecified',
 is_active boolean NOT NULL DEFAULT true,expires_at timestamptz,deactivated_at timestamptz,policy_version text NOT NULL DEFAULT 'qf-consent-v1');
INSERT INTO public.cities VALUES('$CITY','Gurugram',true),('$OTHERCITY','Noida',true);
INSERT INTO public.marketplace_service_zones VALUES('$ZONE','Gurugram',true,true);
INSERT INTO public.vendors VALUES('$VENDOR','$ZONE');
INSERT INTO public.vox_staff_teams_v1 VALUES('$TEAM','$CITY',true),('$OTHERTEAM','$OTHERCITY',true);
INSERT INTO public.profiles VALUES('$U',NULL,true),('$TLU',NULL,true),('$REQ',NULL,true);
INSERT INTO auth.users VALUES('$U','{"qf_principal":"vox_staff","vox_role":"operations_manager"}'),
 ('$TLU','{"qf_principal":"vox_staff","vox_role":"team_leader"}'),('$REQ','{"qf_principal":"vox_staff","vox_role":"team_leader"}');
INSERT INTO public.vox_staff_memberships_v1 VALUES('$U','$TEAM','operations_manager',true,NULL,now()+interval '1 day'),
 ('$TLU','$TEAM','team_leader',true,NULL,now()+interval '1 day');
INSERT INTO public.vox_staff_department_requests_v1 VALUES('$(Id 20)','APPROVED',1,now()+interval '1 day','$U','$TEAM','$CITY','client_success','$TLU','$REQ','ref-1');
INSERT INTO public.vox_staff_department_capabilities_v1 VALUES('$(Id 21)','$U','$TEAM','$CITY','client_success',NULL,2,now()+interval '1 day','$(Id 20)','$REQ');
INSERT INTO public.vox_staff_department_decisions_v1 VALUES('$(Id 20)','$TLU','APPROVED','ref-1');
INSERT INTO public.vox_staff_department_activations_v1 VALUES('$(Id 20)','$(Id 21)','$REQ');
INSERT INTO public.communication_conversations(id,destination_hash,subject_type,subject_id,assigned_actor)
 SELECT ('00000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,lpad(to_hex(n),64,'0'),'vendor','$VENDOR','ANISHA' FROM generate_series(10,59) n;
INSERT INTO public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id,revoked_at,expires_at)
 SELECT '$U','conversation',('00000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,NULL,now()+interval '1 day' FROM generate_series(10,59) n;
-- Out-of-scope conversations: client subject (60), foreign tenant (61), SYSTEM actor (62), no object grant (63).
INSERT INTO public.communication_conversations(id,destination_hash,subject_type,subject_id,assigned_actor) VALUES
 ('$(Conv 60)','$(Hash 60)','client','$VENDOR','RIYA'),('$(Conv 62)','$(Hash 62)','vendor','$VENDOR','SYSTEM'),('$(Conv 63)','$(Hash 63)','vendor','$VENDOR','ANISHA');
INSERT INTO public.communication_conversations(id,tenant_id,destination_hash,subject_type,subject_id,assigned_actor) VALUES('$(Conv 61)','other','$(Hash 61)','vendor','$VENDOR','ANISHA');
INSERT INTO public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id,revoked_at,expires_at) SELECT '$U','conversation',id,NULL,now()+interval '1 day' FROM public.communication_conversations WHERE id IN('$(Conv 60)','$(Conv 61)','$(Conv 62)');
GRANT USAGE ON SCHEMA public TO service_role;GRANT USAGE ON SCHEMA public,auth TO vox_rc41_owner;
-- service_role mirrors production: it can read/update some of these tables directly, but has NO DML on the receipt table.
GRANT SELECT,UPDATE ON public.communication_conversations TO service_role;GRANT SELECT,INSERT ON public.communication_conversation_events TO service_role;
"@
 $res=Sql $fixture;if($res.code -ne 0){throw "RC41_FIXTURE_FAILED $($res.text)"}
 $res=Sql (Get-Content $file -Raw);if($res.code -ne 0){throw "RC41_SQL_FAILED $($res.text)"}
 # Install exactly as proposed for review: non-superuser owner holding only minimum table privileges.
 $acl=@"
ALTER FUNCTION $FN(uuid,text,timestamptz,uuid,uuid,bigint,text) OWNER TO vox_rc41_owner;
GRANT SELECT,UPDATE ON public.communication_conversations,public.vendors,public.marketplace_service_zones,public.cities,public.vox_staff_teams_v1,public.vox_staff_memberships_v1,
 public.vox_staff_object_scopes_v1,public.vox_staff_department_requests_v1,public.vox_staff_department_capabilities_v1,public.vox_staff_department_decisions_v1,
 public.vox_staff_department_activations_v1,public.profiles,public.communication_suppressions,public.communication_preferences TO vox_rc41_owner;
GRANT SELECT,UPDATE ON auth.users TO vox_rc41_owner;
GRANT SELECT,INSERT ON public.communication_conversation_events TO vox_rc41_owner;
GRANT SELECT,INSERT ON public.vox_rc41_core_conversation_operator_receipts_candidate_v1 TO vox_rc41_owner;
"@
 $res=Sql $acl;if($res.code -ne 0){throw "RC41_ACL_FAILED $($res.text)"}
 $fnrow=(Sql "SELECT prosecdef, pg_get_userbyid(proowner), array_to_string(proconfig,',') FROM pg_proc WHERE proname='qf_vox_rc41_core_conversation_operator_atomic_candidate_v1';").text
 $fnattrs=($fnrow -replace ',\s*',',')
 if($fnattrs -cne 't|vox_rc41_owner|search_path=,lock_timeout=3000ms' -and $fnattrs -cne 't|vox_rc41_owner|search_path="",lock_timeout=3000ms'){throw "RC41_FUNCTION_ATTRS $fnrow"}
 Write-Output 'PASS SECURITY DEFINER, non-superuser owner, search_path empty, lock_timeout bounded'

 # ---------------- functional ----------------
 $first=Sql (Tx 10 1 0);$pat='^'+(Nonce 1)+'\|TAKEOVER\|0\|1\|HUMAN\|transactional\|qf-consent-v1\|transactional_no_consent_objection\|f\|([0-9a-f]{64})\|0$'
 if($first.code -ne 0 -or $first.text -notmatch $pat){throw "RC41_TAKEOVER_FAILED $($first.text)"}
 $rcpt=$Matches[1];Write-Output 'PASS TAKEOVER returns immutable sha256 receipt, replayed=false, providerMessagesSent=0'
 Pass 'conversation HUMAN rev1 human_takeover jarvis off assigned HUMAN' "SELECT state,revision,human_takeover,jarvis_enabled,assigned_actor FROM public.communication_conversations WHERE id='$(Conv 10)';" 'HUMAN|1|t|f|HUMAN'
 Pass 'exactly one HUMAN event with operator + nonce' "SELECT count(*)||'|'||min(event_type)||'|'||min(actor_type)||'|'||bool_and(event_data->>'operatorUserId'='$U' AND event_data->>'nonce'='$(Nonce 1)' AND (event_data->>'revision')::int=1) FROM public.communication_conversation_events WHERE conversation_id='$(Conv 10)';" '1|human.takeover_started|HUMAN|true'
 Pass 'receipt row binds actor team city revision and receipt hash' "SELECT actor_id||'|'||team_id||'|'||city_id||'|'||action||'|'||previous_revision||'|'||new_revision||'|'||provider_messages_sent||'|'||(receipt_sha256='$rcpt') FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 WHERE nonce='$(Nonce 1)';" "$U|$TEAM|$CITY|TAKEOVER|0|1|0|true"
 $snap=Snapshot
 $again=Sql (Tx 10 1 0);if($again.code -ne 0 -or $again.text -notmatch "\|HUMAN\|transactional\|qf-consent-v1\|transactional_no_consent_objection\|t\|$rcpt\|0$"){throw "RC41_REPLAY_FAILED $($again.text)"}
 if((Snapshot) -cne $snap){throw 'RC41_REPLAY_WROTE_STATE'}
 Write-Output 'PASS exact replay returns replayed=true with the identical receipt and writes nothing'
 Denied 'replay with different action is a nonce conflict' (Tx 10 1 0 'PAUSE_AI') 'RC41_NONCE_CONFLICT'
 Denied 'replay with different expected revision is a nonce conflict' (Tx 10 1 5) 'RC41_NONCE_CONFLICT'
 Denied 'nonce reused on another conversation is a nonce conflict' (Tx 11 1 0) 'RC41_NONCE_CONFLICT'
 Denied 'new nonce on a taken-over conversation: stale revision' (Tx 10 2 0) 'RC41_REVISION_CONFLICT'
 Denied 'new nonce on a taken-over conversation: state denied' (Tx 10 2 1) 'RC41_STATE_DENIED'
 $p=Sql (Tx 11 3 0 'PAUSE_AI');if($p.code -ne 0 -or $p.text -notmatch '\|PAUSE_AI\|0\|1\|PAUSED\|transactional\|qf-consent-v1\|transactional_no_consent_objection\|f\|[0-9a-f]{64}\|0$'){throw "RC41_PAUSE_FAILED $($p.text)"}
 Write-Output 'PASS PAUSE_AI returns PAUSED receipt'
 Pass 'PAUSED keeps assigned actor, no takeover, jarvis off, event type' "SELECT c.state||'|'||c.revision||'|'||c.assigned_actor||'|'||c.human_takeover||'|'||c.jarvis_enabled||'|'||e.event_type FROM public.communication_conversations c JOIN public.communication_conversation_events e ON e.conversation_id=c.id WHERE c.id='$(Conv 11)';" 'PAUSED|1|ANISHA|false|false|ai.paused_by_operator'
 Denied 'PAUSE_AI on an already paused conversation is state denied' (Tx 11 4 1 'PAUSE_AI') 'RC41_STATE_DENIED'
 $t=Sql (Tx 11 5 1);if($t.code -ne 0 -or $t.text -notmatch '\|TAKEOVER\|1\|2\|HUMAN\|'){throw "RC41_PAUSED_TAKEOVER_FAILED $($t.text)"}
 Pass 'TAKEOVER from PAUSED reaches HUMAN revision 2 with two receipts' "SELECT c.state||'|'||c.revision||'|'||c.human_takeover||'|'||(SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 q WHERE q.conversation_id=c.id) FROM public.communication_conversations c WHERE c.id='$(Conv 11)';" 'HUMAN|2|true|2'
 Denied 'conflicting actions for one revision cannot both exist (unique conversation+revision)' "INSERT INTO public.vox_rc41_core_conversation_operator_receipts_candidate_v1 SELECT '$(Nonce 888)',conversation_id,actor_id,team_id,city_id,action,previous_revision,new_revision,event_id,consent_scope,consent_policy_version,consent_reason,receipt_sha256,provider_messages_sent,occurred_at FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 WHERE nonce='$(Nonce 5)';" 'duplicate key'

 # ---------------- input / isolation ----------------
 Denied 'aal1 is refused' (Tx 12 20 0 'TAKEOVER' $U 'aal1') 'RC41_INPUT_DENIED'
 Denied 'expired AAL2 attestation is refused' (Tx 12 20 0 'TAKEOVER' $U 'aal2' "now()-interval '1 second'") 'RC41_AAL2_EXPIRED'
 Denied 'unknown action (a send-like verb) is refused' (Tx 12 20 0 'SEND_MESSAGE') 'RC41_INPUT_DENIED'
 Denied 'negative revision is refused' (Tx 12 20 -1) 'RC41_INPUT_DENIED'
 Denied 'revision above int32 bound is refused' (Tx 12 20 2147483647) 'RC41_INPUT_DENIED'
 Denied 'null nonce is refused' "SET ROLE service_role; SELECT * FROM $FN('$U','aal2',$FUT,'$(Conv 12)',NULL,0,'TAKEOVER');" 'RC41_INPUT_DENIED'
 Denied 'null actor is refused' "SET ROLE service_role; SELECT * FROM $FN(NULL,'aal2',$FUT,'$(Conv 12)','$(Nonce 20)',0,'TAKEOVER');" 'RC41_INPUT_DENIED'
 Denied 'SERIALIZABLE caller is refused (stale snapshot)' "SET ROLE service_role; BEGIN ISOLATION LEVEL SERIALIZABLE; $(Call 12 20 0) COMMIT;" 'RC41_READ_COMMITTED_REQUIRED'
 Denied 'REPEATABLE READ caller is refused' "SET ROLE service_role; BEGIN ISOLATION LEVEL REPEATABLE READ; $(Call 12 20 0) COMMIT;" 'RC41_READ_COMMITTED_REQUIRED'
 Denied 'READ ONLY transaction cannot write' "SET ROLE service_role; BEGIN READ ONLY; $(Call 12 20 0) COMMIT;" 'read-only'

 # ---------------- scope ----------------
 $unknown=Sql (Tx 900 21 0);$clientConv=Sql (Tx 60 21 0)
 if($unknown.code -eq 0 -or $clientConv.code -eq 0 -or (Norm ($unknown.text -replace 'CONTEXT:[\s\S]*','')) -cne (Norm ($clientConv.text -replace 'CONTEXT:[\s\S]*','')) -or $unknown.text -notmatch 'RC41_CONVERSATION_SCOPE_DENIED'){throw "RC41_EXISTENCE_ORACLE $($unknown.text) // $($clientConv.text)"}
 Write-Output 'PASS DENIED unknown conversation and client-subject conversation are indistinguishable'
 Denied 'foreign tenant conversation' (Tx 61 21 0) 'RC41_CONVERSATION_SCOPE_DENIED'
 Denied 'SYSTEM-assigned conversation is state denied' (Tx 62 21 0) 'RC41_STATE_DENIED'
 Denied 'conversation without an object grant' (Tx 63 21 0) 'RC41_OBJECT_GRANT_REVOKED'
 Denied 'unknown actor is not current staff' (Tx 20 21 0 'TAKEOVER' (Id 77)) 'RC41_STAFF_NOT_CURRENT'

 # ---------------- authority dimensions (each mutated, denied, restored) ----------------
 $authority=@(
  @{l='zone moved to another city';m="UPDATE public.marketplace_service_zones SET canonical_city='Noida';";r="UPDATE public.marketplace_service_zones SET canonical_city='Gurugram';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='zone inactive';m="UPDATE public.marketplace_service_zones SET is_active=false;";r="UPDATE public.marketplace_service_zones SET is_active=true;";e='RC41_CONVERSATION_SCOPE_DENIED'},
  @{l='zone matching disabled';m="UPDATE public.marketplace_service_zones SET matching_enabled=false;";r="UPDATE public.marketplace_service_zones SET matching_enabled=true;";e='RC41_CONVERSATION_SCOPE_DENIED'},
  @{l='city inactive';m="UPDATE public.cities SET is_active=false WHERE id='$CITY';";r="UPDATE public.cities SET is_active=true WHERE id='$CITY';";e='RC41_CONVERSATION_SCOPE_DENIED'},
  @{l='vendor has no service zone';m="UPDATE public.vendors SET service_zone_id=NULL;";r="UPDATE public.vendors SET service_zone_id='$ZONE';";e='RC41_CONVERSATION_SCOPE_DENIED'},
  @{l='membership expired';m="UPDATE public.vox_staff_memberships_v1 SET expires_at=now()-interval '1 minute' WHERE auth_user_id='$U';";r="UPDATE public.vox_staff_memberships_v1 SET expires_at=now()+interval '1 day' WHERE auth_user_id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='membership revoked';m="UPDATE public.vox_staff_memberships_v1 SET revoked_at=now() WHERE auth_user_id='$U';";r="UPDATE public.vox_staff_memberships_v1 SET revoked_at=NULL WHERE auth_user_id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='membership inactive';m="UPDATE public.vox_staff_memberships_v1 SET is_active=false WHERE auth_user_id='$U';";r="UPDATE public.vox_staff_memberships_v1 SET is_active=true WHERE auth_user_id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='membership role is not operations_manager';m="UPDATE public.vox_staff_memberships_v1 SET staff_role='auditor' WHERE auth_user_id='$U';";r="UPDATE public.vox_staff_memberships_v1 SET staff_role='operations_manager' WHERE auth_user_id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='membership moved to another-city team';m="UPDATE public.vox_staff_memberships_v1 SET team_id='$OTHERTEAM' WHERE auth_user_id='$U';";r="UPDATE public.vox_staff_memberships_v1 SET team_id='$TEAM' WHERE auth_user_id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='team inactive';m="UPDATE public.vox_staff_teams_v1 SET is_active=false WHERE id='$TEAM';";r="UPDATE public.vox_staff_teams_v1 SET is_active=true WHERE id='$TEAM';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='profile has an admin role';m="UPDATE public.profiles SET role='admin' WHERE id='$U';";r="UPDATE public.profiles SET role=NULL WHERE id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='profile inactive';m="UPDATE public.profiles SET is_active=false WHERE id='$U';";r="UPDATE public.profiles SET is_active=true WHERE id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='auth principal carries admin_role';m="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{""admin_role"":""Superadmin""}' WHERE id='$U';";r="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data-'admin_role' WHERE id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='auth principal is not vox_staff';m="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{""qf_principal"":""vendor""}' WHERE id='$U';";r="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{""qf_principal"":""vox_staff""}' WHERE id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='auth vox_role is not operations_manager';m="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{""vox_role"":""team_leader""}' WHERE id='$U';";r="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{""vox_role"":""operations_manager""}' WHERE id='$U';";e='RC41_STAFF_NOT_CURRENT'},
  @{l='capability revoked';m="UPDATE public.vox_staff_department_capabilities_v1 SET revoked_at=now();";r="UPDATE public.vox_staff_department_capabilities_v1 SET revoked_at=NULL;";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='capability expired';m="UPDATE public.vox_staff_department_capabilities_v1 SET expires_at=now()-interval '1 minute';";r="UPDATE public.vox_staff_department_capabilities_v1 SET expires_at=now()+interval '1 day';";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='capability for another department';m="UPDATE public.vox_staff_department_capabilities_v1 SET department='acquisition';";r="UPDATE public.vox_staff_department_capabilities_v1 SET department='client_success';";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='TL review request expired';m="UPDATE public.vox_staff_department_requests_v1 SET expires_at=now()-interval '1 minute';";r="UPDATE public.vox_staff_department_requests_v1 SET expires_at=now()+interval '1 day';";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='TL decision rejected';m="UPDATE public.vox_staff_department_decisions_v1 SET decision='REJECTED';";r="UPDATE public.vox_staff_department_decisions_v1 SET decision='APPROVED';";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='reviewer is the requester (no independent review)';m="UPDATE public.vox_staff_department_requests_v1 SET decided_by=requested_by;";r="UPDATE public.vox_staff_department_requests_v1 SET decided_by='$TLU';";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='reviewing TL membership revoked';m="UPDATE public.vox_staff_memberships_v1 SET revoked_at=now() WHERE auth_user_id='$TLU';";r="UPDATE public.vox_staff_memberships_v1 SET revoked_at=NULL WHERE auth_user_id='$TLU';";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='reviewing TL no longer a team_leader principal';m="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{""vox_role"":""operations_manager""}' WHERE id='$TLU';";r="UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{""vox_role"":""team_leader""}' WHERE id='$TLU';";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='activation row missing';m="CREATE TEMP TABLE hold AS SELECT * FROM public.vox_staff_department_activations_v1;DELETE FROM public.vox_staff_department_activations_v1;";r="";e='RC41_DEPARTMENT_REVIEW_REQUIRED'},
  @{l='conversation object scope revoked';m="UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=now() WHERE object_id='$(Conv 20)';";r="UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=NULL WHERE object_id='$(Conv 20)';";e='RC41_OBJECT_GRANT_REVOKED'},
  @{l='conversation object scope expired';m="UPDATE public.vox_staff_object_scopes_v1 SET expires_at=now()-interval '1 minute' WHERE object_id='$(Conv 20)';";r="UPDATE public.vox_staff_object_scopes_v1 SET expires_at=now()+interval '1 day' WHERE object_id='$(Conv 20)';";e='RC41_OBJECT_GRANT_REVOKED'},
  @{l='object scope is for a different kind';m="UPDATE public.vox_staff_object_scopes_v1 SET scope_kind='vendor' WHERE object_id='$(Conv 20)';";r="UPDATE public.vox_staff_object_scopes_v1 SET scope_kind='conversation' WHERE object_id='$(Conv 20)';";e='RC41_OBJECT_GRANT_REVOKED'}
 )
 foreach($c in $authority){
  if($c.l -eq 'activation row missing'){
   $keep=Sql "CREATE TABLE public.activations_hold AS SELECT * FROM public.vox_staff_department_activations_v1;DELETE FROM public.vox_staff_department_activations_v1;"
   if($keep.code -ne 0){throw "RC41_AUTH_SETUP $($keep.text)"}
   $c.r="INSERT INTO public.vox_staff_department_activations_v1 SELECT * FROM public.activations_hold;DROP TABLE public.activations_hold;"
  }else{$m=Sql $c.m;if($m.code -ne 0){throw "RC41_AUTH_SETUP $($c.l) $($m.text)"}}
  try{Denied $c.l (Tx 20 22 0) $c.e}finally{$x=Sql $c.r;if($x.code -ne 0){throw "RC41_AUTH_RESTORE $($c.l) $($x.text)"}}
 }
 Pass 'authority fully restored: conversation 20 untouched at revision 0' "SELECT revision||'|'||state FROM public.communication_conversations WHERE id='$(Conv 20)';" '0|OPEN'

 # ---------------- canonical same-transaction consent ----------------
 $H30=Hash 30
 $sup="INSERT INTO public.communication_suppressions(destination_hash,channel,scope,reason,is_active,expires_at,deactivated_at,policy_version)"
 $pref="INSERT INTO public.communication_preferences(principal_type,principal_id,channel,scope,state,policy_version,consented_at,withdrawn_at)"
 $consent=@(
  @{l='active transactional suppression';s="$sup VALUES('$H30','whatsapp','transactional','user_stop',true,NULL,NULL,'qf-consent-v1');";e='RC41_CONSENT_DENIED'},
  @{l='active global suppression';s="$sup VALUES('$H30','whatsapp','global','legal',true,NULL,NULL,'qf-consent-v1');";e='RC41_CONSENT_DENIED'},
  @{l='suppression with a future expiry still blocks';s="$sup VALUES('$H30','whatsapp','transactional','admin',true,now()+interval '1 hour',NULL,'qf-consent-v1');";e='RC41_CONSENT_DENIED'},
  @{l='blocked vendor preference';s="$pref VALUES('vendor','$VENDOR','whatsapp','transactional','blocked','qf-consent-v1',NULL,now());";e='RC41_CONSENT_DENIED'},
  @{l='blocked preference with a stale policy version still blocks';s="$pref VALUES('vendor','$VENDOR','whatsapp','transactional','blocked','qf-consent-v0',NULL,now());";e='RC41_CONSENT_DENIED'},
  @{l='duplicate global suppressions are an integrity violation';s="$sup VALUES('$H30','whatsapp','global','admin',true,NULL,NULL,'qf-consent-v1'),('$H30','whatsapp','global','admin',true,NULL,NULL,'qf-consent-v1');";e='RC41_CONSENT_INTEGRITY'},
  @{l='duplicate transactional suppressions where one is expired are still an integrity violation';s="$sup VALUES('$H30','whatsapp','transactional','admin',true,now()-interval '1 hour',NULL,'qf-consent-v1'),('$H30','whatsapp','transactional','admin',true,NULL,NULL,'qf-consent-v1');";e='RC41_CONSENT_INTEGRITY'},
  @{l='out-of-vocabulary suppression reason (even if expired)';s="$sup VALUES('$H30','whatsapp','transactional','bogus',true,now()-interval '1 hour',NULL,'qf-consent-v1');";e='RC41_CONSENT_INTEGRITY'},
  @{l='active suppression carrying deactivated_at';s="$sup VALUES('$H30','whatsapp','transactional','admin',true,NULL,now(),'qf-consent-v1');";e='RC41_CONSENT_INTEGRITY'},
  @{l='malformed suppression policy version';s="$sup VALUES('$H30','whatsapp','transactional','admin',true,NULL,NULL,'bad version!');";e='RC41_CONSENT_INTEGRITY'},
  @{l='duplicate preference rows';s="$pref VALUES('vendor','$VENDOR','whatsapp','transactional','allowed','qf-consent-v1',now(),NULL),('vendor','$VENDOR','whatsapp','transactional','allowed','qf-consent-v1',now(),NULL);";e='RC41_CONSENT_INTEGRITY'},
  @{l='allowed preference with withdrawn_at set';s="$pref VALUES('vendor','$VENDOR','whatsapp','transactional','allowed','qf-consent-v1',now(),now());";e='RC41_CONSENT_INTEGRITY'},
  @{l='preference in state unknown';s="$pref VALUES('vendor','$VENDOR','whatsapp','transactional','unknown','qf-consent-v1',NULL,NULL);";e='RC41_CONSENT_INTEGRITY'},
  @{l='malformed preference policy version';s="$pref VALUES('vendor','$VENDOR','whatsapp','transactional','allowed','bad version!',now(),NULL);";e='RC41_CONSENT_INTEGRITY'}
 )
 foreach($c in $consent){
  $m=Sql $c.s;if($m.code -ne 0){throw "RC41_CONSENT_SETUP $($c.l) $($m.text)"}
  try{Denied $c.l (Tx 30 23 0) $c.e}finally{$x=Sql "DELETE FROM public.communication_suppressions;DELETE FROM public.communication_preferences;";if($x.code -ne 0){throw 'RC41_CONSENT_RESTORE'}}
 }
 # Rows that must NOT block (each on its own conversation, since success writes).
 $null=Sql "$sup VALUES('$(Hash 31)','whatsapp','marketing','user_stop',true,NULL,NULL,'qf-consent-v1');"
 $null=Sql "$sup VALUES('$(Hash 32)','whatsapp','transactional','admin',true,now()-interval '1 hour',NULL,'qf-consent-v1');"
 $null=Sql "$pref VALUES('vendor','$VENDOR','whatsapp','marketing','blocked','qf-consent-v1',NULL,now());"
 $null=Sql "$sup VALUES('$(Hash 35)','whatsapp','transactional','admin',false,NULL,now(),'qf-consent-v1'),('$(Hash 35)','sms','transactional','admin',true,NULL,NULL,'qf-consent-v1');"
 foreach($n in 31,32,35){
  $ok=Sql (Tx $n (30+$n) 0);if($ok.code -ne 0 -or $ok.text -notmatch '\|HUMAN\|transactional\|qf-consent-v1\|transactional_no_consent_objection\|f\|'){throw "RC41_CONSENT_ALLOW_$n $($ok.text)"}
 }
 Write-Output 'PASS marketing suppression, expired transactional suppression, other-scope blocked preference, inactive suppression and other-channel suppression do not block'
 $null=Sql "DELETE FROM public.communication_suppressions;DELETE FROM public.communication_preferences;$pref VALUES('vendor','$VENDOR','whatsapp','transactional','allowed','qf-consent-v1',now(),NULL);"
 $ok=Sql (Tx 33 70 0);if($ok.code -ne 0 -or $ok.text -notmatch '\|preference_transactional_no_objection\|f\|'){throw "RC41_PREF_ALLOW $($ok.text)"}
 Write-Output 'PASS current-policy allowed preference is recorded as preference_transactional_no_objection'
 $null=Sql "DELETE FROM public.communication_preferences;$pref VALUES('vendor','$VENDOR','whatsapp','transactional','allowed','qf-consent-v0',now(),NULL);"
 $ok=Sql (Tx 34 71 0);if($ok.code -ne 0 -or $ok.text -notmatch '\|preference_policy_version_mismatch_no_objection\|f\|'){throw "RC41_PREF_STALE $($ok.text)"}
 Write-Output 'PASS stale-policy allowed preference is recorded as preference_policy_version_mismatch_no_objection'
 $null=Sql "DELETE FROM public.communication_preferences;"

 # ---------------- ACL / immutability ----------------
 Denied 'anon cannot execute' ((Tx 36 80 0) -replace 'service_role','anon') 'permission denied'
 Denied 'authenticated cannot execute' ((Tx 36 80 0) -replace 'service_role','authenticated') 'permission denied'
 Denied 'service_role cannot forge a receipt directly' "SET ROLE service_role; INSERT INTO public.vox_rc41_core_conversation_operator_receipts_candidate_v1 SELECT '$(Nonce 889)',conversation_id,actor_id,team_id,city_id,action,previous_revision,new_revision,event_id,consent_scope,consent_policy_version,consent_reason,receipt_sha256,provider_messages_sent,occurred_at FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 LIMIT 1;" 'permission denied'
 Denied 'service_role cannot read receipts directly' "SET ROLE service_role; SELECT * FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1;" 'permission denied'
 Denied 'receipt UPDATE is immutable' "UPDATE public.vox_rc41_core_conversation_operator_receipts_candidate_v1 SET receipt_sha256=repeat('0',64);" 'RC41_RECEIPT_IMMUTABLE'
 Denied 'receipt DELETE is immutable' "DELETE FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1;" 'RC41_RECEIPT_IMMUTABLE'
 Denied 'receipt TRUNCATE is immutable' "TRUNCATE public.vox_rc41_core_conversation_operator_receipts_candidate_v1;" 'RC41_RECEIPT_IMMUTABLE'
 Denied 'receipt cannot claim a provider send' "UPDATE public.vox_rc41_core_conversation_operator_receipts_candidate_v1 SET provider_messages_sent=1;INSERT INTO public.vox_rc41_core_conversation_operator_receipts_candidate_v1(nonce,conversation_id,actor_id,team_id,city_id,action,previous_revision,new_revision,event_id,consent_scope,consent_policy_version,consent_reason,receipt_sha256,provider_messages_sent) SELECT '$(Nonce 890)',conversation_id,actor_id,team_id,city_id,action,9,10,gen_random_uuid(),consent_scope,consent_policy_version,consent_reason,receipt_sha256,1 FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 LIMIT 1;" 'RC41_RECEIPT_IMMUTABLE|violates'

 # ---------------- concurrency ----------------
 # 1. Scope revocation blocks behind an in-flight command (never lands mid-write).
 $writer="SET ROLE service_role; BEGIN; $(Call 40 100 0) SELECT pg_sleep(4); COMMIT;"
 $job=Job $writer;Start-Sleep -Seconds 1
 $t=Elapsed {Sql "UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=now() WHERE object_id='$(Conv 40)';"}
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($t.result.code -ne 0 -or $t.seconds -lt 2){throw "RC41_REVOCATION_NOT_SERIALIZED $($t.seconds)"}
 Write-Output "PASS scope revocation blocked behind in-flight command ($([int]$t.seconds)s)"
 Pass 'in-flight command committed before the revocation' "SELECT state||'|'||revision FROM public.communication_conversations WHERE id='$(Conv 40)';" 'HUMAN|1'
 Denied 'after revocation exact replay is denied too (replay is authority-gated)' (Tx 40 100 0) 'RC41_OBJECT_GRANT_REVOKED'

 # 2. A command queued behind an UNCOMMITTED membership revocation is denied once it commits.
 $revoker="BEGIN; UPDATE public.vox_staff_memberships_v1 SET is_active=false WHERE auth_user_id='$U'; SELECT pg_sleep(2); COMMIT;"
 $job=Job $revoker;Start-Sleep -Milliseconds 800
 $t=Elapsed {Sql (Tx 41 101 0)}
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($t.result.code -eq 0 -or $t.result.text -notmatch 'RC41_STAFF_NOT_CURRENT' -or $t.seconds -lt 0.8){throw "RC41_WRITE_AFTER_REVOCATION $($t.seconds) $($t.result.text)"}
 Write-Output "PASS DENIED command queued behind membership revocation is denied after it commits ($([int]$t.seconds)s)"
 Pass 'queued command wrote nothing' "SELECT state||'|'||revision FROM public.communication_conversations WHERE id='$(Conv 41)';" 'OPEN|0'
 $null=Sql "UPDATE public.vox_staff_memberships_v1 SET is_active=true WHERE auth_user_id='$U';"

 # 3. Bounded wait: a revocation held longer than lock_timeout fails closed, writes nothing.
 $revoker="BEGIN; UPDATE public.vox_staff_memberships_v1 SET is_active=false WHERE auth_user_id='$U'; SELECT pg_sleep(5.5); COMMIT;"
 $job=Job $revoker;Start-Sleep -Milliseconds 800
 $t=Elapsed {Sql (Tx 41 102 0)}
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($t.result.code -eq 0 -or $t.result.text -notmatch 'lock timeout' -or $t.seconds -lt 2.5 -or $t.seconds -gt 5.2){throw "RC41_LOCK_TIMEOUT_NOT_BOUNDED $($t.seconds) $($t.result.text)"}
 Write-Output "PASS DENIED lock wait is bounded by lock_timeout ($([int]$t.seconds)s)"
 Pass 'lock-timeout command wrote nothing' "SELECT state||'|'||revision FROM public.communication_conversations WHERE id='$(Conv 41)';" 'OPEN|0'
 $null=Sql "UPDATE public.vox_staff_memberships_v1 SET is_active=true WHERE auth_user_id='$U';"

 # 4. D2-D consent writer holding the destination key: command waits, then sees the committed STOP.
 $consentWriter="BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('dst|$(Hash 42)|whatsapp',0)); $sup VALUES('$(Hash 42)','whatsapp','transactional','user_stop',true,NULL,NULL,'qf-consent-v1'); SELECT pg_sleep(2); COMMIT;"
 $job=Job $consentWriter;Start-Sleep -Milliseconds 800
 $t=Elapsed {Sql (Tx 42 103 0)}
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($t.result.code -eq 0 -or $t.result.text -notmatch 'RC41_CONSENT_DENIED' -or $t.seconds -lt 0.8){throw "RC41_CONSENT_STOP_RACE $($t.seconds) $($t.result.text)"}
 Write-Output "PASS DENIED command waited for the D2-D destination key and honoured the concurrently committed STOP ($([int]$t.seconds)s)"
 Pass 'STOP-raced command wrote nothing' "SELECT state||'|'||revision FROM public.communication_conversations WHERE id='$(Conv 42)';" 'OPEN|0'
 $null=Sql "DELETE FROM public.communication_suppressions;"

 # 5. Reverse order: in-flight command holds the destination key, a consent writer must wait for it.
 $holder="SET ROLE service_role; BEGIN; $(Call 43 104 0) SELECT pg_sleep(3); COMMIT;"
 $job=Job $holder;Start-Sleep -Seconds 1
 $t=Elapsed {Sql "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('dst|$(Hash 43)|whatsapp',0)); $sup VALUES('$(Hash 43)','whatsapp','transactional','user_stop',true,NULL,NULL,'qf-consent-v1'); COMMIT;"}
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($t.result.code -ne 0 -or $t.seconds -lt 1.2){throw "RC41_CONSENT_WRITER_NOT_SERIALIZED $($t.seconds) $($t.result.text)"}
 Write-Output "PASS consent writer serialized behind the in-flight command on the shared destination key ($([int]$t.seconds)s)"
 Pass 'command committed first, STOP landed after' "SELECT c.state||'|'||c.revision||'|'||(SELECT count(*) FROM public.communication_suppressions) FROM public.communication_conversations c WHERE c.id='$(Conv 43)';" 'HUMAN|1|1'
 $null=Sql "DELETE FROM public.communication_suppressions;"

 # 6. Two identical concurrent commands: one write, one exact replay, identical receipt.
 $holdA="SET ROLE service_role; BEGIN; $(Call 44 105 0) SELECT pg_sleep(3); COMMIT;"
 $job=Job $holdA;Start-Sleep -Seconds 1
 $b=Sql (Tx 44 105 0);$a=(Receive-Job $job -Wait);Remove-Job $job
 $ra=([regex]::Match($a,'HUMAN\|transactional\|qf-consent-v1\|transactional_no_consent_objection\|f\|([0-9a-f]{64})')).Groups[1].Value
 $rb=([regex]::Match($b.text,'HUMAN\|transactional\|qf-consent-v1\|transactional_no_consent_objection\|t\|([0-9a-f]{64})')).Groups[1].Value
 if(!$ra -or $ra -ne $rb){throw "RC41_CONCURRENT_SAME_NONCE $a // $($b.text)"}
 Pass 'concurrent same nonce produced exactly one event and one receipt' "SELECT (SELECT count(*) FROM public.communication_conversation_events WHERE conversation_id='$(Conv 44)')||'|'||(SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 WHERE conversation_id='$(Conv 44)');" '1|1'
 Write-Output 'PASS concurrent identical commands: one write, one replay, identical receipt'

 # 7. PAUSE_AI vs TAKEOVER race on one revision: exactly one winner, loser sees a revision conflict.
 $holdP="SET ROLE service_role; BEGIN; $(Call 45 106 0 'PAUSE_AI') SELECT pg_sleep(3); COMMIT;"
 $job=Job $holdP;Start-Sleep -Seconds 1
 $loser=Sql (Tx 45 107 0 'TAKEOVER');$null=Receive-Job $job -Wait;Remove-Job $job
 if($loser.code -eq 0 -or $loser.text -notmatch 'RC41_REVISION_CONFLICT'){throw "RC41_RACE_LOSER $($loser.text)"}
 Pass 'PAUSE winner intact after losing TAKEOVER' "SELECT c.state||'|'||c.revision||'|'||c.human_takeover||'|'||(SELECT count(*) FROM public.communication_conversation_events WHERE conversation_id=c.id) FROM public.communication_conversations c WHERE c.id='$(Conv 45)';" 'PAUSED|1|false|1'
 Write-Output 'PASS DENIED PAUSE_AI-vs-TAKEOVER race loser is a revision conflict'

 # 8. Six simultaneous commands, distinct nonces, one revision: exactly one commits.
 $jobs=1..6|%{Job "SET ROLE service_role; $(Call 47 (200+$_) 0)"}
 $outs=$jobs|%{Receive-Job $_ -Wait};$jobs|Remove-Job
 $won=@($outs|?{$_ -match '\|HUMAN\|transactional\|'}).Count;$lost=@($outs|?{$_ -match 'RC41_REVISION_CONFLICT'}).Count
 if($won -ne 1 -or $lost -ne 5){throw "RC41_SIX_WAY_RACE won=$won lost=$lost :: $($outs -join ' // ')"}
 Pass 'six-way race left one revision, one event, one receipt' "SELECT c.revision||'|'||(SELECT count(*) FROM public.communication_conversation_events WHERE conversation_id=c.id)||'|'||(SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 WHERE conversation_id=c.id) FROM public.communication_conversations c WHERE c.id='$(Conv 47)';" '1|1|1'
 Write-Output 'PASS six distinct-nonce commands: 1 committed, 5 revision conflicts'

 # 9. Six simultaneous commands, SAME nonce: one write, five exact replays, one receipt.
 $jobs=1..6|%{Job "SET ROLE service_role; $(Call 48 300 0)"}
 $outs=$jobs|%{Receive-Job $_ -Wait};$jobs|Remove-Job
 $fresh=@($outs|?{$_ -match '\|f\|[0-9a-f]{64}\|0'}).Count;$replay=@($outs|?{$_ -match '\|t\|[0-9a-f]{64}\|0'}).Count
 $hashes=@($outs|%{([regex]::Match($_,'([0-9a-f]{64})')).Groups[1].Value}|sort -Unique).Count
 if($fresh -ne 1 -or $replay -ne 5 -or $hashes -ne 1){throw "RC41_SIX_WAY_SAME_NONCE fresh=$fresh replay=$replay hashes=$hashes :: $($outs -join ' // ')"}
 Write-Output 'PASS six same-nonce commands: 1 write, 5 replays, identical receipt'

 # 10. AAL2 attestation that expires while waiting for the destination key is re-checked before return.
 $holdKey="BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('dst|$(Hash 49)|whatsapp',0)); SELECT pg_sleep(2.6); COMMIT;"
 $job=Job $holdKey;Start-Sleep -Milliseconds 600
 $t=Elapsed {Sql (Tx 49 109 0 'TAKEOVER' $U 'aal2' "now()+interval '1 second'")}
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($t.result.code -eq 0 -or $t.result.text -notmatch 'RC41_GRANT_EXPIRED_DURING_TRANSACTION'){throw "RC41_AAL_EXPIRY_CROSSING $($t.seconds) $($t.result.text)"}
 Pass 'AAL2-expiry-crossing command rolled back conversation, event and receipt' "SELECT c.state||'|'||c.revision||'|'||(SELECT count(*) FROM public.communication_conversation_events WHERE conversation_id=c.id)||'|'||(SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 WHERE conversation_id=c.id) FROM public.communication_conversations c WHERE c.id='$(Conv 49)';" 'OPEN|0|0|0'
 Write-Output 'PASS DENIED AAL2 attestation expiring during the transaction'

 # 11. Capability crossing its expiry AFTER the authority check (blocked on a consent row) is caught by the final re-check.
 $null=Sql "$pref VALUES('vendor','$VENDOR','whatsapp','transactional','allowed','qf-consent-v1',now(),NULL);"
 $crossing="UPDATE public.vox_staff_department_capabilities_v1 SET expires_at=now()+interval '3 seconds'; BEGIN; UPDATE public.communication_preferences SET state=state; SELECT pg_sleep(3.3); COMMIT;"
 $job=Job $crossing;Start-Sleep -Seconds 1
 $t=Elapsed {Sql (Tx 50 110 0)}
 $null=Receive-Job $job -Wait;Remove-Job $job
 if($t.result.code -eq 0 -or $t.result.text -notmatch 'RC41_GRANT_EXPIRED_DURING_TRANSACTION'){throw "RC41_CAPABILITY_EXPIRY_CROSSING $($t.seconds) $($t.result.text)"}
 Pass 'capability-expiry-crossing command rolled back conversation, event and receipt' "SELECT c.state||'|'||c.revision||'|'||(SELECT count(*) FROM public.communication_conversation_events WHERE conversation_id=c.id)||'|'||(SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 WHERE conversation_id=c.id) FROM public.communication_conversations c WHERE c.id='$(Conv 50)';" 'OPEN|0|0|0'
 Write-Output 'PASS DENIED capability expiring after the authority check'
 $null=Sql "UPDATE public.vox_staff_department_capabilities_v1 SET expires_at=now()+interval '1 day';DELETE FROM public.communication_preferences;"

 # ---------------- global invariants ----------------
 Pass 'every receipt has exactly one event; events equal receipts' "SELECT (SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 q LEFT JOIN public.communication_conversation_events e ON e.id=q.event_id WHERE e.id IS NULL)||'|'||((SELECT count(*) FROM public.communication_conversation_events)=(SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1));" '0|true'
 Pass 'every conversation revision equals its receipt count (no unreceipted state change)' "SELECT count(*) FROM public.communication_conversations c WHERE c.revision<>(SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 q WHERE q.conversation_id=c.id);" '0'
 Pass 'no outbox row, no message, jarvis never enabled, no takeover without HUMAN' "SELECT (SELECT count(*) FROM public.communication_conversation_outbox)||'|'||(SELECT count(*) FROM public.communication_messages)||'|'||(SELECT count(*) FROM public.communication_conversations WHERE jarvis_enabled)||'|'||(SELECT count(*) FROM public.communication_conversations WHERE human_takeover AND state<>'HUMAN');" '0|0|0|0'
 Pass 'no receipt claims a provider send' "SELECT count(*) FROM public.vox_rc41_core_conversation_operator_receipts_candidate_v1 WHERE provider_messages_sent<>0;" '0'
 $sha=(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "VOX_RC41_CORE_CONVERSATION_ATOMIC_PG17_PASS sha256=$sha"
}finally{if($container){docker rm -f $name *> $null}}
