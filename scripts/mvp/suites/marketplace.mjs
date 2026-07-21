// ============================================================================
// QF-MVP-00 — MVP Marketplace Core suite (safe, non-mutating, offline).
//
// Every test below imports a REAL production module (never a copy) and asserts on
// its actual behaviour. All imported modules are pure and dependency-free — no
// Supabase, no network, no Git, no mutation, no clock dependence.
//
// Launch-critical behaviour covered here:
//   - lead distribution / assignment limits (3-vendor cap)
//   - vendor eligibility fundamentals
//   - package/credit fundamentals (credit cost + credits >= cost gate)
//   - replacement rule + restoration-needs-approval invariant
//   - deterministic category matching (no AI ranking)
//   - deterministic no-side-effect boundary (no AI / WhatsApp / n8n / db-write)
//
// Coverage gaps that need a live DB seam (recorded FOCUSED_TEST_REQUIRED in
// docs/QF-MVP-00-BASELINE.md): assignment idempotency, credit-deduction
// idempotency, the 6-vendor lifetime cap, replacement concurrency-safety.
// ============================================================================

import { assert, assertEqual, assertTrue, assertFalse } from '../lib/harness.mjs';

import { assignmentRules, isAssignmentPreviewWithinLimit } from '../../../lib/aos/rules/assignmentRules.ts';
import {
  MAX_DISTRIBUTION_VENDORS,
  CLIENT_SELECTED_ASSIGNMENT_INTENT,
  LeadDistributionRoute,
} from '../../../lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.ts';
import {
  LEAD_CREDIT_COST,
  evaluateVendorAutomaticLeadEligibility,
  normalizeAcceptingLeads,
} from '../../../lib/vendors/vendorAutomaticEligibility.ts';
import { vendorRules, canVendorReceiveLeadPreview } from '../../../lib/aos/rules/vendorRules.ts';
import { leadRules, isLeadFoundationEligible } from '../../../lib/aos/rules/leadRules.ts';
import { replacementRules, buildReplacementReason } from '../../../lib/aos/rules/replacementRules.ts';
import { pricingRules } from '../../../lib/aos/rules/pricingRules.ts';
import { securityRules, isBlockedSideEffect } from '../../../lib/aos/rules/securityRules.ts';
import {
  normalizeCategory,
  isLeadVendorCategoryCompatible,
  verifyCategoryMatchingSmokeCases,
  CATEGORY_MATCHING_SMOKE_CASES,
} from '../../../lib/vendors/categoryMatching.ts';

const APPROVED = { status: 'Approved', is_active: true, accepting_leads: true, remaining_credits: 5 };

export const suite = {
  id: 'marketplace',
  title: 'MVP Marketplace Core (deterministic, offline)',
  cases: [
    // --- Lead distribution / assignment limits ---------------------------
    {
      name: 'assignment cap is 3 vendors per lead; auto-assign & paid-priority off',
      run: () => {
        assertEqual(assignmentRules.maxVendorsPerLead, 3, 'maxVendorsPerLead');
        assertEqual(assignmentRules.clientSelectedVendorLimit, 3, 'clientSelectedVendorLimit');
        assertEqual(assignmentRules.autoAssignEnabled, false, 'autoAssignEnabled');
        assertEqual(assignmentRules.paidVendorPriorityEnabled, false, 'paidVendorPriorityEnabled (no AI/paid ranking)');
      },
    },
    {
      name: 'assignment preview is within limit at 0..3 and rejected at 4',
      run: () => {
        assertTrue(isAssignmentPreviewWithinLimit([]), 'empty within limit');
        assertTrue(isAssignmentPreviewWithinLimit(['a', 'b', 'c']), '3 within limit');
        assertFalse(isAssignmentPreviewWithinLimit(['a', 'b', 'c', 'd']), '4 exceeds limit');
      },
    },
    {
      name: 'standard distribution recommends at most 3; client-selected route is isolated',
      run: () => {
        assertEqual(MAX_DISTRIBUTION_VENDORS, 3, 'MAX_DISTRIBUTION_VENDORS');
        assertEqual(CLIENT_SELECTED_ASSIGNMENT_INTENT, 'client_selected_vendor', 'client-selected intent literal');
        assertEqual(LeadDistributionRoute.STANDARD, 'standard_route', 'standard route');
        assertEqual(LeadDistributionRoute.CLIENT_SELECTED, 'client_selected_route', 'client-selected route');
      },
    },

    // --- Vendor eligibility fundamentals + credits -----------------------
    {
      name: 'fully-qualified vendor is eligible with empty reasons; credit cost is 1',
      run: () => {
        assertEqual(LEAD_CREDIT_COST, 1, 'LEAD_CREDIT_COST');
        const res = evaluateVendorAutomaticLeadEligibility(APPROVED);
        assertTrue(res.eligible, 'approved+active+accepting+credits should be eligible');
        assertEqual(res.reasons.length, 0, 'no reasons');
        assertEqual(res.creditCost, 1, 'default credit cost');
      },
    },
    {
      name: 'suspended vendor is ineligible for the right reason',
      run: () => {
        const res = evaluateVendorAutomaticLeadEligibility({ ...APPROVED, status: 'suspended' });
        assertFalse(res.eligible, 'suspended ineligible');
        assert(res.reasons.includes('vendor_suspended'), 'reason vendor_suspended');
      },
    },
    {
      name: 'pending vendor is ineligible (vendor_not_approved)',
      run: () => {
        const res = evaluateVendorAutomaticLeadEligibility({ ...APPROVED, status: 'pending' });
        assertFalse(res.eligible, 'pending ineligible');
        assert(res.reasons.includes('vendor_not_approved'), 'reason vendor_not_approved');
      },
    },
    {
      name: 'inactive / not-accepting / zero-credit vendors are each ineligible',
      run: () => {
        assert(
          evaluateVendorAutomaticLeadEligibility({ ...APPROVED, is_active: false }).reasons.includes('vendor_inactive'),
          'reason vendor_inactive',
        );
        assert(
          evaluateVendorAutomaticLeadEligibility({ ...APPROVED, accepting_leads: false }).reasons.includes(
            'not_accepting_leads',
          ),
          'reason not_accepting_leads',
        );
        const noCredit = evaluateVendorAutomaticLeadEligibility({ ...APPROVED, remaining_credits: 0 });
        assert(noCredit.reasons.includes('no_credits'), 'reason no_credits');
        assertEqual(noCredit.credits, 0, 'credits normalized to 0');
      },
    },
    {
      name: 'credit cost option is honoured (credits < cost => no_credits)',
      run: () => {
        const res = evaluateVendorAutomaticLeadEligibility({ ...APPROVED, remaining_credits: 2 }, { creditCost: 5 });
        assertEqual(res.creditCost, 5, 'custom credit cost');
        assert(res.reasons.includes('no_credits'), '2 credits < cost 5 => no_credits');
      },
    },
    {
      name: 'accepting_leads defaults to true when the column is absent/null',
      run: () => {
        assertTrue(normalizeAcceptingLeads({}), 'absent => true (never silently stop delivery)');
        assertTrue(normalizeAcceptingLeads(null), 'null row => true');
        assertFalse(normalizeAcceptingLeads({ accepting_leads: false }), 'explicit false => false');
      },
    },
    {
      name: 'preview eligibility predicate mirrors approved+active+credits>0',
      run: () => {
        assertTrue(canVendorReceiveLeadPreview({ status: 'Approved', isActive: true, remainingCredits: 1 }), 'happy path');
        assertFalse(canVendorReceiveLeadPreview({ status: 'Approved', isActive: true, remainingCredits: 0 }), 'no credits');
        assertFalse(canVendorReceiveLeadPreview({ status: 'Pending', isActive: true, remainingCredits: 5 }), 'not approved');
        assertFalse(canVendorReceiveLeadPreview({ status: 'Approved', isActive: false, remainingCredits: 5 }), 'inactive');
        assertEqual(vendorRules.disabledVendorsReceiveLeads, false, 'disabled vendors never receive leads');
        assertEqual(vendorRules.pendingVendorsReceiveLeads, false, 'pending vendors never receive leads');
      },
    },

    // --- Lead foundation eligibility -------------------------------------
    {
      name: 'lead foundation requires name+phone+city+service (non-blank)',
      run: () => {
        assertTrue(
          isLeadFoundationEligible({ name: 'Asha', phone: '98765', city: 'Pune', service: 'Carpentry' }),
          'complete lead eligible',
        );
        assertFalse(isLeadFoundationEligible({ name: 'Asha', phone: '98765', city: 'Pune' }), 'missing service');
        assertFalse(
          isLeadFoundationEligible({ name: '   ', phone: '98765', city: 'Pune', service: 'Carpentry' }),
          'blank name rejected',
        );
        assertEqual(leadRules.maxMatchedVendors, 3, 'maxMatchedVendors');
      },
    },

    // --- Replacement + restoration invariants ----------------------------
    {
      name: 'replacement reason trims, falls back, and requires admin approval',
      run: () => {
        assertEqual(buildReplacementReason('   '), 'Invalid lead replacement requested.', 'blank => default reason');
        assertEqual(buildReplacementReason('  duplicate submission '), 'duplicate submission', 'trimmed reason');
        assertEqual(replacementRules.requiresAdminApproval, true, 'requiresAdminApproval');
        assertEqual(replacementRules.autoCreditRestoreEnabled, false, 'credit restore is NOT automatic (needs approval)');
      },
    },
    {
      name: 'pricing policy: invalid leads get replacement, never refund',
      run: () => {
        assertEqual(pricingRules.refundsForInvalidLeads, false, 'no refunds for invalid leads');
        assertEqual(pricingRules.replacementsForInvalidLeads, true, 'replacements for invalid leads');
      },
    },

    // --- Deterministic category matching (no AI ranking) -----------------
    {
      name: 'category smoke cases are all compatible (deterministic matcher)',
      run: () => {
        const results = verifyCategoryMatchingSmokeCases();
        assertEqual(results.length, CATEGORY_MATCHING_SMOKE_CASES.length, 'one result per smoke case');
        assertTrue(results.every((r) => r.compatible), 'every canonical smoke case compatible');
      },
    },
    {
      name: 'category matcher accepts a synonym match and rejects an empty vendor category set',
      run: () => {
        assertTrue(
          isLeadVendorCategoryCompatible({ service_required: 'Carpentry' }, { service_categories: ['Carpenters'] })
            .compatible,
          'Carpentry ~ Carpenters',
        );
        assertFalse(
          isLeadVendorCategoryCompatible({ service_required: 'Carpentry' }, { service_categories: [] }).compatible,
          'no vendor categories => not compatible',
        );
        assertEqual(normalizeCategory('Kitchen & Bath'), 'kitchen and bath', 'ampersand + case fold');
        assertEqual(normalizeCategory('  Modular   Kitchen '), 'modular kitchen', 'trim + collapse whitespace');
        assertEqual(normalizeCategory(42), '', 'non-string => empty');
      },
    },

    // --- Deterministic no-side-effect boundary ---------------------------
    {
      name: 'security rules block AI / WhatsApp / n8n / db-write side effects',
      run: () => {
        assertTrue(isBlockedSideEffect('ai'), 'ai blocked');
        assertTrue(isBlockedSideEffect('whatsapp'), 'whatsapp blocked');
        assertTrue(isBlockedSideEffect('n8n'), 'n8n blocked');
        assertTrue(isBlockedSideEffect('db-write'), 'db-write blocked');
        assertFalse(isBlockedSideEffect('read'), 'read allowed');
        assertEqual(securityRules.serviceRoleClientSideAllowed, false, 'no service-role on client');
        assertEqual(securityRules.aiApiCallsAllowed, false, 'no AI api calls');
        assertEqual(securityRules.n8nCallsAllowed, false, 'no direct n8n calls');
      },
    },
  ],
};

export default suite;
