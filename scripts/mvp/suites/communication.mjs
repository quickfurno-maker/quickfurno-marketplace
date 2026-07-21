// ============================================================================
// QF-MVP-00 — MVP Communication & Meta suite (safe, non-mutating, offline).
//
// Every test imports a REAL production module (never a copy). All modules are
// pure: HMAC/SHA use node:crypto only (offline, deterministic); the one clock
// dependence (metaRuntimeGate canary) is removed by injecting now=0. No env, no
// network, no Supabase, no Git, no mutation.
//
// Launch-critical behaviour covered here:
//   - communication state / channel handling
//   - Meta approved-template payload construction
//   - normalized provider results + uncertain-outcome no-resend protection
//   - webhook raw-body bounds + HMAC signature validation
//   - callback identity validation (foreign WABA/phone rejected)
//   - inbound idempotency (deterministic provider/delivery event ids)
//   - consent scope decisions + STOP/START/HELP command behaviour + ack plan
//
// Coverage gaps needing a live DB seam (FOCUSED_TEST_REQUIRED in the baseline
// doc): stateful consent-decision authority + writer, outbound consent
// enforcement integration, async ack-worker persistence.
// ============================================================================

import { assert, assertEqual, assertDeepEqual, assertMatch, assertTrue, assertFalse } from '../lib/harness.mjs';

import { normalizeConsentCommand } from '../../../lib/communication/consentCommand.ts';
import {
  ackTemplateKeyFor,
  isEligibleDisposition,
  deriveAckIdempotencyKey,
  deriveConsentAckPlan,
  ConsentAckType,
  APPROVED_ACK_COPY,
} from '../../../lib/communication/consentCommandResponse.ts';
import { resolveOutboundConsentScope, assertRegistryInvariants } from '../../../lib/communication/outboundConsentScope.ts';
import {
  mapAdapterProviderToConsentProvider,
  deriveProviderEventId,
  isStrictRfc3339,
  toStrictIsoInstant,
  resolveOccurredAt,
  readCommandToken,
} from '../../../lib/communication/inboundConsentCommandInput.ts';
import { decideCallbackIdentity } from '../../../lib/communication/providers/metaCallbackIdentity.ts';
import {
  evaluateRuntimeActivation,
  providerIdentityMatches,
  evaluateCanaryGate,
} from '../../../lib/communication/providers/metaRuntimeGate.ts';
import {
  readMetaWebhookRawBytes,
  META_MAX_WEBHOOK_BODY_BYTES,
} from '../../../lib/communication/providers/metaWebhookRawBody.ts';
import { selectApprovedProviderMapping, supportsResolvedTemplate } from '../../../lib/communication/whatsappTemplate.ts';
import { renderWhatsAppTemplateComponents } from '../../../lib/communication/providers/whatsappTemplateBinding.ts';
import {
  ProviderDispatchError,
  classifyProviderException,
  normalizeProviderException,
} from '../../../lib/communication/providers/providerError.ts';
import {
  isChannelDispatchable,
  isTemplateChannelConsistent,
  CHANNEL_DISPATCH_ERROR,
} from '../../../lib/communication/channelDispatchGuard.ts';
import {
  isCommunicationChannel,
  isAutomationDispatchable,
  ephemeralAuthDestination,
  ACTIVE_DISPATCH_CHANNEL,
  COMMUNICATION_CHANNELS,
} from '../../../lib/communication/types.ts';
import {
  isContradictoryProviderOutcome,
  effectiveProviderOutcomeCertainty,
  permitsAutomaticRetry,
  classifyTransportCertainty,
} from '../../../lib/communication/providers/providerOutcome.ts';
import {
  verifyMetaWebhookSignature,
  computeMetaWebhookSignature,
  verifyMetaWebhookGetChallenge,
  classifyMetaWebhook,
  normalizeMetaDeliveryWebhook,
  deriveMetaDeliveryEventId,
} from '../../../lib/communication/providers/metaWhatsAppWebhook.ts';

const gateReason = (res) => (res.ok ? '<ok>' : res.reason);

export const suite = {
  id: 'communication',
  title: 'MVP Communication & Meta (offline, deterministic)',
  cases: [
    // --- STOP / START / HELP command normalization -----------------------
    {
      name: 'consent command normalization maps STOP/START/HELP and rejects free text',
      run: () => {
        assertEqual(normalizeConsentCommand('STOP'), 'stop');
        assertEqual(normalizeConsentCommand('  stop '), 'stop', 'trim + case fold');
        assertEqual(normalizeConsentCommand('UNSUBSCRIBE'), 'stop');
        assertEqual(normalizeConsentCommand('START'), 'start');
        assertEqual(normalizeConsentCommand('SUBSCRIBE'), 'start');
        assertEqual(normalizeConsentCommand('HELP'), 'help');
        assertEqual(normalizeConsentCommand('INFO'), 'help');
        assertEqual(normalizeConsentCommand('please stop texting me'), 'unsupported', 'no substring match');
        assertEqual(normalizeConsentCommand(''), 'unsupported');
        assertEqual(normalizeConsentCommand(42), 'unsupported', 'non-string');
        assertEqual(normalizeConsentCommand(null), 'unsupported');
      },
    },

    // --- Consent acknowledgement plan + idempotency ----------------------
    {
      name: 'ack template keys, disposition eligibility, and approved copy',
      run: () => {
        assertEqual(ackTemplateKeyFor(ConsentAckType.STOP), 'consent_stop_acknowledgement');
        assertTrue(isEligibleDisposition('stop', 'stop_applied'), 'stop_applied eligible for stop');
        assertFalse(isEligibleDisposition('stop', 'start_applied'), 'start_applied not eligible for stop');
        assertTrue(isEligibleDisposition('help', 'help_acknowledged'), 'help_acknowledged eligible for help');
        assertFalse(isEligibleDisposition('start', 123), 'non-string disposition');
        assert(
          String(APPROVED_ACK_COPY[ConsentAckType.STOP]).startsWith('Your STOP request has been processed.'),
          'approved STOP copy is the frozen string',
        );
      },
    },
    {
      name: 'ack idempotency key buckets by receipt time and rejects bad inputs',
      run: () => {
        const hash = 'a'.repeat(64);
        const key = deriveAckIdempotencyKey('consent_stop_acknowledgement', 'stop', hash, '1970-01-01T00:00:00.000Z');
        assertMatch(key, /^ack:consent_stop_acknowledgement:a{64}:0$/, 'bucket 0 at epoch 0');
        assertEqual(
          deriveAckIdempotencyKey('consent_stop_acknowledgement', 'stop', hash, 'not-a-date'),
          null,
          'unparseable receipt time => null',
        );
        assertEqual(
          deriveAckIdempotencyKey('consent_stop_acknowledgement', 'stop', 'nothex', '1970-01-01T00:00:00.000Z'),
          null,
          'non hex64 destination hash => null',
        );
      },
    },
    {
      name: 'ack plan rejects non-commands and replays before doing work',
      run: () => {
        const observed = { destinationHash: 'a'.repeat(64), providerMessageId: 'wamid.X' };
        assertEqual(deriveConsentAckPlan({ command: 'nope' }, observed).reason, 'NOT_A_COMMAND');
        assertEqual(deriveConsentAckPlan({ command: 'stop', replayed: true }, observed).reason, 'REPLAYED_COMMAND');
      },
    },

    // --- Outbound consent scope decisions --------------------------------
    {
      name: 'consent scope registry is internally sound and rejects unknown message types',
      run: () => {
        assertEqual(assertRegistryInvariants().length, 0, 'registry invariants hold');
        const unknown = resolveOutboundConsentScope({ messageType: 'definitely_not_registered', templateKey: 'x', lane: 'business' });
        assertFalse(unknown.ok, 'unknown message type rejected');
        assertEqual(unknown.reason, 'UNCLASSIFIED_MESSAGE_TYPE');
      },
    },

    // --- Inbound identity / idempotency / temporal normalization ---------
    {
      name: 'adapter->consent provider mapping is strict',
      run: () => {
        assertEqual(mapAdapterProviderToConsentProvider('meta_whatsapp_cloud'), 'meta_whatsapp');
        assertEqual(mapAdapterProviderToConsentProvider('meta_whatsapp'), null, 'already-consent value is not an adapter');
        assertEqual(mapAdapterProviderToConsentProvider(5), null, 'non-string');
      },
    },
    {
      name: 'provider event id is a deterministic sha256 (inbound idempotency key)',
      run: () => {
        const a = deriveProviderEventId('wamid.ABC');
        const b = deriveProviderEventId('wamid.ABC');
        const c = deriveProviderEventId('wamid.OTHER');
        assertMatch(a, /^[0-9a-f]{64}$/, 'sha256 hex shape');
        assertEqual(a, b, 'same message id => same event id (dedup stable)');
        assert(a !== c, 'different message id => different event id');
      },
    },
    {
      name: 'strict RFC3339 validation and ISO instant normalization',
      run: () => {
        assertTrue(isStrictRfc3339('2026-07-22T10:30:00Z'), 'valid Z instant');
        assertFalse(isStrictRfc3339('2026-02-31T10:30:00Z'), 'Feb 31 invalid');
        assertFalse(isStrictRfc3339('2026-07-22'), 'date without time/zone invalid');
        assertEqual(toStrictIsoInstant('2026-07-22T10:30:00Z'), '2026-07-22T10:30:00.000Z');
        assertEqual(toStrictIsoInstant('garbage'), null);
        assertEqual(
          resolveOccurredAt('2026-07-22T10:30:00Z', '2026-07-01T00:00:00Z'),
          '2026-07-22T10:30:00.000Z',
          'provider time wins when valid',
        );
        assertEqual(resolveOccurredAt(null, null), null, 'no times => null');
      },
    },
    {
      name: 'command token is read only from eligible text messages',
      run: () => {
        const base = { provider: 'p', providerMessageId: 'm', providerOccurredAt: null };
        assertEqual(readCommandToken({ ...base, messageType: 'text', contentMinimized: { text: 'STOP' } }), 'STOP');
        assertEqual(readCommandToken({ ...base, messageType: 'image', contentMinimized: { text: 'STOP' } }), null, 'non-text ignored');
      },
    },

    // --- Callback identity gate ------------------------------------------
    {
      name: 'callback identity authorizes own WABA/phone and rejects foreign ones',
      run: () => {
        const expected = { wabaId: '111', phoneNumberId: '222' };
        const authorized = decideCallbackIdentity(
          { object: 'whatsapp_business_account', entry: [{ id: '111', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '222' } } }] }] },
          expected,
        );
        assertEqual(authorized.kind, 'authorized', 'own waba + phone authorized');
        const foreignWaba = decideCallbackIdentity(
          { object: 'whatsapp_business_account', entry: [{ id: '999', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '222' } } }] }] },
          expected,
        );
        assertEqual(foreignWaba.kind, 'rejected');
        assertEqual(foreignWaba.reason, 'foreign_waba');
        const foreignPhone = decideCallbackIdentity(
          { object: 'whatsapp_business_account', entry: [{ id: '111', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '888' } } }] }] },
          expected,
        );
        assertEqual(foreignPhone.reason, 'foreign_phone_number');
        assertEqual(decideCallbackIdentity({ object: 'other' }, expected).kind, 'unsupported');
        assertEqual(decideCallbackIdentity({}, { wabaId: '', phoneNumberId: '222' }).reason, 'malformed_expected_identity');
      },
    },

    // --- Runtime / outbound gate (fail-closed) ---------------------------
    {
      name: 'runtime activation gate is fail-closed and only opens when active',
      run: () => {
        assertEqual(gateReason(evaluateRuntimeActivation(null)), 'runtime_policy_missing');
        assertEqual(gateReason(evaluateRuntimeActivation({ outbound_enabled: false })), 'outbound_disabled');
        assertEqual(
          gateReason(evaluateRuntimeActivation({ outbound_enabled: true, activation_status: 'shadow' })),
          'activation_not_sendable',
        );
        const active = evaluateRuntimeActivation({ outbound_enabled: true, activation_status: 'active' });
        assertTrue(active.ok, 'active policy opens the gate');
        assertEqual(active.value, 'active');
        assertTrue(providerIdentityMatches('meta_whatsapp_cloud', 'meta_whatsapp_cloud'), 'identity match');
        assertFalse(providerIdentityMatches('meta_whatsapp_cloud', 'mock'), 'identity mismatch');
        assertFalse(providerIdentityMatches(null, 'x'), 'null provider never matches');
      },
    },
    {
      name: 'canary gate allows active, and blocks a non-allowlisted canary destination',
      run: () => {
        assertTrue(evaluateCanaryGate('active', 'h', [], 0).ok, 'active skips the allowlist');
        const blocked = evaluateCanaryGate('canary', 'abc', [], 0);
        assertFalse(blocked.ok, 'empty allowlist blocks canary');
        assertEqual(blocked.reason, 'canary_destination_not_allowlisted');
      },
    },

    // --- Webhook raw-body bounds -----------------------------------------
    {
      name: 'webhook raw-body reader enforces the 16KB ceiling and reads the buffer',
      run: async () => {
        assertEqual(META_MAX_WEBHOOK_BODY_BYTES, 16 * 1024, '16KB ceiling');
        const oversized = await readMetaWebhookRawBytes({
          body: null,
          headers: { get: (n) => (String(n).toLowerCase() === 'content-length' ? '99999' : null) },
        });
        assertFalse(oversized.ok, 'content-length over ceiling rejected');
        assertEqual(oversized.reason, 'oversized_body');
        const source = {
          body: null,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
        const ok = await readMetaWebhookRawBytes(source);
        assertTrue(ok.ok, 'small body read ok');
        assertDeepEqual(ok.rawBytes, new Uint8Array([1, 2, 3]), 'exact bytes');
        const capped = await readMetaWebhookRawBytes(source, 2);
        assertFalse(capped.ok, 'maxBytes=2 rejects 3-byte body');
        assertEqual(capped.reason, 'oversized_body');
      },
    },

    // --- Approved-template selection + payload construction --------------
    {
      name: 'approved provider mapping selection: none / ambiguous / not-approved / success',
      run: () => {
        assertEqual(
          selectApprovedProviderMapping([], { templateKey: 't', providerKey: 'p', language: 'en' }).reason,
          'no_mapping_found',
        );
        const row = {
          id: 'm1',
          template_key: 't',
          channel: 'whatsapp',
          provider_key: 'p',
          language: 'en',
          provider_template_name: 'tpl',
          provider_template_id: null,
          approval_status: 'approved',
          is_active: true,
          version: '1',
          variables_schema: { bindingVersion: 1, bindings: [] },
        };
        const ok = selectApprovedProviderMapping([row], { templateKey: 't', providerKey: 'p', language: 'en' });
        assertTrue(ok.ok, 'single approved active row selected');
        assertEqual(ok.template.providerTemplateName, 'tpl');
        assertEqual(
          selectApprovedProviderMapping([row, row], { templateKey: 't', providerKey: 'p', language: 'en' }).reason,
          'ambiguous_active_mapping',
        );
        assertEqual(
          selectApprovedProviderMapping([{ ...row, approval_status: 'pending' }], { templateKey: 't', providerKey: 'p', language: 'en' }).reason,
          'not_approved',
        );
        assertFalse(supportsResolvedTemplate({ templateResolutionMode: 'internal_template' }), 'internal mode has no resolved sender');
      },
    },
    {
      name: 'template component rendering orders params and validates variables',
      run: () => {
        const single = renderWhatsAppTemplateComponents(
          { bindingVersion: 1, bindings: [{ component: 'body', position: 1, sourceKey: 'name', parameterType: 'text' }] },
          { name: 'Ravi' },
        );
        assertTrue(single.ok, 'valid render');
        assertDeepEqual(single.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Ravi' }] }]);
        const ordered = renderWhatsAppTemplateComponents(
          {
            bindingVersion: 1,
            bindings: [
              { component: 'body', position: 2, sourceKey: 'b', parameterType: 'text' },
              { component: 'body', position: 1, sourceKey: 'a', parameterType: 'text' },
            ],
          },
          { a: 'A', b: 'B' },
        );
        assertDeepEqual(ordered.components[0].parameters, [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }], 'ordered by position');
        assertEqual(renderWhatsAppTemplateComponents(null, {}).reason, 'malformed_schema');
        assertEqual(renderWhatsAppTemplateComponents({ bindingVersion: 2, bindings: [] }, {}).reason, 'unsupported_binding_version');
        assertEqual(
          renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [{ component: 'body', position: 1, sourceKey: 'x', parameterType: 'text' }] }, {}).reason,
          'missing_source_key',
        );
        assertEqual(
          renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [{ component: 'body', position: 1, sourceKey: 'a', parameterType: 'text' }] }, { a: 'A', extra: 'E' }).reason,
          'undeclared_source_variable',
        );
      },
    },

    // --- Normalized provider results + no-resend protection --------------
    {
      name: 'provider dispatch errors normalize accepted->unknown and unknown->non-retryable',
      run: () => {
        const accepted = new ProviderDispatchError('X', 'm', 'accepted', true);
        assertEqual(accepted.outcomeCertainty, 'unknown_outcome', 'accepted throw normalized to unknown');
        assertEqual(accepted.retryable, false, 'unknown outcome forced non-retryable');
        assertEqual(new ProviderDispatchError('X', 'm', 'definitive_failure', true).retryable, true, 'definitive stays retryable');
      },
    },
    {
      name: 'provider exception classification: ambiguous vs proven pre-connect',
      run: () => {
        const reset = classifyProviderException({ code: 'ECONNRESET' });
        assertEqual(reset.code, 'ECONNRESET');
        assertEqual(reset.outcomeCertainty, 'unknown_outcome', 'ambiguous transport code => unknown');
        assertEqual(reset.retryable, false);
        const notFound = classifyProviderException({ code: 'ENOTFOUND' });
        assertEqual(notFound.outcomeCertainty, 'definitive_failure', 'proven pre-connect => definitive');
        assertEqual(notFound.retryable, true);
        assertEqual(classifyProviderException({}).code, 'PROVIDER_EXCEPTION', 'fallback code');
        const norm = normalizeProviderException({ code: 'ECONNREFUSED' }, 'meta_whatsapp_cloud');
        assertEqual(norm.accepted, false);
        assertEqual(norm.provider, 'meta_whatsapp_cloud');
        assertEqual(norm.providerMessageId, null);
        assertEqual(norm.normalizedStatus, 'failed');
        assertEqual(norm.errorCode, 'ECONNREFUSED');
      },
    },
    {
      name: 'uncertain outcome is never auto-retried (D9), definitive-retryable is',
      run: () => {
        assertFalse(isContradictoryProviderOutcome({ accepted: true, outcomeCertainty: 'accepted' }), 'consistent');
        assertTrue(isContradictoryProviderOutcome({ accepted: false, outcomeCertainty: 'accepted' }), 'accepted but not accepted');
        assertTrue(isContradictoryProviderOutcome({ accepted: true, outcomeCertainty: 'definitive_failure' }), 'accepted but failed');
        assertEqual(effectiveProviderOutcomeCertainty({ accepted: true, outcomeCertainty: 'unknown_outcome' }), 'unknown_outcome');
        assertEqual(effectiveProviderOutcomeCertainty({ accepted: false, outcomeCertainty: 'bogus' }), 'unknown_outcome', 'unknown default');
        assertTrue(permitsAutomaticRetry({ accepted: false, outcomeCertainty: 'definitive_failure', retryable: true }), 'definitive+retryable retries');
        assertFalse(permitsAutomaticRetry({ accepted: false, outcomeCertainty: 'unknown_outcome', retryable: true }), 'UNCERTAIN never auto-resent');
        assertFalse(permitsAutomaticRetry({ accepted: false, outcomeCertainty: 'definitive_failure', retryable: false }), 'non-retryable stays');
      },
    },
    {
      name: 'transport certainty: 200+id accepted, 200 without id uncertain, 5xx uncertain',
      run: () => {
        assertEqual(classifyTransportCertainty({ kind: 'response', status: 200, hasProviderMessageId: true }).outcomeCertainty, 'accepted');
        assertEqual(classifyTransportCertainty({ kind: 'response', status: 200, hasProviderMessageId: false }).outcomeCertainty, 'unknown_outcome');
        assertEqual(classifyTransportCertainty({ kind: 'response', status: 503, hasProviderMessageId: false }).outcomeCertainty, 'unknown_outcome');
        assertEqual(classifyTransportCertainty({ kind: 'aborted' }).outcomeCertainty, 'unknown_outcome');
      },
    },

    // --- Channel + communication state handling --------------------------
    {
      name: 'channel dispatch + template/intent consistency guards',
      run: () => {
        assertTrue(isChannelDispatchable('whatsapp', 'whatsapp'), 'matching channel dispatchable');
        assertFalse(isChannelDispatchable('sms', 'whatsapp'), 'mismatch not dispatchable');
        assertTrue(isTemplateChannelConsistent('whatsapp', 'whatsapp'), 'consistent');
        assertFalse(isTemplateChannelConsistent('sms', 'whatsapp'), 'inconsistent');
        assertEqual(CHANNEL_DISPATCH_ERROR.UNSUPPORTED_DISPATCH_CHANNEL, 'UNSUPPORTED_DISPATCH_CHANNEL');
      },
    },
    {
      name: 'communication channel/automation/destination state helpers',
      run: () => {
        assertTrue(isCommunicationChannel('whatsapp'), 'whatsapp is a channel');
        assertTrue(isCommunicationChannel('sms'), 'sms is a channel');
        assertFalse(isCommunicationChannel('email'), 'email is not');
        assertFalse(isCommunicationChannel(5), 'non-string is not');
        assertEqual(ACTIVE_DISPATCH_CHANNEL, 'whatsapp', 'active dispatch channel');
        assertEqual(COMMUNICATION_CHANNELS.length, 3, 'whatsapp/sms/rcs');
        assertTrue(isAutomationDispatchable({ readiness_status: 'active', is_operationally_enabled: true }), 'active+enabled');
        assertFalse(isAutomationDispatchable({ readiness_status: 'active', is_operationally_enabled: false }), 'disabled');
        assertFalse(isAutomationDispatchable({ readiness_status: 'wiring_pending', is_operationally_enabled: true }), 'not-ready');
        assertDeepEqual(ephemeralAuthDestination('+919876543210'), { kind: 'ephemeral_auth_destination', destination: '+919876543210' });
      },
    },

    // --- Webhook signature validation + delivery normalization -----------
    {
      name: 'HMAC webhook signature verifies round-trip and rejects tampering',
      run: () => {
        const sig = computeMetaWebhookSignature('hello', 'secret');
        assertMatch(sig, /^sha256=[0-9a-f]{64}$/, 'signature grammar');
        assertTrue(verifyMetaWebhookSignature('hello', sig, 'secret'), 'valid signature accepted');
        assertFalse(verifyMetaWebhookSignature('hello', sig, 'wrong-secret'), 'wrong secret rejected');
        assertFalse(verifyMetaWebhookSignature('HELLO', sig, 'secret'), 'tampered body rejected');
        assertFalse(verifyMetaWebhookSignature('hello', 'nope', 'secret'), 'malformed signature rejected');
      },
    },
    {
      name: 'webhook GET challenge only echoes on subscribe + matching verify token',
      run: () => {
        const ok = verifyMetaWebhookGetChallenge({ mode: 'subscribe', verifyToken: 'tok', challenge: '12345' }, 'tok');
        assertTrue(ok.ok, 'subscribe + token match');
        assertEqual(ok.challenge, '12345');
        assertFalse(verifyMetaWebhookGetChallenge({ mode: 'subscribe', verifyToken: 'bad', challenge: '1' }, 'tok').ok, 'token mismatch');
        assertFalse(verifyMetaWebhookGetChallenge({ mode: 'unsubscribe', verifyToken: 'tok', challenge: '1' }, 'tok').ok, 'wrong mode');
      },
    },
    {
      name: 'webhook classification + deterministic delivery event id + normalization',
      run: () => {
        const delivery = {
          object: 'whatsapp_business_account',
          entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.X', status: 'read', timestamp: '1' }] } }] }],
        };
        assertEqual(classifyMetaWebhook(delivery), 'delivery_status');
        assertEqual(
          classifyMetaWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{}] } }] }] }),
          'inbound_message',
        );
        assertEqual(classifyMetaWebhook({ object: 'other' }), 'unknown');
        assertEqual(classifyMetaWebhook(null), 'unknown');
        const id1 = deriveMetaDeliveryEventId('m', 'sent', '1');
        assertMatch(id1, /^meta-evt-[0-9a-f]{32}$/, 'delivery event id shape');
        assertEqual(id1, deriveMetaDeliveryEventId('m', 'sent', '1'), 'deterministic (dedup stable)');
        const events = normalizeMetaDeliveryWebhook(delivery);
        assertEqual(events.length, 1, 'one normalized delivery event');
        assertEqual(events[0].providerMessageId, 'wamid.X');
        assertEqual(events[0].normalizedEventType, 'read');
        assertEqual(normalizeMetaDeliveryWebhook({ object: 'other' }).length, 0, 'foreign object => no events');
      },
    },
  ],
};

export default suite;
