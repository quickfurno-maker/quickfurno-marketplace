# VL-02 — Canonical Google Places vendor geography
13 October 2026 — SOURCE IMPLEMENTATION IN PROGRESS; no production cutover.

## One Google location system
The shared `GooglePlaceAutocomplete` is reused for live vendor account registration, the older public application form, and superadmin CRM office backfill. Public customer project-location flows continue using `PublicGoogleLocationInput` / `ProjectLocationProvider`. There is no device GPS/Routes API and no second provider.

## Contract and authority
- Location selection: Google Places (New), browser-restricted key, Place ID, Google city, formatted address, latitude and longitude. Manual text immediately invalidates prior selected Place metadata.
- Vendor signup: active Core city, Google suggestion required on the full form; the server stores supplied Place data as unverified **review candidate** only. The new vendor is Pending, `accepting_leads=false`, with no verified office coordinates, zone, or Core location-verification timestamp. An alternate old application form also captures Google selection and remains Pending.
- Superadmin office backfill: re-fetch selected Place ID through the server-only `GOOGLE_MAPS_PLACES_SERVER_KEY` using the Places (New) Details API; verify Google-returned coordinates and city components against active Core city labels and Core's authoritative service-zone resolver. Store Google-returned, not browser-entered, address and coordinates. Fail closed on missing key, mismatched point, unsupported city or unavailable resolver; capture actor-bound audit.
- Service coverage: Core's active city and PostGIS service-zone polygons continue to decide matching permissions. Google supplies the place point, NOT entitlement or a new service-zone definition.
- Vendor self-serve profile: service-area summary remains descriptive only; changes to verified office point require Core-mediated review and admin verification. A future vendor-origin change request must reuse the shared Google component and cannot write verified location directly.
- Money and communication: changing the office location alone must not modify credits, package, vendor approval, communication consent, lead assignments or Meta messages.

## Operating gates
1. Configure server-only Google Places API (New) key and appropriate API restrictions; keep existing browser-referrer key separate. No secrets are committed.
2. Certify mocked Places response with cross-city, altered coordinates, missing API key, duplicate/place replay, incomplete components, and service-zone rejection.
3. Certify actual Google Places lookup and genuine vendor → admin location → eligibility against isolated staging.
4. Record approved/unlinked vendor backlog and zero verified locations as operational launch blockers; do not bulk activate 28 historical vendors or retroactively rewrite lead/credit logs.
5. Require signed image, green CI, approval-bound promotion, live rollback check, and a separately authorized vendor canary before production enablement.

This document is source-only evidence, not production Google API verification, not payment/lead delivery certification, and not VL-02 completion.
