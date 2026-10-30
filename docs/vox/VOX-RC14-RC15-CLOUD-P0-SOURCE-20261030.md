# VOX Cloud-only P0 batch — Finance mode parity, real Pg17 CI and release HOLD

**30 October 2026 · JARVIS PC OFF · protected Draft PR #450 · NO managed Staging/Production changes**

## Source corrections completed in GitHub
- The RC11 review-only Finance attempt-event SQL now compares environment with the **actual source-provider contract**. Historical TEST rows use `payment_provider='razorpay_test'`; current Core `services/vendorPackagePaymentService.ts` uses `payment_provider='razorpay'` and a separate `provider_mode`. The old SQL incorrectly assumed `razorpay_live` was canonical.
- A new validation accepts historical TEST with missing/TEST mode, modern TEST with explicit test mode, modern LIVE with explicit live mode, and rejects contradictory or mode-missing LIVE attempts. It reads `provider_mode` via JSON projection so old rows/tables with no physical column cannot be misinterpreted as LIVE.
- The isolated PG17 Finance fixture now represents five realistic order/mode combinations and checks 4 accepted immutable events / 3 attempts, duplicate sequence, cross-order, mode contradiction, missing order, RLS-denied writes and no change to payment status. A deterministic SOURCE test covers legacy vs modern contracts.
- The fixture waits for a genuine SQL query, not Docker log text (logs are frequently written to stderr on Linux). This is test reliability only, not a quality downgrade.

## GitHub Actions parallel real tests
- `.github/workflows/vox-rc14-finance-mode-pg17-hold.yml`: Node24, no managed DB/provider secrets, disposable loopback-only PG17, actual Finance attempt-event SQL and contract test, strict expected pass marker and container removal, explicit HOLD.
- `.github/workflows/vox-rc15-core-signer-real-pg17-hold.yml`: independent parallel jobs for real Core client/vendor native transaction + original AB7B/F1/nonce source proof, and the distinct Owner+TL **synthetic signer** pending-intent + key revocation interlock. No real signing credentials or production execution. Both jobs require actual PG17, exact pass markers and container cleanup.
- All workflows retain full test execution, no `continue-on-error`, no runtime feature activation, no provider sends, no database migration/deploy.
- This batch is committed only through GitHub without needing the PC. **Actual CI results are not assumed passing until latest exact-head checks finish**.

## Critical new P0 blocker: source-defined Razorpay V2 RPC parity
GitHub source audit finds `services/vendorPackagePaymentService.ts` calls five `*_v2` RPCs and expects `provider_mode`, while the two checked-in vendor payment migrations define V1 RPCs and no mode column. It is not justified to claim the managed database lacks V2 without a read-only managed inventory. Tracking issue: [#451](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/451).

Required to close: a genuine reviewed V2 migration and roles/permissions, isolated full PG17 upgrade from V1 and five-RPC transaction/replay/concurrency tests, signed provider audit ingestion/reconciliation, refunds/consumed credits, independent DBA/AppSec and verified managed recovery. No payment activation is approved.

## Carry-over release gates
Canonical live Staff AAL2-to-native Core Postgres writer, true client-project ownership evidence and reviewed AB7B/F1 migration; two enrolled distinct humans and reviewed official signed EOD; independent DBA/AppSec, managed Supabase Auth/Vault/Storage/roles/ACL/PITR restore; full authenticated feature acceptance; signed deployment; Owner Production GO.

**Release status: DRAFT / HOLD.** New cloud CI may be queued; an automatic hourly existing VOX QA Watch monitors it and reports actionable failures. Monitoring does NOT implement code or authorize releases overnight.
