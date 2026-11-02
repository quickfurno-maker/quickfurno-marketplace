# VOX RC5 Track B — Approval ledger least-privilege hardening

**30 October 2026 — SOURCE + ISOLATED POSTGRESQL17 PASS; PROTECTED RELEASE HOLD**.

The uninstalled, **disposable-only** RC4 approval nonce/subject and key-revocation ledger tables in `ops/vox/rc4-approval-overlay/20261030020000_vox_rc4_approval_nonce_ledger_disposable.sql` now explicitly use `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` on both public tables, in addition to existing PUBLIC table/EXECUTE revocations, append-only triggers and same-transaction nonce+subject uniqueness. The disposable verifier now demands both RLS flags and checks a temporary untrusted role cannot SELECT nonce rows, INSERT revocation rows or EXECUTE the privileged claim function. The test role exists only inside a rolled-back verification transaction; it is never created in managed Supabase.

Executed on JARVIS:
- `node --test .../rc5-approval-ledger-security.test.mjs .../rc4-approval-pipeline.test.mjs`: **18/18 PASS**, no failures.
- **Actual** `postgres:17-alpine` run, Docker `--network none`, synthetic `qf_disposable_*` database. Both SQL scripts installed/executed with `ON_ERROR_STOP=1`; verifier emits `RC4_LEDGER_VERIFY_PASSED_DISPOSABLE_ONLY`; shell exit **0**.
- Existing Ed25519 Owner/Team Leader signature verifier remains pinned, with no real enrolled signing public keys, and official EOD/Operator approvals remain strictly hard-off.

These changes **do not** install a trusted atomic approval writer or a production signer and are not managed Staging DDL. Before activation: genuine distinct Owner/TL AAL2, approved key enrollment ceremony, verified DB-side nonce+revocation and approval writer, independent qualified DBA/AppSec review and managed recovery certification.
