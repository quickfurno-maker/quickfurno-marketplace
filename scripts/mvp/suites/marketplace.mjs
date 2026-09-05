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
import { categoryArtwork, categoriesWithArtwork } from '../../../components/public-listing/categoryArtwork.ts';
import { existsSync, readFileSync } from 'node:fs';

import {
  formatServiceLabels,
  BUDGET_MIN_PLACEHOLDER,
  BUDGET_MAX_PLACEHOLDER,
  DISCARD_CONFIRM_TITLE,
  DISCARD_CONFIRM_BODY,
} from '../../../components/client-enquiry/enquiryDisplay.ts';

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
  toProfileView,
  safePublicImageUrl,
  profileSections,
  profileQuickFacts,
} from '../../../components/public-vendor/profileModel.ts';

import {
  toListingView,
  hasRealStartingPrice,
  formatStartingPrice,
  matchesListingFilters,
  selectListingVendors,
  resultCountLabel,
  emptyListingFilters,
} from '../../../components/public-listing/listingModel.ts';

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

    // --- QF-UI-V2-06: public listing display model (truthfulness) ---------
    {
      name: 'listing view drops defaulted rating / reviews / response / experience',
      run: () => {
        // Shape a real Supabase-mapped vendor: mapToPublicVendor() defaults
        // rating to 4.2, reviews to 0, responseTime to "Quick response expected"
        // and experience to "Verified Team" when the columns are null.
        const view = toListingView({
          slug: 'v-1', businessName: 'Shree Balaji Interiors', city: 'Pune',
          category: 'Interior Designers', subCategory: 'Interior Designers',
          rating: 4.2, reviews: 0, rate: 'Price on request',
          experience: 'Verified Team', responseTime: 'Quick response expected',
          activePaidPlan: true, verified: true, description: 'Local team.',
          imageTone: 'warm-suite', source: 'supabase',
        });
        const keys = Object.keys(view);
        for (const banned of ['rating', 'reviews', 'responseTime', 'experience',
                              'warranty', 'distance', 'openStatus', 'ratingLabel']) {
          assertFalse(keys.includes(banned), `view must not expose ${banned}`);
        }
        assertEqual(JSON.stringify(view).includes('4.2'), false, 'no defaulted 4.2 rating anywhere');
        assertEqual(JSON.stringify(view).includes('Quick response expected'), false, 'no invented response text');
        assertEqual(view.startingPrice, null, '"Price on request" is not a real price');
        assertEqual(view.portfolioCount, 0, 'no stock imagery counted as vendor photos');
      },
    },
    {
      name: 'listing view never exposes private vendor contact fields',
      run: () => {
        const view = toListingView({
          slug: 'v-2', businessName: 'Test Vendor', city: 'Mumbai',
          category: 'Carpenters', subCategory: 'Carpenters', rating: 0, reviews: 0,
          rate: '1200', experience: '', responseTime: '', activePaidPlan: false,
          verified: true, description: 'd', imageTone: 't',
          portfolioImages: ['/a.png', '/b.png'], serviceAreaSummary: 'Andheri, Bandra',
          businessHours: 'Mon-Sat 10am-7pm', serviceCategories: ['Carpenters'],
        });
        const serialized = JSON.stringify(view).toLowerCase();
        for (const banned of ['phone', 'whatsapp', 'email', 'user_id', 'gst', 'address']) {
          assertFalse(serialized.includes(banned), `must not serialize ${banned}`);
        }
        assertEqual(view.startingPrice, '₹1200', 'real numeric price is kept and prefixed');
        assertEqual(view.portfolioCount, 2, 'counts the vendor own uploads');
        assertEqual(view.serviceArea, 'Andheri, Bandra', 'real service area kept');
        assertEqual(view.activePaidPlan, false, 'contact authority flag carried through untouched');
        assertEqual(view.initials, 'TV', 'initials avatar fallback');
      },
    },
    {
      name: 'only real listed prices count as a price',
      run: () => {
        assertTrue(hasRealStartingPrice('1200'), 'numeric is real');
        assertTrue(hasRealStartingPrice('₹ 1,200 per sq ft'), 'formatted numeric is real');
        assertFalse(hasRealStartingPrice('Price on request'), 'placeholder is not a price');
        assertFalse(hasRealStartingPrice(''), 'empty is not a price');
        assertFalse(hasRealStartingPrice(null), 'null is not a price');
        assertEqual(formatStartingPrice('Price on request'), null, 'placeholder formats to null');
      },
    },
    {
      name: 'listing filters use only real facts and the count matches the rows',
      run: () => {
        const base = {
          rating: 0, reviews: 0, experience: '', responseTime: '', verified: true,
          description: 'd', imageTone: 't', subCategory: 'Carpenters', activePaidPlan: true,
        };
        const vendors = [
          { ...base, slug: 'a', businessName: 'Alpha Woodworks', city: 'Pune',
            category: 'Carpenters', rate: '900', portfolioImages: ['/x.png'] },
          { ...base, slug: 'b', businessName: 'Beta Interiors', city: 'Mumbai',
            category: 'Carpenters', rate: 'Price on request', portfolioImages: [] },
        ];
        const all = selectListingVendors(vendors, emptyListingFilters, 'recommended');
        assertEqual(all.length, 2, 'no filter => both');
        assertEqual(resultCountLabel(all.length), '2 vendors', 'plural count label');
        assertEqual(resultCountLabel(1), '1 vendor', 'singular count label');

        const pune = selectListingVendors(vendors, { ...emptyListingFilters, city: 'Pune' }, 'recommended');
        assertEqual(pune.length, 1, 'city filter uses the real city column');
        assertEqual(pune[0].businessName, 'Alpha Woodworks', 'correct vendor kept');

        const priced = selectListingVendors(vendors, { ...emptyListingFilters, hasPrice: true }, 'recommended');
        assertEqual(priced.length, 1, 'price filter keeps only a real listed price');

        const photos = selectListingVendors(vendors, { ...emptyListingFilters, hasPhotos: true }, 'recommended');
        assertEqual(photos.length, 1, 'photo filter uses the vendor own uploads');

        const named = selectListingVendors(vendors, emptyListingFilters, 'name');
        assertEqual(named[0].businessName, 'Alpha Woodworks', 'A-Z sort');

        const searched = selectListingVendors(vendors, { ...emptyListingFilters, query: 'beta' }, 'recommended');
        assertEqual(searched.length, 1, 'search matches the business name');
        assertFalse(
          matchesListingFilters(all[0], { ...emptyListingFilters, query: 'zzz-no-match' }),
          'non-matching query excludes the row',
        );
      },
    },

    // --- QF-UI-V2-07: public vendor profile truth model --------------------
    {
      name: 'profile view drops defaulted rating / reviews / experience / response',
      run: () => {
        const view = toProfileView({
          slug: 'v-1', businessName: 'Shree Balaji Interiors', city: 'Pune',
          category: 'Interior Designers', subCategory: 'Interior Designers',
          rate: 'Price on request', description: 'Local interior team.',
          verified: true, activePaidPlan: true, source: 'supabase',
        });
        const keys = Object.keys(view);
        const banned = ['rating', 'reviews', 'responseTime', 'experience',
                        'distance', 'openStatus', 'premium', 'warranty'];
        for (const key of banned) {
          assertFalse(keys.includes(key), 'profile view must not expose ' + key);
        }
        const blob = JSON.stringify(view);
        assertFalse(blob.includes('4.2'), 'no defaulted rating');
        assertFalse(blob.includes('Quick response expected'), 'no invented response text');
        assertFalse(blob.includes('Verified Team'), 'no defaulted experience string');
        assertFalse(blob.includes('Mon - Sun'), 'no invented business hours');
        for (const locality of ['Baner', 'Wakad', 'Andheri', 'Thane']) {
          assertFalse(blob.includes(locality), 'no invented service area ' + locality);
        }
        assertEqual(view.hasBusinessHours, false, 'absent hours stay absent');
        assertEqual(view.hasServiceArea, false, 'absent service area stays absent');
        assertEqual(view.startingPrice, null, 'price on request is not a price');
        assertEqual(view.hasPortfolio, false, 'no portfolio');
      },
    },
    {
      name: 'profile view exposes only published facts and no private contact fields',
      run: () => {
        const view = toProfileView({
          slug: 'v-2', businessName: 'Aarav Furniture Works', city: 'Mumbai',
          category: 'Carpenters', rate: '1250', description: 'Custom furniture.',
          verified: true, activePaidPlan: false, source: 'supabase',
          serviceCategories: ['Carpenters', 'Modular Factory'],
          serviceAreaSummary: 'Andheri, Powai', businessHours: 'Mon-Sat, 10am-7pm',
          portfolioImages: ['/a.png', 'https://cdn.example.com/b.jpg'],
        });
        const blob = JSON.stringify(view).toLowerCase();
        for (const key of ['phone', 'whatsapp', 'email', 'user_id', 'gst', 'address']) {
          assertFalse(blob.includes(key), 'must not serialize ' + key);
        }
        assertEqual(view.startingPrice, '₹1250', 'real price kept');
        assertEqual(view.serviceAreas.length, 2, 'service areas split faithfully');
        assertEqual(view.serviceAreas[0], 'Andheri', 'first area');
        assertEqual(view.portfolio.length, 2, 'local and approved external photos kept');
        assertEqual(view.activePaidPlan, false, 'action-authority flag carried through');
        assertEqual(view.initials, 'AF', 'initials fallback');
      },
    },
    {
      name: 'profile media accepts approved local and http(s) urls, rejects unsafe schemes',
      run: () => {
        assertEqual(safePublicImageUrl('/uploads/a.png'), '/uploads/a.png', 'local path kept');
        assertEqual(safePublicImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg', 'https kept');
        assertEqual(safePublicImageUrl('http://cdn.example.com/a.jpg'), 'http://cdn.example.com/a.jpg', 'http kept');
        assertEqual(safePublicImageUrl('javascript:alert(1)'), null, 'javascript scheme rejected');
        assertEqual(safePublicImageUrl('JavaScript:alert(1)'), null, 'mixed-case javascript rejected');
        assertEqual(safePublicImageUrl('data:text/html;base64,xxx'), null, 'data scheme rejected');
        assertEqual(safePublicImageUrl('//evil.example.com/a.jpg'), null, 'protocol-relative rejected');
        assertEqual(safePublicImageUrl(''), null, 'empty rejected');
        assertEqual(safePublicImageUrl(null), null, 'null rejected');
        const view = toProfileView({
          slug: 'v-3', businessName: 'X Y', city: 'Pune', category: 'Painter',
          description: 'd', portfolioImages: ['javascript:alert(1)', '/ok.png', '//evil.com/x.png'],
          imageUrl: 'javascript:alert(1)', coverImageUrl: 'https://cdn.example.com/c.jpg',
        });
        assertEqual(view.portfolio.length, 1, 'only the safe portfolio url survives');
        assertEqual(view.portfolio[0], '/ok.png', 'safe url kept');
        assertEqual(view.profileImage, null, 'unsafe profile image dropped');
        assertEqual(view.coverImage, 'https://cdn.example.com/c.jpg', 'approved external cover kept');
      },
    },
    {
      name: 'profile sections and quick facts hide what is not published',
      run: () => {
        const sparse = toProfileView({
          slug: 'v-4', businessName: 'Nova Interiors', city: 'Pune',
          category: 'Carpenters', rate: 'Price on request', description: 'd',
        });
        assertEqual(profileSections(sparse).map((x) => x.id).join(','), 'overview',
          'sparse profile shows only Overview');
        assertEqual(profileQuickFacts(sparse).length, 0, 'no invented quick facts');

        const rich = toProfileView({
          slug: 'v-5', businessName: 'Balaji', city: 'Pune', category: 'Carpenters',
          rate: '900', description: 'd', serviceCategories: ['Carpenters'],
          serviceAreaSummary: 'Kharadi', businessHours: 'Mon-Sat',
          portfolioImages: ['/a.png', '/b.png'],
        });
        assertEqual(profileSections(rich).map((x) => x.id).join(','),
          'overview,services,portfolio,details', 'rich profile shows all four');
        const facts = profileQuickFacts(rich);
        assertTrue(facts.length > 0 && facts.length <= 4, 'between 1 and 4 quick facts');
        assertFalse(JSON.stringify(facts).includes('rating'), 'no rating fact');
      },
    },
    {
      name: 'profile falls back to a neutral description, never invented marketing',
      run: () => {
        const view = toProfileView({
          slug: 'v-6', businessName: 'Nova Interiors', city: 'Pune',
          category: 'Carpenters', description: '',
        });
        assertEqual(view.description,
          'Nova Interiors is a verified QuickFurno vendor for carpenters services in Pune.',
          'neutral factual fallback');
        for (const claim of ['best', 'fast response', 'transparent', 'premium', 'years']) {
          assertFalse(view.description.toLowerCase().includes(claim), 'no claim: ' + claim);
        }
      },
    },

    {
      name: 'listing card keeps its local-only image guard after V2-07 widened the mapper',
      run: () => {
        // QF-UI-V2-07 lets publicVendorService expose an APPROVED external
        // profile/cover URL so the profile can render it with a plain <img>.
        // The listing card renders with next/image, which has no host allowlist,
        // so toListingView must still drop anything that is not a local path.
        const external = toListingView({
          slug: 'v-x', businessName: 'External Logo Vendor', city: 'Pune',
          category: 'Carpenters', rate: '900', description: 'd',
          imageUrl: 'https://cdn.example.com/logo.png',
        });
        assertEqual(external.imageUrl, null, 'external url must not reach next/image');
        assertEqual(external.initials, 'EL', 'card falls back to initials');

        const local = toListingView({
          slug: 'v-y', businessName: 'Local Logo Vendor', city: 'Pune',
          category: 'Carpenters', rate: '900', description: 'd',
          imageUrl: '/uploads/logo.png',
        });
        assertEqual(local.imageUrl, '/uploads/logo.png', 'local path still renders');

        // The same row on the PROFILE does render the approved external URL.
        const profile = toProfileView({
          slug: 'v-x', businessName: 'External Logo Vendor', city: 'Pune',
          category: 'Carpenters', rate: '900', description: 'd',
          imageUrl: 'https://cdn.example.com/logo.png',
        });
        assertEqual(profile.profileImage, 'https://cdn.example.com/logo.png',
          'profile renders the approved external url');
      },
    },

    // --- QF-UI-V2-08: client enquiry truthfulness + layering -------------
    {
      name: 'enquiry modal shows no ungoverned subcategory rates',
      run: () => {
        const src = readFileSync('components/ClientEnquiryModal.tsx', 'utf8');
        assertFalse(src.includes('SUBCATEGORY_RATES ='), 'rate table must not be redefined');
        assertFalse(src.includes('qf-rf-tile-rate'), 'rate element must not be rendered');
        for (const rate of ['1,000/sqft', '200/sqft', '1,200/sqft']) {
          assertFalse(src.includes(rate), 'no hardcoded rate ' + rate);
        }
      },
    },
    {
      name: 'enquiry success copy claims relevance, not unsupported proximity',
      run: () => {
        const src = readFileSync('components/ClientEnquiryModal.tsx', 'utf8');
        assertTrue(src.includes('up to 3 relevant verified vendors'), 'relevance wording present');
        assertFalse(src.includes('verified vendors near you'), 'no "near you" match claim');
        assertFalse(src.includes('Verified Teams near your area'), 'no near-area claim');
        // The governed consent + cap wording must survive untouched.
        assertTrue(src.includes('up to 3 verified vendors initially'), 'consent cap wording intact');
      },
    },
    {
      name: 'client modals lock the real scroll owner and restore it',
      run: () => {
        for (const file of ['components/ClientEnquiryModal.tsx', 'components/FreeVendorInterestButton.tsx']) {
          const src = readFileSync(file, 'utf8');
          assertTrue(src.includes('document.documentElement'), file + ' locks documentElement');
          assertFalse(src.includes('document.body.style.overflow'), file + ' must not lock body');
          assertTrue(src.includes('previousOverflow'), file + ' captures the previous value');
          assertTrue(src.includes('root.style.overflow = previousOverflow'), file + ' restores it');
          assertTrue(src.includes('previousPaddingRight'), file + ' compensates the scrollbar');
        }
      },
    },
    {
      name: 'client modal stack sits above the public bottom nav',
      run: () => {
        const css = readFileSync('app/client-enquiry-v2.css', 'utf8');
        const publicCss = readFileSync('app/qf-public-v2.css', 'utf8');
        const navZ = Number(/\.qf-bottom-nav\.qf-bottom-nav\s*\{[^}]*z-index:\s*(\d+)/.exec(publicCss)?.[1]);
        const enquiryZ = Number(/\.qf-rf-backdrop\.qf-rf-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
        const freeZ = Number(/\.qf-free-interest-backdrop\.qf-free-interest-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
        const confirmZ = Number(/\.qf-rf-confirm\.qf-rf-confirm\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
        assertEqual(navZ, 90, 'public bottom nav level');
        assertTrue(enquiryZ > navZ, 'enquiry backdrop above the nav');
        assertTrue(freeZ > navZ, 'free callback backdrop above the nav');
        assertTrue(confirmZ > enquiryZ, 'discard confirm above the enquiry shell');
      },
    },
    {
      name: 'client enquiry authority is unchanged by the V2-08 redesign',
      run: () => {
        const modal = readFileSync('components/ClientEnquiryModal.tsx', 'utf8');
        const free = readFileSync('components/FreeVendorInterestButton.tsx', 'utf8');
        const inline = readFileSync('components/vendors/ClientSelectedVendorEnquiry.tsx', 'utf8');
        // General + preferred stay on submitLead with preferred_vendor intent.
        assertTrue(modal.includes('submitLead'), 'general enquiry still calls submitLead');
        assertTrue(modal.includes("lead_intent: \"preferred_vendor\""), 'preferred intent preserved');
        assertTrue(modal.includes('targetVendorId'), 'preferred target preserved');
        // The profile form keeps its own certified backend.
        assertTrue(inline.includes('sendClientSelectedVendorEnquiry'), 'profile form authority preserved');
        // Free vendors stay on the gated interest capture only.
        assertTrue(free.includes('submitFreeVendorProfileInterest'), 'free interest authority preserved');
        assertFalse(free.includes('preferred_vendor'), 'free flow never sends a preferred-vendor enquiry');
        assertFalse(free.includes('submitLead'), 'free flow never submits a lead directly');
        // 10-digit Indian mobile validation survives in every client form.
        for (const [name, src] of [['free', free], ['inline', inline]]) {
          assertTrue(/\[6-9\]\\d\{9\}/.test(src), name + ' keeps 10-digit 6-9 phone validation');
        }
      },
    },

    // --- QF-UI-V2-08R: client enquiry copy corrections -------------------
    {
      name: 'preferred-vendor service label collapses only genuine duplicates',
      run: () => {
        // The reported defect: category and subcategory resolve to the same label.
        assertEqual(formatServiceLabels('Carpenters', 'Carpenters'), 'Carpenters',
          'identical labels render once');
        assertEqual(formatServiceLabels('Carpenters', ' carpenters '), 'Carpenters',
          'trim + case-insensitive match still collapses, keeping the first casing');
        // Genuinely different labels must NOT be collapsed.
        assertEqual(formatServiceLabels('Interior Designers', 'Modular Factory'),
          'Interior Designers / Modular Factory', 'distinct labels are both kept');
        assertEqual(formatServiceLabels('Carpenters', 'Carpentry'),
          'Carpenters / Carpentry', 'similar but distinct labels are both kept');
        // Missing halves degrade cleanly.
        assertEqual(formatServiceLabels('Carpenters', ''), 'Carpenters', 'empty second');
        assertEqual(formatServiceLabels('', 'Carpenters'), 'Carpenters', 'empty first');
        assertEqual(formatServiceLabels(null, undefined), '', 'both absent');
        // The inline profile form uses the same helper with its own separator.
        assertEqual(formatServiceLabels('Carpentry', 'Carpentry', ' · '), 'Carpentry',
          'inline separator variant also dedupes');
        assertEqual(formatServiceLabels('Carpentry', 'Carpenters', ' · '),
          'Carpentry · Carpenters', 'inline separator variant keeps distinct labels');
      },
    },
    {
      name: 'budget placeholders are examples, never prefilled values',
      run: () => {
        assertEqual(BUDGET_MIN_PLACEHOLDER, 'e.g. 50,000', 'minimum placeholder copy');
        assertEqual(BUDGET_MAX_PLACEHOLDER, 'e.g. 3,00,000', 'maximum placeholder copy');
        for (const text of [BUDGET_MIN_PLACEHOLDER, BUDGET_MAX_PLACEHOLDER]) {
          assertTrue(text.startsWith('e.g. '), 'reads as an example: ' + text);
        }
        const src = readFileSync('components/ClientEnquiryModal.tsx', 'utf8');
        // Placeholders only — never a value/defaultValue, and no bare numerics.
        assertFalse(src.includes('placeholder="50000"'), 'old bare minimum placeholder gone');
        assertFalse(src.includes('placeholder="300000"'), 'old bare maximum placeholder gone');
        assertTrue(src.includes('placeholder={BUDGET_MIN_PLACEHOLDER}'), 'min bound to the constant');
        assertTrue(src.includes('placeholder={BUDGET_MAX_PLACEHOLDER}'), 'max bound to the constant');
        assertFalse(src.includes('defaultValue={BUDGET_MIN_PLACEHOLDER}'), 'never a default value');
        assertFalse(src.includes('value={BUDGET_MIN_PLACEHOLDER}'), 'never a bound value');
        assertFalse(src.includes('value={BUDGET_MAX_PLACEHOLDER}'), 'never a bound value');
        // The budget fields stay bound to form state, so nothing can leak to the payload.
        assertTrue(src.includes('value={form.budgetMin}'), 'min stays bound to form state');
        assertTrue(src.includes('value={form.budgetMax}'), 'max stays bound to form state');
      },
    },
    {
      name: 'discard confirmation uses the approved specific copy',
      run: () => {
        assertEqual(DISCARD_CONFIRM_TITLE, 'Discard this enquiry?', 'heading copy');
        assertEqual(DISCARD_CONFIRM_BODY, 'Your entered details will be lost.', 'body copy');
        const src = readFileSync('components/ClientEnquiryModal.tsx', 'utf8');
        assertFalse(src.includes('Are you sure?'), 'vague heading removed');
        assertFalse(src.includes('Your requirement details will be lost.'), 'old body removed');
        assertTrue(src.includes('{DISCARD_CONFIRM_TITLE}'), 'heading bound to the constant');
        assertTrue(src.includes('{DISCARD_CONFIRM_BODY}'), 'body bound to the constant');
        // The two actions and the gating behaviour are untouched.
        assertTrue(src.includes('Keep editing'), 'keep-editing action preserved');
        assertTrue(src.includes('>\n                      Discard\n'), 'discard action preserved');
        assertTrue(src.includes('if (success || !hasData())'), 'confirm gating unchanged');
      },
    },

    // --- QF-UI-V2-09: public utility routes -----------------------------
    {
      name: 'legacy nested carpenter route only redirects to the canonical category',
      run: () => {
        const src = readFileSync('app/category/interiors/carpenters/page.tsx', 'utf8');
        assertTrue(src.includes('permanentRedirect("/category/carpenters")'),
          'permanent 308 redirect to the canonical route');
        // The fabricated listing must be gone from the user path entirely.
        for (const name of ['ModuCraft Interiors', 'WoodNest Interiors', 'Urban Wood Studio',
                            'FineLine Carpentry', 'Prism Interiors', 'CraftEdge Solutions']) {
          assertFalse(src.includes(name), 'invented vendor removed: ' + name);
        }
        for (const token of ['rating:', 'reviews:', 'priorityRank', 'isSubscribed',
                             'Top Rated', 'Budget Friendly', 'Subscription Active',
                             '/ sq ft', 'vendor-listing.module.css']) {
          assertFalse(src.includes(token), 'fabricated listing token removed: ' + token);
        }
        // Its stylesheet is deleted, not merely unreferenced.
        let cssExists = true;
        try { readFileSync('app/category/interiors/carpenters/vendor-listing.module.css', 'utf8'); }
        catch { cssExists = false; }
        assertFalse(cssExists, 'legacy listing stylesheet deleted');
        // The canonical page is untouched and still reads real vendors.
        const canonical = readFileSync('app/category/[slug]/page.tsx', 'utf8');
        assertTrue(canonical.includes('getPublicVendorsForCategory'), 'canonical still reads Supabase');
        assertTrue(canonical.includes('VendorDiscovery'), 'canonical still renders the V2 listing');
      },
    },
    {
      name: 'public utility redirect routes stay intact',
      run: () => {
        const expected = [
          ['app/login/page.tsx', '/vendor?mode=login'],
          ['app/pricing/page.tsx', '/vendors'],
          ['app/vendors/register/page.tsx', '/vendor?mode=signup'],
          ['app/vendors/dashboard/page.tsx', '/vendor/dashboard'],
        ];
        for (const [file, target] of expected) {
          const src = readFileSync(file, 'utf8');
          assertTrue(src.includes('redirect("' + target + '")'), file + ' -> ' + target);
          // Redirect-only: no interstitial UI was added.
          assertFalse(src.includes('<Header'), file + ' stays redirect-only');
        }
      },
    },
    {
      name: 'standalone enquiry keeps its submission authority and validation',
      run: () => {
        const src = readFileSync('components/LeadFunnel.tsx', 'utf8');
        assertTrue(src.includes('submitLead('), 'same submitLead authority');
        assertTrue(src.includes('source: "Enquiry funnel"'), 'source tag unchanged');
        assertTrue(src.includes('share_consent: consent'), 'consent flag unchanged');
        assertTrue(src.includes('readTracking()'), 'UTM capture unchanged');
        assertTrue(src.includes('useActiveCities'), 'active-city authority unchanged');
        assertTrue(src.includes('useActiveCategories'), 'active-category authority unchanged');
        assertTrue(src.includes('defaultService'), '?service= prefill preserved');
        // Every submitted field name survives the restyle.
        for (const field of ['name', 'phone', 'city', 'service_required', 'area',
                             'budget', 'property_type', 'timeline', 'message']) {
          assertTrue(src.includes(field), 'field preserved: ' + field);
        }
        // Validation rules unchanged.
        assertTrue(src.includes('replace(/\\D/g, "").length < 10'), '10-digit phone rule unchanged');
        assertTrue(src.includes('Please accept sharing your details with up to 3 verified vendors to continue.'),
          'consent gate message unchanged');
        // The governed consent paragraph is preserved verbatim.
        assertTrue(src.includes('up to 3 verified vendors initially'), 'consent: initial cap');
        assertTrue(src.includes('may manually connect me with additional verified vendors'),
          'consent: limited manual additional matching');
      },
    },
    {
      name: 'legal pages match the governed consent and drop proximity claims',
      run: () => {
        // JSX wraps long sentences across lines, so collapse whitespace before
        // matching copy, and drop comments so only shipped text is asserted.
        const stripComments = (text) => text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/\s+/g, ' ');
        for (const file of ['app/privacy/page.tsx', 'app/terms/page.tsx']) {
          const body = stripComments(readFileSync(file, 'utf8'));
          // No unsupported proximity wording in shipped copy.
          assertFalse(/vendors near you/i.test(body), file + ': no "vendors near you"');
          assertFalse(/nearby leads/i.test(body), file + ': no "nearby leads"');
          // Matching semantics mirror the consent checkbox.
          assertTrue(body.includes('up to 3 verified vendors initially'),
            file + ': states the initial cap');
          assertTrue(/manually connect/i.test(body),
            file + ': states the limited manual additional matching');
          assertTrue(/city and area/i.test(body), file + ': matching is service + city/area');
          // Legacy dark/gold utilities are gone.
          for (const cls of ['text-ivory', 'text-muted', 'text-gold']) {
            assertFalse(body.includes(cls), file + ': legacy class removed ' + cls);
          }
          assertTrue(body.includes('Last updated: 4 September 2026'), file + ': last-updated refreshed');
        }
        // Terms keeps the commercial model intact.
        const terms = readFileSync('app/terms/page.tsx', 'utf8').replace(/\s+/g, ' ');
        assertTrue(terms.includes('we do not carry out the work ourselves'), 'marketplace model kept');
        assertTrue(terms.includes('Client enquiries are free'), 'free enquiries kept');
        assertTrue(terms.includes('is between you and the vendor'), 'contract boundary kept');
      },
    },

    // --- QF-UI-V2-10: vendor acquisition page ---------------------------
    {
      name: 'vendor acquisition CTAs route to the real portal tabs',
      run: () => {
        const src = readFileSync('app/vendors/page.tsx', 'utf8');
        assertTrue(src.includes('const SIGNUP_HREF = "/vendor?mode=signup"'), 'signup target');
        assertTrue(src.includes('const LOGIN_HREF = "/vendor?mode=login"'), 'login target');
        // Both a signup AND a login CTA must exist (the old page had no login CTA).
        assertTrue((src.match(/SIGNUP_HREF/g) || []).length >= 2, 'signup CTA used');
        assertTrue((src.match(/LOGIN_HREF/g) || []).length >= 2, 'login CTA used');
        // No second auth surface on this page.
        assertFalse(/VendorRegisterForm|LoginForm|<form/.test(src), 'no duplicate auth form');
        // The portal itself still honours both modes.
        const portal = readFileSync('app/vendor/page.tsx', 'utf8');
        assertTrue(portal.includes('searchParams?.mode === "signup" ? "signup" : "login"'),
          'portal still resolves both modes');
      },
    },
    {
      name: 'vendor acquisition page carries no fabricated or unsupported claims',
      run: () => {
        // Assert on shipped JSX only — the file's header comment deliberately
        // records what was removed.
        const src = readFileSync('app/vendors/page.tsx', 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

        // Invented testimonials and businesses.
        for (const name of ['Rohit Deshmukh', 'Sanket Patil', 'Arjun Mehta',
                            'UrbanCraft', 'Patil Modular', 'Mehta Construction']) {
          assertFalse(src.includes(name), 'fabricated name removed: ' + name);
        }
        // Invented dashboard metrics and live-lead theatre.
        for (const token of ['92%', 'New Today', 'Active Client Matches', 'waiting for you',
                             'Accept Match', 'sampleLeads', 'miniLeads', 'testimonials',
                             'VendorHeroStats']) {
          assertFalse(src.includes(token), 'fabricated element removed: ' + token);
        }
        assertFalse(/\dm ago|\dh ago/.test(src), 'no fake relative timestamps');
        assertFalse(/₹\s?\d/.test(src), 'no invented rupee figures');
        // Unsupported marketing promises.
        for (const claim of [/verified client/i, /high-intent/i, /genuine/i, /faster growth/i,
                             /win more/i, /fair distribut/i, /no hidden/i, /24.7 support/i,
                             /pre-qualified/i, /premium visibility/i, /higher conversions/i,
                             /guarantee/i, /unlimited/i, /cancel anytime/i,
                             /future vendor dashboard/i]) {
          assertFalse(claim.test(src), 'unsupported claim removed: ' + claim.source);
        }
        // Public package pricing stays unpublished.
        assertFalse(/Starter|Growth plan|per month|\/month|credits for ₹/i.test(src),
          'no public package pricing');
      },
    },
    {
      name: 'vendor page preview is labelled illustrative and the journey states eligibility',
      run: () => {
        const src = readFileSync('app/vendors/page.tsx', 'utf8');
        // The dashboard preview must announce itself as an example, not live data.
        assertTrue(src.includes('Example view'), 'visible example label');
        assertTrue(/aria-label="Illustrative example[^"]*Not live data\./.test(src),
          'accessible name says illustrative and not live');
        assertTrue(src.includes('Example enquiry'), 'example enquiry labelled');
        // The journey must not imply enquiries start immediately after signup.
        assertTrue(/reviews your profile/i.test(src), 'states QuickFurno review');
        assertTrue(/approved, active and credited/i.test(src), 'states eligibility reality');
        assertTrue(/package and credits/i.test(src), 'states package/credit reality');
        // Metadata is truthful.
        assertFalse(/verified client matches/i.test(src), 'metadata claim removed');
        assertTrue(src.includes('manage matched home-service enquiries'), 'truthful metadata');
      },
    },
    {
      name: 'vendor auth implementation is untouched by the acquisition redesign',
      run: () => {
        // These are the signup/login authority files; V2-10 is presentation only.
        for (const file of ['components/vendor/VendorPortal.tsx']) {
          const src = readFileSync(file, 'utf8');
          assertTrue(src.includes('initialMode'), file + ' still takes initialMode');
          assertTrue(src.includes('/vendor?mode='), file + ' still drives both tabs');
        }
      },
    },

    // --- QF-UI-V2-11: vendor auth + onboarding ---------------------------
    {
      name: 'vendor portal keeps its mode deep-links and tab semantics',
      run: () => {
        const page = readFileSync('app/vendor/page.tsx', 'utf8');
        assertTrue(page.includes('searchParams?.mode === "signup" ? "signup" : "login"'),
          '?mode=signup maps signup, everything else maps login');
        const portal = readFileSync('components/vendor/VendorPortal.tsx', 'utf8');
        assertTrue(portal.includes('router.replace(`/vendor?mode=${next}`, { scroll: false })'),
          'switchMode keeps the exact router.replace target');
        assertTrue(portal.includes('role="tablist"'), 'tablist preserved');
        assertTrue(portal.includes('role="tab"'), 'tab role preserved');
        assertTrue(portal.includes('aria-selected={active}'), 'aria-selected preserved');
        // The copper pill is gone and no inline colour remains.
        assertFalse(portal.includes('#c8892b'), 'copper active tab removed');
        assertFalse(portal.includes('#4b3f33'), 'brown inactive text removed');
        assertFalse(/background: active \?/.test(portal), 'inline tab colouring removed');
      },
    },
    {
      name: 'vendor login authority and role routing are unchanged',
      run: () => {
        const src = readFileSync('components/LoginForm.tsx', 'utf8');
        assertTrue(src.includes('browserClient()'), 'same supabase browser client');
        assertTrue(src.includes('sb.auth.signInWithPassword({ email, password })'), 'same sign-in call');
        assertTrue(src.includes('.from("profiles").select("role").eq("id", data.user.id).single()'),
          'same profiles.role read');
        assertTrue(src.includes('profile?.role === "admin"'), 'same admin test');
        assertTrue(src.includes('router.refresh()'), 'refresh before redirect');
        assertTrue(src.includes('router.push(isAdmin ? "/admin/dashboard" : "/vendor/dashboard")'),
          'same role-based redirect');
        // Enter-to-submit survives on BOTH fields.
        assertEqual((src.match(/e\.key === "Enter" && onSubmit\(\)/g) || []).length, 2,
          'Enter submits from email and password');
        // No second auth implementation and no legacy copper styling.
        assertFalse(/signInWithOtp|signInWithOAuth|magic|resetPasswordForEmail/i.test(src),
          'no new auth method introduced');
        for (const cls of ['btn-gold', 'text-gold', 'className="panel', 'className="field']) {
          assertFalse(src.includes(cls), 'legacy class removed: ' + cls);
        }
      },
    },
    {
      name: 'vendor registration authority and rules are unchanged',
      run: () => {
        const src = readFileSync('components/VendorRegisterForm.tsx', 'utf8');
        assertTrue(src.includes('submitVendorAccountRegistration'), 'sole submit authority');
        assertEqual((src.match(/submitVendorAccountRegistration\(/g) || []).length, 1,
          'submitted through exactly one call');
        // Shared sources of truth are not forked.
        for (const dep of ['mainCategories', 'useActiveCities', 'GooglePlaceAutocomplete',
                           'isPlaceCompatibleWithSelectedCity', 'readTracking', 'CATEGORY_MIN_RATE']) {
          assertTrue(src.includes(dep), 'preserved: ' + dep);
        }
        // Six steps, in order.
        assertTrue(src.includes('const LAST_STEP = 5'), 'six steps (0..5) preserved');
        for (const name of ['Business Identity', 'Service Category', 'City & Base Area',
                            'Location', 'Business Strength', 'Review']) {
          assertTrue(src.includes(name), 'step preserved: ' + name);
        }
        // Validation rules untouched.
        assertTrue(src.includes('key: "confirmPassword"'), 'confirm-password rule kept');
        assertTrue(/10-digit/.test(src), '10-digit phone rule kept');
        // No invented brand remains as a placeholder.
        assertFalse(src.includes('UrbanCraft'), 'fictional business placeholder removed');
      },
    },
    {
      name: 'set-password recovery flow is untouched by the restyle',
      run: () => {
        const src = readFileSync('app/vendor/set-password/page.tsx', 'utf8');
        assertTrue(src.includes('supabase.auth.setSession({'), 'setSession retained');
        assertTrue(src.includes('window.history.replaceState(null, "", window.location.pathname)'),
          'fragment stripped immediately');
        assertTrue(src.includes('supabase.auth.getUser()'), 'getUser retained');
        assertTrue(src.includes('supabase.auth.updateUser({ password })'), 'updateUser retained');
        assertTrue(src.includes('await supabase.auth.signOut()'), 'recovery session signed out');
        assertTrue(src.includes('router.push("/vendor?mode=login")'), 'login redirect retained');
        assertTrue(src.includes('VENDOR_PASSWORD_MIN_LENGTH'), 'minimum length rule retained');
        assertTrue(src.includes('password !== confirm'), 'confirm match retained');
        // Nothing logs or persists a token or password.
        assertFalse(/console\.(log|info|warn|error)\(/.test(src), 'no logging on this page');
        assertFalse(/localStorage|sessionStorage/.test(src), 'no client storage of secrets');
      },
    },

    {
      name: 'vendor portal page states eligibility without promising leads',
      run: () => {
        // Assert on shipped code only — the file header comment records what the
        // old copy said.
        const src = readFileSync('app/vendor/page.tsx', 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/\s+/g, ' ');

        // Unsupported claims must be gone.
        assertFalse(/verified home-service client leads/i.test(src),
          'no "verified ... client leads" — QuickFurno verifies vendors, not clients');
        assertFalse(/verified client/i.test(src), 'no verified-client claim');
        assertFalse(/start receiving/i.test(src), 'signup does not promise leads will start');
        for (const claim of [/guaranteed/i, /instant activation/i, /start earning/i,
                             /grow faster/i, /priority leads/i]) {
          assertFalse(claim.test(src), 'unsupported claim absent: ' + claim.source);
        }

        // The eligibility reality must be stated in full.
        assertTrue(/approved and active/i.test(src), 'states approved and active');
        assertTrue(/package and credits in place/i.test(src), 'states package and credits');
        assertTrue(/matched enquiries/i.test(src), 'uses matched-enquiry wording');
        assertTrue(src.includes('Lead access depends on your account being approved and active'),
          'process step states the eligibility dependency');

        // Title intent is unchanged; the description is the truthful one.
        assertTrue(src.includes('Vendor Portal | QuickFurno'), 'title kept');
        assertTrue(src.includes('manage matched home-service enquiries when eligible'),
          'truthful metadata description');
      },
    },

    // --- QF-UI-V2-12: vendor portal contextual chrome --------------------
    {
      name: 'vendor portal page uses dedicated chrome, not the homeowner Header/Footer',
      run: () => {
        const page = readFileSync('app/vendor/page.tsx', 'utf8');
        // The generic public chrome must not be composed here any more.
        assertFalse(/from "@\/components\/Header"/.test(page), 'generic Header not imported');
        assertFalse(/from "@\/components\/Footer"/.test(page), 'generic Footer not imported');
        assertFalse(/<Header\s*\/>/.test(page), 'generic Header not rendered');
        assertFalse(/<Footer\s*\/>/.test(page), 'generic Footer not rendered');
        // The public fixed bottom nav was never composed here and must stay out.
        assertFalse(/StickyMobileCTA|MobileBottomNav/.test(page), 'no public bottom nav');
        // Dedicated vendor chrome is used instead.
        assertTrue(page.includes('<VendorPortalHeader />'), 'vendor header rendered');
        assertTrue(page.includes('<VendorPortalFooter />'), 'vendor footer rendered');
      },
    },
    {
      name: 'vendor chrome carries no homeowner navigation or client-enquiry CTA',
      run: () => {
        const header = readFileSync('components/vendor/VendorPortalHeader.tsx', 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        for (const banned of ['Get Free Team Matches', 'EnquiryModalTrigger', 'Fill Form',
                              'Categories', 'How It Works', 'For Professionals', 'Resources',
                              'Toggle navigation menu']) {
          assertFalse(header.includes(banned), 'header must not contain: ' + banned);
        }
        assertTrue(header.includes('<header'), 'semantic header element');
        assertTrue(header.includes('aria-label="QuickFurno home"'), 'brand link is labelled');
        assertTrue(header.includes('Vendor Portal'), 'context is readable text');

        const footer = readFileSync('components/vendor/VendorPortalFooter.tsx', 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        for (const banned of ['Free for homeowners', 'Up to 3 matches', 'Get Free Team Matches',
                              'EnquiryModalTrigger', 'Verified vendors ·']) {
          assertFalse(footer.includes(banned), 'footer must not contain: ' + banned);
        }
        assertTrue(footer.includes('<footer'), 'semantic footer element');
        assertTrue(footer.includes('/privacy'), 'privacy link kept');
        assertTrue(footer.includes('/terms'), 'terms link kept');
        // Support reuses the existing destination helper, not a new one.
        assertTrue(footer.includes('whatsappLink('), 'support uses the existing helper');
      },
    },
    {
      name: 'public chrome primitives and homeowner surfaces are untouched by V2-12',
      run: () => {
        // The shared components must still carry their homeowner behaviour.
        const header = readFileSync('components/Header.tsx', 'utf8');
        assertTrue(header.includes('Get Free Team Matches'), 'public header keeps its CTA');
        assertTrue(header.includes('Toggle navigation menu'), 'public header keeps its menu toggle');
        const footer = readFileSync('components/Footer.tsx', 'utf8');
        assertTrue(footer.includes('Free for homeowners'), 'public footer keeps its summary');
        const sticky = readFileSync('components/StickyMobileCTA.tsx', 'utf8');
        assertTrue(sticky.includes('MobileBottomNav'), 'public bottom nav wrapper intact');
        // Homeowner pages still compose the public bottom nav.
        for (const file of ['app/page.tsx', 'app/vendors/page.tsx', 'app/category/[slug]/page.tsx']) {
          assertTrue(readFileSync(file, 'utf8').includes('<StickyMobileCTA />'),
            file + ' still renders the public bottom nav');
        }
        // /vendors stays a public marketing page, not the auth shell.
        const vendors = readFileSync('app/vendors/page.tsx', 'utf8');
        assertTrue(vendors.includes('<Header />'), '/vendors keeps the public header');
        assertFalse(vendors.includes('VendorPortalHeader'), '/vendors is not the auth shell');
      },
    },
    {
      name: 'V2-11R vendor copy survives the chrome change',
      run: () => {
        const raw = readFileSync('app/vendor/page.tsx', 'utf8');
        const src = raw.replace(/\s+/g, ' ');
        // The file's header comment deliberately records the old wording, so the
        // regression check runs against shipped code only.
        const shipped = raw.replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
          .replace(/\s+/g, ' ');
        assertTrue(src.includes('manage matched home-service enquiries when eligible'),
          'V2-11R metadata description unchanged');
        assertTrue(src.includes('Lead access depends on your account being approved and active, with a package and credits in place.'),
          'V2-11R eligibility step copy unchanged');
        assertTrue(src.includes('When can matched enquiries appear?'), 'V2-11R FAQ question unchanged');
        assertFalse(/verified home-service client leads/i.test(shipped),
          'no regression to the old claim in shipped code');
      },
    },

    {
      name: 'vendor portal label appears once, in the header only',
      run: () => {
        const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
        // The persistent contextual badge lives in the header and must stay.
        const header = strip(readFileSync('components/vendor/VendorPortalHeader.tsx', 'utf8'));
        assertTrue(header.includes('qf-vauth-context'), 'header keeps the context badge');
        assertTrue(header.includes('Vendor Portal'), 'header badge still reads Vendor Portal');
        // The page-level eyebrow was the duplicate and must not come back.
        const portal = strip(readFileSync('components/vendor/VendorPortal.tsx', 'utf8'));
        assertFalse(portal.includes('qf-vendor-badge'), 'page-level badge element removed');
        assertFalse(portal.includes('Vendor Portal'), 'no second Vendor Portal label on the page');
        // The intro heading itself is untouched.
        assertTrue(portal.includes('qf-vendor-intro-title'), 'intro title still rendered');
        assertTrue(portal.includes('Login to your vendor dashboard'), 'login title copy unchanged');
      },
    },

    // --- QF-UI-V2-13: superadmin shell + dashboard certification ----------
    {
      name: 'admin login keeps its full fail-closed Superadmin authority',
      run: () => {
        const src = readFileSync('components/AdminLoginForm.tsx', 'utf8');
        // Presentation-only phase: every authority step must survive verbatim.
        assertTrue(src.includes('signInWithPassword'), 'password sign-in intact');
        assertTrue(src.includes('.from("profiles")'), 'profile lookup intact');
        assertTrue(
          src.includes('profile?.role === "admin" && data.user.app_metadata?.admin_role === "Superadmin"'),
          'both role checks intact and ANDed',
        );
        assertTrue(src.includes('if (profileError || !isSuperadmin) {'), 'fail-closed branch intact');
        assertTrue(src.includes('await sb.auth.signOut();'), 'non-superadmin is signed out');
        // No bypass may ever be committed.
        assertFalse(/DEV_BYPASS|SKIP_AUTH|NEXT_PUBLIC_ADMIN_BYPASS|bypassAuth/i.test(src), 'no auth bypass');
      },
    },
    {
      name: 'admin login renders in the admin design system, not the public palette',
      run: () => {
        const src = readFileSync('components/AdminLoginForm.tsx', 'utf8');
        // It is the entry point to the admin; it must speak the qfa language.
        assertTrue(src.includes('var(--qfa-page)'), 'admin page token used');
        assertTrue(src.includes('var(--qfa-surface)'), 'admin surface token used');
        assertTrue(src.includes('qfa-control'), 'shared admin control height/border');
        assertTrue(src.includes('qfa-focus'), 'shared admin focus ring');
        // The legacy public marketing palette must not reappear here. Scan the
        // CODE only: the file's header comment names the old hexes on purpose,
        // to record what was replaced.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        for (const legacy of ['#f3eadf', '#b8874a', '#1f1a14', 'qf-btn', 'qf-eyebrow']) {
          assertFalse(code.toLowerCase().includes(legacy.toLowerCase()),
            'no legacy public token: ' + legacy);
        }
      },
    },
    {
      name: 'admin shell returns focus to the trigger when the drawer is dismissed',
      run: () => {
        const src = readFileSync('components/admin/AdminShell.tsx', 'utf8');
        assertTrue(src.includes('menuButtonRef'), 'trigger ref exists');
        assertTrue(src.includes('ref={menuButtonRef}'), 'ref is attached to the trigger');
        assertTrue(src.includes('menuButtonRef.current?.focus()'), 'focus is restored');
        assertTrue(src.includes('onClose={closeMobileNav}'), 'the drawer control restores focus too');
        assertTrue(/event.key === "Escape" && mobileOpen/.test(src), 'Escape only acts while open');
        // A route change must NOT steal focus back to the hamburger.
        assertTrue(/useEffect\(\(\) => \{\s*setMobileOpen\(false\);\s*\}, \[pathname\]\);/.test(src),
          'route-change close stays a plain state reset');
      },
    },
    {
      name: 'admin surfaces make no unverifiable runtime-safety or metric claims',
      run: () => {
        // QF-MVP-80.03 removed a static "Preview-safe mode" banner that claimed
        // no assignment/credit effect while preview DID assign and debit.
        const shell = readFileSync('components/admin/AdminShell.tsx', 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        assertFalse(/Preview-safe mode/i.test(shell), 'no static preview-safe claim in the shell');
        // The dashboard must not hardcode metric numbers.
        const dash = readFileSync('components/AdminDashboard.tsx', 'utf8');
        assertTrue(dash.includes('emptyCommandCenterData'), 'zero state comes from a real empty model');
        // Sample-scoped figures must be labelled approximate, never absolute.
        assertTrue(dash.includes('approximate'), 'sample-scoped figures are flagged');
      },
    },
    {
      name: 'V2-13 touched no public or vendor chrome',
      run: () => {
        // The phase is admin-only; these approved surfaces must be unchanged.
        const header = readFileSync('components/Header.tsx', 'utf8');
        assertTrue(header.includes('Get Free Team Matches'), 'public header CTA intact');
        const vHeader = readFileSync('components/vendor/VendorPortalHeader.tsx', 'utf8');
        assertTrue(vHeader.includes('Vendor Portal'), 'vendor chrome intact');
        assertFalse(vHeader.includes('qfa-'), 'admin tokens did not leak into vendor chrome');
        const vFooter = readFileSync('components/vendor/VendorPortalFooter.tsx', 'utf8');
        assertFalse(vFooter.includes('qfa-'), 'admin tokens did not leak into vendor footer');
      },
    },
    {
      name: 'no visual-QA harness route is committed',
      run: () => {
        // The V2-13 harness lived at app/qf-visual-qa and must be gone.
        assertFalse(existsSync('app/qf-visual-qa'), 'qf-visual-qa harness removed');
        // And the real admin routes must still be the only way in.
        const section = readFileSync('app/admin/[section]/page.tsx', 'utf8');
        assertTrue(section.includes('if (!session.isLoggedIn) redirect("/admin/login");'), 'login gate intact');
        assertTrue(section.includes('if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");'),
          'superadmin gate intact');
      },
    },

    // --- QF-UI-V2-13R: breadcrumb list marker ----------------------------
    {
      name: 'admin breadcrumb list cannot render a browser list marker',
      run: () => {
        const src = readFileSync('components/admin/AdminShell.tsx', 'utf8');
        const ol = src.match(/<ol className="([^"]*)"/);
        assertTrue(!!ol, 'breadcrumb ol found');
        // globals.css loads @tailwind utilities WITHOUT @tailwind base, so
        // Preflight never resets lists: without these the UA paints "1." and a
        // 40px indent.
        assertTrue(ol[1].includes('list-none'), 'breadcrumb ol disables the marker');
        assertTrue(/\bp-0\b/.test(ol[1]), 'breadcrumb ol drops the UA list indent');
        // The semantic breadcrumb must be preserved, not swapped out to hide it.
        assertTrue(src.includes('<nav aria-label="Breadcrumb">'), 'breadcrumb landmark kept');
        assertTrue(src.includes('aria-current="page"'), 'current crumb still marked');
      },
    },

    // --- QF-UI-V2-14: global public navigation ---------------------------
    {
      name: 'mobile bottom nav derives active state from the pathname',
      run: () => {
        const src = readFileSync('components/MobileBottomNav.tsx', 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        // Home used to be hardcoded active, so it stayed lit on every route.
        assertFalse(/className="qf-bottom-nav-item qf-bottom-nav-item--active"/.test(code),
          'no hardcoded active item');
        assertTrue(code.includes('usePathname()'), 'active state reads the real pathname');
        assertTrue(/isHome\s*=\s*pathname === "\/"/.test(code), 'Home is active only on /');
        assertTrue(/isCategory\s*=\s*pathname.startsWith\("\/category"\)/.test(code),
          'Categories owns the active state on category routes');
        // Screen readers must get the same fact the highlight conveys.
        assertTrue((code.match(/aria-current=\{/g) || []).length >= 2, 'aria-current is exposed');
        // WhatsApp leaves the site, so it is never a page and never "current".
        // (Fill Form IS current on /enquiry - see the V2-14R case below.)
        const waIndex = code.indexOf('WhatsAppGlyph />');
        assertTrue(waIndex > 0, 'WhatsApp item found');
        assertFalse(/aria-current/.test(code.slice(waIndex - 300, waIndex + 200)),
          'WhatsApp is never marked as the current page');
      },
    },
    {
      name: 'public header mobile menu is dismissible and unambiguous',
      run: () => {
        const src = readFileSync('components/Header.tsx', 'utf8');
        // Escape must close the disclosure menu.
        assertTrue(/event.key === "Escape"/.test(src), 'Escape handler present');
        assertTrue(/if \(!open\) return;/.test(src), 'the key listener is bound only while open');
        // The toggle must point at what it controls.
        assertTrue(src.includes('aria-controls="qf-mobile-menu"'), 'toggle declares aria-controls');
        assertTrue(src.includes('id="qf-mobile-menu"'), 'the menu carries that id');
        // Two <nav> landmarks must not share one accessible name.
        assertTrue(src.includes('aria-label="Mobile menu"'), 'header menu has its own landmark name');
        const bottom = readFileSync('components/MobileBottomNav.tsx', 'utf8');
        assertTrue(bottom.includes('aria-label="Mobile navigation"'), 'bottom nav keeps its name');
        assertFalse(src.includes('aria-label="Mobile navigation"'), 'names no longer collide');
      },
    },
    {
      name: 'public nav has one link source and no duplicate contact id',
      run: () => {
        const header = readFileSync('components/Header.tsx', 'utf8');
        // Desktop and mobile must render the SAME list, not two copies.
        assertTrue((header.match(/NAV_LINKS.map/g) || []).length === 2, 'both menus map one list');
        assertEqual((header.match(/const NAV_LINKS/g) || []).length, 1, 'exactly one link source');
        // The homepage shipped id="contact" twice (footer + final CTA).
        const footer = readFileSync('components/Footer.tsx', 'utf8');
        const footerCode = footer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        assertFalse(footerCode.includes('id="contact"'), 'footer no longer duplicates the id');
        assertTrue(readFileSync('components/home/HomeSectionsV2.tsx', 'utf8').includes('id="contact"'),
          'the homepage anchor target is kept');
        // Every header anchor must exist in the homepage composition.
        for (const [href, id] of [['/#categories', 'categories'], ['/#how-it-works', 'how-it-works'],
                                  ['/#why-quickfurno', 'why-quickfurno']]) {
          assertTrue(header.includes(href), 'header links ' + href);
        }
        const home = readFileSync('app/page.tsx', 'utf8')
          + readFileSync('components/home/HomeSectionsV2.tsx', 'utf8');
        for (const id of ['categories', 'how-it-works', 'why-quickfurno']) {
          assertTrue(home.includes('id="' + id + '"'), 'anchor #' + id + ' exists on the homepage');
        }
      },
    },
    {
      name: 'public nav never leaks into vendor or admin chrome',
      run: () => {
        for (const file of ['components/vendor/VendorPortalHeader.tsx',
                            'components/vendor/VendorPortalFooter.tsx']) {
          // Strip comments: these files document WHY they exclude the homeowner
          // CTA, so the raw text names it on purpose.
          const src = readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
          assertFalse(src.includes('MobileBottomNav'), file + ' has no public bottom nav');
          assertFalse(src.includes('StickyMobileCTA'), file + ' has no public sticky CTA');
          assertFalse(src.includes('Get Free Team Matches'), file + ' has no homeowner CTA');
        }
        const vendorPage = readFileSync('app/vendor/page.tsx', 'utf8');
        assertFalse(vendorPage.includes('<StickyMobileCTA />'), '/vendor renders no public bottom nav');
        // WhatsApp destination authority stays in lib/config, not inlined here.
        const bottom = readFileSync('components/MobileBottomNav.tsx', 'utf8');
        assertTrue(bottom.includes('whatsappLink()'), 'WhatsApp uses the existing helper');
        assertFalse(/wa\.me\/\d/.test(bottom), 'no hardcoded second contact authority');
      },
    },

    // --- QF-UI-V2-14R: /enquiry is the Fill Form destination --------------
    {
      name: 'bottom nav marks exactly the right item current on every public route',
      run: () => {
        const src = readFileSync('components/MobileBottomNav.tsx', 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

        // The three predicates that drive the whole table.
        assertTrue(/isHome\s*=\s*pathname === "\/"/.test(code), 'Home: exact "/"');
        assertTrue(/isCategory\s*=\s*pathname.startsWith\("\/category"\)/.test(code),
          'Categories: /category prefix');
        assertTrue(/isEnquiry\s*=\s*pathname === "\/enquiry"/.test(code),
          'Fill Form: exact "/enquiry"');

        // Reproduce the table the predicates imply, for every certified route.
        const activeFor = (pathname) => {
          const hits = [];
          if (pathname === '/') hits.push('Home');
          if (pathname.startsWith('/category')) hits.push('Categories');
          if (pathname === '/enquiry') hits.push('Fill Form');
          return hits;
        };
        const expected = {
          '/': ['Home'],
          '/category/carpenters': ['Categories'],
          '/enquiry': ['Fill Form'],
          '/privacy': [],
          '/terms': [],
          '/vendors': [],
        };
        for (const [route, want] of Object.entries(expected)) {
          const got = activeFor(route);
          assertEqual(got.join(','), want.join(','), route + ' active item');
          // Never more than one current item anywhere.
          assertTrue(got.length <= 1, route + ' has at most one current item');
        }

        // Fill Form stays a modal-opening button; it was NOT turned into a link
        // just to get active styling.
        assertTrue(code.includes('<EnquiryModalTrigger'), 'Fill Form is still the modal trigger');
        assertFalse(/<Link[^>]*Fill Form/s.test(code), 'Fill Form was not converted to a link');
        // Active styling reuses the established class, not a new one.
        assertEqual((code.match(/qf-bottom-nav-item--active/g) || []).length, 3,
          'all three active items share one class');
      },
    },

    // --- QF-UI-V2-15: premium homepage hero artwork -----------------------
    {
      name: 'homepage hero declares exactly three slides with local artwork',
      run: () => {
        const src = readFileSync('components/home/HomeHeroSlider.tsx', 'utf8');
        const media = src.match(/media: "([^"]+)"/g) || [];
        assertEqual(media.length, 3, 'exactly three slides');
        for (const entry of media) {
          const url = entry.replace(/^media: "|"$/g, '');
          // Local-only: no remote host, no protocol-relative, no data URI.
          assertTrue(url.startsWith('/assets/'), 'local asset: ' + url);
          assertFalse(/^https?:|^\/\/|^data:/.test(url), 'no remote/data image: ' + url);
          assertTrue(existsSync('public' + url), 'asset exists on disk: ' + url);
        }
        // Each slide gets its own artwork - the previous set reused one
        // thumbnail template for two slides.
        assertEqual(new Set(media).size, 3, 'three distinct artworks');
        // Artwork is decorative; the copy carries the meaning.
        assertEqual((src.match(/alt: ""/g) || []).length, 3, 'all slide media is decorative');
      },
    },
    {
      name: 'hero keeps one H1, distinct headlines and the enquiry CTA authority',
      run: () => {
        const src = readFileSync('components/home/HomeHeroSlider.tsx', 'utf8');
        // Slide 1 is the page H1; the rest are H2 so the outline stays valid.
        assertTrue(src.includes('const Heading = i === 0 ? "h1" : "h2"'), 'single H1 rule intact');
        const headlines = (src.match(/headline:\s*\n?\s*"([^"]+)"/g) || []);
        assertEqual(headlines.length, 3, 'three headlines');
        assertEqual(new Set(headlines).size, 3, 'no duplicated headline');
        // Every slide keeps the governed enquiry trigger - not a raw link.
        assertEqual((src.match(/<EnquiryModalTrigger/g) || []).length, 1, 'one shared CTA component');
        assertTrue(src.includes('source={`Homepage hero'), 'CTA still reports its source');
      },
    },
    {
      name: 'hero slide copy makes no unsupported marketing claim',
      run: () => {
        const src = readFileSync('components/home/HomeHeroSlider.tsx', 'utf8');
        // Only the declared copy fields, so code identifiers cannot trip this.
        const copy = [...src.matchAll(/(?:headline|support|primary):\s*\n?\s*"([^"]+)"/g)]
          .map((m) => m[1]).join(' ').toLowerCase();
        assertTrue(copy.length > 0, 'copy extracted');
        for (const banned of ['guarantee', 'guaranteed', 'instant', 'lowest price', 'best ',
                              'top rated', '100%', 'same-day', 'trusted by thousands',
                              'award', 'no.1', 'cheapest']) {
          assertFalse(copy.includes(banned), 'no unsupported claim: ' + banned);
        }
        // No invented counts (a bare number followed by customers/projects/reviews).
        assertFalse(/\d[\d,+]*\s*(customers|projects|reviews|clients|vendors served)/.test(copy),
          'no fabricated counts');
        // The approved promise is still stated.
        assertTrue(copy.includes('up to 3 relevant'), 'keeps the approved match claim');
        assertTrue(copy.includes('free for homeowners'), 'keeps the free-for-homeowners claim');
      },
    },
    {
      name: 'hero slider keeps its accessible carousel semantics',
      run: () => {
        const src = readFileSync('components/home/HomeHeroSlider.tsx', 'utf8');
        assertTrue(src.includes('aria-roledescription="carousel"'), 'carousel role description');
        assertTrue(src.includes('aria-roledescription="slide"'), 'slide role description');
        assertTrue(src.includes('aria-label="Previous slide"'), 'previous control is named');
        assertTrue(src.includes('aria-label="Next slide"'), 'next control is named');
        assertTrue(src.includes('aria-selected={i === index}'), 'dots expose selection');
        // Inactive slides must leave the tab order.
        assertTrue(src.includes('inert'), 'inactive slides are inert');
        // Autoplay must yield to reduced-motion and to hover/focus.
        assertTrue(src.includes('prefers-reduced-motion: reduce'), 'reduced motion respected');
        assertTrue(src.includes('if (paused) return;'), 'autoplay pauses');
        const interval = Number((src.match(/INTERVAL_MS = (\d+)/) || [])[1]);
        assertTrue(interval >= 5000 && interval <= 7000, 'interval within 5-7s, got ' + interval);
      },
    },
    {
      name: 'homepage service finder keeps its locked categories',
      run: () => {
        const src = readFileSync('components/home/HomeServiceLauncher.tsx', 'utf8');
        for (const label of ['Interior', 'Carpentry', 'Modular', 'Premium Interiors',
                             'Sofa', 'Painting', 'Civil Work']) {
          assertTrue(src.includes(label), 'finder keeps: ' + label);
        }
        // The hero pass must not have taken over the launcher's subsheet.
        assertTrue(src.includes('aria-modal="true"'), 'subsheet dialog semantics intact');
      },
    },

    // --- QF-UI-V2-16: neutral category artwork ----------------------------
    {
      name: 'every public category has neutral local artwork',
      run: () => {
        // The map must cover the EXISTING taxonomy exactly - no invented
        // categories, none missing.
        const taxonomy = ['Interior Designers', 'Carpenters', 'Modular Factory',
                          'Premium Interiors', 'Sofa', 'Painter', 'Civil Work'];
        assertEqual(categoriesWithArtwork().slice().sort().join('|'),
          taxonomy.slice().sort().join('|'), 'artwork map matches the taxonomy');
        const seen = new Set();
        for (const name of taxonomy) {
          const url = categoryArtwork(name);
          assertTrue(typeof url === 'string' && url.length > 0, name + ' has artwork');
          // Local only: no remote host, no protocol-relative, no data URI.
          assertTrue(url.startsWith('/assets/quickfurno/images/categories/'), 'local: ' + url);
          assertFalse(/^https?:|^\/\/|^data:/.test(url), 'no remote asset: ' + url);
          assertTrue(existsSync('public' + url), 'exists on disk: ' + url);
          assertFalse(seen.has(url), 'each category has its own artwork: ' + url);
          seen.add(url);
        }
        // An unknown name yields nothing rather than a misleading default.
        assertEqual(categoryArtwork('Not A Category'), null, 'unknown category -> null');
        assertEqual(categoryArtwork(''), null, 'empty -> null');
      },
    },
    {
      name: 'category artwork carries no caption, claim or retired palette',
      run: () => {
        for (const name of categoriesWithArtwork()) {
          const file = 'public' + categoryArtwork(name);
          const svg = readFileSync(file, 'utf8');
          // A caption baked into artwork is how the old thumbnails implied a
          // specific project ("Modular Kitchen", "Premium Living Room").
          assertFalse(/<text|<tspan/i.test(svg), 'no baked text in ' + file);
          // Decorative: it must not be announced as content.
          assertTrue(svg.includes('aria-hidden="true"'), 'decorative: ' + file);
          assertFalse(/<title>/i.test(svg), 'no accessible name: ' + file);
          // The retired copper family must not come back.
          for (const dead of ['#8A6342', '#B98A5B', '#F3EADF', '#FFF8EF', '#E8D7C4', '#C67821']) {
            assertFalse(svg.toUpperCase().includes(dead), 'no retired token ' + dead + ' in ' + file);
          }
        }
      },
    },
    {
      name: 'generic artwork is never presented as a vendor photo or project',
      run: () => {
        // Listing thumbnail: the vendor's OWN image, else initials. No stock.
        const card = readFileSync('components/public-listing/VendorListingCard.tsx', 'utf8');
        assertTrue(card.includes('vendor.imageUrl ?'), 'real vendor image wins');
        assertTrue(card.includes('qf-vl-card-initials'), 'initials are the fallback');
        assertFalse(card.includes('categoryArtwork'), 'no category art on listing cards');
        assertFalse(card.includes('images/categories'), 'no category art path on cards');

        // Profile gallery: vendor uploads only, never synthesised.
        const profile = readFileSync('components/public-vendor/profileModel.ts', 'utf8');
        assertTrue(profile.includes('vendor.portfolioImages'), 'gallery reads vendor uploads');
        assertFalse(profile.includes('categoryArtwork'), 'gallery is not synthesised');
        assertFalse(profile.includes('images/categories'), 'no category art in the profile model');

        // The artwork module states, and keeps, its own boundary.
        const art = readFileSync('components/public-listing/categoryArtwork.ts', 'utf8');
        assertTrue(art.includes('never a vendor'), 'module records the contract');

        // Category artwork is only consumed by the category route.
        const page = readFileSync('app/category/[slug]/page.tsx', 'utf8');
        assertTrue(page.includes('categoryArtwork(category.name)'), 'category page uses the map');
        assertTrue(page.includes('aria-hidden="true"'), 'slot is decorative');
        assertTrue(page.includes('alt=""'), 'decorative image has empty alt');
      },
    },
    {
      name: 'category empty/error state keeps its honest copy and CTA authority',
      run: () => {
        const page = readFileSync('app/category/[slug]/page.tsx', 'utf8');
        // The error-vs-empty distinction and its wording are unchanged.
        assertTrue(page.includes('const listingUnavailable = publicVendors === null;'),
          'error state still comes from a null read');
        assertTrue(page.includes('Vendor listings are temporarily unavailable.'),
          'unavailable copy unchanged');
        assertTrue(page.includes('Get Free Team Matches'), 'primary CTA unchanged');
        assertTrue(page.includes('Browse services'), 'secondary CTA unchanged');
        // Routing is untouched by an artwork phase.
        assertTrue(page.includes('getCategoryBySlug'), 'category routing unchanged');
      },
    },

    // --- QF-UI-V2-17: public launch invariants -----------------------------
    {
      name: 'footer headings do not skip a level below the page h1',
      run: () => {
        // MEASURED DEFECT: the shared footer used h3, so on pages whose main
        // content has no visible h2 (/enquiry) the outline jumped h1 -> h3.
        const footer = readFileSync('components/Footer.tsx', 'utf8');
        assertTrue(footer.includes('<h2 className="qf-foot-acc-head">'), 'footer groups are h2');
        assertFalse(/<h3 className="qf-foot-acc-head"/.test(footer), 'no h3 regression');
        // The level change must stay purely semantic: styling lives on the
        // inner button, so no stylesheet may start targeting the heading tag.
        const css = readFileSync('app/qf-public-v2.css', 'utf8');
        assertFalse(/\.qf-foot-acc-head\s+h3|\.qf-foot\s+h3\b/.test(css), 'no tag-based footer heading style');
      },
    },
    {
      name: 'every public nav target is a real route, never a dead href',
      run: () => {
        const header = readFileSync('components/Header.tsx', 'utf8');
        const bottom = readFileSync('components/MobileBottomNav.tsx', 'utf8');
        const footer = readFileSync('components/Footer.tsx', 'utf8');
        const all = header + bottom + footer;
        // No placeholder or script hrefs may ship.
        assertFalse(/href="#"/.test(all), 'no bare # href');
        assertFalse(/href="javascript:/i.test(all), 'no javascript: href');
        assertFalse(/href=""/.test(all), 'no empty href');
        // Header anchors must point at ids the homepage actually renders.
        const home = readFileSync('app/page.tsx', 'utf8')
          + readFileSync('components/home/HomeSectionsV2.tsx', 'utf8')
          + readFileSync('components/home/HomeServiceLauncher.tsx', 'utf8');
        for (const id of ['categories', 'how-it-works', 'why-quickfurno', 'services']) {
          if (!all.includes('/#' + id) && !all.includes('#' + id)) continue;
          assertTrue(home.includes('id="' + id + '"'), 'anchor #' + id + ' exists on the homepage');
        }
      },
    },
    {
      name: 'public surfaces keep the approved claims and add no new ones',
      run: () => {
        const files = ['app/page.tsx', 'components/home/HomeSectionsV2.tsx',
                       'components/home/HomeHeroSlider.tsx', 'components/home/HomeServiceLauncher.tsx',
                       'app/category/[slug]/page.tsx', 'app/enquiry/page.tsx', 'components/Footer.tsx'];
        for (const file of files) {
          // Strip comments so a note ABOUT a banned phrase cannot fail the scan.
          const src = readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').toLowerCase();
          for (const banned of ['guaranteed', 'lowest price', 'cheapest', 'top rated',
                                'same-day', 'trusted by thousands', 'award-winning',
                                'instant match', 'best price']) {
            assertFalse(src.includes(banned), file + ' must not claim: ' + banned);
          }
          // No invented counts of customers/projects/reviews.
          assertFalse(/\d[\d,+]*\s*(customers|projects completed|reviews|happy clients)/.test(src),
            file + ' must not invent counts');
        }
        // The approved promises are still present on the homepage.
        const hero = readFileSync('components/home/HomeHeroSlider.tsx', 'utf8').toLowerCase();
        assertTrue(hero.includes('up to 3 relevant'), 'keeps the up-to-3 claim');
        assertTrue(hero.includes('free for homeowners'), 'keeps the free-for-homeowners claim');
      },
    },
    {
      name: 'legal routes stay linked from the public footer',
      run: () => {
        const footer = readFileSync('components/Footer.tsx', 'utf8');
        assertTrue(footer.includes('/privacy'), 'privacy linked');
        assertTrue(footer.includes('/terms'), 'terms linked');
        // The pages themselves must still exist.
        assertTrue(existsSync('app/privacy/page.tsx'), 'privacy route exists');
        assertTrue(existsSync('app/terms/page.tsx'), 'terms route exists');
      },
    },
    {
      name: 'no visual-QA harness route is present at launch',
      run: () => {
        // Temporary QA routes from earlier phases must never reach a release.
        assertFalse(existsSync('app/qf-visual-qa'), 'no qf-visual-qa route');
        assertFalse(existsSync('app/qf-visual-qa/admin'), 'no admin QA harness');
        assertFalse(existsSync('app/qf-visual-qa/admin-section'), 'no section QA harness');
      },
    },

    // --- QF-UI-V2-17R: vendor signup heading hierarchy ---------------------
    {
      name: 'inline vendor registration step titles are h2, not h3',
      run: () => {
        const src = readFileSync('components/VendorRegisterForm.tsx', 'utf8');
        // This form renders INLINE beneath the page h1 on /vendor?mode=signup,
        // so an h3 step title skipped a level (measured jump "1->3").
        for (const title of ['Tell us about your business', 'What do you specialise in?',
                             'Where do you serve clients?', 'Improve your client matching',
                             'Tell us your business strength', 'Review your application',
                             'Vendor account created']) {
          assertTrue(src.includes('<h2>' + title + '</h2>'), title + ' is an h2');
          assertFalse(src.includes('<h3>' + title + '</h3>'), title + ' is not an h3');
        }
        // No h3 may reappear as a direct step title in this inline form.
        assertEqual((src.match(/<h3>/g) || []).length, 0, 'no bare h3 left in the inline form');
      },
    },
    {
      name: 'the enquiry modal keeps its h3 dialog-title contract',
      run: () => {
        const src = readFileSync('components/ClientEnquiryModal.tsx', 'utf8');
        // Inside a dialog an h3 is correct: it is the accessible NAME, and a
        // dialog starts its own context. This must not be "fixed" too.
        assertTrue(src.includes('aria-labelledby="qf-rf-title"')
          || src.includes('aria-labelledby={"qf-rf-title"}'), 'dialog is labelled by its title');
        assertTrue(src.includes('role="dialog"'), 'dialog role kept');
        assertTrue(src.includes('aria-modal="true"'), 'aria-modal kept');
        const titles = src.match(/<h3 id="qf-rf-title">/g) || [];
        assertTrue(titles.length >= 7, 'every modal step still titles with h3, got ' + titles.length);
        assertFalse(/<h2 id="qf-rf-title">/.test(src), 'modal title was not changed to h2');
      },
    },
    {
      name: 'h2 and h3 step titles render identically in the shared qf-rf styling',
      run: () => {
        // The two surfaces share .qf-rf-question / .qf-rf-success, so the rules
        // must match BOTH tags or the vendor form would restyle itself.
        const css = readFileSync('app/client-enquiry-v2.css', 'utf8');
        assertTrue(css.includes('.qf-rf-question > h2,'), 'question rule covers h2');
        assertTrue(css.includes('.qf-rf-question > h3 {'), 'question rule still covers h3');
        assertTrue(css.includes('.qf-rf-success h2,'), 'success rule covers h2');
        assertTrue(css.includes('.qf-rf-success h3 {'), 'success rule still covers h3');
        // No global heading reset may be introduced to achieve this.
        assertFalse(/^\s*h2\s*\{/m.test(css), 'no global h2 rule');
        assertFalse(/^\s*h3\s*\{/m.test(css), 'no global h3 rule');
      },
    },
    {
      name: 'V2-17R changed no vendor registration or auth authority',
      run: () => {
        const src = readFileSync('components/VendorRegisterForm.tsx', 'utf8');
        // The submit path and its single authority call are untouched.
        assertTrue(src.includes('import { submitVendorAccountRegistration } from "@/app/actions";'),
          'registration action import unchanged');
        assertTrue(src.includes('await submitVendorAccountRegistration({'), 'submit call unchanged');
        // A presentation pass must never introduce a bypass or a second path.
        assertFalse(/signInWithPassword|signOut\(|service_role|admin_role/.test(src),
          'no auth authority in the registration form');
        assertFalse(/DEV_BYPASS|SKIP_AUTH|bypassAuth/i.test(src), 'no bypass');
        // The page h1 is still owned by the portal, not the form.
        const portal = readFileSync('components/vendor/VendorPortal.tsx', 'utf8');
        assertTrue(portal.includes('<h1 className="qf-vendor-intro-title">'), 'portal keeps the page h1');
        assertEqual((src.match(/<h1/g) || []).length, 0, 'the form declares no h1');
      },
    },

    // --- QF-UI-V2-19: listing heading hierarchy ---------------------------
    {
      name: 'category listing headings do not skip a level under the page h1',
      run: () => {
        // Latent until QF-UI-V2-18 put real vendors on the page: the card name
        // and the empty-state heading both sit directly under the category h1
        // with no intervening section heading, so an h3 measured as "1->3".
        const card = readFileSync('components/public-listing/VendorListingCard.tsx', 'utf8');
        assertTrue(card.includes('<h2 className="qf-vl-card-name">'), 'card name is an h2');
        assertFalse(/<h3 className="qf-vl-card-name">/.test(card), 'no h3 regression on the card name');

        const discovery = readFileSync('components/public-listing/VendorDiscovery.tsx', 'utf8');
        const emptyBlock = discovery.slice(discovery.indexOf('qf-vl-empty'));
        assertTrue(/<h2>/.test(emptyBlock.slice(0, 600)), 'empty-state heading is an h2');

        // The category page keeps exactly one h1 and does not add another.
        const page = readFileSync('app/category/[slug]/page.tsx', 'utf8');
        assertEqual((page.match(/<h1/g) || []).length, 1, 'category page declares exactly one h1');
        assertFalse(/<h1/.test(card), 'a listing card never declares an h1');

        // The level change must stay semantic: styling is class-based.
        const css = readFileSync('app/category/vendor-listing-v2.css', 'utf8');
        assertTrue(css.includes('.qf-vl-card-name {'), 'card name styled by class, not tag');
        assertTrue(css.includes('.qf-vl-empty h2,'), 'empty rule covers h2');
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
