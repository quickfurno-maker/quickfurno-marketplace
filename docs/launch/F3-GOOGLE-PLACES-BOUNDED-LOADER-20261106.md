# F3 — Google Places loader recovery without bypassing verification (NO DEPLOY)

**6 November 2026.** Draft integration branch based on [Vendor UI PR #505](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/505) at `8b228beebab2831041265098aaba0c884f912af4`. Reuses one already implemented Google SDK loader source path plus three focused test suites from source SHA `f7ffbc1dbf1f9165c7818d2cfb767be33e238c73`. Does NOT modify Google Cloud account, key restrictions, active cities, location scope, prices, user profiles or managed Staging/Production.

## Problem actually addressed

An existing Google Maps JavaScript SDK tag may be present even if it never completes `importLibrary("places")`, leaving public client and vendor location controls hung indefinitely. A second location input could initiate duplicate concurrent loads, and previously failed promises could poison the next attempt.

## Implementation

- Bound runtime public-key fetch to **2.5 seconds** and Google SDK/Places import attempts to **8 seconds**; unsupported or stalled responses safely resolve `null`.
- Share a single in-flight Places import across all location fields. Do not start multiple SDK requests for a stale preloaded script.
- On script failure remove only the broken SDK script; after failure clear the poisoned promise and allow a later explicit attempt to recover.
- No invented Google Place ID, free-text alternative verification, city geofence override or fallback to device GPS. The actual business address remains unverified without a valid chosen Places result. This software improvement cannot repair a Google account's expired trial or disabled billing.

## Tested locally on JARVIS

- Three SDK suites: bounded import **6/6**, singleflight **3/3**, timeout/recovery **4/4** = **13/13 PASS**.
- Added strict source SHA manifest and **6/6** adversarial tests for modified SDK code, removed timeout, forged billing certification, missing tests and unreviewed Core/payment paths.
- Full Marketplace TypeScript, optimized build and provider-isolated vendor HTTP hold smoke are required to pass independently on exact-head GitHub CI. Passing these tests does not imply a live API key is authorized.
- Existing Phase F2 vendor login gap remains open: returning WhatsApp-only vendor dashboard sign-in must be independently implemented and tested before public vendor recruitment.

**Release HOLD:** no merged code, no managed environment changes, no provider calls, no Google live certification. External Google Cloud billing/Places key restrictions must be handled by the authorized account owner; real Pune/PCMC geofence and suggestion UAT remains an F3 release gate. ClamAV/F5 and Staff activation are unaffected.
