# QuickFurno Pune / पुणे Google Places false-negative — source fix and immediate Admin remedy

**6 November 2026. DRAFT / NO DEPLOY.** Stacked on [F3 Google SDK Draft PR #506](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/506) at exact base `decf3ddcad49e702cad11b756d8910530938c8bb`. No change to admin-active city, existing vendor assignments, lead matching, Core/VOX, provider settings, managed data, scanner or production.

## Reproduced incident with live read-only configuration

Actual user screenshot: select Kunal Belleza in Bavdhan, Pune; Google's location response labels the city as **`पुणे`**. Website wrongly displays "QuickFurno isn't serving पुणे yet". Read-only live `GET https://quickfurno.in/api/cities` returned HTTP 200 with active **Pune**, `matchingEnabled:true`, and only `["Pune","Pimpri-Chinchwad","Pimpri Chinchwad","PCMC"]` in `acceptedCityLabels`. Thus the existing client-side `isPlaceCompatibleWithSelectedCity` rejects the legitimate Google city label, notwithstanding verified Google billing and enabled Places/Maps APIs.

## Immediate reversible live configuration fix (Owner Admin, not automatic SQL)

In the existing QuickFurno **Admin → Cities & Locations → Pune → Market config**, modify only the comma-separated **Google city labels** field to:
```
Pune, Pimpri-Chinchwad, Pimpri Chinchwad, PCMC, पुणे
```
Do NOT change Active, Matching, Priority or zone boundaries. Click **Save**. The existing admin action `adminUpdateCityMarketSettings` calls `qf_admin_update_city_market_v1` and invalidates `/api/cities`. Verify the public read-only endpoint now includes `पुणे`; reopen the homepage, pick the actual Google building prediction (not just type it) and ensure saved `city=Pune`, genuine Place ID and coordinates. This remedy requires no deployment if the current live admin UI supports Market config.

## Bounded defensive code correction

`lib/google-maps/normalizePlace.ts` now maps **only the entire Unicode Marathi token `पुणे`** to canonical city key `pune` in a comparison function, including exact address tokens separated by real Unicode boundaries. This is not phonetic fuzzy matching, not unbounded transliteration, and does not guess city from user input. The actual selected Google Place ID, coordinates and active city record remain mandatory, with Google city/address components independently verified. Partial labels like `पुणेकर` and unsupported cities like Mumbai, Nashik and Nagpur still fail against the current active Pune list. Admin still decides whether Pune is active.

### Regression evidence

- **Baseline red reproduced:** before patch PUNE-01/02/03 rejected valid Marathi Google city and address while five other safety tests passed.
- **After patch 8/8 PASS:** exact Kunal Belleza-like raw Google locality, Marathi city and formatted address, Pune/PCMC equivalence, English and Marathi unsupported-city rejection, Admin-supplied alias authority, Place ID/coords and active-city record constraints.
- **Whole Marketplace typecheck PASS**, **optimized build PASS**, and **8/8 compiled localhost HTTP checks PASS** with all Meta/Google/managed provider credentials removed from the test process; no real sends, DB writes or deployment.
- SHA-pinned exact source/test manifest, dedicated read-only CI and hostile mutation tests on scoped branch. No source/test bulk import.

## Important release status

Even after the Admin alias is saved and verified, this **does not certify real customer-vendor lead assignment** or a Production launch. General source release of this patch remains **DRAFT** until signed image, Staging and rollback controls pass. The admin-only city-label data correction is the fastest reversible way to address this live false-negative; it is separate from the protected release train. Do not activate inactive cities, relax city geofencing, or disable project location verification.
