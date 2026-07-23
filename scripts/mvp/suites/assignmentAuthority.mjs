// ============================================================================
// QF-MVP-20.3R1 — Canonical Assignment Authority suite (safe, offline, pure).
//
// Every test imports the REAL production contract module (never a copy):
//   lib/marketplace/canonicalAssignmentContract.ts
//
// That module is dependency-free by construction — no Supabase client, no
// network, no clock, no randomness — so this suite exercises the same code the
// runtime uses while touching nothing. The I/O half
// (services/canonicalAssignmentAuthority.ts) is deliberately NOT imported here:
// importing it would pull in the service-role client.
//
// Covered:
//   - the mode / actor vocabularies match public.qf_assign_lead_vendors_v2
//   - the locked caps and credit cost (3 active / 6 lifetime / cost 1)
//   - NO caller-controlled ceiling reaches the authority
//   - client_selected is fail-closed with R1_BLOCKED_PENDING_OWNER_BINDING
//   - actor-id rules, replacement XOR replacement-ref, candidate-pool bounds
//   - operation-key determinism (and order-independence) for safe replay
//   - result normalization degrades to REJECTED, never to success
// ============================================================================

import { assert, assertEqual, assertDeepEqual, assertTrue, assertFalse } from '../lib/harness.mjs';

import {
  CANONICAL_ASSIGNMENT_RPC,
  CANONICAL_ASSIGNMENT_MODES,
  CANONICAL_ACTOR_KINDS,
  CANONICAL_ACTIVE_ASSIGNMENT_CAP,
  CANONICAL_LIFETIME_ASSIGNMENT_CAP,
  CANONICAL_ASSIGNMENT_CREDIT_COST,
  MAX_CANONICAL_CANDIDATE_POOL,
  CANONICAL_ASSIGNMENT_INVALID_REQUEST,
  R1_BLOCKED_PENDING_OWNER_BINDING,
  isCanonicalUuid,
  normalizeCandidateVendorIds,
  normalizeOperationScope,
  buildAssignmentOperationKey,
  validateCanonicalAssignmentRequest,
  normalizeCanonicalAssignmentResult,
  canonicalAssignmentPlacedVendors,
  isMissingAuthorityError,
} from '../../../lib/marketplace/canonicalAssignmentContract.ts';

const LEAD = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const REPLACEMENT = '33333333-3333-4333-8333-333333333333';
const V1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const V2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const V3 = 'aaaaaaaa-0000-4000-8000-000000000003';

/** A minimal valid automatic request. Individual tests override one field. */
function autoRequest(overrides = {}) {
  return {
    leadId: LEAD,
    mode: 'automatic',
    candidateVendorIds: [V1, V2],
    operationScope: 'auto_match',
    actorKind: 'system',
    actorId: null,
    reasonCode: 'automatic_match',
    ...overrides,
  };
}

function validRequest(overrides = {}) {
  const res = validateCanonicalAssignmentRequest(autoRequest(overrides));
  assertTrue(res.ok, `expected a valid request, got ${res.ok ? '' : res.code}`);
  return res.request;
}

export const suite = {
  id: 'assignment-authority',
  title: 'QF-MVP-20.3R1 Canonical Assignment Authority (deterministic, offline)',
  cases: [
    // --- Contract identity -------------------------------------------------
    {
      name: 'the sole authority is qf_assign_lead_vendors_v2',
      run: () => {
        assertEqual(CANONICAL_ASSIGNMENT_RPC, 'qf_assign_lead_vendors_v2', 'canonical RPC name');
      },
    },
    {
      name: 'mode and actor vocabularies match the migration exactly',
      run: () => {
        assertDeepEqual(
          [...CANONICAL_ASSIGNMENT_MODES],
          ['automatic', 'client_selected', 'admin_manual', 'delayed_fill', 'replacement', 'recovery_replay'],
          'assignment modes',
        );
        assertDeepEqual([...CANONICAL_ACTOR_KINDS], ['system', 'client', 'admin', 'worker'], 'actor kinds');
      },
    },
    {
      name: 'locked caps and credit cost are 3 active / 6 lifetime / cost 1',
      run: () => {
        assertEqual(CANONICAL_ACTIVE_ASSIGNMENT_CAP, 3, 'active cap');
        assertEqual(CANONICAL_LIFETIME_ASSIGNMENT_CAP, 6, 'lifetime cap');
        assertEqual(CANONICAL_ASSIGNMENT_CREDIT_COST, 1, 'credit cost');
      },
    },
    {
      name: 'a validated request carries NO caller-controlled ceiling or cost',
      run: () => {
        const request = validRequest();
        const keys = Object.keys(request).sort();
        assertDeepEqual(
          keys,
          ['actorId', 'actorKind', 'candidateVendorIds', 'leadId', 'mode', 'operationKey', 'reasonCode', 'replacementRequestId'],
          'normalized request fields',
        );
        for (const forbidden of ['limit', 'totalLimit', 'p_total_limit', 'creditCost', 'allowDuplicate', 'maxVendors']) {
          assertFalse(forbidden in request, `request must not carry ${forbidden}`);
        }
      },
    },

    // --- R1_BLOCKED_PENDING_OWNER_BINDING ----------------------------------
    {
      name: 'client_selected is fail-closed with R1_BLOCKED_PENDING_OWNER_BINDING',
      run: () => {
        const res = validateCanonicalAssignmentRequest(autoRequest({ mode: 'client_selected', actorKind: 'client', actorId: ADMIN }));
        assertFalse(res.ok, 'client_selected must never validate');
        assertEqual(res.code, R1_BLOCKED_PENDING_OWNER_BINDING, 'block code');
        assertFalse('request' in res, 'a blocked request must produce no operation key');
        assert(/ownership/i.test(res.error), 'the block must state the missing ownership prerequisite');
      },
    },
    {
      name: 'client_selected is blocked even when every other field is valid',
      run: () => {
        // Deliberately the most "assignable-looking" client request possible.
        const res = validateCanonicalAssignmentRequest({
          leadId: LEAD,
          mode: 'client_selected',
          candidateVendorIds: [V1],
          operationScope: 'client_pick',
          actorKind: 'client',
          actorId: ADMIN,
          reasonCode: 'client_selected_vendor',
        });
        assertFalse(res.ok, 'still blocked');
        assertEqual(res.code, R1_BLOCKED_PENDING_OWNER_BINDING, 'block code');
      },
    },

    // --- Argument rules (mirror of the authority's own step 0/1) -----------
    {
      name: 'an unknown mode or actor kind is rejected before any call',
      run: () => {
        assertEqual(validateCanonicalAssignmentRequest(autoRequest({ mode: 'sneaky' })).code, CANONICAL_ASSIGNMENT_INVALID_REQUEST, 'bad mode');
        assertEqual(validateCanonicalAssignmentRequest(autoRequest({ actorKind: 'root' })).code, CANONICAL_ASSIGNMENT_INVALID_REQUEST, 'bad actor');
        assertEqual(validateCanonicalAssignmentRequest(autoRequest({ leadId: 'not-a-uuid' })).code, CANONICAL_ASSIGNMENT_INVALID_REQUEST, 'bad lead id');
      },
    },
    {
      name: 'system and worker actors must not carry an actor id',
      run: () => {
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ actorKind: 'system', actorId: ADMIN })).ok, 'system + id');
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ actorKind: 'worker', actorId: ADMIN })).ok, 'worker + id');
        assertTrue(validateCanonicalAssignmentRequest(autoRequest({ actorKind: 'worker', actorId: null })).ok, 'worker + null');
      },
    },
    {
      name: 'admin actors require a real actor id',
      run: () => {
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ actorKind: 'admin', actorId: null })).ok, 'admin without id');
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ actorKind: 'admin', actorId: '   ' })).ok, 'admin with blank id');
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ actorKind: 'admin', actorId: 'admin-1' })).ok, 'admin with non-uuid id');
        assertTrue(validateCanonicalAssignmentRequest(autoRequest({ mode: 'admin_manual', actorKind: 'admin', actorId: ADMIN })).ok, 'admin with uuid');
      },
    },
    {
      name: 'replacement mode and the replacement reference imply each other',
      run: () => {
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ mode: 'replacement' })).ok, 'replacement without ref');
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ replacementRequestId: REPLACEMENT })).ok, 'ref without replacement mode');
        assertTrue(
          validateCanonicalAssignmentRequest(autoRequest({ mode: 'replacement', replacementRequestId: REPLACEMENT })).ok,
          'replacement with ref',
        );
      },
    },
    {
      name: 'the candidate pool is bounded and must be non-empty',
      run: () => {
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ candidateVendorIds: [] })).ok, 'empty pool');
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ candidateVendorIds: ['x', ''] })).ok, 'no valid ids');
        const tooMany = Array.from({ length: MAX_CANONICAL_CANDIDATE_POOL + 1 }, (_, i) =>
          `aaaaaaaa-0000-4000-8000-${String(i + 100).padStart(12, '0')}`);
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ candidateVendorIds: tooMany })).ok, 'oversized pool');
      },
    },
    {
      name: 'a deterministic operation scope is mandatory',
      run: () => {
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ operationScope: '' })).ok, 'empty scope');
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ operationScope: '   ' })).ok, 'blank scope');
        assertFalse(validateCanonicalAssignmentRequest(autoRequest({ operationScope: '!!!' })).ok, 'scope with no usable characters');
      },
    },

    // --- Candidate normalization -------------------------------------------
    {
      name: 'candidate ids are lowercased, de-duplicated and rank-order preserved',
      run: () => {
        assertDeepEqual(
          normalizeCandidateVendorIds([V2.toUpperCase(), ` ${V1} `, V2, 'nope', '', null, 42]),
          [V2, V1],
          'normalized candidates',
        );
        assertTrue(isCanonicalUuid(V1), 'uuid accepted');
        assertFalse(isCanonicalUuid('aaaaaaaa-0000-4000-8000-00000000000'), 'short uuid rejected');
      },
    },
    {
      name: 'operation scope normalization is stable and collapses separators',
      run: () => {
        assertEqual(normalizeOperationScope(' Admin Manual:Recovery '), 'admin-manual:recovery', 'normalized scope');
        assertEqual(normalizeOperationScope('a///b'), 'a-b', 'collapsed separators');
        assertEqual(normalizeOperationScope('---'), '', 'no usable characters');
      },
    },

    // --- Operation-key determinism (safe replay) ---------------------------
    {
      name: 'the same logical operation always produces the same operation key',
      run: () => {
        assertEqual(validRequest().operationKey, validRequest().operationKey, 'stable across calls');
      },
    },
    {
      name: 'candidate ORDER does not change the key (ranking is not authority)',
      run: () => {
        const a = validRequest({ candidateVendorIds: [V1, V2, V3] });
        const b = validRequest({ candidateVendorIds: [V3, V1, V2] });
        assertEqual(a.operationKey, b.operationKey, 'order-independent key');
        // ...but the ranking preference still reaches the authority intact.
        assertDeepEqual(a.candidateVendorIds, [V1, V2, V3], 'rank order preserved for A');
        assertDeepEqual(b.candidateVendorIds, [V3, V1, V2], 'rank order preserved for B');
      },
    },
    {
      name: 'a materially different operation produces a different key',
      run: () => {
        const base = validRequest().operationKey;
        const variants = [
          validRequest({ candidateVendorIds: [V1, V3] }).operationKey,
          validRequest({ operationScope: 'auto_match_retry' }).operationKey,
          validRequest({ reasonCode: 'something_else' }).operationKey,
          validRequest({ mode: 'delayed_fill', actorKind: 'worker' }).operationKey,
          validRequest({ mode: 'admin_manual', actorKind: 'admin', actorId: ADMIN }).operationKey,
        ];
        for (const variant of variants) {
          assert(variant !== base, `expected a distinct key, got the base key again: ${variant}`);
        }
        assertEqual(new Set(variants).size, variants.length, 'every variant key is distinct');
      },
    },
    {
      name: 'the operation key never embeds a clock, a random value or a cost',
      run: () => {
        const key = validRequest().operationKey;
        assert(key.startsWith('qf20r1:v1:'), `unexpected key shape: ${key}`);
        assert(key.includes(LEAD), 'key must identify the lead');
        assertFalse(/\d{13}/.test(key), 'key must not embed a millisecond timestamp');
        // Rebuilding it from the same parts must reproduce it byte for byte.
        assertEqual(
          buildAssignmentOperationKey({
            leadId: LEAD,
            mode: 'automatic',
            actorKind: 'system',
            actorId: null,
            replacementRequestId: null,
            reasonCode: 'automatic_match',
            operationScope: 'auto_match',
            candidateVendorIds: [V2, V1],
          }),
          key,
          'reproducible key',
        );
      },
    },

    // --- Result normalization: degrade to REJECTED, never to success -------
    {
      name: 'an applied result is normalized with assignments and intents',
      run: () => {
        const request = validRequest();
        const out = normalizeCanonicalAssignmentResult(
          {
            operation_id: REPLACEMENT,
            status: 'applied',
            lead_id: LEAD,
            assigned: [{ assignment_id: 'a1', vendor_id: V1, credit_ledger_id: 'l1' }],
            skipped: [],
            active_count_after: 1,
            lifetime_count_after: 1,
            communication_intent_ids: ['i1'],
          },
          request,
        );
        assertEqual(out.status, 'applied', 'status');
        assertEqual(out.reason_code, null, 'no reason on success');
        assertDeepEqual(out.assigned_vendor_ids, [V1], 'assigned vendor ids');
        assertDeepEqual(out.communication_intent_ids, ['i1'], 'intent ids');
        assertEqual(out.operation_key, request.operationKey, 'echoes the operation key');
        assertFalse(out.already_applied, 'not a replay');
        assertTrue(canonicalAssignmentPlacedVendors(out), 'placed vendors');
      },
    },
    {
      name: 'a partial result reports both the placements and the skip reasons',
      run: () => {
        const out = normalizeCanonicalAssignmentResult(
          {
            status: 'partial',
            assigned: [{ assignment_id: 'a1', vendor_id: V1 }],
            skipped: [
              { vendor_id: V2, reason_code: 'insufficient_credits' },
              { vendor_id: V3, reason_code: 'lifetime_limit_reached' },
            ],
          },
          validRequest(),
        );
        assertEqual(out.status, 'partial', 'status');
        assertDeepEqual(out.skipped_vendor_ids, [V2, V3], 'skipped vendor ids');
        assertEqual(out.skipped[1].reason_code, 'lifetime_limit_reached', 'lifetime cap is reported, never silently raised');
        assertEqual(out.assigned[0].credit_ledger_id, null, 'a missing ledger id is null, never invented');
      },
    },
    {
      name: 'a whole-operation rejection surfaces its top-level reason',
      run: () => {
        const out = normalizeCanonicalAssignmentResult(
          { status: 'rejected', reason_code: 'active_limit_reached', assigned: [], skipped: [], active_count_after: 3 },
          validRequest(),
        );
        assertEqual(out.status, 'rejected', 'status');
        assertEqual(out.reason_code, 'active_limit_reached', 'the active-3 cap is reported');
        assertFalse(canonicalAssignmentPlacedVendors(out), 'nothing placed');
      },
    },
    {
      name: 'a per-vendor-only rejection falls back to the first skip reason',
      run: () => {
        const out = normalizeCanonicalAssignmentResult(
          { status: 'rejected', assigned: [], skipped: [{ vendor_id: V1, reason_code: 'duplicate_assignment' }] },
          validRequest(),
        );
        assertEqual(out.reason_code, 'duplicate_assignment', 'derived reason');
      },
    },
    {
      name: 'a replay is reported as already_applied',
      run: () => {
        const out = normalizeCanonicalAssignmentResult(
          { status: 'already_applied', already_applied: true, operation_id: REPLACEMENT, assigned: [{ assignment_id: 'a1', vendor_id: V1 }] },
          validRequest(),
        );
        assertEqual(out.status, 'already_applied', 'status');
        assertTrue(out.already_applied, 'already_applied flag');
        assertEqual(out.operation_id, REPLACEMENT, 'operation id preserved for audit');
      },
    },
    {
      name: 'an unknown, empty or malformed payload degrades to REJECTED, never to success',
      run: () => {
        const request = validRequest();
        for (const payload of [null, undefined, {}, 'applied', [], { status: 'ok' }, { status: 'assigned' }, { status: 42 }]) {
          const out = normalizeCanonicalAssignmentResult(payload, request);
          assertEqual(out.status, 'rejected', `payload ${JSON.stringify(payload) ?? 'undefined'} must read as rejected`);
          assertDeepEqual(out.assigned, [], 'no assignments invented');
          assertFalse(out.already_applied, 'no replay invented');
          assertEqual(out.lead_id, request.leadId, 'lead id falls back to the request');
        }
      },
    },
    {
      name: 'malformed assignment and skip rows are dropped, not guessed',
      run: () => {
        const out = normalizeCanonicalAssignmentResult(
          {
            status: 'applied',
            assigned: [{ vendor_id: V1 }, { assignment_id: 'a2' }, null, 'x', { assignment_id: 'a3', vendor_id: V3 }],
            skipped: [{ reason_code: 'vendor_not_eligible' }, { vendor_id: V2 }],
          },
          validRequest(),
        );
        assertDeepEqual(out.assigned_vendor_ids, [V3], 'only the complete assignment row survives');
        assertDeepEqual(out.skipped_vendor_ids, [V2], 'only the identifiable skip row survives');
        assertEqual(out.skipped[0].reason_code, 'rejected', 'a missing skip reason degrades to rejected');
      },
    },

    // --- Missing-authority detection (fail closed, never fall back) --------
    {
      name: 'a missing authority is detected from the Postgres and PostgREST codes',
      run: () => {
        assertTrue(isMissingAuthorityError({ code: '42883' }), 'undefined_function');
        assertTrue(isMissingAuthorityError({ code: 'PGRST202' }), 'not in schema cache');
        assertTrue(
          isMissingAuthorityError({ message: 'Could not find the function public.qf_assign_lead_vendors_v2 in the schema cache' }),
          'message form',
        );
        assertFalse(isMissingAuthorityError({ code: '23505', message: 'duplicate key' }), 'a real conflict is not a missing authority');
        assertFalse(isMissingAuthorityError(null), 'no error');
      },
    },
  ],
};

export default suite;
