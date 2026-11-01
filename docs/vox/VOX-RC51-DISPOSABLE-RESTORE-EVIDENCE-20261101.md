# VOX RC51 — isolated recovery proof (synthetic; production HOLD)

Source baseline: Draft PR #450, exact starting commit `6967f0a64e3316ed74b47bb2ee704d45ddb8e99f`.

Executed on JARVIS on 2026-11-01:
`scripts/mvp/vox/validate-vox20-isolated-recovery.ps1`

**Actual test outcome:** `VOX20_ISOLATED_PG17_SEVEN_MIGRATION_RESTORE_PASS`, exit 0. This was a disposable Docker PostgreSQL 17 source→custom archive→restore proof on `--network none`, with synthetic principals and seven legacy quarantined VOX migrations.

Evidence: `D:\QuickFurno-Workspace\Artifacts\VOX-RC51-DISPOSABLE-RECOVERY-20261101.log` (local JARVIS only, not a portable managed backup artifact).

Verified reported invariants:
- 7 synthetic quarantined VOX migrations restored
- 10 VOX tables and 10 RLS-enabled tables; 5 functions
- Two synthetic profile rows and two synthetic city rows restored
- SHA-256 archive integrity checked
- Privileges preserved and anonymous role denied

**This test is not the managed Staging or Production backup** and did not restore real Auth, Vault, Storage, PostGIS, managed cluster roles/ACLs, production payments or live identities. It does not certify independent DBA/AppSec approval, real team MFA, official EOD or release readiness. Existing managed SQL reconciliation remains blocked by 31 absent original managed migration SQL definitions and 107 unmatched source SQL files.

Approved next external input: immutable read-only original managed SQL capture, full-fidelity isolated managed backup/restore with exact extension and role inventory, independent qualified DBA/AppSec review, Owner/TL MFA and authorized Staging UAT. All managed installs, money, credits, messaging, official EOD and Production remain HOLD.
