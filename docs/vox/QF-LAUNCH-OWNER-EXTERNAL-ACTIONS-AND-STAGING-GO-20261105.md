# QuickFurno — Owner Action Packet to Close Protected Launch Gates

**5 November 2026. Release HOLD. Actual operations NOT executed.** This is a precise owner/operator authorization request and acceptance list, not a request to paste credentials into chat or Notion.

## Urgent #1 — Approve limited Staging data preflight and actual backup rehearsal

Target: **QuickFurno Staging only** (Supabase project name verified, Postgres 17, ACTIVE_HEALTHY); **not Production**. Read-only latest ledger: 86 applied migrations, latest 20261013144901; **all 7 November vendor SQL versions absent**. No new private verification schema/bucket. Connected Supabase currently exposes only its default branch; no separately certified data-bearing restore target is available.

**First authorization requested:** Allow aggregate-only, read-only legacy vendor and owner-mapping conflict checks described in `ops/vendor/vendor-before-migration-readonly-preflight-20261105.sql`. This is a data-scoped Staging query. Results should be counts and risk categories only—never raw phone numbers, Auth tokens or customer records.

**Second authorization requested:** Allow a controlled backup and isolated restoration of the **actual Staging** database/Auth/Storage metadata and owned objects, with sanitized proof of roles, RLS, receipt/retention behavior and rollback. An isolated target requires confirmed infrastructure access and potentially additional compute charges; quote cost and obtain Owner approval before provisioning. Neither Supabase's current connection nor source-only `pg_dump` rehearsals independently certifies this full managed restore. Do not perform schema installation until the restore and migration plan pass.

**Explicit exclusion:** No SQL DDL/DML, vendor deletion, seven-migration install, live provider sends, VOX Owner decisions, Staging feature enablement or Production action from this first limited permission. Return separate explicit approval at the installation stage.

**Evidence to close P4-02:** actual backup ID+timestamp and size/integrity verification (no secret value), separately restored target ID, verified migration-ledger counts/catalog, Auth user/session policy and Storage private object ownership tests, RLS/definer grant checks, maximum tested recovery gap, rollback operator/approval and all deviations.

## Urgent #2 — Real provider credentials and Owner UAT (independent in parallel)

| Owner/provider action | Successful acceptance evidence | Must remain disabled until then |
| --- | --- | --- |
| Google Cloud: confirm active billing linked to proper QuickFurno Maps/Places project; browser/server API restrictions and authorized site | Real Pune/PCMC predictions + selected Place ID + server geofence; unsupported city rejection. Public `/api/public/google-maps-config` currently reports configured, which does **not** certify billing | Public registration relying on Google location |
| Meta/WABA: verify approved Authentication template, signed Supabase Auth send hook and designated synthetic WhatsApp test number/consent | Actual signed delivery to Owner-authorized recipient, verified OTP, expiry/replay/rate-limit negatives, no SMS bypass. Do not paste OTP | Live WhatsApp registration |
| Scanner & Storage: authorize private nonpublic verification bucket and genuine ClamAV daemon/signatures with harmless EICAR | One real clean sample and EICAR quarantine, receipt immutability, access denied across users, scanner outage fail-closed. Local ClamAV loopback previously unavailable | Private ID/office document collection |
| VOX Owner: authorized Cloudflare Access Owner sign-in + authenticator TOTP AAL2 | Real AAL1 denied, AAL2 admitted, forged/revoked denied, Core case read and guarded decision. No TOTP shared in documentation | Owner decision write gate |
| Image supply chain: authorize approved pinned public base pull and secure signer/registry as needed | Artifact built from exact reviewed 40-SHA with base digest, SBOM/vulnerability report, signature and immutable registry digest; deployed host digest/rollback verified separately | Production/Staging deployment |

**Do not invent service connection status from existence of a key, from a 302 redirect or from source CI.**

## Exact release sequence

1. Source pin and security review → aggregate-only real Staging preflight → approve actual backup/restore environment.
2. Restore managed Staging safely, review seven exact source migrations and signed rollback.
3. **New explicit Staging SQL authorization** → install the seven migrations, certify grants/RLS/private Storage and providers.
4. Exact signed running VOX Web/Core builds → Cloudflare Owner TOTP AAL2 → synthetic Staging end-to-end and recovery.
5. **New explicit Production GO** → small invite-only Pune/PCMC beta, alerting/rollback and audit.

**Locked business policies:** WhatsApp OTP mandatory, email/GST optional, no PAN; minimum identity and office proof with privacy-minimized Aadhaar; vendor Pending/inactive until separate approval; max three vendors per lead, one credit consumed per delivered lead, zero for browsing, one lead credit restored for bad leads and **no monetary refunds**. Staff frozen, Jarvis Automation Studio outside VOX.

Task board: https://app.notion.com/p/40f751ba167c81cdb55bf1ee0c368a2b
