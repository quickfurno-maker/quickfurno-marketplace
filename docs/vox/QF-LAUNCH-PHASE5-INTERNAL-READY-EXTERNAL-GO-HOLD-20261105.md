# QuickFurno Phase 5 — Controlled Beta Launch: Integrated Source and Operational GO/NO-GO

**Owner-only launch plan, 5 November 2026. Source / isolated QA only. No managed Staging or Production deployment. FINAL RELEASE DECISION: HOLD.**

## Source ancestry
Phase 1 integrated Vendor+VOX Draft PR #492 → Phase 2 Vendor/OTP Draft #493 → Phase 3 Owner/MFA Draft #494 → Phase 4 Staging/offline QA Draft #495 → this Phase 5 candidate. No new business-logic authority, no wholesale rebuild. Core continues to own registration, matching, vendor verification, lead credits and case decisions. Staff/Team Leader activation frozen; Automation Studio stays JARVIS.

## Last internal source gaps closed
- **Google Places bootstrap recovery:** 8-second maximum initialization, including existing script whose load event already fired; broken script is removed, shared promise settles null and subsequent use retries; healthy load cancels timer and succeeds. Real free-trial/billing status remains UNVERIFIED or expired per Owner’s earlier observation. This fix cannot restore actual Places suggestions without an active authorized Google account; manual location remains non-Google evidence and cannot bypass server city/geofence verification.
- **Sequential vendor synthetic journey:** new cross-step PostgreSQL 17 acceptance executes after the seven exact source migrations and existing private OTP, atomic Pending, consent, office/document scan receipt, Owner decisions and queue tests. It proves *synthetic* ready verification cases are still business status Pending, inactive, not accepting leads, not publicly visible and not credited or automatically assigned. A revoked-consent vendor fails readiness, and an evidence marked clean without linked immutable scan receipt cannot count. It does not represent Meta delivery, actual ClamAV scanner, a real Auth session or managed Staging.
- Source CI adds the Google bootstrap negative tests and the cross-step assertions, while the existing networkless disposable PG17 runner now executes 18 fixture/migration/acceptance steps and performs `pg_dump -Fc` / `pg_restore` for source/restore catalog equivalence.

## Concrete five-phase gate ledger
| Phase | Internal engineering | Operational gate |
| --- | --- | --- |
| 1 Integrated source / no duplicate Core | Completed source CI (Draft #492) | Draft unmerged; formal protected merge still gated |
| 2 Vendor registration/OTP/evidence | Completed source CI (Draft #493) | WhatsApp signed-hook delivery + safe real identity/private evidence + scanner and bucket not certified |
| 3 VOX Owner verification | Completed source CI (Draft #494) | Exact deployed VOX/Core images, real Cloudflare Access→TOTP AAL2 Owner UAT not certified |
| 4 Staging/recovery | Read-only ledger inspection + offline isolated PG17 dump/restore source CI (Draft #495) | 7 new SQL migrations absent, verification bucket and scoped Core RPC absent; actual managed DB/Auth/Storage restore not certified |
| 5 Controlled Pune/PCMC beta | Google loader no-hang improvement + cross-step synthetic QA | Google billing/Places, actual Staging E2E, separately approved Production GO not performed |

## Non-negotiable real prerequisites before an invite-only beta
1. Capture current QuickFurno Staging applied migrations and catalog. Date-bounded capture on 5 Nov: **86** migrations, latest `20261013144901`, zero of seven November vendor SQL applied; matching verification bucket and new Core RPCs not observed. Re-capture read-only immediately before approved change. Do NOT use Production as a shortcut.
2. Owner-authorized protected Staging maintenance window, qualified database migration and rollback review, immutable seven-file checksums, real DB/Auth/Storage backup, isolated restoration with actual access control/RLS verification and signed go/no-go. Never rewrite historical captured VOX 162-file evidence or unquarantine frozen Staff SQL.
3. Separate Staging approval to apply exact seven source-pinned vendor SQL migrations in order. Test owner/new private functions, grants/RLS, private Storage bucket restricted ACL, retention/purge and object ownership. No real client/vendor data in QA.
4. Real scanner with pinned ClamAV binary/signature database, clean and harmless EICAR controls, actual quarantine receipts and fail-closed outage handling. JARVIS local ClamAV at latest check was **unavailable/unavailable**; an offline mock pass is not real engine certification.
5. Meta WhatsApp OTP real signed Supabase Auth hook + purpose reservation, template delivery and recipient consent, rate/replay/expiry, no SMS fallback, with approved synthetic phone numbers only. HTTP 202 initiated is NOT delivery proof. Email/GST optional, no separate PAN collection, no unrestricted raw Aadhaar uploads.
6. Google Maps billing/API and restricted key for authorized QuickFurno browser and server origins. Verify actual Pune/PCMC autocomplete and unsupported-city hard rejection. Timeout and manual typing cannot manufacture valid Google place/geolocation evidence.
7. Cloudflare Access → VOX Owner sign-in → GoTrue authenticator AAL2 → case queue → version-locked Owner decision from exact running signed VOX Web/Core immutable image digests, browser negative tests for AAL1, non-Owner, forged/revoked sessions and stale case versions. Keep decision write gate OFF until separately signed evidence. Review does not automatically activate vendor or route leads.
8. Governed synthetic full vendor journey and recovery drill in protected Staging, independently capture sanitized audit/report; restore/backout and monitoring verified. Maintain assignment maximum three eligible vendors and exactly one lead credit per delivered lead, zero credits for browsing; bad lead remedy restores **one lead credit, no cash refund**.
9. Only after all eight gates, explicit **Owner Production GO** with a short rollback window: deploy immutable exact reviewed code, enable Owner read + vendor signup for a **small invite-only Pune/PCMC cohort**, no Staff/Finance/EOD/advertising changes, alert on OTP delivery/scan/queue and first contact, halt on any violation. Release GO is **not** implied by all green GitHub workflows or any JSON checklist.

## Current fail-closed production decision
`HOLD`. Managed Staging and Production not deployed, neither customer nor vendor registration enabled, real provider messages and Google billing untouched, actual scanner not installed, no protected Owner decision/lead assignment/wallet activity, no production blast radius. The script tests and runbook are meant to shorten approved Staging acceptance, not to replace actual signed external attestations.

Canonical Notion plan: https://app.notion.com/p/40f751ba167c819d8827cb89a5340dcc
