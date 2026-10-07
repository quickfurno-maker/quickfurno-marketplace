import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

function fail(message){process.stderr.write('QF_PHASE14_FAIL: '+message+'\n');process.exit(1);}
const read=(path)=>readFileSync(path,'utf8');
const contract=JSON.parse(read('contracts/qfj-observability-phase14-v1.json'));
const compat=JSON.parse(read('contracts/agni-governance-v1-compat.json'));
const governance=await import(new URL('../../lib/agni/contracts.ts',import.meta.url));
const actualFingerprint=governance.fingerprintAgniAction(compat.fingerprintInput);
if(actualFingerprint!==compat.expectedActionFingerprint)fail('AGNI action fingerprint compatibility drift');
const canonical=governance.canonicalAgniCapability(compat.capability);
const canonicalSha=createHash('sha256').update(canonical,'utf8').digest('hex');
if(canonicalSha!==compat.expectedCanonicalCapabilitySha256)fail('AGNI capability canonicalization drift');
if(contract.phase!==14||contract.system!=='AGNI')fail('contract identity mismatch');
if(contract.backend!=='OTEL_COLLECTOR_PROMETHEUS_TEMPO_LOKI_GRAFANA')fail('backend mismatch');
if(contract.telemetryAuthority!=='POWERLESS')fail('telemetry must be powerless');
if(contract.propagation?.format!=='W3C Trace Context'||contract.propagation?.rejectTraceIdMismatch!==true)fail('W3C signed binding missing');
if(contract.aiSre?.continuousRawTelemetryStreamingToModel!==false)fail('continuous LLM streaming forbidden');
if(contract.governance?.humanApprovalAuthority!=='QUICKFURNO_CORE')fail('Core approval authority drifted');

for(const path of [
  'instrumentation.ts',
  'lib/observability/runtime.ts',
  'lib/jarvis/scaleContract.ts',
  'lib/jarvis/scaleRequestGuard.ts',
  'services/jarvisScaleTransport.ts',
  'lib/agni/contracts.ts',
  'services/agniGovernanceService.ts',
  'app/api/internal/agni/proposal/route.ts',
  'app/api/internal/agni/capability/route.ts',
  'ops/observability/otel-agent.yaml',
  'ops/observability/compose.agent.yml',
  'ops/observability/qf-otel-heartbeat-bridge.py',
  'ops/observability/qf-otel-heartbeat-bridge.service',
  'ops/observability/qf-otel-heartbeat-bridge.timer',
  'ops/observability/install-qf-otel-heartbeat-bridge.sh',
  'supabase/migrations/20261005200000_scale_phase14_agni_governance.sql',
  'supabase/migrations/20261005203000_scale_phase14_trace_context.sql',
]) if(!existsSync(path))fail('missing '+path);

const scale=read('lib/jarvis/scaleContract.ts');
if(!scale.includes('traceparent')||!scale.includes('x-qfj-trace-id'))fail('signed trace binding missing');
const transport=read('services/jarvisScaleTransport.ts');
if(!transport.includes('injectCurrentTraceHeaders')||!transport.includes('withSpan'))fail('client tracing missing');
const guard=read('lib/jarvis/scaleRequestGuard.ts');
if(!guard.includes('qf.security.auth.failures')||!guard.includes('qf.security.signature.failures'))fail('security counters missing');
const runtime=read('lib/observability/runtime.ts');
if(!runtime.includes('qf.telemetry.heartbeat.unixtime')||!runtime.includes('OTEL_EXPORTER_OTLP_ENDPOINT'))fail('heartbeat/OTLP runtime missing');
const agent=read('ops/observability/otel-agent.yaml');
if(!agent.includes('0.0.0.0:4317')||!agent.includes('AGNI_OTLP_GATEWAY_ENDPOINT')||!agent.includes('cert_file')||!agent.includes('key_file'))fail('local mTLS OTLP agent invalid');
const overlay=read('ops/observability/compose.agent.yml');
if(
  !overlay.includes('OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-agent:4318')||
  !overlay.includes('QF_OTEL_SECRET_DIR')||
  overlay.includes('depends_on')
)fail('QuickFurno agent overlay invalid or telemetry became blocking');

const heartbeatBridge=read('ops/observability/qf-otel-heartbeat-bridge.py');
const heartbeatService=read('ops/observability/qf-otel-heartbeat-bridge.service');
const heartbeatTimer=read('ops/observability/qf-otel-heartbeat-bridge.timer');
const heartbeatInstaller=read('ops/observability/install-qf-otel-heartbeat-bridge.sh');
if(!heartbeatBridge.includes('http://127.0.0.1:4318/v1/metrics'))fail('PM2 heartbeat bridge must export only to local OTEL agent');
if(!heartbeatBridge.includes('qf.telemetry.heartbeat.unixtime'))fail('PM2 heartbeat metric missing');
if(!heartbeatBridge.includes('os.scandir("/proc")'))fail('PM2 heartbeat bridge must use read-only procfs liveness');
if(heartbeatBridge.includes('subprocess')||heartbeatBridge.includes('os.system')||heartbeatBridge.includes('Popen'))fail('PM2 heartbeat bridge may not execute processes');
if(!heartbeatBridge.includes('/var/www/quickfurno-marketplace/dist/automation-worker.mjs'))fail('automation worker liveness marker missing');
if(!heartbeatBridge.includes('/var/www/quickfurno-marketplace/dist/conversation-transpor'))fail('conversation transport PM2 process-title prefix missing');
if(heartbeatBridge.includes('/var/run/docker.sock'))fail('PM2 heartbeat bridge must not gain Docker authority');
if(!heartbeatService.includes('DynamicUser=yes')||!heartbeatService.includes('NoNewPrivileges=yes')||!heartbeatService.includes('ProtectSystem=strict'))fail('PM2 heartbeat service hardening drift');
if(!heartbeatService.includes('Requires=qf-otel-agent.service'))fail('PM2 heartbeat service must depend on local OTEL agent only');
if(!heartbeatTimer.includes('OnUnitActiveSec=15s')||!heartbeatTimer.includes('WantedBy=timers.target'))fail('PM2 heartbeat timer cadence/boot contract drift');
if(!heartbeatInstaller.includes('systemctl enable --now qf-otel-heartbeat-bridge.timer'))fail('PM2 heartbeat installer boot persistence missing');
if(!heartbeatInstaller.includes('qf-otel-agent.service is not active'))fail('PM2 heartbeat installer must fail closed without local OTEL agent');
if(!heartbeatInstaller.includes('QF_OTEL_HEARTBEAT_BRIDGE_INSTALLED'))fail('PM2 heartbeat installer completion token missing');
for(const forbidden of ['compose.observability.yml','prometheus.yml','tempo.yaml','loki.yaml','otel-collector.yaml']){
  if(existsSync('ops/observability/'+forbidden))fail('central observability ownership leaked into QuickFurno: '+forbidden);
}
const source=[
  read('lib/observability/runtime.ts'),
  transport,
  guard,
  read('services/agniGovernanceService.ts'),
].join('\n');
if(/https?:\/\/[^\s'"]*(prometheus|tempo|loki)/iu.test(source))fail('application talks directly to telemetry backend');
const traceMigration=read('supabase/migrations/20261005203000_scale_phase14_trace_context.sql');
const conversation=read('services/conversationalWhatsAppService.ts');
const jarvisGateway=read('services/jarvisWhatsAppGatewayService.ts');
if(
  !traceMigration.includes('communication_jarvis_turn_outbox')||
  !traceMigration.includes('communication_conversation_outbox')||
  !traceMigration.includes('traceparent')||
  !traceMigration.includes('tracestate')||
  !conversation.includes('captureCurrentTraceContext')||
  !conversation.includes('extractRemoteContext')||
  !jarvisGateway.includes('quickfurno.jarvis-turn-outbox')||
  !jarvisGateway.includes('SpanKind.CONSUMER')
)fail('durable W3C trace continuity missing');

const migration=read('supabase/migrations/20261005200000_scale_phase14_agni_governance.sql');
if(
  !migration.includes('agni_action_proposals')||
  !migration.includes('qf_agni_proposal_guard')||
  !migration.includes('AGNI_PROPOSAL_ALREADY_DECIDED')
)fail('AGNI immutable governance persistence missing');
process.stdout.write('QF_PHASE14_PASS\n');
