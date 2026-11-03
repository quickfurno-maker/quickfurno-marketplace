# VOX Owner O1 — Reuse and Integration Register (3 November 2026)

**Release classification:** Source candidate; not deployed, not certified for live operations.
**Architecture:** VOX Owner UI/BFF -> pinned private Staging Core -> existing canonical QuickFurno services.
**Owner scope:** Client Operations + Vendor Operations. Staff preserved and frozen.
**Automation Studio:** QF Jarvis ONLY; no Owner Studio navigation, migration or activation.

| Owner feature | Already implemented / single source of truth | Existing VOX reuse | O1 addition | Next acceptance blocker |
| --- | --- | --- | --- | --- |
| Owner auth/AAL2 | Core verified Superadmin bearer `services/vox/verifiedStaffBearer.ts` and VOX MFA `apps/vox-web/lib/auth.ts` | `/api/vox/v1/overview`, `owner-workspaces` | Reuse same Owner-only read gate | Genuine browser Owner session / post-read auth UAT |
| Client leads | `leads` table, Core lead service, `/admin/leads` and existing matching authority | New metadata projection exposed via existing `owner-workspaces` only | `kind=clients` bounded recent rows, no PII; `/owner/clients` | Full searchable 20/page secure Client 360/qualification, nonmutating matching preview and audited command API |
| Vendor relationships | `vendors`, `vendor_crm_profiles`, `vendor_tasks`, canonical approval services | Owner-only `kind=vendor360` read projection and Web `fetchScopedCrm` | `/owner/vendors` reuses same adapter | Full directory, signup review, KYC and audited approval command contract |
| Aarohi acquisition | `aarohi_prospects`, `aarohi_tasks`, Core Admin Aarohi | Owner-only Acquisition read | Remains existing `/acquisition` drilldown | Owner task lifecycle, consent checks |
| Vendor/support messages | Core Human Desk, support and communication services | Owner-only desk read | No new message actions | Consent, revision, provider send certification |
| Finance/credits | Core Finance, package orders and canonical credit ledger | Existing read-only Owner Finance candidate | No new finance writes | One-lead-credit bad-lead policy + atomic RPC + external gates |
| Owner Home | VOX `/operations` and existing read overview | Existing deployed November 2 UI must be preserved | New navigation to Client + Vendor workspaces | Full UI/auth reconciliation, verified KPI scope |
| Staff Management | Existing Staff/Team Leader modules | None exposed in Owner O1 | **No work** | Later explicit separate project |
| Automation Studio | Jarvis Agent Flow Studio; Core automation runtime | Dormant VOX Studio source preserved | **Excluded** | Stays in QF Jarvis |

## O1 delivered-source boundaries

- All new APIs use existing Staging Owner feature gates; no new Production flags or tables.
- The Client endpoint exposes at most 12 recent metadata rows; it does **not** promise exhaustive counts, quality, contact success or credits.
- Vendor Operations reuses the existing 12-row Owner Vendor360 projection; no new vendor backend created.
- Both workspace pages are **read-only**. No approval, assignment, provider send, package activation, credit debit or money mutation.
- Existing Core Admin remains a restricted transitional fallback, not accepted as VOX end-state.
- Owner-only navigation surfaces these two workspaces and keeps Jarvis Automation Studio outside VOX.
- Existing Staff/Team Leader paths remain unchanged.

## Next implementation tranche (not delivered in O1)

1. Gate A: reconciled deployed Owner UI/auth and exact stacked PR dependencies, full read and command OpenAPI contract, MFA/CSRF/nonce/expected-revision/idempotency/audit.
2. Client Ops: canonical 20/page Core lead read/search and detail, quality and Riya qualification, genuine nonmutating matching preview, manual assignment only after real Core security/ledger certification.
3. Vendor Ops: 20/page Vendor 360, real new-registration inbox, KYC/location evidence, gated Owner approve/reject/suspend, Anisha CRM and Aarohi prospects.
4. Shared: truthful read-only finance, Core alerts/audit/reporting; live assignment mode `auto_suggest` is currently mutating and must be explicitly controlled before vendor activation.
5. E2E: verified real Owner AAL2, role/replay/CSRF negatives, true vendor registration and lead first contact, Staff regression, signed private Staging canary, rollback, separately authorized Production GO.

No production change, SQL migration, live provider interaction or API write action in O1.
