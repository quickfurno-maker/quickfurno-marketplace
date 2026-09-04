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
import { readFileSync } from 'node:fs';

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
